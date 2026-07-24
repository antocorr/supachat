import { globals, tick } from 'tinybubble';
import { api, clientLog } from '../api/client.js';

export default {
  name: 'WorldPanel',
  props: ['conversationId', 'conversationModel'],
  emits: [],
  components: {},
  template() {
    return /*html*/`
      <div class="world-panel">
        <h2 class="world-panel-title">Story</h2>

        <template x-for="section in sections">
          <details class="world-section">
            <summary class="world-section-header" @click="toggleSection(section)">
              <span class="world-section-title">{{ section.label }}</span>
              <span class="world-section-count">({{ entriesByKind(section.kind).length }})</span>
              <button type="button" class="world-add-btn" @click="openCreateModal(section.kind, $event)" title="Add {{ section.label }}">+</button>
            </summary>
            <div class="world-section-body">
              <template x-if="!entriesByKind(section.kind).length">
                <p class="empty-state">No {{ section.label }} yet.</p>
              </template>
              <template x-for="(entry, idx) in entriesByKind(section.kind)">
                <div class="world-entry">
                  <div class="world-entry-row">
                    <input class="world-entry-title" x-model="entry._title" placeholder="Title" @change="markDirty(entry)" style="flex:1">
                    <button type="button" class="ai-assist-btn" :disabled="!entry._title.trim()" @click="startAssist(entry, 'title')" title="AI: expand title"><span class="material-symbols-outlined">auto_awesome</span></button>
                    <button type="button" class="form-expand-btn" @click="openEditModal(entry)"><span class="material-symbols-outlined" style="font-size:14px">open_in_full</span></button>
                    <button type="button" class="danger-action" @click="deleteEntry(entry)" title="Remove">✕</button>
                  </div>
                  <div x-if="entry._assistField === 'title'" class="ai-assist-llimi">
                    <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="entry._assistSlider"> <span>{{ entry._assistSlider }}/5</span></label>
                    <button type="button" class="ai-assist-btn-sm" @click="runAssist(entry, 'title')" :disabled="entry._assistLoading"><span class="material-symbols-outlined">refresh</span></button>
                    <button type="button" class="ai-assist-undo" @click="undoAssist(entry)"><span class="material-symbols-outlined">undo</span> Undo</button>
                    <span x-if="entry._assistLoading" class="ai-assist-loading">Generating…</span>
                  </div>
                  <div class="ai-textarea-wrap" style="margin-top:4px">
                    <textarea class="world-entry-content" x-model="entry._content" placeholder="Content" @change="markDirty(entry)" rows="2" style="flex:1"></textarea>
                    <button type="button" class="ai-assist-btn" :disabled="!entry._content.trim()" @click="startAssist(entry, 'content')" title="AI: expand content"><span class="material-symbols-outlined">auto_awesome</span></button>
                  </div>
                  <div x-if="entry._assistField === 'content'" class="ai-assist-llimi">
                    <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="entry._assistSlider"> <span>{{ entry._assistSlider }}/5</span></label>
                    <button type="button" class="ai-assist-btn-sm" @click="runAssist(entry, 'content')" :disabled="entry._assistLoading"><span class="material-symbols-outlined">refresh</span></button>
                    <button type="button" class="ai-assist-undo" @click="undoAssist(entry)"><span class="material-symbols-outlined">undo</span> Undo</button>
                    <span x-if="entry._assistLoading" class="ai-assist-loading">Generating…</span>
                  </div>
                  <div style="margin-top:4px;display:flex;gap:6px">
                    <button type="button" class="world-save-btn" @click="saveEntry(entry)" :disabled="!entry._dirty || entry._saving">{{ entry._saving ? 'Saving…' : '💾 Save' }}</button>
                  </div>
                </div>
              </template>
            </div>
          </details>
        </template>

        <div class="world-actions">
          <button type="button" class="reset-compaction-btn" @click="resetCompaction" title="Reset the LLM conversation memory/summary">🗑 Reset memory</button>
        </div>

        <!-- Create / Edit modal -->
        <div x-if="createModal" class="modal-overlay">
          <div class="modal-backdrop" @click="cancelCreate"></div>
          <div class="modal-card">
            <div class="modal-header">
              <h3>{{ createTitle() }}</h3>
              <button type="button" class="modal-close" @click="cancelCreate">✕</button>
            </div>
            <div class="modal-body">
              <label class="form-label">Title
                <input class="modal-input" x-model="createTitleVal" placeholder="Title" ref="createTitleInput">
              </label>
              <label class="form-label">Content
                <textarea ref="createTextarea" class="modal-textarea" x-model="createContent" placeholder="Enter content…"></textarea>
              </label>
              <div class="ai-assist-llimi modal-ai-row">
                <button type="button" class="ai-assist-btn-sm" @click="generateCreateText" :disabled="modalAssist.loading || !createContent.trim()" title="Generate"><span class="material-symbols-outlined">auto_awesome</span></button>
                <button type="button" class="ai-assist-btn-sm" @click="continueCreateText" :disabled="modalAssist.loading || !createContent.trim()" title="Continue writing"><span class="material-symbols-outlined">arrow_forward</span></button>
                <span x-if="modalAssist.loading" class="ai-assist-loading">{{ modalAssist.mode === 'continue' ? 'Continuing…' : 'Generating…' }}</span>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" @click="cancelCreate">Cancel</button>
              <button type="button" class="modal-save" @click="saveCreate">Save Changes</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },
  data() {
    return {
      entries: [],
      sections: [
        { kind: 'setting', label: 'Settings', open: false },
        { kind: 'fact', label: 'Facts', open: false },
        { kind: 'chapter', label: 'Chapters', open: false }
      ],
      createModal: false,
      createKind: '',
      createTitleVal: '',
      createContent: '',

      modalAssist: { loading: false, mode: '' },
      _saveTimer: null,
    };
  },
  createTitle() {
    const kind = this.data.createKind.value;
    const found = this.data.sections.value.find(s => s.kind === kind);
    if (this._editingEntry) return `Edit ${found ? found.label : 'Entry'}`;
    return found ? `New ${found.label}` : 'New Entry';
  },
  entriesByKind(kind) {
    return (this.data.entries.value || []).filter(e => e.kind === kind);
  },
  async init() {
    await this.loadEntries();
  },
  mounted() {
    this._stateHandler = (event) => {
      const data = event.detail || event;
      if (data.storyEntries) {
        this.data.entries.value = this.normalizeEntries(data.storyEntries);
      }
    };
    document.addEventListener('state_changed', this._stateHandler);
    this._autoSave();
  },
  beforeDestroy() {
    if (this._stateHandler) document.removeEventListener('state_changed', this._stateHandler);
    if (this._saveTimer) clearInterval(this._saveTimer);
    this._stateHandler = null;
    this._saveTimer = null;
  },
  _autoSave() {
    this._saveTimer = setInterval(() => {
      for (const entry of this.data.entries.value || []) {
        if (entry._dirty) this.saveEntry(entry);
      }
    }, 2000);
  },
  normalizeEntries(raw) {
    return (raw || []).map(e => ({
      ...e,
      _title: e.title || '',
      _content: e.content || '',
      _dirty: false,
      _saving: false,
      _assistField: null,
      _assistSlider: 3,
      _assistLoading: false,
      _originalTitle: e.title || '',
      _originalContent: e.content || ''
    }));
  },
  async loadEntries() {
    const id = this.props.conversationId;
    clientLog('world_load_entries', { id: !!id });
    if (!id) { clientLog('world_load_abort', { reason: 'no conversationId' }); return; }
    try {
      const response = await api.getStoryEntries(id);
      const raw = Array.isArray(response) ? response : (response?.storyEntries || response?.entries || []);
      clientLog('world_entries_loaded', { count: raw.length });
      this.data.entries.value = this.normalizeEntries(raw);
    } catch (error) {
      clientLog('world_load_error', { message: error.message || String(error) });
    }
  },
  // ── Create modal (same pattern as AgentPanel expand) ──
  openCreateModal(kind, event) {
    event.stopPropagation();
    clientLog('world_modal_open', { kind });
    this._editingEntry = null;
    this.data.createKind.value = kind;
    this.data.createTitleVal.value = '';
    this.data.createContent.value = '';
    this.data.createModal.value = true;
    setTimeout(() => {
      const input = this.refs?.createTitleInput;
      if (input) input.focus();
    }, 50);
  },
  cancelCreate() {
    this.data.createModal.value = false;
    this.data.createKind.value = '';
    this._editingEntry = null;
  },
  saveCreate() {
    const id = this.props.conversationId;
    const kind = this.data.createKind.value;
    const title = this.data.createTitleVal.value.trim();
    const content = this.data.createContent.value.trim();
    clientLog('world_modal_save', { kind, titleLen: title.length, contentLen: content.length });
    if (!id || !kind) return;
    if (this._editingEntry) {
      api.patchStoryEntry(id, this._editingEntry.id, { title, content })
        .then(() => {
          this._editingEntry._title = title;
          this._editingEntry._content = content;
          this._editingEntry._dirty = false;
        })
        .catch(error => clientLog('world_entry_error', { message: error.message || String(error) }));
    } else {
      api.createStoryEntry(id, { kind, title, content })
        .then(entry => {
          clientLog('world_entry_created', { kind, id: entry?.id });
          const list = Array.isArray(entry) ? entry : [entry];
          this.data.entries.value = [...this.data.entries.value, ...this.normalizeEntries(list)];
          const section = this.data.sections.value.find(s => s.kind === kind);
          if (section) section.open = true;
        })
        .catch(error => clientLog('world_entry_error', { message: error.message || String(error) }));
    }
    this.data.createModal.value = false;
    this.data.createKind.value = '';
    this._editingEntry = null;
  },
  // ── AI Assist in modal (same pattern as AgentPanel) ──
  _contentKind(kind) {
    return kind || this.data.createKind.value || 'chapter';
  },
  _kindLabel(kind) {
    return ({ setting: 'Setting', fact: 'Fact', chapter: 'Chapter' })[kind] || 'Entry';
  },
  buildExpandPrompt(text, field, detail, kind) {
    kind = this._contentKind(kind);
    const lengthDesc = {
      1: 'a very brief one-line description (10-15 words)',
      2: 'a short description (20-40 words)',
      3: 'a medium-length description (40-80 words)',
      4: 'a detailed description (80-150 words)',
      5: 'an extensive, richly detailed description (150-250 words)'
    };
    return `Expand and enrich the following ${kind} entry for a story world.

Detail level: ${detail}/5 — ${lengthDesc[detail] || lengthDesc[3]}

Original text:
"""
${text}
"""
Output ONLY the expanded text, no meta-commentary, no quotes, no headers.
Stay faithful to ALL details in the original text.`;
  },
  buildContinuePrompt(textBefore, textAfter, field, detail, kind) {
    kind = this._contentKind(kind);
    const lengthDesc = {
      1: 'a very short continuation (10-15 words)',
      2: 'a short continuation (20-40 words)',
      3: 'a medium-length continuation (40-80 words)',
      4: 'a detailed continuation (80-150 words)',
      5: 'an extensive continuation (150-250 words)'
    };
    if (!textAfter.trim()) {
      return `Continue the following ${kind} entry, picking up exactly where it leaves off.
Write ${lengthDesc[detail] || lengthDesc[3]}, matching the existing tone and style.

Existing text:
"""
${textBefore}
"""
Output ONLY the continuation text, no meta-commentary, no quotes, no headers.
Do not repeat or rephrase any part of the existing text.`;
    }
    return `You are filling a gap in the following ${kind} entry.

Text before the gap:
"""
${textBefore}
"""

Text after the gap:
"""
${textAfter}
"""

Write ${lengthDesc[detail] || lengthDesc[3]} that fits naturally in the gap.
Output ONLY the text that fills the gap, no meta-commentary, no quotes, no headers.
Do not repeat any part of "Text before the gap" or "Text after the gap".`;
  },
  _modalPrompt(text, detail, kind, label) {
    const lengthDesc = {
      1: 'a very brief one-line description (10-15 words)',
      2: 'a short description (20-40 words)',
      3: 'a medium-length description (40-80 words)',
      4: 'a detailed description (80-150 words)',
      5: 'an extensive, richly detailed description (150-250 words)'
    };
    return `Expand and enrich the following ${label} for a story world.

Detail level: ${detail}/5 — ${lengthDesc[detail] || lengthDesc[3]}

Original text:
"""
${text}
"""
Output ONLY the expanded text, no meta-commentary, no quotes, no headers.
Stay faithful to ALL details in the original text.`;
  },
  async generateCreateText() {
    const fullText = this.data.createContent.value;
    if (!fullText.trim()) return;
    const textarea = this.refs?.createTextarea;
    const selStart = textarea ? textarea.selectionStart : 0;
    const selEnd = textarea ? textarea.selectionEnd : 0;
    const selectedText = fullText.slice(selStart, selEnd);
    const hasSelection = selectedText.trim().length > 0;
    const detail = 3;
    const prompt = hasSelection
      ? this.buildExpandPrompt(selectedText, 'create', detail)
      : this.buildExpandPrompt(fullText, 'create', detail);
    clientLog('world_modal_ai_generate', { hasSelection, textLen: fullText.length });
    this.data.modalAssist.value = { loading: true, mode: 'generate' };
    try {
      const response = await api.generateText({ prompt, model: this.props.conversationModel || '' });
      const result = (response?.text || response?.content || response || '').trim();
      clientLog('world_modal_ai_result', { gotText: !!result, textLen: result.length });
      if (hasSelection) {
        this.data.createContent.value = fullText.slice(0, selStart) + result + fullText.slice(selEnd);
        tick();
        if (textarea) { textarea.focus(); textarea.setSelectionRange(selStart, selStart + result.length); }
      } else {
        this.data.createContent.value = result;
      }
    } catch (error) {
      clientLog('world_modal_ai_error', { message: error.message || String(error) });
    } finally {
      this.data.modalAssist.value = { loading: false, mode: '' };
    }
  },
  async continueCreateText() {
    const fullText = this.data.createContent.value;
    if (!fullText.trim()) return;
    const textarea = this.refs?.createTextarea;
    const insertPos = textarea ? textarea.selectionEnd : fullText.length;
    const textBefore = fullText.slice(0, insertPos);
    const textAfter = fullText.slice(insertPos);
    const prompt = this.buildContinuePrompt(textBefore, textAfter, 'create', 3);
    clientLog('world_modal_ai_continue', { textBeforeLen: textBefore.length, textAfterLen: textAfter.length });
    this.data.modalAssist.value = { loading: true, mode: 'continue' };
    try {
      const response = await api.generateText({ prompt, model: this.props.conversationModel || '' });
      const continuation = (response?.text || response?.content || response || '').trim();
      clientLog('world_modal_ai_cont_result', { gotText: !!continuation, textLen: continuation.length });
      if (continuation) {
        const leadingSpace = textBefore && !/\s$/.test(textBefore) ? ' ' : '';
        const trailingSpace = textAfter && !/^\s/.test(textAfter) ? ' ' : '';
        this.data.createContent.value = textBefore + leadingSpace + continuation + trailingSpace + textAfter;
        tick();
        const start = (textBefore + leadingSpace).length;
        if (textarea) { textarea.focus(); textarea.setSelectionRange(start, start + continuation.length); }
      }
    } catch (error) {
      clientLog('world_modal_ai_error', { message: error.message || String(error) });
    } finally {
      this.data.modalAssist.value = { loading: false, mode: '' };
    }
  },
  // ── Inline entry operations ──
  openEditModal(entry) {
    this._editingEntry = entry;
    this.data.createKind.value = entry.kind;
    this.data.createTitleVal.value = entry._title;
    this.data.createContent.value = entry._content;
    this.data.createModal.value = true;
    setTimeout(() => {
      const input = this.refs?.createTitleInput;
      if (input) input.focus();
    }, 50);
  },
  markDirty(entry) {
    entry._dirty = true;
  },
  async saveEntry(entry) {
    if (!entry._dirty) return;
    const id = this.props.conversationId;
    if (!id || !entry.id) return;
    entry._saving = true;
    try {
      await api.patchStoryEntry(id, entry.id, { title: entry._title, content: entry._content });
      entry._dirty = false;
      entry._originalTitle = entry._title;
      entry._originalContent = entry._content;
    } catch (error) {
      clientLog('world_entry_save_error', { message: error.message || String(error) });
      entry._dirty = true;
    } finally {
      entry._saving = false;
    }
  },
  toggleSection(section) {
    section.open = !section.open;
  },
  async deleteEntry(entry) {
    const id = this.props.conversationId;
    if (!id || !entry.id) return;
    try {
      await api.deleteStoryEntry(id, entry.id);
      this.data.entries.value = (this.data.entries.value || []).filter(e => e.id !== entry.id);
    } catch (error) {
      clientLog('world_entry_delete_error', { message: error.message || String(error) });
    }
  },
  // ── Per-field AI assist (like AgentPanel) ──
  startAssist(entry, field) {
    clientLog('world_assist_start', { field, entryId: entry.id });
    const text = field === 'title' ? entry._title : entry._content;
    if (!text.trim()) return;
    entry._originalTitle = entry._title;
    entry._originalContent = entry._content;
    entry._assistField = field;
    entry._assistSlider = entry._assistSlider || 3;
    this.runAssist(entry, field);
  },
  _assistPrompt(entry, field, detail) {
    const kind = entry.kind || 'chapter';
    const text = field === 'title' ? entry._title : entry._content;
    const lengthDesc = {
      1: 'very brief (10-15 words)',
      2: 'short (20-40 words)',
      3: 'medium-length (40-80 words)',
      4: 'detailed (80-150 words)',
      5: 'extensive (150-250 words)'
    };
    return `Expand and enrich the following ${kind} ${field} for a story world.

Detail level: ${detail}/5 — Write a ${lengthDesc[detail] || lengthDesc[3]} ${field}.

Original text:
"""
${text}
"""
Output ONLY the expanded ${field} text, no meta-commentary, no quotes, no headers.
Stay faithful to ALL details in the original text.`;
  },
  async runAssist(entry, field) {
    const model = this.props.conversationModel || '';
    const detail = Number(entry._assistSlider) || 3;
    clientLog('world_assist_generate', { field, detail });
    entry._assistLoading = true;
    try {
      const response = await api.generateText({
        prompt: this._assistPrompt(entry, field, detail),
        model
      });
      const text = (response?.text || response?.content || response || '').trim();
      clientLog('world_assist_result', { field, gotText: !!text, textLen: text.length });
      if (text) {
        if (field === 'title') entry._title = text;
        else entry._content = text;
        entry._dirty = true;
      }
    } catch (error) {
      clientLog('world_assist_error', { message: error.message || String(error) });
    } finally {
      entry._assistLoading = false;
    }
  },
  undoAssist(entry) {
    clientLog('world_assist_undo', { entryId: entry.id });
    entry._title = entry._originalTitle;
    entry._content = entry._originalContent;
    entry._assistField = null;
    entry._dirty = true;
  },
  async resetCompaction() {
    const id = this.props.conversationId;
    if (!id) return;
    clientLog('world_reset_compaction', { id });
    try {
      await api.resetCompaction(id);
      clientLog('world_reset_compaction_done', { id });
    } catch (error) {
      clientLog('world_reset_compaction_error', { message: error.message || String(error) });
    }
  }
};
