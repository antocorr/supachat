/**
 * @typedef {{ value?: string, id?: string, label?: string, name?: string }} SelectOption
 */

export default {
  name: 'CustomSelect',
  props: ['options', 'placeholder', 'pill', 'label', 'selectId', 'disabled', 'value'],
  emits: ['change'],
  template() {
    return /*html*/`
      <div class="custom-select">
        <select :id="selectId" class="custom-select__native" :disabled="disabled" @change="handleChange">
          <template x-if="placeholder">
            <option value="">{{ placeholder }}</option>
          </template>
          <option x-for="item in options" :value="item.id || item.value">{{ item.name || item.label || item.id || item.value }}</option>
        </select>
        <span x-if="pill" class="custom-select__pill">{{ pill }}</span>
        <span class="custom-select__value">{{ displayLabel() }}</span>
        <svg class="custom-select__chevron" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    `;
  },
  data() {
    return { selectedValue: '' };
  },
  init() {
    const valueSignal = this._propsSignals.value;
    const optionsSignal = this._propsSignals.options;

    valueSignal.subscribe(() => {
      this.data.selectedValue.value = valueSignal.value ?? '';
      this.syncNativeSelectValue();
    });

    // <option> elements from x-for may re-render after this fires; defer the sync past that render.
    optionsSignal.subscribe(() => {
      Promise.resolve().then(() => this.syncNativeSelectValue());
    });

    if (valueSignal.value) {
      this.data.selectedValue.value = valueSignal.value;
      this.syncNativeSelectValue();
    }
  },
  syncNativeSelectValue() {
    const select = this.$element?.querySelector('select');
    if (!select) return;
    select.value = this.data.selectedValue.value ?? '';
  },
  /** @returns {string} */
  displayLabel() {
    const selected = this.data.selectedValue.value;
    const fallback = this._propsSignals.label.value || this._propsSignals.placeholder.value || '';
    if (!selected) return fallback;

    /** @type {SelectOption[]} */
    const options = this._propsSignals.options.value || [];
    const match = options.find((item) => item && (item.id === selected || item.value === selected));
    // Show the actual value even if it's not in the current options list
    return match ? (match.name || match.label || match.id || match.value) : selected;
  },
  /** @param {string} value */
  handleChange(value) {
    const next = value ?? '';
    this.data.selectedValue.value = next;
    this.emit('change', next);
  }
};
