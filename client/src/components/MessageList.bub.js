import ImageLightbox from './ImageLightbox.bub.js';
import MessageItem from './MessageItem.bub.js';
import { api, clientLog } from '../api/client.js';
import { tick, watchProp } from 'tinybubble';

export default {
  name: 'MessageList',
  props: ['messages', 'streamingMessage', 'toolEvents', 'autoMode', 'audioAutoPlay', 'playingAudioMessageId', 'lastImageMessageId', 'imagePending', 'extraAttachments', 'patches', 'generatingAudioIds'],
  emits: ['request-audio', 'delete-message', 'delete-messages-from', 'regenerate-message', 'edit-message', 'stop'],
  components: { 'image-lightbox': ImageLightbox, 'message-item': MessageItem },
  template() {
    return /*html*/`
      <section ref="scroller" class="message-list" aria-label="Messages">
        <div x-if="!renderMessages.length && !streamingMessage" class="empty-state">No messages yet. Start chatting below.</div>

        <message-item x-for="message in renderMessages" :key="message.id"
          :message="message"
          :patches="patches"
          :extra-attachments="extraAttachments"
          :messages="messages"
          :image-pending="imagePending"
          :auto-mode="autoMode"
          :playing-audio-message-id="playingAudioMessageId"
          :last-image-message-id="lastImageMessageId"
          :generating-audio-ids="generatingAudioIds"
          @delete-message="onDelete"
          @delete-messages-from="onDeleteFrom"
          @regenerate-message="onRegenerate"
          @start-edit="startEdit"
          @request-audio="onRequestAudio"
          @open-lightbox="openLightbox"
        ></message-item>

        <!-- Streaming message -->
        <div x-if="streamingMessage" class="msg-group assistant streaming">
          <div class="msg-meta-row">
            <div class="msg-meta-left">
              <div class="msg-avatar assistant-avatar">{{ avatarLetter(streamingMessage) }}</div>
              <div class="msg-info">
                <span class="msg-name assistant-name">{{ streamingMessage.speaker_name_snapshot || 'Assistant' }}</span>
                <span class="msg-time">streaming</span>
              </div>
            </div>
          </div>
          <div class="msg-bubble assistant streaming">
            <div class="msg-content">{{ streamingMessage.content }}</div>
          </div>
        </div>

        <!-- Edit modal -->
        <div x-if="editModal" class="modal-overlay">
          <div class="modal-backdrop" @click="cancelEdit"></div>
          <div class="modal-card">
            <div class="modal-header">
              <h3>Edit message</h3>
              <button type="button" class="modal-close" @click="cancelEdit">✕</button>
            </div>
            <div class="modal-body">
              <label class="form-label">Content
                <textarea ref="editTextarea" class="modal-textarea" x-model="editDraft" placeholder="Edit message content…"></textarea>
              </label>
              <div class="ai-assist-llimi modal-ai-row">
                <button type="button" class="ai-assist-btn-sm" @click="generateEditText" :disabled="editAssistLoading || !editDraft.trim()" title="Generate"><span class="material-symbols-outlined" style="font-size:16px">auto_awesome</span></button>
                <button type="button" class="ai-assist-btn-sm" @click="continueEditText" :disabled="editAssistLoading || !editDraft.trim()" title="Continue writing"><span class="material-symbols-outlined" style="font-size:16px">arrow_forward</span></button>
                <span x-if="editAssistLoading" class="ai-assist-loading">{{ editAssistMode === 'continue' ? 'Continuing…' : 'Generating…' }}</span>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" @click="cancelEdit">Cancel</button>
              <button type="button" class="modal-save" @click="saveEdit">Save Changes</button>
            </div>
          </div>
        </div>

        <!-- Image lightbox -->
        <image-lightbox
          x-if="lightboxAttachment"
          :attachment="lightboxAttachment"
          :message="lightboxMessage"
          :streaming-message="currentStreamingMessage()"
          :auto-mode="autoMode"
          @close="closeLightbox"
          @stop="onStop"
        ></image-lightbox>

        <!-- Tool events toggle -->
        <div x-if="toolEvents.length" class="tool-events-bar">
          <button type="button" @click="toggleToolEvents" :class="showToolEvents ? 'active' : ''">
            <span class="material-symbols-outlined">build</span>
            <span>Tool events ({{ toolEvents.length }})</span>
            <span class="material-symbols-outlined">{{ showToolEvents ? 'expand_less' : 'expand_more' }}</span>
          </button>
          <div x-if="showToolEvents && toolEvents.length" class="tool-events-list">
            <div x-for="event in toolEvents" class="tool-event-item">
              <span class="tool-event-name">{{ event.tool_name || event.type }}</span>
              <span class="tool-event-state">{{ event.state || event.status || '' }}</span>
              <code class="tool-event-detail">{{ eventSummary(event) }}</code>
            </div>
          </div>
        </div>
      </section>
    `;
  },
  data() {
    return { renderMessages: [], showToolEvents: false, editModal: null, editDraft: '', editOriginal: '', editAssist: false, editAssistSlider: 3, editAssistLoading: false, editAssistMode: '', lightboxAttachment: null, lightboxMessage: null };
  },
  init() {
    this.syncMessages(this.props.messages || []);
    watchProp(this, 'messages', (messages) => this.syncMessages(messages || []));
    watchProp(this, 'playingAudioMessageId', () => this.syncLightboxMessage());
    watchProp(this, 'streamingMessage', (cur, prev) => {
      if (!prev || !prev.content) this.scrollToBottom();
    });
    this.scrollToBottom();
  },
  syncMessages(messages) {
    const previousCount = this.data.renderMessages.value.length;
    const visible = messages.filter((m) => m.kind !== 'character_description' && m.kind !== 'tool');
    this.data.renderMessages.value = visible;
    if (visible.length > previousCount) this.scrollToBottom();
  },
  avatarLetter(message) {
    const name = message.speaker_name_snapshot || message.speakerName || message.role || 'Unknown';
    return name ? name.charAt(0).toUpperCase() : '?';
  },
  scrollToBottom() {
    tick();
    requestAnimationFrame(() => {
      const el = this.refs.scroller;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
  eventSummary(event) {
    return JSON.stringify(event.arguments_json || event.result_json || event.error || event).slice(0, 180);
  },
  toggleToolEvents() {
    this.data.showToolEvents.value = !this.data.showToolEvents.value;
  },
  // ---- Image lightbox ----
  openLightbox({ attachment, message }) {
    this.data.lightboxAttachment.value = attachment;
    this.data.lightboxMessage.value = message;
  },
  syncLightboxMessage() {
    if (!this.props.audioAutoPlay || !this.data.lightboxAttachment.value) return;
    const playingId = this.props.playingAudioMessageId;
    if (!playingId) return;
    const message = this.data.renderMessages.value.find((item) => item.id === playingId);
    if (message) this.data.lightboxMessage.value = message;
  },
  closeLightbox() {
    this.data.lightboxAttachment.value = null;
    this.data.lightboxMessage.value = null;
  },
  currentStreamingMessage() {
    const msgs = this.data.renderMessages.value || [];
    const playingId = this.props.playingAudioMessageId;
    if (playingId) {
      const playing = msgs.find((m) => m.id === playingId);
      if (playing) return playing;
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].pending && msgs[i].role === 'assistant') return msgs[i];
    }
    const imageId = this.props.lastImageMessageId;
    if (imageId) {
      const imgMsg = msgs.find((m) => m.id === imageId);
      if (imgMsg) return imgMsg;
    }
    return null;
  },
  onStop() {
    this.closeLightbox();
    this.emit('stop');
  },
  // ---- Edit modal ----
  onEditMessage(payload) {
    this.emit('edit-message', payload);
  },
  startEdit(message) {
    this.data.editModal.value = message;
    this.data.editDraft.value = message.rendered_content || message.content || '';
    this.data.editOriginal.value = this.data.editDraft.value;
    this.data.editAssist.value = false;
    this.data.editAssistSlider.value = 3;
    this.data.editAssistLoading.value = false;
    this.data.editAssistMode.value = '';
    queueMicrotask(() => {
      const el = this.refs.editTextarea;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  },
  saveEdit() {
    const message = this.data.editModal.value;
    if (!message) return;
    const content = this.data.editDraft.value.trim();
    if (!content) { this.cancelEdit(); return; }
    this.data.editModal.value = null;
    this.data.editDraft.value = '';
    this.data.editOriginal.value = '';
    this.emit('edit-message', { id: message.id, content });
  },
  cancelEdit() {
    this.data.editModal.value = null;
    this.data.editDraft.value = '';
    this.data.editOriginal.value = '';
  },
  async generateEditText() {
    const draft = this.data.editDraft.value;
    if (!draft.trim()) return;
    const textarea = this.refs.editTextarea;
    const selStart = textarea ? textarea.selectionStart : 0;
    const selEnd = textarea ? textarea.selectionEnd : 0;
    const selectedText = draft.slice(selStart, selEnd);
    const hasSelection = selectedText.trim().length > 0;
    const detail = Number(this.data.editAssistSlider.value) || 3;
    const lengthDesc = {
      1: 'a very brief one-line description (10-15 words)',
      2: 'a short description (20-40 words)',
      3: 'a medium-length description (40-80 words)',
      4: 'a detailed description (80-150 words)',
      5: 'an extensive, richly detailed description (150-250 words)'
    };
    const prompt = hasSelection
      ? `Expand and enrich the following text for a story.\nDetail level: ${detail}/5 — ${lengthDesc[detail] || lengthDesc[3]}\nOriginal text:\n"""\n${selectedText}\n"""\nOutput ONLY the expanded text.`
      : `Expand and enrich the following text for a story.\nDetail level: ${detail}/5 — ${lengthDesc[detail] || lengthDesc[3]}\nText:\n"""\n${draft}\n"""\nOutput ONLY the expanded text.`;
    this.data.editAssist.value = true;
    this.data.editAssistLoading.value = true;
    this.data.editAssistMode.value = 'generate';
    try {
      const response = await api.generateText({ prompt });
      const result = (response?.text || response?.content || response || '').trim();
      if (hasSelection) {
        this.data.editDraft.value = draft.slice(0, selStart) + result + draft.slice(selEnd);
        tick();
        if (textarea) { textarea.focus(); textarea.setSelectionRange(selStart, selStart + result.length); }
      } else {
        this.data.editDraft.value = result;
      }
    } catch (error) {
      clientLog('edit_ai_error', { message: error.message || String(error) });
    } finally {
      this.data.editAssistLoading.value = false;
    }
  },
  async continueEditText() {
    const draft = this.data.editDraft.value;
    if (!draft.trim()) return;
    const textarea = this.refs.editTextarea;
    const insertPos = textarea ? textarea.selectionEnd : draft.length;
    const textBefore = draft.slice(0, insertPos);
    const textAfter = draft.slice(insertPos);
    const detail = Number(this.data.editAssistSlider.value) || 3;
    const lengthDesc = {
      1: 'a very short continuation (10-15 words)',
      2: 'a short continuation (20-40 words)',
      3: 'a medium-length continuation (40-80 words)',
      4: 'a detailed continuation (80-150 words)',
      5: 'an extensive continuation (150-250 words)'
    };
    let prompt;
    if (!textAfter.trim()) {
      prompt = `Continue the following text, picking up exactly where it leaves off.\nWrite ${lengthDesc[detail] || lengthDesc[3]}, matching the existing tone and style.\n\nExisting text:\n"""\n${textBefore}\n"""\nOutput ONLY the continuation text. Do not repeat the existing text.`;
    } else {
      prompt = `You are filling a gap in the following text.\n\nText before the gap:\n"""\n${textBefore}\n"""\n\nText after the gap:\n"""\n${textAfter}\n"""\n\nWrite ${lengthDesc[detail] || lengthDesc[3]} that fits naturally in the gap.\nOutput ONLY the text that fills the gap. Do not repeat any part.`;
    }
    this.data.editAssist.value = true;
    this.data.editAssistLoading.value = true;
    this.data.editAssistMode.value = 'continue';
    try {
      const response = await api.generateText({ prompt });
      const continuation = (response?.text || response?.content || response || '').trim();
      if (continuation) {
        const leadingSpace = textBefore && !/\s$/.test(textBefore) ? ' ' : '';
        const trailingSpace = textAfter && !/^\s/.test(textAfter) ? ' ' : '';
        this.data.editDraft.value = textBefore + leadingSpace + continuation + trailingSpace + textAfter;
        tick();
        const start = (textBefore + leadingSpace).length;
        if (textarea) { textarea.focus(); textarea.setSelectionRange(start, start + continuation.length); }
      }
    } catch (error) {
      clientLog('edit_ai_error', { message: error.message || String(error) });
    } finally {
      this.data.editAssistLoading.value = false;
    }
  },
  // ---- Events from MessageItem ----
  onDelete(message) {
    this.emit('delete-message', message);
  },
  onDeleteFrom(message) {
    this.emit('delete-messages-from', message);
  },
  onRegenerate(message) {
    this.emit('regenerate-message', message);
  },
  onRequestAudio(message) {
    this.emit('request-audio', message);
  },
  onEditMessage(payload) {
    this.emit('edit-message', payload);
  },
};
