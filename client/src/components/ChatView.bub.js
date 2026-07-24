import MessageList from './MessageList.bub.js';
import MessageComposer from './MessageComposer.bub.js';
import Toggle from './Toggle.bub.js';
import CustomSelect from './CustomSelect.bub.js';
import { watchProp, watch } from 'tinybubble';

export default {
  name: 'ChatView',
  props: ['conversation', 'messages', 'agents', 'models', 'state', 'streamingMessage', 'toolEvents', 'loading', 'audioAutoPlay', 'profiles', 'leftRailOpen', 'rightRailOpen', 'playingAudioMessageId', 'lastImageMessageId', 'imagePending', 'extraAttachments', 'patches', 'generatingAudioIds', 'dicePending', 'diceSpeakerName', 'dicePublicReason'],
  emits: ['send', 'command', 'action', 'request-audio', 'reload', 'toggle-audio-autoplay', 'delete-message', 'delete-messages-from', 'regenerate-message', 'edit-message', 'open-dice-roll', 'toggle-left-rail', 'toggle-right-rail'],
  components: {
    'message-list': MessageList,
    'message-composer': MessageComposer,
    'toggle': Toggle,
    'custom-select': CustomSelect
  },
  template() {
    return /*html*/`
      <main class="chat-view">
        <!-- Header -->
        <header class="chat-header compact">
          <button type="button" class="header-toggle-btn" @click="emit('toggle-left-rail')" :title="leftRailOpen ? 'Hide conversations' : 'Show conversations'">
            <span class="material-symbols-outlined">{{ leftRailOpen ? 'keyboard_double_arrow_left' : 'keyboard_double_arrow_right' }}</span>
          </button>
          <div class="chat-title-block">
            <h1>{{ conversation?.title || 'Select a conversation' }}</h1>
            <p>{{ statusText() }}</p>
          </div>
          <button type="button" ref="optionsToggleBtn" class="header-options-toggle" :class="showHeaderOptions ? 'active' : ''" @click="toggleHeaderOptions" :disabled="!conversation" title="Show/hide chat options">
            <span class="material-symbols-outlined">tune</span>
          </button>
          <button type="button" class="header-toggle-btn" @click="emit('toggle-right-rail')" :title="rightRailOpen ? 'Hide panel' : 'Show panel'">
            <span class="material-symbols-outlined">{{ rightRailOpen ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left' }}</span>
          </button>
          <div x-if="showHeaderOptions" ref="headerOptionsPopover" class="chat-header-options" :style="popoverRight !== null ? ('top:' + popoverTop + 'px; right:' + popoverRight + 'px') : ('top:' + popoverTop + 'px')">
            <label>
              <span>Model</span>
              <custom-select :options="modelSelectOptions()" :placeholder="'— Use global —'" :value="selectedModel" :disabled="!conversation" @change="setSelectedModel"></custom-select>
            </label>
            <label>
              <span>Tools</span>
              <custom-select :options="toolModeOptions" :placeholder="'Conversation tool mode'" :value="selectedToolMode" :disabled="!conversation" @change="setSelectedToolMode"></custom-select>
            </label>
            <label>
              <span>Thinking</span>
              <custom-select :options="thinkingModeOptions" :value="selectedThinkingMode" :disabled="!conversation" @change="setSelectedThinkingMode"></custom-select>
            </label>
            <div class="header-action-group">
              <button type="button" @click="reload" :disabled="!conversation" title="Refresh messages">
                <span class="material-symbols-outlined">refresh</span>
              </button>
              <button type="button" @click="nextSpeaker" :disabled="!conversation" title="Next speaker">
                <span class="material-symbols-outlined">skip_next</span>
              </button>
              <button type="button" @click="flush" :disabled="!conversation" title="Flush messages">
                <span class="material-symbols-outlined">delete_sweep</span>
              </button>
              <button type="button" @click="togglePromptModal" :disabled="!conversation" title="Image prompt settings for this conversation">
                <span class="material-symbols-outlined">image</span>
                <span>Image prompts</span>
              </button>
            </div>
            <div class="header-toggle-group">
              <toggle :model-val="state?.auto_mode" label="Auto" :disabled="!conversation" @change="onAutoChange"></toggle>
              <toggle :model-val="audioAutoPlay" label="Auto play audio" @change="onAudioAutoPlayChange"></toggle>
            </div>
          </div>
        </header>

        <message-list :messages="messages" :streaming-message="streamingMessage" :tool-events="toolEvents" :auto-mode="state?.auto_mode" :audio-auto-play="audioAutoPlay" :playing-audio-message-id="playingAudioMessageId" :last-image-message-id="lastImageMessageId" :extra-attachments="extraAttachments" :patches="patches" :image-pending="imagePending" :generating-audio-ids="generatingAudioIds" @request-audio="requestAudio" @delete-message="onDeleteMessage" @delete-messages-from="onDeleteMessagesFrom" @regenerate-message="onRegenerateMessage" @edit-message="onEditMessage" @stop="onStop"></message-list>
        <message-composer
          :disabled="!conversation || loading"
          :agents="agents"
          :profiles="profiles"
          :active-profile-id="state?.active_profile_id || ''"
          :forced-next-agent-id="state?.forced_next_agent_id"
          :auto-mode="state?.auto_mode"
          :conversation-model="model"
          :dice-pending="dicePending"
          :dice-speaker-name="diceSpeakerName"
          :dice-public-reason="dicePublicReason"
          @send="send"
          @command="command"
          @action="action"
          @open-dice-roll="emit('open-dice-roll')"
        ></message-composer>

        <!-- Image prompt settings modal (fixed, above everything) -->
        <div x-if="showPromptModal" class="modal-overlay">
          <div class="modal-backdrop" @click="closePromptModal"></div>
          <div class="modal-card" style="max-width:520px">
            <div class="modal-header">
              <h3>Image prompt settings</h3>
              <button type="button" class="modal-close" @click="closePromptModal">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>
            <div class="modal-body" style="display:flex;flex-direction:column;gap:1rem">
              <p class="muted" style="margin:0;font-size:0.85rem;color:#cbc3d7">
                Custom text added before or after every image generated in this conversation.
              </p>
              <label class="form-label">Prompt prepend
                <textarea class="modal-textarea" x-model="promptPrepend" placeholder="Text added before every image prompt" rows="3"></textarea>
              </label>
              <label class="form-label">Prompt append
                <textarea class="modal-textarea" x-model="promptAppend" placeholder="Text added after every image prompt" rows="3"></textarea>
              </label>
            </div>
            <div class="modal-footer">
              <button type="button" @click="closePromptModal">Cancel</button>
              <button type="button" class="modal-save" @click="savePromptSettings">Save</button>
            </div>
          </div>
        </div>
      </main>
    `;
  },
  data() {
    return {
      selectedModel: '',
      selectedToolMode: '',
      selectedThinkingMode: 'parent',
      showHeaderOptions: false,
      popoverTop: 0,
      popoverRight: null,
      showPromptModal: false,
      promptPrepend: '',
      promptAppend: '',
      toolModeOptions: [
        { value: 'native', label: 'Native (tools API)' },
        { value: 'structured', label: 'Structured output (JSON schema)' }
      ],
      thinkingModeOptions: [
        { value: 'parent', label: 'Parent' },
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' }
      ]
    };
  },
  init() {
    this.syncingState = false;
    this.syncFromState(this.props.state || {});

    // Keep in sync when state prop changes (e.g. after SSE state_changed)
    watchProp(this, 'state', (state) => this.syncFromState(state || {}));

    // Sync drawThings prompt fields from state
    watchProp(this, 'state', (state) => {
      const dt = (state && state.drawThings) || {};
      if (!this._syncingPrompt) {
        this._syncingPrompt = true;
        this.data.promptPrepend.value = dt.promptPrepend || '';
        this.data.promptAppend.value = dt.promptAppend || '';
        queueMicrotask(() => { this._syncingPrompt = false; });
      }
    });

    // Emit action only for user picks, not prop sync.
    watch(this.data.selectedModel, (model) => {
      if (!this.syncingState && model !== (this.props.state?.selected_model || '')) this.emit('action', { action: 'model', payload: { model } });
    });

    watch(this.data.selectedToolMode, (toolMode) => {
      if (!this.syncingState && toolMode !== (this.props.state?.selected_tool_mode || '')) this.emit('action', { action: 'toolMode', payload: { toolMode } });
    });

    watch(this.data.selectedThinkingMode, (thinkingMode) => {
      if (!this.syncingState && thinkingMode !== (this.props.state?.selected_thinking_mode || 'parent')) this.emit('action', { action: 'thinkingMode', payload: { thinkingMode } });
    });

    // Header options popover: position is computed in JS because it's
    // position:fixed (escapes the chat column's overflow:hidden clipping
    // caused by the side rails), so it can't rely on CSS top/right alone.
    this._onOutsideClick = (event) => {
      if (!this.data.showHeaderOptions.value) return;
      const popover = this.refs.headerOptionsPopover;
      const toggleBtn = this.refs.optionsToggleBtn;
      if (popover && popover.contains(event.target)) return;
      if (toggleBtn && toggleBtn.contains(event.target)) return;
      this.data.showHeaderOptions.value = false;
    };
    this._onResize = () => { if (this.data.showHeaderOptions.value) this.positionPopover(); };
    document.addEventListener('mousedown', this._onOutsideClick);
    window.addEventListener('resize', this._onResize);
  },
  beforeDestroy() {
    document.removeEventListener('mousedown', this._onOutsideClick);
    window.removeEventListener('resize', this._onResize);
  },
  syncFromState(state) {
    this.syncingState = true;
    this.data.selectedModel.value = state.selected_model || '';
    this.data.selectedToolMode.value = state.selected_tool_mode || '';
    this.data.selectedThinkingMode.value = state.selected_thinking_mode || 'parent';
    queueMicrotask(() => { this.syncingState = false; });
  },
  statusText() {
    if (!this.props.conversation) return 'Create or select a conversation.';
    const state = this.props.state || {};
    const selected = this.props.agents?.find((agent) => agent.id === state.forced_next_agent_id);
    return selected ? `Next: ${selected.name}` : 'Ready';
  },
  toggleHeaderOptions() {
    const next = !this.data.showHeaderOptions.value;
    if (next) this.positionPopover();
    this.data.showHeaderOptions.value = next;
  },
  positionPopover() {
    const btn = this.refs.optionsToggleBtn;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    this.data.popoverTop.value = Math.round(rect.bottom + 8);
    if (window.innerWidth <= 760) {
      this.data.popoverRight.value = null; // mobile: CSS takes over (left/right margins, full width)
      return;
    }
    this.data.popoverRight.value = Math.round(window.innerWidth - rect.right);
    queueMicrotask(() => this.clampPopover());
  },
  clampPopover() {
    const el = this.refs.headerOptionsPopover;
    if (!el || this.data.popoverRight.value === null) return;
    const rect = el.getBoundingClientRect();
    if (rect.left < 8) this.data.popoverRight.value = Math.max(8, this.data.popoverRight.value - (8 - rect.left));
  },
  togglePromptModal() { this.data.showPromptModal.value = !this.data.showPromptModal.value; },
  closePromptModal() { this.data.showPromptModal.value = false; },
  savePromptSettings() {
    this.emit('action', {
      action: 'drawThings',
      payload: {
        promptPrepend: this.data.promptPrepend.value,
        promptAppend: this.data.promptAppend.value
      }
    });
    this.data.showPromptModal.value = false;
  },
  /** @returns {{value:string,label:string}[]} */
  /** @returns {{value:string,label:string}[]} */
  modelSelectOptions() {
    return (this.props.models || []).map((model) => ({ value: model.name || model.model, label: model.name || model.model }));
  },
  /** @param {string} value */
  setSelectedModel(value) { this.data.selectedModel.value = value; },
  /** @param {string} value */
  setSelectedToolMode(value) { this.data.selectedToolMode.value = value; },
  /** @param {string} value */
  setSelectedThinkingMode(value) { this.data.selectedThinkingMode.value = value; },
  send(payload) { this.emit('send', payload); },
  command(payload) { this.emit('command', payload); },
  action(payload) { this.emit('action', payload); },
  requestAudio(message) { this.emit('request-audio', message); },
  onDeleteMessage(message) { this.emit('delete-message', message); },
  onDeleteMessagesFrom(message) { this.emit('delete-messages-from', message); },
  onRegenerateMessage(message) { this.emit('regenerate-message', message); },
  onEditMessage(payload) { this.emit('edit-message', payload); },
  reload() { this.emit('reload'); },
  nextSpeaker() { this.emit('action', { action: 'next', payload: {} }); },
  onAutoChange(enabled) { this.emit('action', { action: 'auto', payload: { enabled } }); },
  onAudioAutoPlayChange(enabled) { this.emit('toggle-audio-autoplay', enabled); },
  onStop() { this.emit('action', { action: 'stop', payload: {} }); },
  flush() { this.emit('action', { action: 'flush', payload: {} }); }
};
