/**
 * MessageAudioManager — singleton audio playback controller.
 *
 * Owns one <audio> per layer.  Every play/pause command goes through
 * this class so that audio-chunk streaming, queue advancement, and
 * waiting-for-chunks logic live in one place.
 *
 * Layers allow different audio streams (e.g. main voice, background
 * music).  The default layer is 'mainVoice'.
 *
 * ════════════════════════════════════════════════════════════════════
 * Usage (from a component):
 *
 *   import audioManager from '../lib/AudioManager.js';
 *
 *   // User tapped play on a message:
 *   audioManager.play(msgId, this.props.messages);
 *
 *   // An audio_ready SSE event arrived (total = chunk count for the message):
 *   audioManager.addChunk(msgId, attachment, total);
 *
 *   // Subscribe to UI updates:
 *   audioManager.onChange('mainVoice', (state) => { render(state); });
 *   audioManager.offChange('mainVoice', handler);
 *
 *   // getState() returns:
 *   //   { playing, currentMessageId, currentTime, duration,
 *   //     waitingForChunks, queue: [{messageId, hasChunks}] }
 * ════════════════════════════════════════════════════════════════════
 */
class MessageAudioManager {
  constructor() {
    /** @type {Record<string, object>} */
    this.layers = {};
    /** @type {Record<string, Set<Function>>} */
    this._listeners = {};
  }

  /* ------------------------------------------------------------------ */
  /*  Internal helpers                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Get or create a layer descriptor.
   * @param {string} name
   * @returns {object}
   */
  _getLayer(name) {
    if (!this.layers[name]) {
      this.layers[name] = this._createLayer(name);
    }
    return this.layers[name];
  }

  /**
   * Create a fresh layer descriptor with an <audio> element (if
   * available) and wired event listeners.
   * @returns {object}
   */
  _createLayer(name) {
    /** @type {HTMLAudioElement|null} */
    const audio = typeof Audio !== 'undefined' ? new Audio() : null;

    const layer = {
      name,
      audio,

      /** @type {boolean} */
      playing: false,
      /** @type {number} */
      currentTime: 0,
      /** @type {number} */
      duration: 0,

      /** @type {string|null} */
      currentMessageId: null,

      /** @type {Array<{id:string,url:string,sequence:number}>} */
      currentChunks: [],
      /** @type {number} */
      currentChunkIndex: 0,
      /** Durations of each chunk, indexed by chunk index. Populated
       *  from loadedmetadata as chunks play. */
      chunkDurations: [],

      /** @type {boolean} */
      waitingForChunks: false,

      /** True while parked at the end of the last spoken message, waiting for
       *  a future message to be generated (auto-advance, dynamic queue).
       *  A new message arriving (setMessages / addChunk) resumes playback.
       *  @type {boolean} */
      awaitingNext: false,

      /** URLs already handed to a preload Audio(), so each chunk is fetched
       *  as soon as its audio_ready event arrives.
       *  @type {Set<string>} */
      _preloadedUrls: new Set(),
      /** Durations read from preloaded chunks, grouped by message and sequence.
       *  @type {Record<string, Record<number, number>>} */
      messageDurations: {},
      /** Keep preload elements alive until playback can reuse the browser cache.
       *  @type {Map<string, HTMLAudioElement>} */
      _preloadElements: new Map(),

      /**
       * Chunks for any message that isn't the current one (buffered until the
       * cursor reaches that message).
       * @type {Record<string,Array>}
       */
      pendingChunks: {},

      /**
       * Set of message IDs that are externally marked as "all chunks
       * delivered".
       * @type {Set<string>}
       */
      readyMessages: new Set(),
      /** @type {Set<string>|undefined} */
      noAudioMessages: new Set(),
      /** Generation counter per message — bumped on clearMessageAudio.
       *  Lets us ignore stale chunks that arrive late. */
      generations: {}, // { [messageId]: number }
      /** Total chunk count per message, taken from the `audio_ready` event's
       *  `total` field (or the attachment count for history). Lets playback
       *  tell "wait for a late chunk" apart from "the message is complete".
       *  @type {Record<string, number>} */
      totals: {},
      /** When true, playback auto-advances to the next eligible message at the
       *  end of the current one (and waits for future messages). Mirrors the
       *  top "autoplay" flag; the app sets it from conversation state. */
      autoAdvance: false,
      /** Cached message list used by play() when no allMessages arg is given. */
      allMessages: [],
    };

    if (audio) {
      audio.preload = 'metadata';
      audio.addEventListener('timeupdate', () => {
        layer.currentTime = audio.currentTime;
        if (audio.duration && isFinite(audio.duration)) {
          layer.duration = audio.duration;
        }
        this._notify(name);
      });
      audio.addEventListener('loadedmetadata', () => {
        if (isFinite(audio.duration)) {
          layer.duration = audio.duration;
          // Record duration for the current chunk index
          if (layer.currentChunkIndex >= 0 && layer.currentChunks.length > 0) {
            layer.chunkDurations[layer.currentChunkIndex] = audio.duration;
          }
        }
        this._notify(name);
      });
      audio.addEventListener('play', () => {
        layer.playing = true;
        this._notify(name);
      });
      audio.addEventListener('pause', () => {
        layer.playing = false;
        this._notify(name);
      });
      audio.addEventListener('ended', () => {
        this._onChunkEnded(name);
      });
      audio.addEventListener('error', () => {
        this._onChunkError(name);
      });
    }

    return layer;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Called when an `audio_ready` SSE event arrives with a new audio
   * chunk.  Routes the chunk to the correct slot:
   *   - currently playing message → appended to currentChunks
   *   - a queued message          → appended to that queue item's chunks
   *   - otherwise                 → stored in pendingChunks
   *
   * If we were waiting for chunks and they just became available for
   * the current or next message, playback starts/resumes.
   *
   * @param {string}  messageId
   * @param {object}  attachment    Attachment object with `public_url`
   *                                and `metadata.sequence`.
   * @param {number|null} [total]   Total chunk count for this message's
   *                                generation, from the `audio_ready` event.
   * @param {string}  [layerName='mainVoice']
   */
  addChunk(messageId, attachment, total = null, layerName = 'mainVoice') {
    const layer = this._getLayer(layerName);
    if (total != null) layer.totals[messageId] = total;
    const gen = layer.generations[messageId] || 0;
    const chunk = {
      id: attachment.id || attachment.public_url,
      url: attachment.public_url,
      sequence: attachment.metadata?.sequence ?? 0,
      _gen: gen, // tag with current generation
    };
    this._preloadUrl(layer, chunk.url, messageId, chunk.sequence);

    // ── Currently playing message ──
    if (layer.currentMessageId === messageId) {
      // Ignore stale chunks from older generations
      if (chunk._gen < (layer.generations[messageId] || 0)) return;
      this._insertChunkSorted(layer.currentChunks, chunk);
      // Arrival never starts the wrong chunk: if we are holding for the next
      // in-sequence chunk, _playChunk picks it only when its sequence matches.
      if (layer.waitingForChunks) this._playChunk(layerName);
      this._notify(layerName);
      return;
    }

    // ── Any other message — buffer until the cursor reaches it ──
    const existingGen = layer.generations[messageId];
    if (existingGen !== undefined && chunk._gen < existingGen) return; // stale
    if (!layer.pendingChunks[messageId]) {
      layer.pendingChunks[messageId] = [];
    }
    this._insertChunkSorted(layer.pendingChunks[messageId], chunk);
    // Parked at the tail and a future message just produced audio — advance.
    if (layer.awaitingNext && layer.autoAdvance) {
      this._advanceCursor(layerName);
    }
    this._notify(layerName);
  }

  /**
   * Start (or resume) playback for a message.  Builds the play queue
   * from all messages that come after the given one in the messages
   * array, so playback continues automatically.
   *
   * If the same message is already playing, toggles pause/resume.
   *
   * @param {string}  messageId
   * @param {Array}   [allMessages=[]]  Ordered message list (used to
   *   determine which messages come next).
   * @param {string}  [layerName='mainVoice']
   */
  play(messageId, allMessages = [], layerName = 'mainVoice') {
    const layer = this._getLayer(layerName);

    // ── Toggle pause if same message ──
    if (layer.currentMessageId === messageId) {
      if (layer.playing) {
        layer.audio.pause();
        return;
      }
      if (!layer.playing && !layer.waitingForChunks) {
        layer.audio.play().catch(() => {});
        return;
      }
    }

    // ── Save pending chunks before stop clears them ──
    const savedPending = { ...layer.pendingChunks };

    // ── Stop anything currently playing ──
    this._stop(layerName, /* keepHistory */ false);

    // ── Restore pending chunks ──
    layer.pendingChunks = savedPending;

    // Keep the cached list fresh so skip/role/next checks see the latest
    // messages. The queue is dynamic: the next message is computed at the end
    // of each one from allMessages, so newly generated messages are picked up.
    const allMsgs = Array.isArray(allMessages) && allMessages.length > 0
      ? allMessages
      : (layer.allMessages || []);
    layer.allMessages = allMsgs;

    this._loadMessage(layer, messageId);
    this._playChunk(layerName);
    this._notify(layerName);
  }

  /**
   * Toggle pause / resume on the current layer.
   * @param {string} [layerName='mainVoice']
   */
  togglePause(layerName = 'mainVoice') {
    const layer = this._getLayer(layerName);
    if (!layer.audio) return;
    if (layer.playing) {
      layer.audio.pause();
    } else {
      layer.audio.play().catch(() => {});
    }
  }

  /**
   * Seek to a specific time (seconds) on the current layer.
   * @param {number} time
   * @param {string} [layerName='mainVoice']
   */
  seek(time, layerName = 'mainVoice') {
    const layer = this._getLayer(layerName);
    if (layer.audio && isFinite(layer.audio.duration)) {
      layer.audio.currentTime = time;
    }
  }

  /**
   * Store the ordered message list for a layer.  Call this when the
   * conversation messages change so that play(messageId) can build
   * the correct queue without passing the full list every time.
   * @param {Array}  messages
   * @param {string} [layerName='mainVoice']
   */
  setMessages(messages, layerName = 'mainVoice') {
    const layer = this._getLayer(layerName);
    layer.allMessages = Array.isArray(messages) ? messages : [];
    for (let i = 0; i < layer.allMessages.length; i++) {
      const message = layer.allMessages[i];
      const chunks = this._extractAudioChunks(layer.allMessages, message.id);
      if (chunks.length === 0) continue;
      layer.totals[message.id] = chunks.length;
      for (let j = 0; j < chunks.length; j++) {
        const chunk = chunks[j];
        this._preloadUrl(layer, chunk.url, message.id, chunk.sequence);
      }
    }
    // Parked at the tail and a new message just appeared — resume into it.
    if (layer.awaitingNext && layer.autoAdvance) {
      this._advanceCursor(layerName);
    }
    this._notify(layerName);
  }

  /**
   * Set whether playback auto-advances to the next message when the current
   * one ends.  Mirrors the top "autoplay" flag.  When off, playback stops at
   * the end of the message the user started.
   * @param {boolean} value
   * @param {string}  [layerName='mainVoice']
   */
  setAutoAdvance(value, layerName = 'mainVoice') {
    this._getLayer(layerName).autoAdvance = Boolean(value);
  }

  /**
   * Stop playback on a layer and clear its queue.
   * @param {string} [layerName='mainVoice']
   */
  stop(layerName = 'mainVoice') {
    this._stop(layerName, /* keepHistory */ false);
  }

  /**
   * Mark a message as "all audio chunks have been delivered".  Useful
   * if the server sends a signal that a message's audio is complete.
   * @param {string} messageId
   * @param {string} [layerName='mainVoice']
   */
  markReady(messageId, layerName = 'mainVoice') {
    const layer = this._getLayer(layerName);
    layer.readyMessages.add(messageId);
    this._notify(layerName);
  }

  /**
   * Get the current playback state for a layer.  Returns `null` if the
   * layer hasn't been created yet.
   *
   * @param {string} [layerName='mainVoice']
   * @returns {object|null}
   */
  /**
   * Remove all audio data for a specific message (e.g. on regeneration).
   * Clears it from pending, the play queue, and stops it if currently
   * playing on the given layer.
   * @param {string} messageId
   * @param {string} [layerName='mainVoice']
   */
  clearMessageAudio(messageId, layerName = 'mainVoice') {
    const layer = this.layers[layerName];
    if (!layer) return;
    // Bump generation so any in-flight chunks from the old generation
    // are ignored when they arrive.
    layer.generations[messageId] = (layer.generations[messageId] || 0) + 1;
    delete layer.pendingChunks[messageId];
    delete layer.totals[messageId];
    delete layer.messageDurations[messageId];
    if (layer.noAudioMessages) layer.noAudioMessages.delete(messageId);
    if (layer.currentMessageId === messageId) {
      this._stop(layerName);
    }
    this._notify(layerName);
  }

  /**
   * Return a message duration only when metadata has loaded for every chunk.
   * @param {string} messageId
   * @param {string} [layerName='mainVoice']
   * @returns {number}
   */
  getMessageDuration(messageId, layerName = 'mainVoice') {
    const layer = this.layers[layerName];
    if (!layer) return 0;
    const durations = layer.messageDurations[messageId];
    const total = layer.totals[messageId];
    if (!durations || total == null) return 0;

    let duration = 0;
    for (let sequence = 0; sequence < total; sequence++) {
      const chunkDuration = durations[sequence];
      if (!chunkDuration || !isFinite(chunkDuration)) return 0;
      duration += chunkDuration;
    }
    return duration;
  }

  getState(layerName = 'mainVoice') {
    const layer = this.layers[layerName];
    if (!layer) return null;

    // Total duration: sum of all known chunk durations
    const chunkDurations = layer.chunkDurations || [];
    const totalDuration = chunkDurations.reduce((s, d) => s + (d || 0), 0)
      || layer.duration;

    // Total elapsed: sum of completed chunks + current chunk's time
    const completed = chunkDurations
      .slice(0, layer.currentChunkIndex)
      .reduce((s, d) => s + (d || 0), 0);
    const totalElapsed = completed + layer.currentTime;

    return {
      playing: layer.playing,
      currentMessageId: layer.currentMessageId,
      currentTime: layer.currentTime,
      duration: layer.duration,
      totalDuration,
      totalElapsed,
      chunkIndex: layer.currentChunkIndex,
      waitingForChunks: layer.waitingForChunks,
      chunkCount: layer.currentChunks.length,
      // With auto-advance off nothing is queued — playback stops at the message.
      queue: (layer.autoAdvance ? this._eligibleAfter(layer, layer.currentMessageId) : []).map(id => ({
        messageId: id,
        hasChunks: (layer.pendingChunks[id] || []).length > 0,
      })),
    };
  }

  /**
   * Subscribe to state changes on a layer.
   * @param {string}   layerName
   * @param {Function} callback  Receives the state object (same shape
   *   as getState()).
   */
  onChange(layerName, callback) {
    if (!this._listeners[layerName]) {
      this._listeners[layerName] = new Set();
    }
    this._listeners[layerName].add(callback);
  }

  /**
   * Unsubscribe.
   * @param {string}   layerName
   * @param {Function} callback
   */
  offChange(layerName, callback) {
    const set = this._listeners[layerName];
    if (set) set.delete(callback);
  }

  /* ------------------------------------------------------------------ */
  /*  Internal playback logic                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Make a message the current one and seed its chunks from pending buffer or,
   * failing that, from the message's existing audio attachments (history).
   * Does not start playback — the caller calls _playChunk afterwards.
   * @param {object} layer
   * @param {string} messageId
   */
  _loadMessage(layer, messageId) {
    layer.currentMessageId = messageId;
    layer.currentChunkIndex = 0;
    layer.chunkDurations = [];
    layer.waitingForChunks = false;
    layer.awaitingNext = false;

    const pending = layer.pendingChunks[messageId];
    if (pending && pending.length > 0) {
      layer.currentChunks = pending;
      delete layer.pendingChunks[messageId];
    } else {
      // Fall back to existing audio attachments (history is fully present, so
      // its chunk count is the total).
      layer.currentChunks = this._extractAudioChunks(layer.allMessages, messageId);
      if (layer.currentChunks.length > 0) layer.totals[messageId] = layer.currentChunks.length;
    }
  }

  /**
   * First message after `afterId` that can produce audio, or null.
   * @param {object} layer
   * @param {string|null} afterId
   * @returns {string|null}
   */
  _nextEligibleMessageId(layer, afterId) {
    return this._eligibleAfter(layer, afterId)[0] || null;
  }

  /**
   * Message IDs after `afterId` (exclusive) that can produce audio — i.e. the
   * dynamic play queue. Skips user turns and messages marked no-audio.
   * @param {object} layer
   * @param {string|null} afterId
   * @returns {string[]}
   */
  _eligibleAfter(layer, afterId) {
    const msgs = layer.allMessages || [];
    const start = afterId ? msgs.findIndex(m => m.id === afterId) : -1;
    if (afterId && start === -1) return []; // position lost — nothing to queue
    const out = [];
    for (let i = start + 1; i < msgs.length; i++) {
      const id = msgs[i].id;
      if (layer.noAudioMessages && layer.noAudioMessages.has(id)) continue;
      if (!this._willGenerateAudio(layer, id)) continue;
      out.push(id);
    }
    return out;
  }

  /**
   * Extract audio chunks from a message's existing attachments.
   * Uses `generationTurnId` (from server metadata) to group chunks
   * by generation turn and returns only the latest one. Falls back
   * to all chunks if no `generationTurnId` is present (old data).
   * @param {Array}  messages  Full message list
   * @param {string} messageId
   * @returns {Array<{id:string,url:string,sequence:number}>}
   */
  _extractAudioChunks(messages, messageId) {
    if (!Array.isArray(messages)) return [];
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return [];
    const audioAtts = (msg.attachments || []).filter(
      a => a.type === 'audio' || String(a.mime_type || '').startsWith('audio/')
    );
    if (audioAtts.length === 0) return [];

    // Group by generationTurnId if present, otherwise use all
    const hasGen = audioAtts.some(a => a.metadata?.generationTurnId != null);
    let targetAtts;
    if (hasGen) {
      const groups = new Map();
      for (const att of audioAtts) {
        const gid = att.metadata?.generationTurnId;
        if (gid == null) continue;
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid).push(att);
      }
      // Find the latest generationTurnId (numeric, highest wins)
      let latestGid = -Infinity;
      for (const gid of groups.keys()) { if (gid > latestGid) latestGid = gid; }
      targetAtts = groups.get(latestGid) || [];
    } else {
      // No generationTurnId — backward compat: use all attachments
      targetAtts = audioAtts;
    }

    if (targetAtts.length === 0) return [];

    // Sort by sequence
    const hasSeq = targetAtts.some(a => a.metadata?.sequence != null);
    const sorted = hasSeq
      ? [...targetAtts].sort(
          (a, b) => (a.metadata?.sequence ?? 0) - (b.metadata?.sequence ?? 0)
        )
      : targetAtts;

    return sorted.map((a, i) => ({
      id: a.id || a.public_url,
      url: a.public_url,
      sequence: a.metadata?.sequence ?? i,
      _gen: 0,
    }));
  }

  /**
   * Play the chunk due at the current position (strict sequence order).
   * The chunk for step `currentChunkIndex` is the one tagged with that exact
   * sequence.  If it hasn't arrived yet we hold (waitingForChunks) unless the
   * message is already complete (`total` chunks consumed), in which case the
   * message ends.  Arrival of a later chunk therefore never plays out of order.
   * @param {string} layerName
   */
  _playChunk(layerName) {
    const layer = this._getLayer(layerName);
    layer.awaitingNext = false; // dealing with the current message, not the tail
    const chunk = this._chunkAt(layer.currentChunks, layer.currentChunkIndex);

    if (!chunk) {
      const total = layer.totals[layer.currentMessageId];
      if (total != null && layer.currentChunkIndex >= total) {
        this._onMessageEnd(layerName);
      } else {
        layer.waitingForChunks = true;
        this._notify(layerName);
      }
      return;
    }

    if (layer.audio) {
      layer.audio.preload = 'auto';
      layer.audio.src = chunk.url;
      layer.audio.play().catch(() => {
        this._onChunkError(layerName);
      });
    }
    layer.waitingForChunks = false;
    this._preloadNext(layerName);
    this._notify(layerName);
  }

  /**
   * One audio chunk finished playing — try the next in sequence.
   * @param {string} layerName
   */
  _onChunkEnded(layerName) {
    const layer = this._getLayer(layerName);

    // Record finished chunk's duration
    if (layer.audio && isFinite(layer.audio.duration)) {
      layer.chunkDurations[layer.currentChunkIndex] = layer.audio.duration;
    }

    layer.currentChunkIndex++;
    // _playChunk plays the next in sequence, holds for a late chunk, or ends
    // the message once all `total` chunks have been consumed.
    this._playChunk(layerName);
  }

  /**
   * The current message finished. Hand off to auto-advance, or stop.
   * @param {string} layerName
   */
  _onMessageEnd(layerName) {
    const layer = this._getLayer(layerName);
    if (layer.currentMessageId) layer.readyMessages.delete(layer.currentMessageId);

    if (layer.autoAdvance) {
      this._advanceCursor(layerName);
    } else {
      this._resetPlayback(layer);
      this._notify(layerName);
    }
  }

  /**
   * Move the cursor to the next message that can produce audio, computed live
   * from allMessages (so messages generated after play() are picked up, and
   * user turns are skipped).  If none exists yet, park at the tail
   * (awaitingNext) so a future message resumes playback.
   * @param {string} layerName
   */
  _advanceCursor(layerName) {
    const layer = this._getLayer(layerName);
    const nextId = this._nextEligibleMessageId(layer, layer.currentMessageId);

    if (nextId) {
      // Commit to it and hold for its first chunk (arrives via addChunk's
      // current-message branch) — or play immediately if already buffered.
      this._loadMessage(layer, nextId);
      this._playChunk(layerName);
      return;
    }

    // No next message yet. Stay parked and wait for one to be generated.
    layer.playing = false;
    layer.currentChunks = [];
    layer.currentChunkIndex = 0;
    layer.chunkDurations = [];
    layer.waitingForChunks = true;
    layer.awaitingNext = true;
    this._notify(layerName);
  }

  /**
   * Reset the active-playback fields (keeps buffered/pending data, totals,
   * and the cached message list).
   * @param {object} layer
   */
  _resetPlayback(layer) {
    layer.playing = false;
    layer.currentMessageId = null;
    layer.currentChunks = [];
    layer.currentChunkIndex = 0;
    layer.chunkDurations = [];
    layer.waitingForChunks = false;
    layer.awaitingNext = false;
  }

  /**
   * Start loading an audio URL without claiming the playback element.  Chunks
   * are preloaded on audio_ready, before the user presses Play.
   * @param {object} layer
   * @param {string} url
   * @param {string} messageId
   * @param {number} sequence
   */
  _preloadUrl(layer, url, messageId, sequence) {
    if (!url || typeof Audio === 'undefined' || layer._preloadedUrls.has(url)) return;
    layer._preloadedUrls.add(url);
    const generation = layer.generations[messageId] || 0;
    const preload = new Audio();
    preload.preload = 'metadata';
    preload.src = url;
    layer._preloadElements.set(url, preload);
    preload.addEventListener('loadedmetadata', () => {
      if ((layer.generations[messageId] || 0) !== generation || !isFinite(preload.duration)) return;
      if (!layer.messageDurations[messageId]) layer.messageDurations[messageId] = {};
      layer.messageDurations[messageId][sequence] = preload.duration;
      console.log('[AudioManager] chunk duration preloaded', {
        messageId,
        sequence,
        duration: preload.duration,
        total: layer.totals[messageId],
        completeDuration: this.getMessageDuration(messageId, layer.name),
      });
      this._notify(layer.name);
    }, { once: true });
    const release = () => layer._preloadElements.delete(url);
    preload.addEventListener('canplaythrough', release, { once: true });
    preload.addEventListener('error', () => {
      console.log('[AudioManager] chunk metadata preload failed', { messageId, sequence, url });
      release();
    }, { once: true });
    preload.load();
  }

  /**
   * Preload the next chunk while the current one plays, in case it was loaded
   * from history rather than received through audio_ready.
   * @param {string} layerName
   */
  _preloadNext(layerName) {
    const layer = this._getLayer(layerName);
    const nextIdx = layer.currentChunkIndex + 1;
    if (nextIdx >= layer.currentChunks.length) return;
    const chunk = layer.currentChunks[nextIdx];
    this._preloadUrl(layer, chunk.url, layer.currentMessageId, chunk.sequence);
  }

  /**
   * On playback error, skip to the next chunk.
   * @param {string} layerName
   */
  _onChunkError(layerName) {
    this._onChunkEnded(layerName);
  }

  /**
   * Mark a message as having no audio chunks at all.
   * It will be skipped when the queue reaches it.
   * @param {string} messageId
   * @param {string} [layerName='mainVoice']
   */
  markNoAudio(messageId, layerName = 'mainVoice') {
    const layer = this._getLayer(layerName);
    if (!layer.noAudioMessages) layer.noAudioMessages = new Set();
    layer.noAudioMessages.add(messageId);

    // If we're holding for this exact message (committed-and-waiting) or parked
    // at the tail, skip past it to the next eligible message.
    if (
      layer.autoAdvance &&
      (layer.awaitingNext ||
        (layer.waitingForChunks && layer.currentMessageId === messageId))
    ) {
      this._advanceCursor(layerName);
    }
    this._notify(layerName);
  }

  /**
   * Stop playback and optionally keep or discard queue/pending data.
   * @param {string}  layerName
   * @param {boolean} [keepHistory=false]
   */
  _stop(layerName, keepHistory = false) {
    const layer = this._getLayer(layerName);
    if (layer.audio) {
      layer.audio.pause();
      layer.audio.src = '';
    }
    this._resetPlayback(layer);

    if (!keepHistory) {
      layer.pendingChunks = {};
      layer.noAudioMessages = new Set();
      layer.generations = {};
    }

    this._notify(layerName);
  }

  /* ------------------------------------------------------------------ */
  /*  Utility                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Insert a chunk into an array sorted by `sequence` (ascending).
   * Mutates the array in place.
   * @param {Array}  chunks
   * @param {object} chunk
   */
  _insertChunkSorted(chunks, chunk) {
    const idx = chunks.findIndex(c => c.sequence > chunk.sequence);
    if (idx === -1) {
      chunks.push(chunk);
    } else {
      chunks.splice(idx, 0, chunk);
    }
  }

  /**
   * Find the chunk due at a playback position.  Chunks play in strict
   * sequence order, so the chunk for step `index` is the one tagged
   * `sequence === index` (the server emits sequences 0..N-1 per generation).
   * Returns `undefined` when that chunk hasn't arrived yet.
   * @param {Array}  chunks
   * @param {number} index
   * @returns {object|undefined}
   */
  _chunkAt(chunks, index) {
    return chunks.find(c => c.sequence === index);
  }

  /**
   * Whether a queued message can ever produce audio.  Only assistant turns
   * are spoken, so a message with an explicit non-assistant role (e.g. a user
   * turn) is skipped rather than waited for.  Conservative: when the role is
   * unknown we assume audio may still come and wait.
   * @param {object} layer
   * @param {string} messageId
   * @returns {boolean}
   */
  _willGenerateAudio(layer, messageId) {
    const msg = (layer.allMessages || []).find(m => m.id === messageId);
    if (!msg) return true;
    return !msg.role || msg.role === 'assistant';
  }

  /**
   * Notify all listeners of the current layer state.
   * @param {string} layerName
   */
  _notify(layerName) {
    const cbs = this._listeners[layerName];
    if (cbs) {
      const state = this.getState(layerName);
      for (const cb of cbs) cb(state);
    }
  }
}

/** Singleton */
const audioManager = new MessageAudioManager();
export default audioManager;
export { MessageAudioManager };
