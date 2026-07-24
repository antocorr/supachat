import { watchProp } from 'tinybubble';
import audioManager from '../lib/AudioManager.js';

/**
 * AudioPlayer — play/pause/progress UI for one message's audio.
 *
 * Playback delegates to AudioManager, which owns the only <audio>
 * element in the page. It preloads chunk metadata to calculate complete
 * message durations before playback starts.
 *
 * Props
 * -----
 *   messageId    — the message this player belongs to
 *   messages     — full message list (for queue building)
 *   hasAudio     — whether the message already has audio attachments
 *   isGenerating — whether TTS generation is in flight
 *
 * Emits
 * -----
 *   play-click   — when user taps play and no audio exists yet
 */
export default {
  name: 'AudioPlayer',
  props: ['messageId', 'messages', 'hasAudio', 'isGenerating'],
  emits: ['play-click'],
  template() {
    return /*html*/`
      <div class="audio-player-custom" :class="rootClass()">
        <button type="button" class="ap-play-btn" :class="btnClass()" :disabled="isGenerating && !hasAudio" :aria-label="isGenerating && !hasAudio ? 'Generating audio' : 'Play audio'" @click="onPlayClick">
          <span class="material-symbols-outlined">{{ playIcon() }}</span>
        </button>

        <!-- Progress bar (always visible, live only for current message) -->
        <div class="ap-track" ref="track" @click="onSeek">
          <div class="ap-track-fill" :style="'width:' + progressPct() + '%'"></div>
          <div class="ap-track-knob" :style="'left:' + progressPct() + '%'"></div>
        </div>
        <span class="ap-time">{{ timeDisplay() }}</span>

        <!-- Queue / waiting badges -->
        <span x-if="isGenerating" class="ap-generation-status">{{ hasAudio ? 'Generating remaining audio…' : 'Generating audio…' }}</span>
        <span x-if="!isGenerating && isQueued() && !isCurrent()" class="ap-queued-badge">next</span>
        <span x-if="!isGenerating && isCurrent() && amWaiting()" class="ap-waiting-badge">waiting…</span>
      </div>
    `;
  },
  data() {
    return {
      /** @type {object|null} Current AudioManager state for 'mainVoice' */
      amState: null,
    };
  },
  init() {
    this._onChange = (st) => { this.data.amState.value = st; };
    audioManager.onChange('mainVoice', this._onChange);

    // Sync messages for queue building
    if (Array.isArray(this.props.messages)) {
      audioManager.setMessages(this.props.messages);
    }
    watchProp(this, 'messages', (msgs) => {
      if (Array.isArray(msgs)) audioManager.setMessages(msgs);
    });
  },
  beforeDestroy() {
    audioManager.offChange('mainVoice', this._onChange);
    this._onChange = null;
  },

  /* ------------------------------------------------------------------ */
  /*  Derived state                                                      */
  /* ------------------------------------------------------------------ */
  _st() { return this.data.amState ? this.data.amState.value : null; },

  /**
   * Duration is available only after metadata for every chunk has loaded.
   */
  _duration() {
    return audioManager.getMessageDuration(this.props.messageId);
  },
  /**
   * Cumulative elapsed time across all chunks.
   */
  _currentTime() {
    if (this.isCurrent()) {
      const st = this._st();
      if (!st) return 0;
      return st.totalElapsed ?? st.currentTime ?? 0;
    }
    return 0;
  },

  isCurrent() {
    const st = this._st();
    return st ? st.currentMessageId === this.props.messageId : false;
  },
  isPlaying() { return this.isCurrent() && this._st()?.playing; },
  isQueued() {
    const st = this._st();
    if (!st || !st.queue) return false;
    return st.queue.some(q => q.messageId === this.props.messageId);
  },
  amWaiting() { return this.isCurrent() && this._st()?.waitingForChunks; },

  playIcon() {
    if (this.props.isGenerating && !this.props.hasAudio) return 'hourglass_top';
    return this.isPlaying() ? 'pause' : 'play_arrow';
  },
  btnClass() {
    if (this.props.isGenerating && !this.props.hasAudio) return 'generating';
    return this.isPlaying() ? 'playing' : '';
  },
  rootClass() {
    if (this.props.isGenerating) return 'generating';
    if (this.isQueued() && !this.isCurrent()) return 'ap-queued';
    return '';
  },

  progressPct() {
    const duration = this._duration();
    if (duration) return Math.min(100, (this._currentTime() / duration) * 100);
    const state = this._st();
    if (!this.isCurrent() || !state || !state.duration) return 0;
    return Math.min(100, (state.currentTime / state.duration) * 100);
  },
  timeDisplay() {
    const duration = this._duration();
    if (!duration && this.isCurrent()) return `${this._fmt(this._currentTime())} / …`;
    return `${this._fmt(this._currentTime())} / ${this._fmt(duration)}`;
  },
  _fmt(s) {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  },

  /* ------------------------------------------------------------------ */
  /*  Actions                                                            */
  /* ------------------------------------------------------------------ */
  onPlayClick() {
    audioManager.play(this.props.messageId, this.props.messages || []);

    if (!this.props.hasAudio && !this.props.isGenerating) {
      this.emit('play-click');
    }
  },

  onSeek(e) {
    if (!this.isCurrent()) return;
    const st = this._st();
    if (!st || !st.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    audioManager.seek(pct * st.duration);
  },
};
