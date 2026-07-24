import { globals, watch, Signal } from 'tinybubble';
import { api, clientLog, openConversationStream } from './api/client.js';
import { synthesizeMessage, blobToBase64 } from './services/kokoroBrowser.ts';
import { router } from './router';
import audioManager from './lib/AudioManager.js';
import ConversationList from './components/ConversationList.bub.js';
import ChatView from './components/ChatView.bub.js';
import AgentPanel from './components/AgentPanel.bub.js';
import ProfilePanel from './components/ProfilePanel.bub.js';
import SettingsPanel from './components/SettingsPanel.bub.js';
import WorldPanel from './components/WorldPanel.bub.js';
import DiceRoller from './components/DiceRoller.bub.js';

function listFrom(response, key) {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response[key])) return response[key];
  if (response && Array.isArray(response.items)) return response.items;
  return [];
}

function itemFrom(response, key) {
  return response && response[key] ? response[key] : response;
}

function keepLatestAudio(attachments) {
  const audio = attachments.filter((a) => a.type === 'audio' || String(a.mime_type || '').startsWith('audio/'));
  if (audio.length <= 1) return attachments;
  // Sort by created_at descending, keep the newest
  audio.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const latest = audio[0];
  const nonAudio = attachments.filter((a) => a.type !== 'audio' && !String(a.mime_type || '').startsWith('audio/'));
  return [...nonAudio, latest];
}

export default {
  name: 'App',
  components: {
    'conversation-list': ConversationList,
    'chat-view': ChatView,
    'agent-panel': AgentPanel,
    'profile-panel': ProfilePanel,
    'settings-panel': SettingsPanel,
    'world-panel': WorldPanel,
    'dice-roller': DiceRoller
  },
  template() {
    return /*html*/`
      <div class="app-shell" :class="shellClass()">
        <div x-if="leftRailOpen" class="left-rail">
          <div class="left-rail-header mobile-only">
            <span class="left-rail-title">Conversations</span>
            <button type="button" class="rail-close-btn" @click="toggleLeftRail">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <conversation-list :conversations="conversations" :theme="theme" :active-conversation-id="activeConversationId" :loading="loading" :conversation-model="conversationModel" :kokoro-voices="kokoroVoices" @select="selectConversation" @create="createConversation" @archive="archiveConversation" @delete="deleteConversation" @duplicate="duplicateConversation" @set-theme="setTheme" @create-from-blueprint="createConversationFromBlueprint"></conversation-list>
        </div>
        <chat-view :conversation="activeConversation" :messages="messages" :agents="agents" :profiles="profiles" :models="models" :state="conversationState" :streaming-message="streamingMessage" :tool-events="toolEvents" :loading="loading" :audio-auto-play="audioAutoPlay" :playing-audio-message-id="playingAudioMessageId" :last-image-message-id="lastImageMessageId" :image-pending="imagePending" :extra-attachments="extraAttachments" :patches="messagePatches" :generating-audio-ids="generatingAudioIds" :left-rail-open="leftRailOpen" :right-rail-open="rightRailOpen" :dice-pending="diceToolCallId && diceConversationId === activeConversationId" :dice-speaker-name="diceSpeakerName" :dice-public-reason="dicePublicReason" @send="sendMessage" @command="runCommand" @action="runAction" @request-audio="requestAudio" @reload="reloadActiveConversation" @toggle-audio-autoplay="setAudioAutoPlay" @delete-message="onDeleteMessage" @delete-messages-from="onDeleteMessagesFrom" @regenerate-message="onRegenerateMessage" @edit-message="onEditMessage" @open-dice-roll="openDiceRoll" @toggle-left-rail="toggleLeftRail" @toggle-right-rail="toggleRightRail"></chat-view>
        <div x-if="leftRailOpen || rightRailOpen" class="rail-backdrop mobile-only" @click="leftRailOpen ? toggleLeftRail() : toggleRightRail()"></div>
        <aside x-if="rightRailOpen" class="right-rail">
          <nav class="tabs" aria-label="Panels">
            <button type="button" :class="{ active: activePanel === 'agents' }" @click="setPanel('agents')">Agents</button>
            <button type="button" :class="{ active: activePanel === 'profiles' }" @click="setPanel('profiles')">Profile</button>
            <button type="button" :class="{ active: activePanel === 'settings' }" @click="setPanel('settings')">Settings</button>
            <button type="button" :class="{ active: activePanel === 'world' }" @click="setPanel('world')">World</button>
            <button type="button" class="rail-close-btn mobile-only" @click="toggleRightRail">
              <span class="material-symbols-outlined">close</span>
            </button>
          </nav>
          <div class="aside-scroll">
            <template x-if="activePanel === 'agents'">
              <agent-panel :agents="agents" :models="models" :kokoro-voices="kokoroVoices" :disabled="!activeConversation" :conversation-model="conversationModel" @create="createAgent" @update="updateAgent" @delete="deleteAgent" @refresh-kokoro-voices="loadKokoroVoices"></agent-panel>
            </template>
            <template x-if="activePanel === 'profiles'">
              <profile-panel :profiles="profiles" :active-profile-id="activeProfileId()" :disabled="!activeConversation" :conversation-model="conversationModel" @create="createProfile" @update="updateProfile" @delete="deleteProfile" @activate="activateProfile"></profile-panel>
            </template>
            <template x-if="activePanel === 'settings'">
              <settings-panel :settings="settings" :draw-status="drawStatus" :voices="voices" :kokoro-voices="kokoroVoices" :models="models" :draw-models="drawModels" @save="saveSettings" @probe-draw-things="probeDrawThings" @refresh-voices="loadVoices" @refresh-kokoro-voices="loadKokoroVoices" @refresh-models="loadModels"></settings-panel>
            </template>
            <template x-if="activePanel === 'world'">
              <world-panel :conversation-id="activeConversationId" :conversation-model="conversationModel"></world-panel>
            </template>
            <div x-if="error" class="error-banner">{{ error }}</div>
          </div>
        </aside>
        <!-- Dice Roll overlay -->
        <div class="dice-overlay" :class="{ visible: showDiceOverlay }" @click="dismissDiceRoll($event)">
          <template x-if="showDiceOverlay">
            <div class="dice-overlay-card">
              <dice-roller :type="diceType" :challenge-value="diceChallengeValue" :sign="diceSign" :label="diceLabel" :speaker-name="diceSpeakerName" :public-reason="dicePublicReason" :roll-id="diceToolCallId" :interactive="true" @roll-complete="onDiceRollComplete"></dice-roller>
              <button type="button" class="dice-overlay-close" @click="dismissDiceRoll($event, true)">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>
          </template>
        </div>
      </div>
    `;
  },
  data() {
    return {
      showDiceOverlay: false,
      diceType: 'd20',
      diceChallengeValue: null,
      diceSign: '>=',
      diceToolCallId: '',
      diceConversationId: '',
      diceRollSubmitted: false,
      diceLabel: '',
      diceSpeakerName: '',
      dicePublicReason: '',
      loading: false,
      error: '',
      settings: {},
      conversations: [],
      activeConversationId: '',
      activeConversation: null,
      conversationState: {},
      messages: [],
      agents: [],
      profiles: [],
      voices: [],
      kokoroVoices: [],
      drawStatus: { available: false, message: 'Not probed' },
      models: [],
      drawModels: [],
      activePanel: 'agents',
      streamingMessage: null,
      toolEvents: [],
      lastEventId: '',
      audioAutoPlay: false,
      playingAudioMessageId: '',
      lastImageMessageId: '',
      imagePending: {},
      generatingAudioIds: {},
      extraAttachments: {},
      messagePatches: {},
      leftRailOpen: true,
      rightRailOpen: true,
      theme: localStorage.getItem('supachat.theme') || 'tau',
    };
  },
  async init() {
    // Playback is cursor-driven by the AudioManager. Mirror which message it
    // is playing into playingAudioMessageId so the message list can track it.
    this._onAudioState = (state) => {
      this.data.playingAudioMessageId.value = state && state.currentMessageId ? state.currentMessageId : '';
    };
    audioManager.onChange('mainVoice', this._onAudioState);
    // On mobile (≤760px) rails start closed regardless of localStorage
    const isMobile = window.innerWidth <= 760;
    this.data.leftRailOpen.value = isMobile ? false : localStorage.getItem('supachat.leftRailOpen') !== 'false';
    this.data.rightRailOpen.value = isMobile ? false : localStorage.getItem('supachat.rightRailOpen') !== 'false';
    await this.bootstrap();
    const route = globals.$route.value;
    const routeId = route.params.id || '';
    if (routeId) {
      await this.selectConversation({ id: routeId }, true);
    } else if (this.data.conversations.value.length) {
      await this.selectConversation(this.data.conversations.value[0], true);
    }
    // React to browser navigation (back/forward).
    watch(globals.$route, (nextRoute) => {
      const id = nextRoute.params.id || '';
      if (id && id !== this.data.activeConversationId.value) {
        this.selectConversation({ id }, true);
      } else if (!id && this.data.activeConversationId.value) {
        this.closeActiveConversation();
      }
    });
    // Apply saved theme
    this._applyTheme(this.data.theme.value);
  },
  beforeDestroy() {
    if (this._dismissTimer) clearTimeout(this._dismissTimer);
    this.closeStream();
    audioManager.offChange('mainVoice', this._onAudioState);
    audioManager.stop();
  },
  closeActiveConversation() {
    this.closeStream();
    this.data.activeConversationId.value = '';
    this.data.activeConversation.value = null;
    this.data.conversationState.value = {};
    this.data.messages.value = [];
    this.data.agents.value = [];
    this.data.profiles.value = [];
    this.data.streamingMessage.value = null;
    this.data.toolEvents.value = [];
    audioManager.stop();
    this.data.lastImageMessageId.value = '';
    this.data.imagePending.value = {};
  },
  shellClass() {
    return `${this.data.leftRailOpen.value ? 'left-open' : 'left-closed'} ${this.data.rightRailOpen.value ? 'right-open' : 'right-closed'}`;
  },
  toggleLeftRail() {
    const next = !this.data.leftRailOpen.value;
    this.data.leftRailOpen.value = next;
    localStorage.setItem('supachat.leftRailOpen', String(next));
  },
  toggleRightRail() {
    const next = !this.data.rightRailOpen.value;
    this.data.rightRailOpen.value = next;
    localStorage.setItem('supachat.rightRailOpen', String(next));
  },

  _applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
  },

  setTheme(theme) {
    if (theme === this.data.theme.value) return;
    this.data.theme.value = theme;
    localStorage.setItem('supachat.theme', theme);
    this._applyTheme(theme);
  },
  async bootstrap() {
    clientLog('bootstrap');
    await this.safeLoad(async () => {
      const [settings, conversations, drawStatus, models, kokoroVoices] = await Promise.all([
        api.getSettings().catch(() => ({})),
        api.getConversations().catch(() => []),
        api.getDrawThingsStatus().catch((error) => ({ available: false, message: error.message })),
        api.getOllamaModels().catch(() => ({ models: [] })),
        api.getKokoroVoices().catch(() => ({ voices: [] }))
      ]);
      this.data.settings.value = itemFrom(settings, 'settings') || {};
      this.data.conversations.value = listFrom(conversations, 'conversations');
      this.data.drawStatus.value = itemFrom(drawStatus, 'status') || drawStatus;
      this.data.models.value = listFrom(models, 'models');
      this.data.kokoroVoices.value = listFrom(kokoroVoices, 'voices');
      this.data.drawModels.value = this.drawModelsFrom(this.data.drawStatus.value, this.data.settings.value);
      // Initialize reactive global for TTS engine used by AgentPanel
      const engine = (this.data.settings.value?.tts?.engine) || 'piper';
      if (!globals.$ttsEngine) globals.$ttsEngine = Signal(engine);
      else globals.$ttsEngine.value = engine;
    });
  },
  drawModelsFrom(status, settings) {
    const statusSettings = status && status.settings ? status.settings : {};
    const appSettings = settings && settings.drawThings ? settings.drawThings : {};
    const probe = statusSettings.lastProbe || appSettings.lastProbe || {};
    if (probe && Array.isArray(probe.filesystemModels)) return probe.filesystemModels;
    return listFrom(probe.models, 'models');
  },
  async safeLoad(work) {
    this.data.loading.value = true;
    this.data.error.value = '';
    try {
      await work();
    } catch (error) {
      this.data.error.value = error.message || String(error);
    } finally {
      this.data.loading.value = false;
    }
  },
  setPanel(panel) { this.data.activePanel.value = panel; },
  async createConversation(payload = {}) {
    const title = payload && payload.title ? payload.title : 'New conversation';
    await this.safeLoad(async () => {
      const response = await api.createConversation({ title, password: payload.password || undefined });
      const conversation = itemFrom(response, 'conversation');
      if (conversation) {
        this.upsertConversation(conversation);
        await this.selectConversation(conversation);
      }
    });
  },
  async createConversationFromBlueprint(blueprint) {
    if (!blueprint) return;
    const title = blueprint.title || 'New conversation';
    await this.safeLoad(async () => {
      // Track partial failures for reporting
      /** @type {{ profile: Error|null, agents: Error[], world: Error[] }} */
      const failures = { profile: null, agents: [], world: [] };

      // 1. Create the conversation
      const convResponse = await api.createConversation({ title });
      const conversation = itemFrom(convResponse, 'conversation');
      if (!conversation) throw new Error('Failed to create conversation');
      const cid = conversation.id;

      // 2. Create profile
      if (blueprint.profile) {
        try {
          await api.createProfile(cid, {
            name: blueprint.profile.name || 'User',
            introduction: blueprint.profile.introduction || ''
          });
        } catch (e) {
          failures.profile = e;
        }
      }

      // 3. Create agents
      if (Array.isArray(blueprint.agents)) {
        for (const agent of blueprint.agents) {
          try {
            const payload = {
              name: agent.name,
              introduction: agent.introduction || '',
              appearance: agent.appearance || '',
              voice: agent.voice || '',
              language: (agent.voice || '').split('-')[0] || 'en_US',
              is_narrator: !!agent.is_narrator,
              tools: agent.tools || { imagen: true, narrate: false },
              audio_enabled: true,
              auto_select: true
            };
            await api.createAgent(cid, payload);
          } catch (e) {
            failures.agents.push(e);
          }
        }
      }

      // 4. Create world entries
      if (Array.isArray(blueprint.world)) {
        for (const entry of blueprint.world) {
          try {
            await api.createStoryEntry(cid, {
              kind: entry.kind || 'fact',
              title: entry.title || '',
              content: entry.content || ''
            });
          } catch (e) {
            failures.world.push(e);
          }
        }
      }

      // 5. Report any failures
      const totalFailures = (failures.profile ? 1 : 0) + failures.agents.length + failures.world.length;
      if (totalFailures > 0) {
        const msg = [
          failures.profile ? `Profile: ${failures.profile.message}` : '',
          failures.agents.length ? `Agents: ${failures.agents.length} failed (${failures.agents[0].message})` : '',
          failures.world.length ? `World: ${failures.world.length} failed (${failures.world[0].message})` : ''
        ].filter(Boolean).join('; ');
        console.warn(`Blueprint import had ${totalFailures} error(s): ${msg}`);
      }

      // 6. Select the conversation (reloads everything)
      this.upsertConversation(conversation);
      await this.selectConversation(conversation);
    });
  },
  async selectConversation(conversation, skipNavigate) {
    if (!conversation || !conversation.id) return;
    // Already the active conversation, skip reload
    if (conversation.id === this.data.activeConversationId.value) return;
    this.data.activeConversationId.value = conversation.id;
    if (!skipNavigate) router.navigate('/c/' + conversation.id);
    clientLog('select_conversation', { id: conversation.id });
    await this.reloadActiveConversation();
    this.openStream();
    // Check for pending dice roll after stream opens
    this.checkPendingDiceRoll();
  },
  async reloadActiveConversation() {
    const id = this.data.activeConversationId.value;
    if (!id) return;
    await this.safeLoad(async () => {
      const conversation = await api.getConversation(id);
      const messages = await api.getMessages(id);
      const agents = await api.getAgents(id);
      const profiles = await api.getProfiles(id);
      const active = itemFrom(conversation, 'conversation');
      const state = this.stateFromConversation(active, conversation);
      this.data.activeConversation.value = active;
      this.data.conversationState.value = state;
      this.data.audioAutoPlay.value = Boolean(state.audio_auto_play);
      audioManager.setAutoAdvance(Boolean(state.audio_auto_play));
      const nextMessages = listFrom(messages, 'messages').map((m) => ({
        ...m,
        // Keep all attachments (AudioManager handles chunk ordering)
        attachments: m.attachments || []
      }));
      console.log('Next messages:', nextMessages);
      // return;
      this.data.messages.value = nextMessages;
      this.data.extraAttachments.value = {};
      this.data.messagePatches.value = {};
      clientLog('messages_loaded', { count: nextMessages.length, attachments: nextMessages.reduce((n, message) => n + (message.attachments ? message.attachments.length : 0), 0) });
      this.data.agents.value = listFrom(agents, 'agents');
      this.data.profiles.value = listFrom(profiles, 'profiles');
      this.data.streamingMessage.value = null;
      audioManager.stop();
      this.data.lastImageMessageId.value = '';
    });
  },
  activeProfileId() {
    const state = this.data.conversationState.value || {};
    return state.active_profile_id || '';
  },
  conversationModel() {
    const state = this.data.conversationState.value || {};
    const ai = this.data.settings.value?.ai || {};
    return state.selected_model || ai.model || '';
  },
  stateFromConversation(active, conversation) {
    if (active && active.state) return active.state;
    if (conversation && conversation.state) return conversation.state;
    return {};
  },
  upsertConversation(conversation) {
    if (!conversation || !conversation.id) return;
    const current = this.data.conversations.value || [];
    const exists = current.some((item) => item.id === conversation.id);
    this.data.conversations.value = exists
      ? current.map((item) => item.id === conversation.id ? { ...item, ...conversation } : item)
      : [conversation, ...current];
  },
  removeConversation(id) {
    this.data.conversations.value = (this.data.conversations.value || []).filter((item) => item.id !== id);
  },
  upsertAgent(agent) {
    if (!agent || !agent.id) return;
    const current = this.data.agents.value || [];
    const exists = current.some((item) => item.id === agent.id);
    this.data.agents.value = exists
      ? current.map((item) => item.id === agent.id ? { ...item, ...agent } : item)
      : [...current, agent];
  },
  removeAgent(id) {
    this.data.agents.value = (this.data.agents.value || []).filter((item) => item.id !== id);
  },
  upsertProfile(profile) {
    if (!profile || !profile.id) return;
    const current = this.data.profiles.value || [];
    const exists = current.some((item) => item.id === profile.id);
    this.data.profiles.value = exists
      ? current.map((item) => item.id === profile.id ? { ...item, ...profile } : item)
      : [...current, profile];
  },
  removeProfile(id) {
    this.data.profiles.value = (this.data.profiles.value || []).filter((item) => item.id !== id);
  },
  applyState(state) {
    if (!state || !state.conversation_id) return;
    this.data.conversationState.value = state;
    this.data.audioAutoPlay.value = Boolean(state.audio_auto_play);
    audioManager.setAutoAdvance(Boolean(state.audio_auto_play));
    const active = this.data.activeConversation.value;
    if (active && active.id === state.conversation_id) {
      this.data.activeConversation.value = { ...active, state };
    }
  },
  applyActionResult(action, result) {
    if (!result) return;
    if (result.conversation_id) this.applyState(result);
    if (result.id && result.status) {
      this.upsertConversation(result);
      if (this.data.activeConversationId.value === result.id) this.data.activeConversation.value = result;
    }
    if (action === 'flush' && result.flushed) {
      this.data.messages.value = (this.data.messages.value || []).filter((message) => message.kind === 'character_description');
    }
    if ((action === 'audio' || action === 'tts') && result.id) {
      this.attachMessageAttachment({ message_id: result.message_id, attachment: result });
    }
  },
  applyCommandResult(response) {
    if (!response || !response.result) return;
    const result = response.result;
    if (response.command === 'bye' && result.id) this.upsertConversation(result);
    if (response.command === 'flush' && result.flushed) {
      this.data.messages.value = (this.data.messages.value || []).filter((message) => message.kind === 'character_description');
    }
    if (response.command === 'impersonate' && result.id) this.upsertMessage(result);
    if (response.command === 'achar' && result.id) this.upsertAgent(result);
    if (response.command === 'iam' && result.id) this.upsertProfile(result);
    if (response.command === 'rchar' && result.deleted) return;
    if (result.conversation_id) this.applyState(result);
  },
  async archiveConversation(id) {
    if (!id) return;
    await this.safeLoad(async () => {
      const conversation = await api.runAction(id, 'bye', {});
      this.upsertConversation(conversation);
      if (this.data.activeConversationId.value === id) this.data.activeConversation.value = conversation;
    });
  },
  async duplicateConversation(id) {
    if (!id) return;
    await this.safeLoad(async () => {
      const result = await api.duplicateConversation(id);
      const conversation = itemFrom(result, 'conversation');
      if (conversation) {
        this.upsertConversation(conversation);
        await this.selectConversation(conversation);
      }
    });
  },
  async deleteConversation(id) {
    if (!id) return;
    await this.safeLoad(async () => {
      await api.deleteConversation(id);
      this.removeConversation(id);
      if (this.data.activeConversationId.value === id) {
        this.closeActiveConversation();
        router.navigate('/');
      }
    });
  },
  sendMessage(payload) {
    const id = this.data.activeConversationId.value;
    if (!id) return;
    clientLog('send_message', { id });
    api.addMessage(id, payload);
  },
  async runCommand(payload) {
    const id = this.data.activeConversationId.value;
    if (!id) return;
    await this.safeLoad(async () => {
      const result = await api.runCommand({ conversationId: id, ...payload });
      this.applyCommandResult(result);
    });
  },
  async runAction({ action, payload }) {
    const id = this.data.activeConversationId.value;
    if (!id) return;
    await this.safeLoad(async () => {
      clientLog('action', { id, action });
      const result = await api.runAction(id, action, payload || {});
      this.applyActionResult(action, result);
    });
  },
  async setAudioAutoPlay(enabled) {
    this.data.audioAutoPlay.value = enabled;
    audioManager.setAutoAdvance(enabled);
    await this.runAction({ action: 'audioAutoPlay', payload: { enabled } });
  },
  async onDeleteMessage(message) {
    const conversationId = this.data.activeConversationId.value;
    if (!conversationId) return;
    await api.deleteMessage(conversationId, message.id);
    await this.reloadActiveConversation();
  },
  async onDeleteMessagesFrom(message) {
    const conversationId = this.data.activeConversationId.value;
    if (!conversationId) return;
    await api.deleteMessagesFrom(conversationId, message.id);
    await this.reloadActiveConversation();
  },
  async onRegenerateMessage(message) {
    const conversationId = this.data.activeConversationId.value;
    if (!conversationId) return;
    await api.regenerateMessage(conversationId, message.id);
    // Eventi push (message_deleted, message_start, token, message_done)
    // mantengono lo stato aggiornato — reload esplicito non serve.
  },
  async checkPendingDiceRoll() {
    this._clearDiceDismissTimer();
    this.data.showDiceOverlay.value = false;
    this.data.diceToolCallId.value = '';
    this.data.diceConversationId.value = '';
    this.data.diceRollSubmitted.value = false;
    this.data.diceType.value = 'd20';
    this.data.diceChallengeValue.value = null;
    this.data.diceSign.value = '>=';
    this.data.diceLabel.value = '';
    this.data.diceSpeakerName.value = '';
    this.data.dicePublicReason.value = '';
    const conversationId = this.data.activeConversationId.value;
    if (!conversationId) return;
    try {
      const pending = await api.remote.getPendingDiceRoll(conversationId);
      if (conversationId !== this.data.activeConversationId.value) return;
      if (pending && pending.toolCallId) {
        clientLog('restore_dice_roll', pending);
        this._clearDiceDismissTimer();
        this.data.diceType.value = pending.type || 'd20';
        this.data.diceChallengeValue.value = pending.challengeValue;
        this.data.diceSign.value = pending.sign || '>=';
        this.data.diceToolCallId.value = pending.toolCallId;
        this.data.diceConversationId.value = conversationId;
        this.data.diceLabel.value = pending.speakerName ? `${pending.speakerName} requested a roll — click the dice!` : '';
        this.data.diceSpeakerName.value = pending.speakerName || '';
        this.data.dicePublicReason.value = pending.publicReason || pending.public_reason || '';
      }
    } catch (error) {
      clientLog('get_pending_dice_roll_error', { message: error.message || String(error) });
    }
  },
  _clearDiceDismissTimer() {
    if (!this._dismissTimer) return;
    clearTimeout(this._dismissTimer);
    this._dismissTimer = null;
  },
  dismissDiceRoll($event, force) {
    // If called from background overlay click, only dismiss if clicking the backdrop.
    if (!force && $event && $event.currentTarget && $event.target !== $event.currentTarget) return;
    this.data.showDiceOverlay.value = false;
  },
  openDiceRoll() {
    if (!this.data.diceToolCallId.value) return;
    if (this.data.diceConversationId.value !== this.data.activeConversationId.value) return;
    this._clearDiceDismissTimer();
    this.data.showDiceOverlay.value = true;
  },
  onDiceRollComplete(result) {
    clientLog('dice_roll_complete', result);
    const conversationId = this.data.diceConversationId.value;
    const toolCallId = this.data.diceToolCallId.value;
    if (toolCallId && conversationId && result && result.value != null) {
      this.data.diceRollSubmitted.value = true;
      api.remote.resolveDiceRoll(conversationId, toolCallId, result.value);
    }
  },
  async onEditMessage(payload) {
    const conversationId = this.data.activeConversationId.value;
    if (!conversationId) return;
    const result = await api.updateMessage(conversationId, payload.id, payload.content);
    if (result) {
      this.upsertMessage(result);
    }
  },
  /** Clear old audio chunks for a message (e.g. before regeneration). */
  _clearMessageAudio(messageId) {
    audioManager.clearMessageAudio(messageId);
    // Remove audio attachments from the message state
    this.data.messages.value = (this.data.messages.value || []).map((m) => {
      if (m.id !== messageId) return m;
      return {
        ...m,
        attachments: (m.attachments || []).filter(
          (a) => a.type !== 'audio' && !String(a.mime_type || '').startsWith('audio/')
        )
      };
    });
  },
  setAudioGenerating(messageId, generating) {
    const current = this.data.generatingAudioIds.value;
    if (Boolean(current[messageId]) === generating) return;
    const next = { ...current };
    if (generating) next[messageId] = true;
    else delete next[messageId];
    this.data.generatingAudioIds.value = next;
  },
  async requestAudio(message) {
    if (this.data.generatingAudioIds.value[message.id]) return;
    this.setAudioGenerating(message.id, true);
    // Clear old audio chunks before generating new ones
    this._clearMessageAudio(message.id);
    await this.runAction({ action: 'clearAudio', payload: { messageId: message.id } });
    const settings = this.data.settings.value || {};
    const tts = settings.tts || {};
    const kokoro = settings.kokoro || {};
    try {
      if (tts.engine === 'kokoro' && kokoro.mode === 'browser') {
        await this.synthesizeKokoroBrowser(message);
        return;
      }
      await this.runAction({ action: 'audio', payload: { messageId: message.id } });
    } finally {
      this.setAudioGenerating(message.id, false);
    }
  },
  async synthesizeKokoroBrowser(message) {
    const conversationId = this.data.activeConversationId.value;
    if (!conversationId || !message?.content) return;
    const settings = this.data.settings.value || {};
    const kokoro = settings.kokoro || {};
    const agent = (this.data.agents.value || []).find((a) => a.id === message.speaker_id);
    const voice = agent?.kokoro_voice || kokoro.defaultVoice;
    try {
      // Browser path: always use the local q4 model (model_q4.onnx).
      const dtype = 'q4';
      console.log('[synthesizeKokoroBrowser] starting synthesis', { contentLen: message.content?.length, voice, dtype });
      const blobs = await synthesizeMessage(message.content, voice, dtype);
      console.log('[synthesizeKokoroBrowser] synthesis complete', { blobs: blobs.length, sizes: blobs.map(b => b.size) });
      // generationTurnId = simple auto-increment per message (max existing + 1)
      const msgs = this.data.messages.value || [];
      const audioMsg = msgs.find(m => m.id === message.id);
      const audioAtts = (audioMsg?.attachments || []).filter(
        a => a.type === 'audio' || String(a.mime_type || '').startsWith('audio/')
      );
      const maxGen = audioAtts.reduce((max, a) => {
        const gid = a.metadata?.generationTurnId;
        return gid != null && gid > max ? gid : max;
      }, -1);
      const generationTurnId = maxGen >= 0 ? maxGen + 1 : 0;
      for (let i = 0; i < blobs.length; i++) {
        // Play immediately via ObjectURL — no need to wait for the server.
        const url = URL.createObjectURL(blobs[i]);
        audioManager.addChunk(message.id, {
          public_url: url,
          metadata: { sequence: i, total: blobs.length }
        }, blobs.length);
        // Send to server for persistence — fire-and-forget, no await.
        blobToBase64(blobs[i]).then((audioBase64) => {
          api.runAction(conversationId, 'kokoroAudio', {
            messageId: message.id, voice, mimeType: 'audio/wav', audioBase64,
            sequence: i, total: blobs.length, generationTurnId
          }).catch(() => {});
        });
      }
    } catch (error) {
      clientLog('kokoro_browser_error', { messageId: message.id, message: error.message || String(error) });
      this.data.error.value = error.message || String(error);
    }
  },
  async createAgent(payload) {
    const id = this.data.activeConversationId.value;
    if (!id) return;
    await this.safeLoad(async () => { this.upsertAgent(await api.createAgent(id, payload)); });
  },
  async updateAgent({ id: agentId, payload }) {
    const id = this.data.activeConversationId.value;
    if (!id || !agentId) return;
    await this.safeLoad(async () => { this.upsertAgent(await api.patchAgent(id, agentId, payload)); });
  },
  async deleteAgent(agent) {
    const id = this.data.activeConversationId.value;
    if (!id || !agent || !agent.id) return;
    await this.safeLoad(async () => {
      await api.deleteAgent(id, agent.id);
      this.removeAgent(agent.id);
    });
  },
  async createProfile(payload) {
    const id = this.data.activeConversationId.value;
    if (!id) return;
    await this.safeLoad(async () => { this.upsertProfile(await api.createProfile(id, payload)); });
  },
  async updateProfile({ id: profileId, payload }) {
    const id = this.data.activeConversationId.value;
    if (!id || !profileId) return;
    await this.safeLoad(async () => { this.upsertProfile(await api.patchProfile(id, profileId, payload)); });
  },
  async deleteProfile(profile) {
    const id = this.data.activeConversationId.value;
    if (!id || !profile || !profile.id) return;
    await this.safeLoad(async () => {
      await api.deleteProfile(id, profile.id);
      this.removeProfile(profile.id);
    });
  },
  async activateProfile(profile) {
    await this.runAction({ action: 'iam', payload: { profileId: profile.id } });
  },
  async saveSettings(payload) {
    await this.safeLoad(async () => {
      await api.patchSettings(payload);
      // this.data.settings.value = { ...this.data.settings.value, ...payload };
      // Sync TTS engine global if the payload changed it
      if (payload.tts?.engine && globals.$ttsEngine) {
        globals.$ttsEngine.value = payload.tts.engine;
      }
    });
  },
  async probeDrawThings(payload = {}) {
    await this.safeLoad(async () => {
      clientLog('draw_things_probe');
      const response = await api.probeDrawThings(payload);
      this.data.drawStatus.value = itemFrom(response, 'status') || response;
      if (response && response.settings) this.data.settings.value = { ...this.data.settings.value, drawThings: response.settings };
      this.data.drawModels.value = this.drawModelsFrom(this.data.drawStatus.value, this.data.settings.value);
      await this.refreshDrawModels();
    });
  },
  async refreshDrawModels() {
    try {
      const response = await api.getDrawThingsModels();
      const models = listFrom(response, 'models');
      if (models.length) this.data.drawModels.value = models;
    } catch (error) {
      clientLog('draw_things_models_error', { message: error.message || String(error) });
    }
  },
  async loadVoices() {
    await this.safeLoad(async () => {
      const response = await api.getVoices();
      this.data.voices.value = listFrom(response, 'voices');
    });
  },
  async loadKokoroVoices() {
    await this.safeLoad(async () => {
      const response = await api.getKokoroVoices();
      this.data.kokoroVoices.value = listFrom(response, 'voices');
    });
  },
  async loadModels() {
    await this.safeLoad(async () => {
      const response = await api.getOllamaModels();
      this.data.models.value = listFrom(response, 'models');
    });
  },
  openStream() {
    this.closeStream();
    const id = this.data.activeConversationId.value;
    if (!id) return;
    this.stream = openConversationStream(id, this.data.lastEventId.value, {
      onOpen: () => { clientLog('stream_open', { id }); this.data.error.value = ''; },
      onEvent: (type, event) => {
        try { this.handleStreamEvent(type, event); }
        catch (error) {
          clientLog('stream_handler_error', { type, message: error.message || String(error), event });
        }
      },
      onError: () => {
        clientLog('stream_error', { id });
        this.data.error.value = 'Stream disconnected.';
      }
    });
  },
  closeStream() {
    if (this.stream) {
      this.stream.close();
      this.stream = null;
    }
  },

  messageFromEvent(event, overrides = {}) {
    return {
      id: event.message_id,
      role: event.role || 'assistant',
      speaker_type: event.speaker_type || (event.role === 'user' ? 'profile' : 'agent'),
      speaker_id: event.speaker_id || null,
      speaker_name_snapshot: event.speaker_name_snapshot || (event.role === 'user' ? 'User' : 'Assistant'),
      content: event.content || '',
      rendered_content: event.rendered_content || event.content || '',
      attachments: Array.isArray(event.attachments) ? event.attachments : [],
      created_at: event.created_at || new Date().toISOString(),
      pending: true,
      ...overrides
    };
  },
  normalizeAttachment(attachment) {
    if (!attachment) return attachment;
    let metadata = attachment.metadata || {};
    if (!attachment.metadata && attachment.metadata_json) {
      try { metadata = JSON.parse(attachment.metadata_json); } catch { metadata = {}; }
    }
    return { ...attachment, metadata };
  },
  upsertMessage(message) {
    if (!message?.id) return;
    const incoming = { attachments: [], ...message };
    const current = this.data.messages.value || [];
    const exists = current.some((item) => item.id === incoming.id);
    if (!exists) {
      this.data.messages.value = [...current, incoming];
      return;
    }
    this.data.messages.value = current.map((item) => {
      if (item.id !== incoming.id) return item;
      return {
        ...item,
        ...incoming,
        attachments: Array.isArray(incoming.attachments) && incoming.attachments.length ? incoming.attachments : (item.attachments || [])
      };
    });
  },
  updateMessageContent(event) {
    const messageId = event.message_id;
    if (!messageId) return;
    if (!this.data.messages.value.some((item) => item.id === messageId)) {
      this.upsertMessage(this.messageFromEvent(event));
    }
    this.data.messages.value = (this.data.messages.value || []).map((item) => {
      if (item.id !== messageId) return item;
      const content = event.content != null ? event.content : `${item.content || ''}${event.token || ''}`;
      return { ...item, content, rendered_content: content, pending: true };
    });
  },
  finishMessage(event) {
    if (event.message?.id) {
      this.upsertMessage({ 
        ...event.message, 
        content: event.content != null ? event.content : event.message.content,
        rendered_content: event.content != null ? event.content : (event.message.rendered_content || event.message.content),
        pending: false 
      });
      return;
    }
    const messageId = event.message_id;
    if (!messageId) return;
    this.data.messages.value = (this.data.messages.value || []).map((item) => {
      if (item.id !== messageId) return item;
      return {
        ...item,
        content: event.content != null ? event.content : item.content,
        rendered_content: event.rendered_content != null ? event.rendered_content : (event.content != null ? event.content : item.rendered_content),
        pending: false
      };
    });
  },
  maybeSynthesizeKokoroBrowser(event) {
    const message = event.message;
    if (!message || message.role !== 'assistant') return;
    const settings = this.data.settings.value || {};
    const tts = settings.tts || {};
    const kokoro = settings.kokoro || {};
    if (!tts.enabled || tts.engine !== 'kokoro' || kokoro.mode !== 'browser') return;
    this.synthesizeKokoroBrowser(message).catch((error) => {
      clientLog('kokoro_browser_error', { messageId: message.id, message: error.message || String(error) });
    });
  },
  attachMessageAttachment(event) {
    const messageId = event.message_id || event.attachment?.message_id;
    const attachment = this.normalizeAttachment(event.attachment);
    if (!messageId || !attachment) return;
    const isAudio = attachment.type === 'audio' || String(attachment.mime_type || '').startsWith('audio/');
    if (isAudio) {
      // Replace the message so message-list receives the new attachment.
      const msgs = this.data.messages.value;
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx === -1) {
        this.upsertMessage(this.messageFromEvent({ ...event, message_id: messageId }));
        return;
      }
      const existing = msgs[idx].attachments || [];
      if (!existing.some((a) => a.id === attachment.id)) {
        this.data.messages.value = msgs.map((message, index) => {
          if (index !== idx) return message;
          return { ...message, attachments: [...existing, attachment] };
        });
      }
    }
  },
  _addExtraAttachment(messageId, attachment) {
    const current = this.data.extraAttachments.value;
    const existing = current[messageId] || [];
    const isImage = attachment.type === 'image' || String(attachment.mime_type || '').startsWith('image/');
    if (!isImage) return; // audio goes via attachMessageAttachment (needs sequencing)
    // Skip if already present (idempotent)
    if (existing.some((a) => a.id === attachment.id)) return;
    this.data.extraAttachments.value = { ...current, [messageId]: [...existing, attachment] };
    // Fetch blob URL so images don't need server round-trips on DOM re-render
    if (attachment.public_url) {
      fetch(attachment.public_url).then((r) => {
        if (!r.ok) return;
        r.blob().then((blob) => {
          const url = URL.createObjectURL(blob);
          attachment._blobUrl = url;
          // Trigger reactivity by updating extraAttachments with blob
          const cur = this.data.extraAttachments.value;
          const list = (cur[messageId] || []).map((a) => a.id === attachment.id ? { ...a, _blobUrl: url } : a);
          this.data.extraAttachments.value = { ...cur, [messageId]: list };
        }).catch(() => {});
      }).catch(() => {});
    }
  },

  handleStreamEvent(type, event) {
    if (event.event_id) this.data.lastEventId.value = event.event_id;
    if (type === 'message_start') {
      const msg = event.message || this.messageFromEvent(event);
      if (!this.data.messages.value.some((m) => m.id === msg.id)) {
        this.data.messages.value.push(msg);
      }
      this.data.messagePatches.value = { ...this.data.messagePatches.value, [msg.id]: { content: msg.content || '', rendered_content: msg.rendered_content || msg.content || '', pending: true } };
      this.data.streamingMessage.value = null;
      return;
    }
    if (type === 'token') {
      const mid = event.message_id;
      if (mid) {
        const cur = this.data.messagePatches.value[mid] || {};
        const appended = (cur.content || '') + (event.token || event.content || '');
        this.data.messagePatches.value = { ...this.data.messagePatches.value, [mid]: { ...cur, content: appended, rendered_content: appended } };
      }
      return;
    }
    if (type === 'message_done') {
      const mid = event.message_id;
      if (mid) {
        const content = event.content != null ? event.content : (this.data.messagePatches.value[mid]?.content || '');
        this.data.messagePatches.value = { ...this.data.messagePatches.value, [mid]: { content, rendered_content: content, pending: false } };
      }
      this.maybeSynthesizeKokoroBrowser(event);
      return;
    }
    if (type === 'message_deleted') {
      const mid = event.message_id;
      if (mid) {
        const msgs = this.data.messages.value;
        const idx = msgs.findIndex((m) => m.id === mid);
        if (idx !== -1) msgs.splice(idx, 1);
        const patches = { ...this.data.messagePatches.value };
        delete patches[mid];
        this.data.messagePatches.value = patches;
      }
      return;
    }
    if (type === 'tool_call' || type === 'tool_result') {
      const id = event.tool_call_id ? `${type}:${event.tool_call_id}` : `${type}:${event.event_id || Date.now()}`;
      const next = { id, type, ...event };
      const current = this.data.toolEvents.value || [];
      this.data.toolEvents.value = current.some((item) => item.id === id)
        ? current.map((item) => item.id === id ? next : item)
        : [...current, next];
      return;
    }
    if (type === 'image_pending') {
      const msgId = event.message_id || '';
      if (msgId) this.data.imagePending.value = { ...this.data.imagePending.value, [msgId]: event.prompt || '' };
      return;
    }
    if (type === 'image_ready') {
      const msgId = event.message_id || event.attachment?.message_id || '';
      if (msgId && event.attachment) this._addExtraAttachment(msgId, event.attachment);
      this.data.lastImageMessageId.value = msgId;
      this.clearImagePending(msgId);
      return;
    }
    if (type === 'audio_pending') {
      this.setAudioGenerating(event.message_id, true);
      return;
    }
    if (type === 'audio_complete' || type === 'audio_failed') {
      this.setAudioGenerating(event.message_id, false);
      return;
    }
    if (type === 'audio_ready') {
      this.attachMessageAttachment(event);
      const msgId = event.message_id || event.attachment?.message_id || '';
      // Buffer the chunk. Playback is cursor-driven: a chunk arriving never
      // starts audio — it only plays if it's the current/next message's turn.
      audioManager.addChunk(msgId, event.attachment, event.total);
      return;
    }
    if (type === 'dice_challenge') {
      // Server asks user to roll the dice (interactive mode).
      clientLog('dice_challenge', event);
      this._clearDiceDismissTimer();
      this.data.showDiceOverlay.value = false;
      this.data.diceType.value = event.type || 'd20';
      this.data.diceChallengeValue.value = event.challengeValue;
      this.data.diceSign.value = event.sign || '>=';
      this.data.diceToolCallId.value = event.toolCallId;
      this.data.diceConversationId.value = this.data.activeConversationId.value;
      this.data.diceRollSubmitted.value = false;
      this.data.diceLabel.value = event.label || '';
      this.data.diceSpeakerName.value = event.speakerName || '';
      this.data.dicePublicReason.value = event.publicReason || event.public_reason || '';
      clientLog('dice_challenge_reason', { publicReason: this.data.dicePublicReason.value });
      return;
    }
    if (type === 'dice_cancelled') {
      if (event.toolCallId !== this.data.diceToolCallId.value) return;
      this._clearDiceDismissTimer();
      this.data.showDiceOverlay.value = false;
      this.data.diceToolCallId.value = '';
      this.data.diceConversationId.value = '';
      this.data.diceRollSubmitted.value = false;
      this.data.diceLabel.value = '';
      this.data.diceSpeakerName.value = '';
      this.data.dicePublicReason.value = '';
      return;
    }
    if (type === 'dice_roll') {
      clientLog('dice_roll', event);
      if (event.toolCallId !== this.data.diceToolCallId.value) return;
      this.data.diceToolCallId.value = '';
      this.data.diceConversationId.value = '';
      this.data.diceRollSubmitted.value = false;
      this._clearDiceDismissTimer();
      this._dismissTimer = setTimeout(() => {
        this.data.showDiceOverlay.value = false;
        this._dismissTimer = null;
      }, 3000);
      return;
    }
    if (type === 'state_changed') {
      if (event.state) this.applyState(event.state);
      if (event.conversation) {
        this.upsertConversation(event.conversation);
        this.data.activeConversation.value = event.conversation;
      }
      if (Array.isArray(event.agents)) this.data.agents.value = event.agents;
      else if (event.agent) this.upsertAgent(event.agent);
      else if (event.agentId) this.removeAgent(event.agentId);
      if (Array.isArray(event.profiles)) this.data.profiles.value = event.profiles;
      else if (event.profile) this.upsertProfile(event.profile);
      else if (event.profileId) this.removeProfile(event.profileId);
      if (Array.isArray(event.storyEntries)) {
        document.dispatchEvent(new CustomEvent('state_changed', { detail: { storyEntries: event.storyEntries } }));
      }
      return;
    }
    if (type === 'error') {
      this.data.error.value = event.message || event.error || 'Stream error';
      if (event.message_id) this.clearImagePending(event.message_id);
    }
  },
  clearImagePending(messageId) {
    if (!messageId || !this.data.imagePending.value[messageId]) return;
    const next = { ...this.data.imagePending.value };
    delete next[messageId];
    this.data.imagePending.value = next;
  }
};
