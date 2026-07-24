import { api } from '../api/client.js';

export default {
  name: 'ProfilePanel',
  props: ['profiles', 'activeProfileId', 'disabled', 'conversationModel'],
  emits: ['create', 'update', 'delete', 'activate'],
  template() {
    return /*html*/`
      <section class="side-panel">
        <div class="section-header">
          <h2>User profiles</h2>
          <button type="button" @click="startCreate" title="New profile">
            <span class="material-symbols-outlined" style="font-size:18px">add_box</span>
          </button>
        </div>

        <template x-for="profile in profiles">
          <article class="agent-card" :class="{ active: profile.id === activeProfileId }">
            <div class="agent-card-left">
              <div class="agent-avatar">{{ agentInitial(profile.name) }}</div>
              <div class="agent-card-info">
                <h4>{{ profile.name }}</h4>
                <p x-if="profile.introduction">{{ truncateText(profile.introduction, 60) }}</p>
                <p x-if="!profile.introduction && profile.appearance" class="muted-inline">{{ truncateText(profile.appearance, 60) }}</p>
              </div>
            </div>
            <div class="agent-card-actions">
              <button type="button" @click="activate(profile)" title="Use profile">
                <span class="material-symbols-outlined">play_arrow</span>
              </button>
              <button type="button" @click="selectForEdit(profile)" title="Edit">
                <span class="material-symbols-outlined">edit</span>
              </button>
              <button type="button" class="danger-action" @click="remove(profile)" title="Delete">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </article>
        </template>

        <!-- Create form -->
        <form class="edit-form-styled" @submit-prevent="createProfile" x-if="!edit.id">
          <h3><span class="material-symbols-outlined" style="font-size:18px;color:#d0bcff">person_add</span> Create Profile</h3>

          <label class="form-label">Name
            <input x-model="form.name" placeholder="Your name" :disabled="disabled">
          </label>

          <div class="ai-textarea-wrap">
            <textarea x-model="form.introduction" placeholder="Personality, background, relationships" :disabled="disabled || (aiAssist.field === 'form' && aiAssist.loading)" rows="4"></textarea>
            <button type="button" class="ai-assist-btn" :disabled="disabled || !form.introduction.trim()" @click="startAiAssist('form')" title="AI: expand description"><span class="material-symbols-outlined">auto_awesome</span></button>
          </div>
          <div x-if="aiAssist.field === 'form'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <div class="ai-textarea-wrap">
            <textarea x-model="form.appearance" placeholder="Physical appearance" :disabled="disabled || (aiAssist.field === 'form-appearance' && aiAssist.loading)" rows="4"></textarea>
            <button type="button" class="ai-assist-btn" :disabled="disabled || !form.appearance.trim()" @click="startAiAssist('form-appearance')" title="AI: expand appearance"><span class="material-symbols-outlined">auto_awesome</span></button>
          </div>
          <div x-if="aiAssist.field === 'form-appearance'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <div class="form-actions">
            <button type="submit" :disabled="disabled || !form.name.trim()">Save /iam</button>
          </div>
        </form>

        <!-- Edit form -->
        <form x-if="edit.id" class="edit-form-styled" @submit-prevent="saveEdit">
          <h3><span class="material-symbols-outlined" style="font-size:18px;color:#d0bcff">edit_note</span> Edit {{ edit.name }}</h3>

          <label class="form-label">Name
            <input x-model="edit.name" placeholder="Name">
          </label>

          <div class="ai-textarea-wrap">
            <textarea x-model="edit.introduction" placeholder="Personality, background, relationships" :disabled="disabled || (aiAssist.field === 'edit' && aiAssist.loading)" rows="4"></textarea>
            <button type="button" class="ai-assist-btn" :disabled="disabled || !edit.introduction.trim()" @click="startAiAssist('edit')" title="AI: expand description"><span class="material-symbols-outlined">auto_awesome</span></button>
          </div>
          <div x-if="aiAssist.field === 'edit'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <div class="ai-textarea-wrap">
            <textarea x-model="edit.appearance" placeholder="Physical appearance" :disabled="disabled || (aiAssist.field === 'edit-appearance' && aiAssist.loading)" rows="4"></textarea>
            <button type="button" class="ai-assist-btn" :disabled="disabled || !edit.appearance.trim()" @click="startAiAssist('edit-appearance')" title="AI: expand appearance"><span class="material-symbols-outlined">auto_awesome</span></button>
          </div>
          <div x-if="aiAssist.field === 'edit-appearance'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <div class="form-actions">
            <button type="submit">Save profile</button>
            <button type="button" @click="cancelEdit">Cancel</button>
          </div>
        </form>
      </section>
    `;
  },
  data() {
    return {
      form: { name: '', introduction: '', appearance: '' },
      edit: { id: '', name: '', introduction: '', appearance: '' },
      aiAssist: { field: null, originalText: '', slider: 3, loading: false }
    };
  },
  /** @param {string} name @returns {string} */
  agentInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
  },
  /** @param {string} text @param {number} max @returns {string} */
  truncateText(text, max) {
    if (!text) return '';
    return text.length > max ? text.substring(0, max) + '…' : text;
  },
  createProfile() {
    this.emit('create', { ...this.data.form.value });
    this.data.form.value = { name: '', introduction: '', appearance: '' };
  },
  selectForEdit(profile) { this.data.edit.value = { ...profile }; },
  saveEdit() {
    this.emit('update', { id: this.data.edit.value.id, payload: { ...this.data.edit.value } });
    this.cancelEdit();
  },
  cancelEdit() { this.data.edit.value = { id: '', name: '', introduction: '', appearance: '' }; },
  startAiAssist(field) {
    const isAppearance = field.endsWith('-appearance');
    const text = isAppearance
      ? (field.startsWith('form') ? this.data.form.value.appearance : this.data.edit.value.appearance)
      : (field === 'form' ? this.data.form.value.introduction : this.data.edit.value.introduction);
    if (!text.trim()) return;
    this.data.aiAssist.value = { field, originalText: text, slider: this.data.aiAssist.value?.slider || 3, loading: false };
    this.generateAiAssist();
  },
  async generateAiAssist() {
    const assist = this.data.aiAssist.value;
    if (!assist || !assist.field) return;
    const field = assist.field;
    const detailLevel = assist.slider;
    const isAppearance = field === 'form-appearance' || field === 'edit-appearance';
    const profileName = field.startsWith('form') ? this.data.form.value.name : this.data.edit.value.name;
    const detailDescriptions = isAppearance
      ? {
          1: 'Write a very brief one-line physical description (10-15 words).',
          2: 'Write a short physical description (20-40 words).',
          3: 'Write a medium-length physical description (40-80 words).',
          4: 'Write a detailed physical description (80-150 words) covering face, body, hair, clothing style, distinguishing features.',
          5: 'Write an extensive, richly detailed physical description (150-250 words) covering face, body, hair, clothing style, posture, mannerisms, distinguishing features.'
        }
      : {
          1: 'Write a very brief one-line description (10-15 words).',
          2: 'Write a short description (20-40 words).',
          3: 'Write a medium-length description (40-80 words).',
          4: 'Write a detailed description (80-150 words).',
          5: 'Write an extensive, richly detailed description (150-250 words) with personality, interests, communication style, and background.'
        };
    const topicGuidance = isAppearance
      ? `Expand and enrich the following physical appearance description${profileName ? ' for "' + profileName + '"' : ''}. Focus on: physical traits, face, body, hair, clothing style, distinguishing features. Always start with the name. Do NOT include personality, background, or relationship traits.`
      : `Expand and enrich the following character description${profileName ? ' for "' + profileName + '"' : ''}. Focus on: personality, communication style, relationships, background. Do NOT include physical appearance details.`;
    const prompt = `${topicGuidance}

Detail level: ${detailLevel}/5 — ${detailDescriptions[detailLevel]}

Original description:
"""
${assist.originalText}
"""

Guidelines:
- Stay faithful to ALL details in the original description
- Always start with the character name
- Add depth relevant to the description type
- Output ONLY the description text, no meta-commentary, no quotes, no headers`;
    this.data.aiAssist.value = { ...assist, loading: true };
    try {
      const response = await api.generateText({ prompt, model: this.props.conversationModel || '' });
      const generatedText = response.text || '';
      if (field === 'form') {
        this.data.form.value = { ...this.data.form.value, introduction: generatedText };
      } else if (field === 'form-appearance') {
        this.data.form.value = { ...this.data.form.value, appearance: generatedText };
      } else if (field === 'edit') {
        this.data.edit.value = { ...this.data.edit.value, introduction: generatedText };
      } else if (field === 'edit-appearance') {
        this.data.edit.value = { ...this.data.edit.value, appearance: generatedText };
      }
    } catch (error) {
      console.error('AI assist failed:', error);
    } finally {
      this.data.aiAssist.value = { ...this.data.aiAssist.value, loading: false };
    }
  },
  undoAiAssist() {
    const assist = this.data.aiAssist.value;
    if (!assist || !assist.field) return;
    const field = assist.field;
    if (field === 'form') {
      this.data.form.value = { ...this.data.form.value, introduction: assist.originalText };
    } else if (field === 'form-appearance') {
      this.data.form.value = { ...this.data.form.value, appearance: assist.originalText };
    } else if (field === 'edit') {
      this.data.edit.value = { ...this.data.edit.value, introduction: assist.originalText };
    } else if (field === 'edit-appearance') {
      this.data.edit.value = { ...this.data.edit.value, appearance: assist.originalText };
    }
    this.data.aiAssist.value = { field: null, originalText: '', slider: 3, loading: false };
  },
  startCreate() {
    this.cancelEdit();
    this.data.form.value = { name: '', introduction: '', appearance: '' };
  },
  activate(profile) { this.emit('activate', profile); },
  remove(profile) { this.emit('delete', profile); }
};
