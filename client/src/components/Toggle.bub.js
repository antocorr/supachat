import { watchProp } from 'tinybubble';

export default {
  name: 'Toggle',
  props: ['model-val', 'label', 'disabled'],
  emits: ['change'],
  template() {
    return /*html*/`
      <label class="toggle-wrap" :class="{ disabled: disabled }">
        <div
          class="toggle-track"
          :class="{ on: isOn, disabled: disabled }"
          @click="change"
          role="switch"
          :aria-checked="isOn ? 'true' : 'false'"
          :aria-disabled="disabled ? 'true' : 'false'"
          tabindex="0"
          @keydown="onKeydown($event)"
        >
          <div class="toggle-thumb" :class="{ on: isOn }"></div>
        </div>
        <span x-if="label" class="toggle-label">{{ label }}</span>
      </label>
    `;
  },
  data() {
    return { isOn: false };
  },
  init() {
    this.data.isOn.value = !!this.props['model-val'];
    watchProp(this, 'model-val', (val) => {
      this.data.isOn.value = !!val;
    });
  },
  change() {
    if (this.props.disabled) return;
    const next = !this.data.isOn.value;
    this.data.isOn.value = next;
    this.emit('change', next, !next);
  },
  onKeydown(event) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.change();
    }
  }
};
