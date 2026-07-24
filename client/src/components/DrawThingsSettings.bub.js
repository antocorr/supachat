import { watchProp } from 'tinybubble';
import { clientLog } from '../api/client.js';

/**
 * @typedef {{ id: string, name: string, filename: string, size: number }} DrawThingsModel
 */

export default {
  name: 'DrawThingsSettings',
  props: ['settings', 'status', 'models'],
  emits: ['save', 'probe'],
  template() {
    return /*html*/`
      <section class="settings-card">
        <h3>Draw Things</h3>
        <p :class="{ ok: status.available, error: !status.available }">{{ status.message || (status.available ? 'Available' : 'Unconfigured or disabled') }}</p>
        <label class="checkbox"><input type="checkbox" :checked="form.enabled" @change="setEnabled($event)"> Enabled</label>
        <label>Base URL<input x-model="form.baseUrl" placeholder="http://127.0.0.1:7860"></label>
        <label>Models directory<input x-model="form.modelsDir" placeholder="~/Library/Containers/com.liuliu.draw-things/Data/Documents/Models"></label>
        <div class="grid two">
          <label>Width<input type="number" x-model="form.width"></label>
          <label>Height<input type="number" x-model="form.height"></label>
          <label>Steps<input type="number" x-model="form.steps"></label>
          <label>CFG scale<input type="number" x-model="form.cfgScale"></label>
          <label>Text guidance<input type="number" step="0.1" x-model="form.textGuidance"></label>
          <label>Timeout ms<input type="number" x-model="form.timeoutMs"></label>
        </div>
        <label>Model
          <select x-model="form.model">
            <option value="">Use Draw Things current model</option>
            <option x-for="model in availableModels()" :value="model.filename">{{ model.name }}</option>
          </select>
        </label>
        <div x-if="!availableModels().length" class="muted">No models available. Save the models directory and click Probe to refresh.</div>
        <label>LoRA
          <select x-model="form.lora">
            <option value="">No LoRA</option>
            <option x-for="name in availableLoras()" :value="name">{{ name }}</option>
          </select>
        </label>
        <label>Sampler<input x-model="form.sampler"></label>
        <label>Prompt prepend<textarea x-model="form.promptPrepend" placeholder="Text added before every image prompt"></textarea></label>
        <label>Prompt append<textarea x-model="form.promptAppend" placeholder="Text added after every image prompt"></textarea></label>
        <label>Negative prompt<textarea x-model="form.negativePrompt"></textarea></label>
        <div class="button-row">
          <button type="button" @click="save">Save Draw Things</button>
          <button type="button" @click="probe">Probe server</button>
        </div>
      </section>
    `;
  },
  data() {
    return {
      form: {
        enabled: false,
        baseUrl: '',
        modelsDir: '',
        width: 512,
        height: 512,
        steps: 8,
        cfgScale: 7,
        textGuidance: 5,
        model: '',
        lora: '',
        sampler: '',
        promptPrepend: '',
        promptAppend: '',
        negativePrompt: '',
        timeoutMs: 120000
      }
    };
  },
  init() {
    this.syncSettings();
    watchProp(this, 'settings', () => {
      this.syncSettings();
    });
  },
  syncSettings() {
    const settings = this.props.settings || {};
    const source = settings.drawThings || settings.draw_things || {};
    this.data.form.value = { ...this.data.form.value, ...source };
  },
  setEnabled(event) {
    this.data.form.value.enabled = event.target.checked;
  },
  /** @returns {DrawThingsModel[]} */
  availableModels() {
    const propsModels = Array.isArray(this.props.models) ? this.props.models : [];
    return propsModels;
  },
  availableLoras() {
    return [];
  },
  save() {
    clientLog('draw_things_save', { enabled: this.data.form.value.enabled, baseUrl: this.data.form.value.baseUrl, modelsDir: this.data.form.value.modelsDir });
    this.emit('save', { drawThings: { ...this.data.form.value } });
  },
  probe() {
    clientLog('draw_things_probe', { baseUrl: this.data.form.value.baseUrl, modelsDir: this.data.form.value.modelsDir });
    this.emit('probe', { drawThings: { ...this.data.form.value } });
  }
};
