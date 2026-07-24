import { watchProp } from 'tinybubble';
import DiceRoller from './DiceRoller.bub.js';
import AudioPlayer from './AudioPlayer.bub.js';

export default {
  name: 'MessageItem',
  props: ['message', 'patches', 'extraAttachments', 'messages', 'imagePending', 'autoMode', 'playingAudioMessageId', 'lastImageMessageId', 'generatingAudioIds'],
  emits: ['delete-message', 'delete-messages-from', 'regenerate-message', 'start-edit', 'request-audio', 'open-lightbox', 'stop'],
  components: {
    'dice-roller': DiceRoller,
    'audio-player': AudioPlayer,
  },
  template() {
    return /*html*/`
      <div class="msg-group" :class="message.role || 'assistant'">
        <!-- Meta row: avatar + name + time -->
        <div class="msg-meta-row">
          <template x-if="message.role === 'user'">
            <div class="msg-meta-right">
              <div class="msg-info">
                <span class="msg-name">{{ speakerName() }}</span>
                <span class="msg-time">{{ formatTime(message.created_at) }}</span>
              </div>
              <div class="msg-avatar user-avatar">{{ avatarLetter() }}</div>
            </div>
          </template>
          <template x-if="message.role !== 'user'">
            <div class="msg-meta-left">
              <div class="msg-avatar assistant-avatar">{{ avatarLetter() }}</div>
              <div class="msg-info">
                <span class="msg-name assistant-name">{{ speakerName() }}</span>
                <span class="msg-time">{{ formatTime(message.created_at) }}</span>
              </div>
            </div>
          </template>
        </div>
        <!-- Bubble with inline menu -->
        <div class="msg-bubble" :class="message.role || 'assistant'">
          <!-- 3-dot menu inside bubble, top-right -->
          <div class="msg-actions-wrap" :class="{ 'menu-open': openMenuId === message.id }">
            <button type="button" class="msg-menu-btn" @click="toggleMenu($event)" title="Actions">
              <span class="material-symbols-outlined">more_horiz</span>
            </button>
            <div x-if="openMenuId === message.id" class="msg-menu">
              <button type="button" @click="startEdit">Edit</button>
              <button type="button" @click="onDelete">Delete</button>
              <button type="button" @click="onDeleteFrom">Delete this and newer messages <span class="material-symbols-outlined" style="font-size:14px">arrow_downward</span></button>
              <button x-if="message.role === 'assistant'" type="button" @click="onRegenerate">Regenerate</button>
            </div>
          </div>
          <!-- Dice roll message: show animated dice -->
          <template x-if="message.kind === 'dice_roll'">
            <dice-roller :type="diceData().type" :value="diceData().value" :challenge-value="diceData().challengeValue" :sign="diceData().sign" :success="diceData().success"></dice-roller>
          </template>
          <template x-if="message.kind !== 'dice_roll'">
          <div class="msg-content">{{ liveContent() }}</div>
          </template>
          <!-- Images -->
          <div x-if="allImages().length || pendingPrompt()" class="msg-attachments">
            <figure x-for="attachment in allImages()" class="msg-image-figure">
              <img :src="attachment._blobUrl || attachment.public_url" :alt="attachment.metadata?.prompt || attachment.filename || 'generated image'" class="msg-image" loading="eager" @click="emit('open-lightbox', { attachment, message })" />
              <figcaption class="msg-image-caption">{{ trimPrompt(attachment.metadata?.prompt, 100) }}</figcaption>
            </figure>
            <figure x-if="pendingPrompt()" class="msg-image-figure msg-image-placeholder">
              <div class="msg-image-placeholder-box">
                <span class="msg-image-spinner"></span>
                <span class="msg-image-placeholder-label">Generating image…</span>
              </div>
              <figcaption class="msg-image-caption">{{ pendingPrompt() }}</figcaption>
            </figure>
          </div>
          <!-- AudioPlayer + regenerate button -->
          <div x-if="message.role !== 'user'" class="msg-audio-row">
            <audio-player :message-id="message.id" :messages="messages" :has-audio="hasAudio()" :is-generating="isGeneratingAudio()" @play-click="onRequestAudio"></audio-player>
            <button x-if="hasAudio()" type="button" class="msg-audio-btn" @click="onRequestAudio">
              <span class="material-symbols-outlined">autorenew</span>
              <span>Regenerate</span>
            </button>
          </div>
        </div>
      </div>
    `;
  },
  data() {
    return { openMenuId: null };
  },
  init() {
    this._onDocClick = (e) => {
      if (!e.target.closest('.msg-menu') && !e.target.closest('.msg-menu-btn')) this.closeMenu();
    };
    document.addEventListener('click', this._onDocClick);
    // Close menu when message changes
    watchProp(this, 'message', () => { this.closeMenu(); });
  },
  beforeDestroy() {
    document.removeEventListener('click', this._onDocClick);
  },
  closeMenu() {
    this.data.openMenuId.value = null;
  },
  toggleMenu($event) {
    $event.stopPropagation();
    this.data.openMenuId.value = this.data.openMenuId.value === this.props.message.id ? null : this.props.message.id;
  },
  speakerName() {
    const m = this.props.message;
    return m.speaker_name_snapshot || m.speakerName || m.role || 'Unknown';
  },
  avatarLetter() {
    const name = this.speakerName();
    return name ? name.charAt(0).toUpperCase() : '?';
  },
  formatTime(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return value; }
  },
  liveContent() {
    const m = this.props.message;
    const patches = this.props.patches || {};
    const p = patches[m.id];
    return p?.rendered_content || p?.content || m.rendered_content || m.content || '';
  },
  allImages() {
    const m = this.props.message;
    const fromMsg = (m.attachments || []).filter((a) => a.type === 'image' || String(a.mime_type || '').startsWith('image/'));
    const extras = (this.props.extraAttachments || {})[m.id] || [];
    const existingIds = new Set(fromMsg.map((a) => a.id));
    const merged = [...fromMsg];
    for (const a of extras) {
      if (!existingIds.has(a.id)) merged.push(a);
    }
    return merged;
  },
  pendingPrompt() {
    return (this.props.imagePending || {})[this.props.message.id] || '';
  },
  diceData() {
    const m = this.props.message;
    if (m.kind !== 'dice_roll') return { type: 'd20', value: 1, challengeValue: 10, sign: '>=', success: false };
    try { return JSON.parse(m.content); }
    catch { return { type: 'd20', value: 1, challengeValue: 10, sign: '>=', success: false }; }
  },
  hasAudio() {
    return this.audioAttachments().length > 0;
  },
  isGeneratingAudio() {
    return Boolean((this.props.generatingAudioIds || {})[this.props.message.id]);
  },
  audioAttachments() {
    const m = this.props.message;
    return (m.attachments || []).filter((a) => a.type === 'audio' || String(a.mime_type || '').startsWith('audio/'));
  },
  trimPrompt(text, max) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '…' : text;
  },
  onRequestAudio() {
    this.emit('request-audio', this.props.message);
  },
  startEdit() {
    this.emit('start-edit', this.props.message);
    this.closeMenu();
  },
  onDelete() {
    this.emit('delete-message', this.props.message);
    this.closeMenu();
  },
  onDeleteFrom() {
    this.emit('delete-messages-from', this.props.message);
    this.closeMenu();
  },
  onRegenerate() {
    this.emit('regenerate-message', this.props.message);
    this.closeMenu();
  },
};
