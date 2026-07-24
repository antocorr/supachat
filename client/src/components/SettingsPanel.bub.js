import DrawThingsSettings from './DrawThingsSettings.bub.js';
import TtsSettings from './TtsSettings.bub.js';

export default {
  name: 'SettingsPanel',
  props: ['settings', 'drawStatus', 'voices', 'kokoroVoices', 'models', 'drawModels'],
  emits: ['save', 'probe-draw-things', 'refresh-voices', 'refresh-kokoro-voices', 'refresh-models'],
  components: {
    'draw-things-settings': DrawThingsSettings,
    'tts-settings': TtsSettings
  },
  template() {
    return /*html*/`
      <section class="settings-panel">
        <h2>Settings</h2>
        <section class="settings-card">
          <h3>AI / Ollama</h3>
          <label>Provider<input x-model="ai.provider" placeholder="ollama"></label>
          <label>Model
            <select x-model="ai.model">
              <option value="">Choose live Ollama model</option>
              <option x-for="model in models" :value="model.name || model.model">{{ model.name || model.model }}</option>
            </select>
          </label>
          <label>Ollama base URL<input x-model="ai.ollamaBaseUrl" placeholder="http://127.0.0.1:11434"></label>
          <label>Tool calling mode
            <select x-model="ai.toolMode">
              <option value="native">Native (tools API)</option>
              <option value="structured">Structured output (JSON schema)</option>
            </select>
          </label>
          <label>Thinking mode
            <select x-model="ai.thinkingMode">
              <option value="inactive">Inactive</option>
              <option value="active">Active</option>
            </select>
          </label>
          <label>Temperature
            <input type="number" x-model="ai.temperature" min="0" max="2" step="0.05" placeholder="0.8">
            <span class="field-hint">0 = deterministic, ~0.8 = expressive default, max 2</span>
          </label>
          <p class="field-hint">Use "Structured output" for models that accept tools but don't reliably call them (they write JSON into the reply instead).</p>
          <div class="button-row">
            <button type="button" @click="saveAi">Save AI settings</button>
            <button type="button" @click="refreshModels">Refresh models</button>
          </div>
        </section>
        <draw-things-settings :settings="settings" :status="drawStatus" :models="drawModels" @save="savePartial" @probe="probeDrawThings"></draw-things-settings>
        <tts-settings :settings="settings" :voices="voices" :kokoro-voices="kokoroVoices" @save="savePartial" @refresh-voices="refreshVoices" @refresh-kokoro-voices="refreshKokoroVoices"></tts-settings>
        <section class="settings-card">
          <h3>Runtime preferences</h3>
          <label class="checkbox"><input type="checkbox" x-model="runtime.logEnabled"> Enable logging</label>
          <label class="checkbox"><input type="checkbox" x-model="runtime.restoreOnStart"> Restore on start</label>
          <label>Data directory<input x-model="runtime.dataDirectory"></label>
          <button type="button" @click="saveRuntime">Save runtime settings</button>
        </section>
      </section>
    `;
  },
  data() {
    return {
      ai: { provider: 'ollama', model: 'socialnetwooky/opencrystal:12b', ollamaBaseUrl: 'http://127.0.0.1:11434', toolMode: 'native', thinkingMode: 'inactive', temperature: 0.8 },
      runtime: { logEnabled: false, restoreOnStart: false, dataDirectory: '' }
    };
  },
  init() {
    this.syncSettings();
  },
  syncSettings() {
    const settings = this.props.settings || {};
    const ai = settings.ai || settings.ollama || {};
    const runtime = settings.runtime || {};
    this.data.ai.value = { ...this.data.ai.value, ...ai };
    this.data.runtime.value = { ...this.data.runtime.value, ...runtime };
  },
  saveAi() { this.emit('save', { ai: { ...this.data.ai.value } }); },
  saveRuntime() { this.emit('save', { runtime: { ...this.data.runtime.value } }); },
  savePartial(payload) { this.emit('save', payload); },
  probeDrawThings(payload) { this.emit('probe-draw-things', payload); },
  refreshVoices() { this.emit('refresh-voices'); },
  refreshKokoroVoices() { this.emit('refresh-kokoro-voices'); },
  refreshModels() { this.emit('refresh-models'); }
};
