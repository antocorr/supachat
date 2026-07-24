import { watchProp } from 'tinybubble';
import { DiceTable } from '../lib/DiceTable.js';

export default {
  name: 'DiceRoller',
  props: ['type', 'value', 'challengeValue', 'sign', 'success', 'label', 'speakerName', 'publicReason', 'rollId', 'interactive'],
  emits: ['roll-complete'],
  data() {
    return { state: 'idle', rollValue: null, rollSuccess: null };
  },
  template() {
    return /*html*/`
      <section class="dice-roller" :class="[interactive ? 'dice-roller--interactive' : 'dice-roller--message', state, rollSuccess ? 'success' : rollSuccess === false ? 'failure' : '']">
        <template x-if="interactive">
          <header class="dice-roll-header">
            <span class="material-symbols-outlined">casino</span>
            <div>
              <strong>{{ type.toUpperCase() }} roll</strong>
              <p>{{ label || 'Roll the dice to resolve the check.' }}</p>
              <div x-if="publicReason" class="dice-public-message">
                <span class="dice-public-message-author">{{ speakerName }} says</span>
                <p class="dice-public-reason">“{{ publicReason }}”</p>
              </div>
            </div>
          </header>
          <button type="button" class="dice-table" :disabled="state !== 'idle'" @click="roll">
            <div ref="canvas" class="dice-canvas"></div>
            <span x-if="state === 'idle'" class="dice-table-prompt">Click the table to roll</span>
            <span x-if="state === 'rolling'" class="dice-table-prompt">Rolling…</span>
            <span x-if="state === 'done'" class="dice-table-prompt dice-table-result">{{ rollValue }}</span>
          </button>
          <div x-if="state === 'done'" class="dice-outcome">
            <span x-if="challengeValue !== null" class="dice-roll-detail">{{ rollValue }} vs DC {{ challengeValue }} ({{ sign }})</span>
            <span x-if="rollSuccess !== null" class="dice-outcome-badge" :class="rollSuccess ? 'badge-success' : 'badge-failure'">
              {{ rollSuccess ? '✓ Success' : '✗ Failure' }}
            </span>
          </div>
        </template>
        <template x-if="!interactive">
          <div class="dice-message-result">
            <span class="material-symbols-outlined">casino</span>
            <strong>{{ type.toUpperCase() }}</strong>
            <span class="dice-message-value">{{ value }}</span>
            <span x-if="challengeValue !== null" class="dice-roll-detail">vs DC {{ challengeValue }} ({{ sign }})</span>
            <span x-if="success !== null" class="dice-outcome-badge" :class="success ? 'badge-success' : 'badge-failure'">
              {{ success ? '✓ Success' : '✗ Failure' }}
            </span>
          </div>
        </template>
      </section>
    `;
  },
  init() {
    watchProp(this, 'type', () => this.reset());
    watchProp(this, 'rollId', (rollId) => {
      if (rollId) this.reset();
    });
  },
  mounted() {
    if (!this.props.interactive) return;
    this._table = new DiceTable(this.refs.canvas);
    this._showPreview();
  },
  roll() {
    if (!this.props.interactive || this.data.state.value !== 'idle') return;

    const value = Math.floor(Math.random() * this._sides()) + 1;
    this.data.rollValue.value = value;
    this.data.rollSuccess.value = this._computeSuccess(value);
    this.data.state.value = 'rolling';

    const duration = this._table.roll(this._diceForRoll(value));
    this._rollTimer = setTimeout(() => {
      this.data.state.value = 'done';
      this._rollTimer = null;
      this.emit('roll-complete', { value, type: this.props.type, success: this.data.rollSuccess.value });
    }, duration);
  },
  reset() {
    if (this._rollTimer) {
      clearTimeout(this._rollTimer);
      this._rollTimer = null;
    }
    this.data.state.value = 'idle';
    this.data.rollValue.value = null;
    this.data.rollSuccess.value = null;
    this._showPreview();
  },
  _showPreview() {
    if (!this._table) return;
    this._table.resetAll();
    this._table.setPreview(this._diceForRoll().map(die => ({ sides: die.sides, count: 1 })));
  },
  _sides() {
    const sides = Number(String(this.props.type).replace('d', ''));
    return sides || 20;
  },
  _diceForRoll(value) {
    const sides = this._sides();
    if (sides === 100) {
      if (!value) return [{ sides: 100 }, { sides: 10 }];
      return [
        { sides: 100, rollValue: Math.floor((value - 1) / 10) + 1 },
        { sides: 10, rollValue: (value - 1) % 10 + 1 },
      ];
    }
    return value ? [{ sides, rollValue: value }] : [{ sides }];
  },
  _computeSuccess(value) {
    const challengeValue = this.props.challengeValue;
    if (challengeValue === null || challengeValue === undefined) return null;
    switch (this.props.sign) {
      case '>': return value > challengeValue;
      case '<': return value < challengeValue;
      case '>=': return value >= challengeValue;
      case '<=': return value <= challengeValue;
      case '=': return value === challengeValue;
      default: return value >= challengeValue;
    }
  },
  beforeDestroy() {
    if (this._rollTimer) clearTimeout(this._rollTimer);
    if (this._table) this._table.destroy();
  },
};
