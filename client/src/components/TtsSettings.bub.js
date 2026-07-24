import { api } from '../api/client.js';
import { watchProp } from 'tinybubble';

export default {
  name: 'TtsSettings',
  props: ['settings', 'voices', 'kokoroVoices'],
  emits: ['save', 'refresh-voices', 'refresh-kokoro-voices'],
  template() {
    return /*html*/`
      <div style="display:contents">
      <section class="settings-card">
        <h3>Text to speech</h3>
        <label class="checkbox"><input type="checkbox" :checked="tts.enabled" @change="toggleTtsEnabled($event)"> Generate audio for assistant messages</label>
        <label>Engine
          <select x-model="tts.engine">
            <option value="piper">Piper</option>
            <option value="kokoro">Kokoro</option>
          </select>
        </label>
        <div class="button-row">
          <button type="button" @click="saveTts">Save TTS engine</button>
        </div>
      </section>
      <section x-if="tts.engine === 'piper'" class="settings-card">
        <h3>Piper TTS</h3>
        <p class="field-hint">Using piper-js — no external binary needed. Voice models are loaded from local .onnx files.</p>
        <label>Voice directory<input x-model="piper.voiceDir" placeholder="/path/to/voices"></label>
        <label>Output directory<input x-model="piper.outputDir" placeholder="data/audio"></label>
        <label>Default voice<select x-model="piper.defaultVoice"><option value="">Choose voice</option><option x-for="voice in voices" :value="voice.id || voice.path || voice.name">{{ voice.name || voice.id || voice.path }}</option></select></label>
        <div class="grid two">
          <label>Timeout ms<input type="number" x-model="piper.timeoutMs"></label>
          <label>Max text length<input type="number" x-model="piper.maxTextLength"></label>
        </div>
        <label>Cleanup policy<input x-model="piper.cleanupPolicy" placeholder="keep"></label>
        <div class="button-row">
          <button type="button" @click="savePiper">Save Piper</button>
          <button type="button" @click="refreshVoices">Refresh Piper voices</button>
        </div>
      </section>
      <section x-if="tts.engine === 'kokoro'" class="settings-card">
        <h3>Kokoro TTS</h3>
        <label>Model directory<input x-model="kokoro.modelDir" placeholder="/path/to/kokoro"></label>
        <div class="grid two">
          <label>Precision
            <select x-model="kokoro.dtype">
              <option value="fp32">fp32</option>
              <option value="fp16">fp16</option>
              <option value="q8">q8</option>
              <option value="q4">q4</option>
              <option value="q4f16">q4f16</option>
            </select>
          </label>
          <label>Synthesis location
            <select x-model="kokoro.mode">
              <option value="server">Server</option>
              <option value="browser">Browser</option>
            </select>
          </label>
          <label>Generation mode
            <select x-model="kokoro.outputMode">
              <option value="full">Full (single shot — best quality)</option>
              <option value="chunk">Chunk (manual sentence split)</option>
              <option value="stream">Stream (kokoro-js streaming)</option>
            </select>
          </label>
        </div>
        <label>Output directory<input x-model="kokoro.outputDir" placeholder="data/audio"></label>
        <label>Max text length<input type="number" x-model="kokoro.maxTextLength"></label>
        <label>Kokoro language
          <select x-model="kokoroLanguage" @change="onKokoroLanguageChange">
            <option x-for="language in kokoroLanguageSelectOptions()" :value="language">{{ language }}</option>
          </select>
        </label>
        <label>Default voice
          <select x-model="kokoro.defaultVoice">
            <option value="">Choose voice</option>
            <option x-for="voice in kokoroVoiceSelectOptions(kokoroLanguage)" :value="voice.id">{{ voice.label }}</option>
          </select>
        </label>
        <div x-if="!kokoroModelReady" class="button-row">
          <button type="button" @click="downloadKokoroDefaultVoice" :disabled="kokoroDownload.loading">{{ kokoroDownload.loading ? 'Downloading model…' : '⬇ Download model' }}</button>
        </div>
        <p x-if="!kokoroModelReady" class="field-hint">Model files not found on the server.</p>
        <div x-if="kokoroModelReady && kokoroVoiceNotInstalled(kokoro.defaultVoice)" class="button-row">
          <button type="button" @click="downloadKokoroDefaultVoice" :disabled="kokoroDownload.loading">{{ kokoroDownload.loading ? 'Downloading voice…' : '⬇ Download voice' }}</button>
        </div>
        <p x-if="kokoroModelReady && kokoroVoiceNotInstalled(kokoro.defaultVoice)" class="field-hint">This voice isn't installed on the server yet.</p>
        <p x-if="kokoroDownload.error" class="error">{{ kokoroDownload.error }}</p>
        <div class="button-row">
          <button type="button" @click="saveKokoro">Save Kokoro</button>
          <button type="button" @click="refreshKokoroVoices">Refresh Kokoro voices</button>
        </div>
      </section>
      </div>
    `;
  },
  data() {
    return {
      tts: { enabled: false, engine: 'piper' },
      piper: { voiceDir: '', outputDir: '', maxTextLength: 4000, defaultVoice: '', timeoutMs: 30000, cleanupPolicy: 'keep' },
      kokoro: { mode: 'server', modelDir: '', dtype: 'q4', outputDir: '', defaultVoice: '', maxTextLength: 2000, outputMode: 'full' },
      kokoroLanguage: '',
      kokoroModelReady: false,
      kokoroDownload: { loading: false, error: '' }
    };
  },
  init() {
    this.syncSettings();
    this.data.kokoroLanguage.value = this.kokoroLanguageForVoice(this.data.kokoro.value.defaultVoice);
    this.checkKokoroModelStatus();
    watchProp(this, 'kokoroVoices', () => {
      this.data.kokoroLanguage.value = this.kokoroLanguageForVoice(this.data.kokoro.value.defaultVoice);
    });
    watchProp(this, 'settings', () => {
      this.syncSettings();
      this.checkKokoroModelStatus();
    });
  },
  syncSettings() {
    const settings = this.props.settings || {};
    this.data.tts.value = { ...this.data.tts.value, ...(settings.tts || {}) };
    this.data.piper.value = { ...this.data.piper.value, ...(settings.piper || {}) };
    this.data.kokoro.value = { ...this.data.kokoro.value, ...(settings.kokoro || {}) };
  },
  saveTts() { this.emit('save', { tts: { ...this.data.tts.value } }); },
  savePiper() { this.emit('save', { piper: { ...this.data.piper.value } }); },
  saveKokoro() { this.emit('save', { kokoro: { ...this.data.kokoro.value } }); },
  toggleTtsEnabled(event) { this.data.tts.value = { ...this.data.tts.value, enabled: event.target.checked }; },
  refreshVoices() { this.emit('refresh-voices'); },
  refreshKokoroVoices() { this.emit('refresh-kokoro-voices'); },
  /** @param {string} voiceId @returns {string} */
  kokoroLanguageForVoice(voiceId) {
    const voices = this.props.kokoroVoices || [];
    const match = voices.find((v) => v.id === voiceId);
    if (match) return match.language;
    return voices[0] ? voices[0].language : 'English (US)';
  },
  /** @returns {string[]} */
  kokoroLanguageSelectOptions() {
    const seen = new Set();
    const languages = [];
    for (const voice of (this.props.kokoroVoices || [])) {
      if (!seen.has(voice.language)) { seen.add(voice.language); languages.push(voice.language); }
    }
    return languages;
  },
  /** @param {string} language @returns {{id: string, label: string}[]} */
  kokoroVoiceSelectOptions(language) {
    return (this.props.kokoroVoices || [])
      .filter((voice) => voice.language === language)
      .map((voice) => ({ id: voice.id, label: voice.installed ? voice.label : `${voice.label} ⬇` }));
  },
  /** @param {string} voiceId @returns {boolean} */
  kokoroVoiceNotInstalled(voiceId) {
    if (!voiceId) return false;
    const voice = (this.props.kokoroVoices || []).find((v) => v.id === voiceId);
    return !!voice && voice.installed === false;
  },
  onKokoroLanguageChange() {
    this.setDefaultKokoroVoice();
  },
  setDefaultKokoroVoice() {
    const voices = this.kokoroVoiceSelectOptions(this.data.kokoroLanguage.value);
    this.data.kokoro.value = { ...this.data.kokoro.value, defaultVoice: voices[0] ? voices[0].id : '' };
  },
  async checkKokoroModelStatus() {
    if (!this.data.kokoro.value.modelDir) {
      this.data.kokoroModelReady.value = false;
      return;
    }
    try {
      const status = await api.kokoroModelStatus();
      this.data.kokoroModelReady.value = status.ready;
    } catch {
      this.data.kokoroModelReady.value = false;
    }
  },
  async downloadKokoroDefaultVoice() {
    const voiceId = this.data.kokoro.value.defaultVoice;
    this.data.kokoroDownload.value = { loading: true, error: '' };
    try {
      const result = await api.downloadKokoroVoice(voiceId);
      this.data.kokoroDownload.value = { loading: false, error: '' };
      if (result.modelDownloaded?.length) {
        this.data.kokoroModelReady.value = true;
      }
      this.emit('refresh-kokoro-voices');
    } catch (error) {
      this.data.kokoroDownload.value = { loading: false, error: error.message || 'Download failed' };
    }
  }
};
