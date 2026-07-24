import { tick, globals } from 'tinybubble';
import { api } from '../api/client.js';
import { voicesByLanguage, languageOptions } from '../shared/voices.js';
import CustomSelect from './CustomSelect.bub.js';

export default {
  name: 'MagicCreateModal',
  props: ['conversationModel', 'kokoroVoices'],
  emits: ['create-from-blueprint', 'request-close'],
  components: {
    'custom-select': CustomSelect
  },
  template() {
    return /*html*/`
      <div class="modal-overlay">
        <div class="modal-backdrop" @click="cancel"></div>
        <div class="modal-card" style="max-width:34rem">
          <!-- Step 1: Describe & Generate -->
          <template x-if="step === 1">
            <div>
              <div class="modal-header">
                <h3>✨ Magic Create</h3>
                <button type="button" class="modal-close" @click="cancel">✕</button>
              </div>
              <div class="modal-body" style="display:grid;gap:0.75rem">
                <!-- Description textarea -->
                <div class="form-label" style="gap:0.35rem">
                  <span style="font-size:0.75rem;color:var(--text-tertiary)">Describe your dream conversation…</span>
                  <div class="ai-textarea-wrap">
                    <textarea x-model="description" placeholder="A noir detective story set in 1940s San Francisco with a hardboiled detective AI and a femme fatale profile…" rows="6" style="resize:vertical" ref="descTextarea"></textarea>
                  </div>
                  <!-- Generation controls (always visible after first type) -->
                  <div class="ai-assist-llimi" x-if="description.trim()">
                    <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="slider"> <span>{{ slider }}/5</span></label>
                    <button type="button" class="ai-assist-btn-sm" @click="expandDescription" :disabled="loading || !description.trim()" title="Expand/rewrite description"><span class="material-symbols-outlined" style="font-size:16px">auto_awesome</span></button>
                    <button type="button" class="ai-assist-btn-sm" @click="continueDescription" :disabled="loading || !description.trim()" title="Continue writing the description"><span class="material-symbols-outlined" style="font-size:16px">play_arrow</span></button>
                    <span x-if="loading" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">{{ loadingMode === 'generate' ? 'Generating…' : 'Continuing…' }}</span>
                  </div>
                </div>

                <!-- Settings row -->
                <div class="form-grid-2">
                  <label class="form-label" style="gap:0.25rem">
                    <span style="font-size:0.75rem;color:var(--text-tertiary)">Default voice language</span>
                    <custom-select :options="languageSelectOptions()" :value="language" @change="onLanguageChange"></custom-select>
                  </label>
                </div>

                <!-- Error -->
                <div x-if="error" class="error">{{ error }}</div>
              </div>
              <div class="modal-footer">
                <button type="button" class="modal-btn-secondary" @click="cancel">Cancel</button>
                <button type="button" class="modal-save" @click="generate" :disabled="loading || !description.trim()">
                  <span x-if="loading && loadingMode === 'generate'">Generating…</span>
                  <span x-if="!loading">✨ Generate Blueprint</span>
                </button>
                <button type="button" x-if="isGenerated && !loading" class="modal-save" @click="step = 2">Next →</button>
              </div>
            </div>
          </template>

          <!-- Step 2: Preview -->
          <template x-if="step === 2">
            <div>
              <div class="modal-header">
                <h3>✨ Blueprint Preview</h3>
                <button type="button" class="modal-close" @click="cancel">✕</button>
              </div>
              <div class="modal-body" style="display:grid;gap:0.75rem">
                <!-- Summary card -->
                <div class="card-summary">
                  <div class="card-summary-row">
                    <span class="card-summary-label">Title</span>
                    <span class="card-summary-value">{{ blueprintTitle }}</span>
                  </div>
                  <div class="card-summary-row">
                    <span class="card-summary-label">Agents</span>
                    <span class="card-summary-value">{{ agentsSummary() }}</span>
                  </div>
                  <div class="card-summary-row">
                    <span class="card-summary-label">Profile</span>
                    <span class="card-summary-value">{{ profileSummary() }}</span>
                  </div>
                  <div class="card-summary-row">
                    <span class="card-summary-label">World</span>
                    <span class="card-summary-value">{{ worldSummary() }}</span>
                  </div>
                </div>

                <!-- Raw JSON expandable -->
                <details style="cursor:pointer">
                  <summary style="font-size:0.75rem;color:var(--text-tertiary)">Raw JSON</summary>
                  <pre class="json-preview">{{ rawJson() }}</pre>
                </details>

                <div x-if="error" class="error">{{ error }}</div>
              </div>
              <div class="modal-footer">
                <button type="button" class="modal-btn-secondary" @click="backToDescribe">← Back</button>
                <button type="button" class="modal-save" @click="confirm" :disabled="loading">
                  <span x-if="loading">Creating…</span>
                  <span x-if="!loading">✨ Create Conversation</span>
                </button>
              </div>
            </div>
          </template>
        </div>
      </div>
    `;
  },
  data() {
    return {
      step: 1,
      description: '',
      language: 'en_US',
      slider: 3,
      blueprint: null,
      loading: false,
      loadingMode: 'generate',
      error: '',
      isGenerated: false,
      originalDescription: ''
    };
  },
  /** @returns {Array<{value: string, label: string}>} */
  languageSelectOptions() {
    return languageOptions.map(l => ({ value: l, label: l }));
  },
  /** @returns {string|null} */
  getSelectionOrFull() {
    const textarea = this.refs.descTextarea;
    if (!textarea) return null;
    const text = this.data.description.value;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const selected = text.slice(selStart, selEnd).trim();
    return selected || text.trim() || null;
  },
  /** @returns {string} */
  voiceOptionsForPrompt() {
    const engine = globals.$ttsEngine?.value || 'piper';
    if (engine === 'kokoro') {
      const voices = this.props.kokoroVoices || [];
      if (!voices.length) return 'No Kokoro voices available';
      return voices
        .filter(v => v.installed)
        .map(v => `${v.language}: ${v.id} (${v.label})`)
        .join('; ');
    }
    const lang = this.data.language.value;
    const voices = voicesByLanguage[lang] || [];
    return voices.map(v => `${lang}-${v.name}-${v.quality}`).join(', ');
  },
  /** @returns {string} */
  buildPrompt() {
    const lang = this.data.language.value;
    const desc = this.data.description.value.trim();
    const voices = this.voiceOptionsForPrompt();
    const detail = Number(this.data.slider.value);
    const engine = globals.$ttsEngine?.value || 'piper';
    const voiceExample = engine === 'kokoro' ? 'e.g. en_US-amy-medium (from the list above)' : 'e.g. en_US-amy-medium';
    return `You are a conversation designer for a roleplay chat app called SupaChat.

Generate a JSON blueprint for a conversation at detail level ${detail}/5.

The user wants a conversation about:
"""
${desc}
"""

Default language: ${lang}
Available voices (the AI should pick the most fitting for each agent):
if someone is flagged as user or human you must put him in the profile section not in the Agent section.
${voices}

Return ONLY valid JSON. No commentary, no code fences. Use this exact structure:

{
  "title": "Short evocative conversation title",
  "agents": [
    {
      "name": "Agent name",
      "introduction": "Second-person: You are {name}...",
      "appearance": "Third-person physical description",
      "voice": "Voice ID from the list above, ${voiceExample}",
      "is_narrator": false,
      "tools": { "imagen": true, "narrate": false }
    }
  ],
  "profile": {
    "name": "User character name",
    "introduction": "Second-person: You are {name}..."
  },
  "world": [
    { "kind": "chapter|fact|setting", "title": "Title", "content": "Description" }
  ]
}

Rules:
- Agents are AI/NPC characters that the user talks TO. Create 1-3 agents.
- Profile is the HUMAN USER's own character — do NOT create a separate agent for the user.
- If the user mentions themselves (e.g. "me", the one in profile, the human user) put that character in profile, NOT in agents.
- World entries are optional (empty array if none).
- Each agent needs a voice from the available list.`;
  },
  /** @param {string} text @param {number} detail @param {string} lang @returns {string} */
  buildExpandPrompt(text, detail, lang) {
    const detailDesc = {
      1: 'a very concise expansion (10-15 words)',
      2: 'a short expansion (20-40 words)',
      3: 'a medium expansion (40-80 words)',
      4: 'a detailed expansion (80-150 words)',
      5: 'an extensive expansion (150-250 words)'
    };
    return `You are helping a user write a conversation description for a roleplay chat app. Expand the following text, making it more vivid and detailed. Write ${detailDesc[detail] || 'a medium expansion'}.

Current text:
"""
${text}
"""

Output ONLY the expanded description text. Write in ${lang || 'English'}. Do not add meta-commentary or quotes. Stay faithful to all details in the original.`;
  },
  /** @param {string} before @param {string} after @param {number} detail @param {string} lang @returns {string} */
  buildContinuePrompt(before, after, detail, lang) {
    const detailDesc = {
      1: 'a very short continuation (10-15 words)',
      2: 'a short continuation (20-40 words)',
      3: 'a medium continuation (40-80 words)',
      4: 'a detailed continuation (80-150 words)',
      5: 'an extensive continuation (150-250 words)'
    };
    if (!after.trim()) {
      return `Continue the following conversation description, picking up exactly where it leaves off. Write ${detailDesc[detail] || 'a medium continuation'}, matching the existing tone and style.

Existing text:
"""
${before}
"""

Output ONLY the continuation text, no meta-commentary, no quotes. Do not repeat any part of the existing text. Write in ${lang || 'English'}.`;
    }
    return `Fill a gap in the following conversation description.

Text before the gap:
"""
${before}
"""

Text after the gap:
"""
${after}
"""

Write ${detailDesc[detail] || 'a medium continuation'} that fits naturally in the gap. Output ONLY the gap-filling text. Write in ${lang || 'English'}. Do not repeat any part of the before/after text.`;
  },
  // ---- Actions ----
  async expandDescription() {
    const textarea = this.refs.descTextarea;
    if (!textarea) return;
    const fullText = this.data.description.value;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const hasSelection = selStart !== selEnd && fullText.slice(selStart, selEnd).trim().length > 0;
    const targetText = hasSelection ? fullText.slice(selStart, selEnd) : fullText;
    if (!targetText.trim()) return;

    this.data.loading.value = true;
    this.data.loadingMode.value = 'generate';
    this.data.error.value = '';

    try {
      const prompt = this.buildExpandPrompt(targetText, Number(this.data.slider.value), this.data.language.value);
      const model = this.props.conversationModel || '';
      const response = await api.generateText({ prompt, model });
      const result = (response.text || '').trim();
      if (result) {
        if (hasSelection) {
          this.data.description.value = fullText.slice(0, selStart) + result + fullText.slice(selEnd);
          tick();
          textarea.focus();
          textarea.setSelectionRange(selStart, selStart + result.length);
        } else {
          this.data.description.value = result;
        }
      }
    } catch (err) {
      this.data.error.value = err.message || 'Generation failed';
    } finally {
      this.data.loading.value = false;
      this.data.loadingMode.value = 'generate';
    }
  },
  async continueDescription() {
    const textarea = this.refs.descTextarea;
    if (!textarea) return;
    const fullText = this.data.description.value;
    if (!fullText.trim()) return;
    const insertPos = textarea.selectionEnd;
    const textBefore = fullText.slice(0, insertPos);
    const textAfter = fullText.slice(insertPos);

    this.data.loading.value = true;
    this.data.loadingMode.value = 'continue';
    this.data.error.value = '';

    try {
      const prompt = this.buildContinuePrompt(textBefore, textAfter, Number(this.data.slider.value), this.data.language.value);
      const model = this.props.conversationModel || '';
      const response = await api.generateText({ prompt, model });
      const continuation = (response.text || '').trim();
      if (continuation) {
        const leadingSpace = textBefore && !/\s$/.test(textBefore) ? ' ' : '';
        const trailingSpace = textAfter && !/^\s/.test(textAfter) ? ' ' : '';
        this.data.description.value = textBefore + leadingSpace + continuation + trailingSpace + textAfter;
        tick();
        const cursorPos = (textBefore + leadingSpace + continuation).length;
        textarea.focus();
        textarea.setSelectionRange(cursorPos, cursorPos);
      }
    } catch (err) {
      this.data.error.value = err.message || 'Continuation failed';
    } finally {
      this.data.loading.value = false;
      this.data.loadingMode.value = 'generate';
    }
  },
  async generate() {
    const desc = this.data.description.value.trim();
    if (!desc) return;
    this.data.loading.value = true;
    this.data.loadingMode.value = 'generate';
    this.data.error.value = '';
    this.data.blueprint.value = null;
    try {
      const prompt = this.buildPrompt();
      const model = this.props.conversationModel || '';
      const response = await api.generateText({ prompt, model });
      const text = response.text || '';
      let jsonStr = text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      const blueprint = JSON.parse(jsonStr);
      if (!blueprint.title || !Array.isArray(blueprint.agents)) {
        throw new Error('Invalid blueprint: missing title or agents array');
      }
      this.data.blueprint.value = blueprint;
      this.data.isGenerated.value = true;
      this.data.originalDescription.value = desc;
      this.data.step.value = 2;
    } catch (err) {
      this.data.error.value = err.message || 'Failed to generate blueprint';
    } finally {
      this.data.loading.value = false;
    }
  },
  confirm() {
    const blueprint = this.data.blueprint.value;
    if (!blueprint) return;
    this.emit('create-from-blueprint', blueprint);
  },
  onLanguageChange(value) {
    this.data.language.value = value;
  },
  cancel() {
    this.emit('request-close');
  },
  backToDescribe() {
    this.data.step.value = 1;
    this.data.error.value = '';
  },
  // ---- Computed display helpers ----
  blueprintTitle() {
    const b = this.data.blueprint.value;
    return b ? b.title : '';
  },
  agentsSummary() {
    const b = this.data.blueprint.value;
    if (!b || !b.agents || !b.agents.length) return 'None';
    return b.agents.map(a => a.name).join(', ');
  },
  profileSummary() {
    const b = this.data.blueprint.value;
    if (!b || !b.profile) return 'None';
    return b.profile.name || 'Unnamed';
  },
  worldSummary() {
    const b = this.data.blueprint.value;
    if (!b || !b.world || !b.world.length) return 'None';
    const chapters = b.world.filter(w => w.kind === 'chapter').length;
    const facts = b.world.filter(w => w.kind === 'fact').length;
    const settings = b.world.filter(w => w.kind === 'setting').length;
    const parts = [];
    if (chapters) parts.push(`${chapters} chapter${chapters > 1 ? 's' : ''}`);
    if (facts) parts.push(`${facts} fact${facts > 1 ? 's' : ''}`);
    if (settings) parts.push(`${settings} setting${settings > 1 ? 's' : ''}`);
    return parts.length ? parts.join(', ') : `${b.world.length} entr${b.world.length > 1 ? 'ies' : 'y'}`;
  },
  rawJson() {
    const b = this.data.blueprint.value;
    return b ? JSON.stringify(b, null, 2) : '';
  }
};
