import { globals } from 'tinybubble';
import { api, clientLog } from '../api/client.js';

export default {
  name: 'MessageComposer',
  props: [
    'disabled', 'agents', 'profiles', 'activeProfileId',
    'forcedNextAgentId', 'autoMode', 'conversationModel', 'dicePending', 'diceSpeakerName', 'dicePublicReason'
  ],
  emits: ['send', 'command', 'action', 'open-dice-roll'],
  template() {
    return /*html*/`
      <section class="composer-panel" ref="panel">
        <template x-if="dicePending">
          <div class="composer-dice-resolution">
            <div class="composer-dice-resolution-context">
              <p><strong>{{ diceSpeakerName }}</strong> has requested a roll.</p>
              <p x-if="dicePublicReason" class="composer-dice-resolution-reason">Reason: {{ dicePublicReason }}</p>
            </div>
            <button type="button" class="composer-dice-resolution-btn" @click="emit('open-dice-roll')">
              <span class="material-symbols-outlined">casino</span>
              <span>Resolve dice roll</span>
              <span class="composer-dice-resolution-hint">Open table</span>
            </button>
          </div>
        </template>
        <template x-if="!dicePending">
          <div class="composer-container">
          <!-- Background glow behind the composer -->
          <div class="composer-backglow"></div>
          <!-- Gradient border glow -->
          <div class="composer-glow"></div>

          <!-- Main input surface -->
          <div class="composer-surface">
            <!-- Textarea -->
            <div class="composer-textarea-wrap">
              <textarea
                class="composer-textarea"
                placeholder="Write a message or a /command..."
                rows="1"
                x-model="draft"
                @input="onInput"
                @keydown="onKeydown"
                :disabled="disabled || generating"
                ref="textarea"
              ></textarea>
              <button
                type="button"
                class="composer-ai-btn"
                :disabled="disabled || !draft.trim() || generating"
                @click="generateDraft"
                title="Generate message"
              >
                <span x-if="!generating" class="material-symbols-outlined">auto_awesome</span>
                <span x-if="generating" class="material-symbols-outlined" style="animation:spin .8s linear infinite">autorenew</span>
              </button>
            </div>

            <!-- Action bar -->
            <div class="composer-actions">
              <!-- Left group -->
              <div class="composer-actions-left">
                <!-- Current speaker pill -->
                <div class="composer-pill-wrap">
                  <button
                    type="button"
                    class="composer-pill"
                    @click="toggleSpeakerMenu"
                    :disabled="disabled"
                    title="Speak as..."
                  >
                    <span class="material-symbols-outlined icon-sm">{{ speakerIcon }}</span>
                    <span class="composer-pill-label">{{ speakerName }}</span>
                    <span class="material-symbols-outlined icon-xs">keyboard_arrow_down</span>
                  </button>
                  <!-- Speaker dropdown: profiles + agents -->
                  <div
                    x-show="showSpeakerMenu"
                    class="composer-dropdown"
                  >
                    <template x-if="profiles && profiles.length">
                      <div>
                        <div class="composer-dropdown-header">Profilo utente</div>
                        <button
                          type="button"
                          x-for="profile in profiles"
                          @click="selectSpeaker(profile.id, 'profile', $event)"
                        >
                          <span>{{ profile.name }}</span>
                          <span
                            class="material-symbols-outlined dd-check"
                            x-show="currentSpeakerType === 'profile' && currentSpeakerId === profile.id"
                          >check</span>
                        </button>
                        <div x-if="agents && agents.length" class="composer-dropdown-divider"></div>
                      </div>
                    </template>
                    <template x-if="agents && agents.length">
                      <div>
                        <div class="composer-dropdown-header">Agenti (impersona)</div>
                        <button
                          type="button"
                          x-for="agent in agents"
                          @click="selectSpeaker(agent.id, 'agent', $event)"
                        >
                          <span>{{ agent.name }}</span>
                          <span
                            class="material-symbols-outlined dd-check"
                            x-show="currentSpeakerType === 'agent' && currentSpeakerId === agent.id"
                          >check</span>
                        </button>
                      </div>
                    </template>
                  </div>
                </div>

                <!-- Next speaker pill -->
                <div class="composer-pill-wrap">
                  <button
                    type="button"
                    class="composer-pill"
                    @click="toggleNextMenu"
                    :disabled="disabled"
                    title="Force next speaker"
                  >
                    <span class="material-symbols-outlined icon-sm" style="color:#d0bcff">arrow_forward</span>
                    <span class="composer-pill-marquee" ref="nextMarquee"><span class="composer-pill-label">{{ nextSpeakerName || 'Next agent' }}</span></span>
                    <span class="material-symbols-outlined icon-xs">keyboard_arrow_down</span>
                  </button>
                  <div
                    x-show="showNextMenu"
                    class="composer-dropdown"
                  >
                    <button type="button" @click="selectNextSpeaker('', $event)">
                      <span>— Auto —</span>
                      <span class="material-symbols-outlined dd-check" x-show="!nextSpeakerId">check</span>
                    </button>
                    <div class="composer-dropdown-divider"></div>
                    <button
                      type="button"
                      x-for="agent in agents"
                      @click="selectNextSpeaker(agent.id, $event)"
                    >
                      <span>{{ agent.name }}</span>
                      <span
                        class="material-symbols-outlined dd-check"
                        x-show="nextSpeakerId === agent.id"
                      >check</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- Right group -->
              <div class="composer-actions-right">
                <!-- Tool toggles (shown after /allow-tool click) -->
                <div x-if="showToolToggles" class="composer-tool-toggles">
                  <button type="button" class="tool-toggle" :class="{ active: toolImagen }" @click="toggleTool('imagen', $event)" :disabled="disabled">🖼</button>
                  <button type="button" class="tool-toggle" :class="{ active: toolNarrate }" @click="toggleTool('narrate', $event)" :disabled="disabled">📖</button>
                  <button type="button" class="tool-toggle" :class="{ active: toolAddAgent }" @click="toggleTool('add_agent', $event)" :disabled="disabled">👤</button>
                  <button type="button" class="tool-toggle" :class="{ active: toolAppendToMyIntro }" @click="toggleTool('append_to_my_intro', $event)" :disabled="disabled">📝</button>
                  <button type="button" class="tool-toggle" :class="{ active: toolAppendToIntro }" @click="toggleTool('append_to_intro', $event)" :disabled="disabled">🗒️</button>
                </div>

                <!-- Commands pill -->
                <div class="composer-pill-wrap">
                  <button
                    type="button"
                    class="composer-pill"
                    @click="toggleCmdMenu"
                    :disabled="disabled"
                    title="Quick commands"
                  >
                    <span class="composer-pill-label primary">/</span>
                    <span class="material-symbols-outlined icon-xs">keyboard_arrow_down</span>
                  </button>
                  <div
                    x-show="showCmdMenu"
                    class="composer-dropdown right-aligned"
                  >
                    <button type="button" @click="insertCommand('/next', $event)">
                      <strong>/next</strong>

                    </button>
                    <button type="button" @click="insertCommand(autoMode ? '/auto off' : '/auto', $event)">
                      <strong>{{ autoMode ? '/auto off' : '/auto' }}</strong>

                    </button>
                    <button type="button" @click="insertCommand('/flush', $event)">
                      <strong>/flush</strong>

                    </button>
                    <button type="button" @click="insertCommand('/bye', $event)">
                      <strong>/bye</strong>

                    </button>
                    <button type="button" @click="openToolToggles($event)">
                      <strong>/allow-tool</strong>

                    </button>
                  </div>
                </div>

                <!-- Voice (placeholder) -->
                <button
                  type="button"
                  class="composer-icon-btn"
                  :disabled="disabled"
                  title="Voice input (coming soon)"
                >
                  <span class="material-symbols-outlined icon-20">mic_none</span>
                </button>

                <!-- Send / Next button -->
                <button
                  type="button"
                  class="composer-send-btn"
                  @click="submit"
                  :disabled="disabled"
                  data-tooltip="Add message"
                >
                  <span class="material-symbols-outlined icon-20">arrow_upward</span>
                </button>

                <!-- Magic send (impersonate + trigger next) -->
                <button
                  x-if="isImpersonating()"
                  type="button"
                  class="composer-send-btn composer-magic-btn"
                  @click="submitMagic"
                  :disabled="disabled"
                  data-tooltip="Add message and generate"
                >
                  <span class="material-symbols-outlined icon-16">arrow_forward</span>
                  <span class="material-symbols-outlined icon-magic">auto_awesome</span>
                </button>

                <!-- Stop button (auto mode) -->
                <button
                  x-if="autoMode"
                  type="button"
                  class="composer-stop-btn"
                  @click="stopAuto"
                  :disabled="disabled"
                  title="Stop"
                >
                  <span class="material-symbols-outlined icon-20">stop</span>
                </button>
              </div>
            </div>
          </div>
          </div>
        </template>
        <!-- Tooltip balloon -->
        <div ref="tooltipEl" class="composer-tooltip"></div>
      </section>
    `;
  },

  data() {
    return {
      draft: '',
      currentSpeakerId: '',
      currentSpeakerType: 'profile',
      nextSpeakerId: '',
      speakerName: 'User',
      speakerIcon: 'person',
      nextSpeakerName: '',
      showSpeakerMenu: false,
      showNextMenu: false,
      showCmdMenu: false,
      showToolToggles: false,
      toolImagen: false,
      toolNarrate: false,
      toolAddAgent: false,
      toolAppendToMyIntro: false,
      toolAppendToIntro: false,
      generating: false,
    };
  },

  init() {
    // Set initial speaker from active profile
    const profileId = this.props.activeProfileId;
    if (profileId) {
      this.data.currentSpeakerId.value = profileId;
      this.data.currentSpeakerType.value = 'profile';
    }

    // Set initial next speaker from forced next agent
    const forcedId = this.props.forcedNextAgentId;
    if (forcedId) {
      this.data.nextSpeakerId.value = forcedId;
    }

    // Sync display names
    this._updateSpeakerName();
    this._watchNextSpeaker();

    // Document click to close dropdowns
    this._onDocClick = (e) => {
      if (this.refs.panel && !this.refs.panel.contains(e.target)) {
        this.closeAllDropdowns();
      }
    };
    document.addEventListener('click', this._onDocClick);
  },

  mounted() {
    this.resizeTextarea();
    this._checkMarquee();
    this._onResize = () => this._checkMarquee();
    window.addEventListener('resize', this._onResize);
    this._tipTimeout = null;
    this._initTooltips();
  },

  beforeDestroy() {
    document.removeEventListener('click', this._onDocClick);
    this._onDocClick = null;
    window.removeEventListener('resize', this._onResize);
    this._destroyTooltips();
  },

  _initTooltips() {
    const panel = this.refs.panel;
    const tip = this.refs.tooltipEl;
    if (!panel || !tip) return;

    let target = null;
    let timer = null;

    this._onTipMove = (e) => {
      const btn = e.target.closest && e.target.closest('[data-tooltip]');
      // Same target, keep waiting
      if (btn === target) return;
      // Different or no target → hide + reset
      if (timer) { clearTimeout(timer); timer = null; }
      tip.classList.remove('visible');
      target = btn;
      // Start timer for new target
      if (btn && panel.contains(btn)) {
        timer = setTimeout(() => {
          if (!document.contains(btn) || target !== btn) return;
          const r = btn.getBoundingClientRect();
          tip.textContent = btn.getAttribute('data-tooltip');
          tip.style.left = (r.left + r.width / 2) + 'px';
          tip.style.top = (r.top - 8) + 'px';
          tip.classList.add('visible');
        }, 500);
      }
    };

    // Listen on panel in capture phase — catches all mouse movement
    panel.addEventListener('mouseover', this._onTipMove, true);
  },

  _destroyTooltips() {
    const panel = this.refs.panel;
    if (panel) panel.removeEventListener('mouseover', this._onTipMove, true);
  },

  onInput() {
    this.resizeTextarea();
  },

  onKeydown(e) {
    // Cmd+Enter (Mac) or Ctrl+Enter → send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.submit();
    }
  },

  resizeTextarea() {
    const el = this.refs.textarea;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 420) + 'px';
  },

  // --- Speaker selection ---

  selectSpeaker(id, type, e) {
    if (e) e.stopPropagation();
    this.data.currentSpeakerId.value = id;
    this.data.currentSpeakerType.value = type;
    this.data.showSpeakerMenu.value = false;
    this._updateSpeakerName();
  },

  selectNextSpeaker(id, e) {
    if (e) e.stopPropagation();
    this.data.nextSpeakerId.value = id;
    this.data.showNextMenu.value = false;
    this._watchNextSpeaker();
    this.emit('action', { action: 'to', payload: { agentId: id } });
  },

  // --- Tool toggles ---

  openToolToggles(e) {
    if (e) e.stopPropagation();
    this.data.showCmdMenu.value = false;
    this.data.showToolToggles.value = !this.data.showToolToggles.value;
  },

  toggleTool(name, e) {
    if (e) e.stopPropagation();
    const map = { imagen: 'toolImagen', narrate: 'toolNarrate', add_agent: 'toolAddAgent', append_to_my_intro: 'toolAppendToMyIntro', append_to_intro: 'toolAppendToIntro' };
    const key = map[name];
    if (!key) return;
    const current = this.data[key].value;
    this.data[key].value = !current;
    this.emit('command', {
      command: this.data[key].value ? `/allow-tool ${name}` : `/disallow-tool ${name}`
    });
  },

  // --- AI message generation ---

  generateDraft() {
    const text = this.data.draft.value.trim();
    if (!text) return;

    const type = this.data.currentSpeakerType.value;
    const id = this.data.currentSpeakerId.value;
    const isAgent = type === 'agent';
    let speakerIntro = '';
    let speakerName = this.data.speakerName.value || 'Character';
    let language = 'en';

    if (isAgent) {
      const agent = (this.props.agents || []).find(a => a.id === id);
      speakerIntro = agent?.introduction || '';
      language = agent?.language || 'en';
    } else {
      const profile = (this.props.profiles || []).find(p => p.id === id);
      speakerIntro = profile?.introduction || '';
    }

    // Disable textarea while generating — keep current text visible
    this.data.generating.value = true;

    const prompt = [
      `You are ${speakerName}.`,
      speakerIntro ? `Character profile: ${speakerIntro}` : null,
      `Language: ${language}. You will only write in ${language}.`,
      '',
      `Below is input from the user. Decide what to do based on its tone:`,
      `- If it sounds like a message or dialogue draft (e.g. "I think we should..."), rewrite and expand it from ${speakerName}'s perspective. Improve it, make it more natural and in character, while keeping the same meaning.`,
      `- If it sounds like a prompt, desire, or instruction (e.g. "tell him about the plan", "introduce yourself"), write a new conversational message from ${speakerName}'s perspective that fulfills it. Write naturally, in character.`,
      `- If it's a question or a few words, write a message that answers or responds to it as ${speakerName}.`,
      '',
      `Input:`,
      text,
      '',
      `Output ONLY the message text in ${language}, no meta-commentary, no quotes, no headers. Do not include the input or any explanation. Never use quotes. No actions, no sound, no narration, only a conversational message that ${speakerName} would say in response to the input. Just one mid-long message, not too short but not too long. But just one, If you want to separate into multiple messages, combine them into one message by use paragraph breakk and dont start the next paragraph with a quote or a header or a dash.`
    ].filter(Boolean).join('\n');

    const model = this.props.conversationModel || '';
    api.generateText({ prompt, model }).then(response => {
      let result = (response?.text || response?.content || response || '').trim();
      if (result) {
        if(result.startsWith('"') && result.endsWith('"')) {
          // Strip quotes if model wrapped the output in them despite instructions not to
          result = result.slice(1, -1).trim();
        }
        this.data.draft.value = result;
        this.resizeTextarea();
      }
    }).catch(error => {
      console.error('Generate message failed:', error);
    }).finally(() => {
      this.data.generating.value = false;
    });
  },

  // --- Submit / send ---

  isImpersonating() {
    return this.data.currentSpeakerType.value === 'agent' && !!this.data.currentSpeakerId.value;
  },

  _sendImpersonate(text) {
    const agentId = this.data.currentSpeakerId.value;
    this.data.draft.value = '';
    this.emit('command', { command: `/impersonate ${agentId} ${text}` });
    // Reset back to user profile after impersonation
    this.data.currentSpeakerType.value = 'profile';
    this.data.currentSpeakerId.value = this.props.activeProfileId || '';
    this._updateSpeakerName();
  },

  submitMagic() {
    const text = this.data.draft.value.trim();
    if (!text) return;
    this._sendImpersonate(text);
    // Also trigger AI to generate the next response
    this.emit('action', { action: 'next', payload: {} });
  },

  submit() {
    const text = this.data.draft.value.trim();
    const isImp = this.data.currentSpeakerType.value === 'agent';
    const agentId = this.data.currentSpeakerId.value;

    // Empty → next speaker
    if (!text) {
      this.emit('action', { action: 'next', payload: {} });
      return;
    }

    this.data.draft.value = '';

    // Slash commands always take precedence
    if (text.startsWith('/')) {
      this.emit('command', { command: text });
      return;
    }

    // Impersonation mode: send as selected agent
    if (isImp && agentId) {
      this._sendImpersonate(text);
      return;
    }

    // Normal send
    this.emit('send', { content: text });
  },

  stopAuto() {
    this.emit('action', { action: 'stop', payload: {} });
  },

  // --- Dropdown toggles ---

  toggleSpeakerMenu(e) {
    e.stopPropagation();
    const open = this.data.showSpeakerMenu.value;
    this.closeAllDropdowns();
    this.data.showSpeakerMenu.value = !open;
  },

  toggleNextMenu(e) {
    e.stopPropagation();
    const open = this.data.showNextMenu.value;
    this.closeAllDropdowns();
    this.data.showNextMenu.value = !open;
  },

  toggleCmdMenu(e) {
    e.stopPropagation();
    const open = this.data.showCmdMenu.value;
    this.closeAllDropdowns();
    this.data.showCmdMenu.value = !open;
  },

  insertCommand(command, e) {
    if (e) e.stopPropagation();
    this.data.draft.value = command;
    this.data.showCmdMenu.value = false;
  },

  closeAllDropdowns() {
    this.data.showSpeakerMenu.value = false;
    this.data.showNextMenu.value = false;
    this.data.showCmdMenu.value = false;
  },

  // --- Internal ---

  _updateSpeakerName() {
    const type = this.data.currentSpeakerType.value;
    const id = this.data.currentSpeakerId.value;

    if (type === 'profile') {
      const p = (this.props.profiles || []).find(p => p.id === id);
      this.data.speakerName.value = p ? p.name : 'User';
      this.data.speakerIcon.value = 'person';
      return;
    }

    if (type === 'agent') {
      const a = (this.props.agents || []).find(a => a.id === id);
      this.data.speakerName.value = a ? a.name : 'Agent';
      this.data.speakerIcon.value = 'smart_toy';
      return;
    }

    this.data.speakerName.value = 'User';
    this.data.speakerIcon.value = 'person';
  },

  _watchNextSpeaker() {
    const id = this.data.nextSpeakerId.value;
    if (id) {
      const a = (this.props.agents || []).find(a => a.id === id);
      this.data.nextSpeakerName.value = a ? a.name : '';
    } else {
      this.data.nextSpeakerName.value = '';
    }
    // Re-check marquee after name changes
    queueMicrotask(() => this._checkMarquee());
  },

  _checkMarquee() {
    const el = this.refs.nextMarquee;
    if (!el) return;
    const label = el.querySelector('.composer-pill-label');
    const overflows = label && label.scrollWidth > el.clientWidth + 2;
    el.classList.toggle('marquee', !!overflows);
  },
};
