import { tick } from 'tinybubble';
import { api } from '../api/client.js';
import { voicesByLanguage, languageOptions } from '../shared/voices.js';
import CustomSelect from './CustomSelect.bub.js';
import Toggle from './Toggle.bub.js';

/**
 * @typedef {{ name: string, quality: string }} VoiceOption
 * @typedef {{ id?: string, name: string, language?: string, voice?: string, kokoro_voice?: string, speed?: string | number, introduction?: string, appearance?: string, selected_model?: string, thinking_mode?: string, is_narrator?: boolean }} Agent
 * @typedef {{ value: string, label: string }} SelectOption
 */

const speedOptions = ['1.0', '1.25', '1.5'];
const thinkingModeOptions = [
  { value: 'parent', label: 'Parent' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' }
];
const responseLengthOptions = [
  { value: '', label: 'Leave it to the model' },
  { value: 'ultra_short', label: 'Ultra short' },
  { value: 'concise', label: 'Concise' },
  { value: 'normal', label: 'Normal' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'long', label: 'Long' },
  { value: 'full_story', label: 'Full story' }
];

export default {
  name: 'AgentPanel',
  props: ['agents', 'models', 'kokoroVoices', 'disabled', 'conversationModel'],
  emits: ['create', 'update', 'delete', 'refresh-kokoro-voices'],
  components: {
    'custom-select': CustomSelect,
    'toggle': Toggle
  },
  template() {
    return /*html*/`
      <section class="side-panel">
        <div class="section-header">
          <h2>Active Agents</h2>
          <button type="button" @click="focusCreateForm" :disabled="disabled">+ Add</button>
        </div>

        <template x-for="agent in agents">
          <article class="agent-card" @click="selectForEdit(agent)">
            <div class="agent-card-left">
              <div class="agent-avatar">{{ agentInitial(agent.name) }}</div>
              <div class="agent-card-info">
                <h4>{{ agent.name }}</h4>
                <p>{{ agent.introduction ? truncateText(agent.introduction, 60) : (agent.voice || 'no voice') }}</p>
              </div>
            </div>
            <div class="agent-card-actions">
              <button type="button" @click.stop="selectForEdit(agent)" title="Edit">✎</button>
              <button type="button" @click.stop="copyAgentJson(agent)" title="Copy JSON">{{ copiedId === agent.id ? '✓' : '⧉' }}</button>
              <button type="button" @click.stop="duplicateAgent(agent)" title="Duplicate">⊞</button>
              <button type="button" class="danger-action" @click.stop="remove(agent)" title="Remove">✕</button>
            </div>
          </article>
        </template>

        <div x-if="!agents.length" class="empty-state">No agents yet.</div>

        <!-- Create form -->
        <form class="edit-form-styled" @submit-prevent="createAgent" x-if="createFormVisible">
          <h3><span class="material-symbols-outlined" style="font-size:18px;color:#d0bcff">edit_note</span> Create Agent</h3>

          <label class="form-label">Name
            <input x-model="form.name" placeholder="Name" :disabled="disabled">
          </label>

          <div x-if="($ttsEngine || 'piper') !== 'kokoro'" class="form-grid-2">
            <label class="form-label">Language (Piper)
              <custom-select :options="languageSelectOptions()" :value="form.language" :disabled="disabled" @change="onFormLanguageChange"></custom-select>
            </label>
            <label class="form-label">Voice (Piper)
              <custom-select :options="formVoiceSelectOptions()" :value="form.voice" :disabled="disabled" @change="form.voice = $event"></custom-select>
            </label>
          </div>

          <div x-if="($ttsEngine || 'piper') === 'kokoro'" class="form-grid-2">
            <label class="form-label">Kokoro language
              <custom-select :options="kokoroLanguageSelectOptions()" :value="formKokoroLanguage" :disabled="disabled" @change="onFormKokoroLanguageChange"></custom-select>
            </label>
            <label class="form-label">Kokoro voice
              <custom-select :options="kokoroVoiceSelectOptions(formKokoroLanguage)" placeholder="Use default Kokoro voice" :value="form.kokoro_voice" :disabled="disabled" @change="form.kokoro_voice = $event"></custom-select>
            </label>
          </div>

          <div x-if="kokoroVoiceNotInstalled(form.kokoro_voice)" class="button-row">
            <button type="button" @click="requestKokoroVoiceDownload(form.kokoro_voice)" :disabled="kokoroDownload.loading">{{ kokoroDownload.loading && kokoroDownload.voiceId === form.kokoro_voice ? 'Downloading…' : '⬇ Download voice' }}</button>
          </div>
          <p x-if="kokoroVoiceNotInstalled(form.kokoro_voice)" class="field-hint">This voice isn't installed on the server yet.</p>
          <p x-if="kokoroDownload.error && kokoroDownload.voiceId === form.kokoro_voice" class="error">{{ kokoroDownload.error }}</p>

          <label class="form-label">Speed
            <custom-select :options="speedSelectOptions()" :value="form.speed" :disabled="disabled" @change="form.speed = $event"></custom-select>
          </label>

          <div class="form-label" style="gap:0.35rem">
            <span style="font-size:0.75rem;color:#cbc3d7">Introduction</span>
            <div class="ai-textarea-wrap">
              <textarea x-model="form.introduction" placeholder="Introduction / description" :disabled="disabled || (aiAssist.field === 'form-intro' && aiAssist.loading)" rows="4"></textarea>
              <button type="button" class="ai-assist-btn" :disabled="disabled || !form.introduction.trim()" @click="startAiAssist('form-intro')" title="AI: expand description"><span class="material-symbols-outlined" style="font-size:18px">auto_awesome</span></button>
            </div>
          </div>
          <div x-if="aiAssist.field === 'form-intro'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <div class="form-label" style="gap:0.35rem">
            <span style="font-size:0.75rem;color:#cbc3d7">Appearance</span>
            <div class="ai-textarea-wrap">
              <textarea x-model="form.appearance" placeholder="Appearance: physical look, clothing, distinctive traits" :disabled="disabled || (aiAssist.field === 'form-appearance' && aiAssist.loading)" rows="3"></textarea>
              <button type="button" class="ai-assist-btn" :disabled="disabled || !form.appearance.trim()" @click="startAiAssist('form-appearance')" title="AI: expand appearance"><span class="material-symbols-outlined" style="font-size:18px">auto_awesome</span></button>
            </div>
          </div>
          <div x-if="aiAssist.field === 'form-appearance'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <!-- Single Expand button for both intro + appearance -->
          <div style="display:flex;gap:0.5rem">
            <button type="button" class="form-expand-btn" @click="openExpand('form-intro')"><span class="material-symbols-outlined" style="font-size:14px">open_in_full</span> Expand Introduction + Appearance</button>
          </div>

          <hr class="form-section-divider" style="margin:0.25rem 0">

          <div class="form-label" style="gap:0.35rem">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:0.75rem;color:#cbc3d7">Imagen Appearance</span>
            </div>
            <div class="ai-textarea-wrap">
              <textarea x-model="form.imagen_appearance" placeholder="Optional: specialized prompt for image generation (leave empty to use Appearance above)" :disabled="disabled" rows="2"></textarea>
            </div>
            <div class="ai-assist-llimi" style="margin-top:0.25rem">
              <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="imagenStyleDetail"> <span>{{ imagenStyleDetail }}/5</span></label>
              <button type="button" class="ai-assist-btn-sm" @click="generateImagenClassic('form')" :disabled="imagenLoading" title="Classic: structured appearance prompt"><span class="material-symbols-outlined" style="font-size:16px">theater_comedy</span></button>
              <button type="button" class="ai-assist-btn-sm" @click="generateImagenFlux('form')" :disabled="imagenLoading" title="Flux-like: Name: {description}"><span class="material-symbols-outlined" style="font-size:16px">bolt</span></button>
              <span x-if="imagenLoading" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">Generating…</span>
            </div>
          </div>

          <div class="form-grid-2">
            <label class="form-label">Model for this character
              <custom-select :options="modelSelectOptions()" placeholder="Use conversation/global model" :value="form.selected_model" :disabled="disabled" @change="form.selected_model = $event"></custom-select>
            </label>
            <label class="form-label">Thinking mode
              <custom-select :options="thinkingModeOptions" :value="form.thinking_mode" :disabled="disabled" @change="form.thinking_mode = $event"></custom-select>
            </label>
          </div>

          <label class="form-label">Response length
            <custom-select :options="responseLengthOptions" :value="form.response_length" :disabled="disabled" @change="form.response_length = $event"></custom-select>
          </label>

          <hr class="form-section-divider">

          <div class="form-toggle-row">
            <span>Narrator</span>
            <toggle :model-val="form.is_narrator" :disabled="disabled" @change="form.is_narrator = $event"></toggle>
          </div>

          <div class="form-toggle-row">
            <span>Generate audio</span>
            <toggle :model-val="form.audio_enabled" :disabled="disabled" @change="form.audio_enabled = $event"></toggle>
          </div>

          <div class="form-toggle-row">
            <span>Auto-select speaker</span>
            <toggle :model-val="form.auto_select" :disabled="disabled" @change="form.auto_select = $event"></toggle>
          </div>

          <hr class="form-section-divider">

          <fieldset class="form-tools-fieldset">
            <legend>Tools</legend>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="form.tools_imagen" @change="toggleTool('tools_imagen', $event)" :disabled="disabled"> 🖼 imagen</label>
              <span x-if="form.tools_imagen" class="required-tag" :class="form.tools_imagen === 'required' ? 'required-tag--on' : ''" @click="cycleTool('tools_imagen')">{{ form.tools_imagen === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="form.tools_narrate" @change="toggleTool('tools_narrate', $event)" :disabled="disabled"> 📖 narrate</label>
              <span x-if="form.tools_narrate" class="required-tag" :class="form.tools_narrate === 'required' ? 'required-tag--on' : ''" @click="cycleTool('tools_narrate')">{{ form.tools_narrate === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="form.tools_add_agent" @change="toggleTool('tools_add_agent', $event)" :disabled="disabled"> 👤 add_agent</label>
              <span x-if="form.tools_add_agent" class="required-tag" :class="form.tools_add_agent === 'required' ? 'required-tag--on' : ''" @click="cycleTool('tools_add_agent')">{{ form.tools_add_agent === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="form.tools_append_to_my_intro" @change="toggleTool('tools_append_to_my_intro', $event)" :disabled="disabled"> 📝 append_to_my_intro</label>
              <span x-if="form.tools_append_to_my_intro" class="required-tag" :class="form.tools_append_to_my_intro === 'required' ? 'required-tag--on' : ''" @click="cycleTool('tools_append_to_my_intro')">{{ form.tools_append_to_my_intro === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="form.tools_append_to_intro" @change="toggleTool('tools_append_to_intro', $event)" :disabled="disabled"> 🗒️ append_to_intro</label>
              <span x-if="form.tools_append_to_intro" class="required-tag" :class="form.tools_append_to_intro === 'required' ? 'required-tag--on' : ''" @click="cycleTool('tools_append_to_intro')">{{ form.tools_append_to_intro === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="form.tools_dice_roll" @change="toggleTool('tools_dice_roll', $event)" :disabled="disabled"> 🎲 request_dice_roll</label>
              <span x-if="form.tools_dice_roll" class="required-tag" :class="form.tools_dice_roll === 'required' ? 'required-tag--on' : ''" @click="cycleTool('tools_dice_roll')">{{ form.tools_dice_roll === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
          </fieldset>

          <div class="form-actions">
            <button type="submit" :disabled="disabled || !form.name.trim()">Add character /achar</button>
          </div>
        </form>

        <!-- Edit form -->
        <form x-if="edit.id" class="edit-form-styled" @submit-prevent="saveEdit">
          <h3><span class="material-symbols-outlined" style="font-size:18px;color:#d0bcff">edit_note</span> Edit {{ edit.name }}</h3>

          <label class="form-label">Name
            <input x-model="edit.name" placeholder="Name">
          </label>

          <div x-if="($ttsEngine || 'piper') !== 'kokoro'" class="form-grid-2">
            <label class="form-label">Language (Piper)
              <custom-select :options="languageSelectOptions()" :value="edit.language" @change="onEditLanguageChange"></custom-select>
            </label>
            <label class="form-label">Voice (Piper)
              <custom-select :options="editVoiceSelectOptions()" :value="edit.voice" @change="edit.voice = $event"></custom-select>
            </label>
          </div>

          <div x-if="($ttsEngine || 'piper') === 'kokoro'" class="form-grid-2">
            <label class="form-label">Kokoro language
              <custom-select :options="kokoroLanguageSelectOptions()" :value="editKokoroLanguage" @change="onEditKokoroLanguageChange"></custom-select>
            </label>
            <label class="form-label">Kokoro voice
              <custom-select :options="kokoroVoiceSelectOptions(editKokoroLanguage)" placeholder="Use default Kokoro voice" :value="edit.kokoro_voice" @change="edit.kokoro_voice = $event"></custom-select>
            </label>
          </div>

          <div x-if="kokoroVoiceNotInstalled(edit.kokoro_voice)" class="button-row">
            <button type="button" @click="requestKokoroVoiceDownload(edit.kokoro_voice)" :disabled="kokoroDownload.loading">{{ kokoroDownload.loading && kokoroDownload.voiceId === edit.kokoro_voice ? 'Downloading…' : '⬇ Download voice' }}</button>
          </div>
          <p x-if="kokoroVoiceNotInstalled(edit.kokoro_voice)" class="field-hint">This voice isn't installed on the server yet.</p>
          <p x-if="kokoroDownload.error && kokoroDownload.voiceId === edit.kokoro_voice" class="error">{{ kokoroDownload.error }}</p>

          <label class="form-label">Speed
            <custom-select :options="speedSelectOptions()" :value="edit.speed" @change="edit.speed = $event"></custom-select>
          </label>

          <div class="form-label" style="gap:0.35rem">
            <span style="font-size:0.75rem;color:#cbc3d7">Introduction</span>
            <div class="ai-textarea-wrap">
              <textarea x-model="edit.introduction" placeholder="Introduction" :disabled="disabled || (aiAssist.field === 'edit-intro' && aiAssist.loading)" rows="4"></textarea>
              <button type="button" class="ai-assist-btn" :disabled="disabled || !edit.introduction.trim()" @click="startAiAssist('edit-intro')" title="AI: expand description"><span class="material-symbols-outlined" style="font-size:18px">auto_awesome</span></button>
            </div>
          </div>
          <div x-if="aiAssist.field === 'edit-intro'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <div class="form-label" style="gap:0.35rem">
            <span style="font-size:0.75rem;color:#cbc3d7">Appearance</span>
            <div class="ai-textarea-wrap">
              <textarea x-model="edit.appearance" placeholder="Appearance: physical look, clothing, distinctive traits" :disabled="disabled || (aiAssist.field === 'edit-appearance' && aiAssist.loading)" rows="3"></textarea>
              <button type="button" class="ai-assist-btn" :disabled="disabled || !edit.appearance.trim()" @click="startAiAssist('edit-appearance')" title="AI: expand appearance"><span class="material-symbols-outlined" style="font-size:18px">auto_awesome</span></button>
            </div>
          </div>
          <div x-if="aiAssist.field === 'edit-appearance'" class="ai-assist-llimi">
            <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
            <button type="button" class="ai-assist-btn-sm" @click="generateAiAssist" :disabled="aiAssist.loading"><span class="material-symbols-outlined">refresh</span></button>
            <button type="button" class="ai-assist-undo" @click="undoAiAssist"><span class="material-symbols-outlined">undo</span> Undo</button>
            <span x-if="aiAssist.loading" class="ai-assist-loading">Generating…</span>
          </div>

          <!-- Single Expand button for both intro + appearance -->
          <div style="display:flex;gap:0.5rem">
            <button type="button" class="form-expand-btn" @click="openExpand('edit-intro')"><span class="material-symbols-outlined" style="font-size:14px">open_in_full</span> Expand Introduction + Appearance</button>
          </div>

          <hr class="form-section-divider" style="margin:0.25rem 0">

          <div class="form-label" style="gap:0.35rem">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-size:0.75rem;color:#cbc3d7">Imagen Appearance</span>
            </div>
            <div class="ai-textarea-wrap">
              <textarea x-model="edit.imagen_appearance" placeholder="Optional: specialized prompt for image generation (leave empty to use Appearance above)" :disabled="disabled" rows="2"></textarea>
            </div>
            <div class="ai-assist-llimi" style="margin-top:0.25rem">
              <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="imagenStyleDetail"> <span>{{ imagenStyleDetail }}/5</span></label>
              <button type="button" class="ai-assist-btn-sm" @click="generateImagenClassic('edit')" :disabled="imagenLoading" title="Classic: structured appearance prompt"><span class="material-symbols-outlined" style="font-size:16px">theater_comedy</span></button>
              <button type="button" class="ai-assist-btn-sm" @click="generateImagenFlux('edit')" :disabled="imagenLoading" title="Flux-like: Name: {description}"><span class="material-symbols-outlined" style="font-size:16px">bolt</span></button>
              <span x-if="imagenLoading" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">Generating…</span>
            </div>
          </div>

          <div class="form-grid-2">
            <label class="form-label">Model for this character
              <custom-select :options="modelSelectOptions()" placeholder="Use conversation/global model" :value="edit.selected_model" @change="edit.selected_model = $event"></custom-select>
            </label>
            <label class="form-label">Thinking mode
              <custom-select :options="thinkingModeOptions" :value="edit.thinking_mode" @change="edit.thinking_mode = $event"></custom-select>
            </label>
          </div>

          <label class="form-label">Response length
            <custom-select :options="responseLengthOptions" :value="edit.response_length" @change="edit.response_length = $event"></custom-select>
          </label>

          <hr class="form-section-divider">

          <div class="form-toggle-row">
            <span>Narrator</span>
            <toggle :model-val="edit.is_narrator" @change="edit.is_narrator = $event"></toggle>
          </div>
          <div class="form-toggle-row">
            <span>Generate audio</span>
            <toggle :model-val="edit.audio_enabled" @change="edit.audio_enabled = $event"></toggle>
          </div>
          <div class="form-toggle-row">
            <span>Auto-select speaker</span>
            <toggle :model-val="edit.auto_select" @change="edit.auto_select = $event"></toggle>
          </div>

          <hr class="form-section-divider">

          <fieldset class="form-tools-fieldset">
            <legend>Tools</legend>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="edit.tools_imagen" @change="toggleEditTool('tools_imagen', $event)"> 🖼 imagen</label>
              <span x-if="edit.tools_imagen" class="required-tag" :class="edit.tools_imagen === 'required' ? 'required-tag--on' : ''" @click="cycleEditTool('tools_imagen')">{{ edit.tools_imagen === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="edit.tools_narrate" @change="toggleEditTool('tools_narrate', $event)"> 📖 narrate</label>
              <span x-if="edit.tools_narrate" class="required-tag" :class="edit.tools_narrate === 'required' ? 'required-tag--on' : ''" @click="cycleEditTool('tools_narrate')">{{ edit.tools_narrate === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="edit.tools_add_agent" @change="toggleEditTool('tools_add_agent', $event)"> 👤 add_agent</label>
              <span x-if="edit.tools_add_agent" class="required-tag" :class="edit.tools_add_agent === 'required' ? 'required-tag--on' : ''" @click="cycleEditTool('tools_add_agent')">{{ edit.tools_add_agent === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="edit.tools_append_to_my_intro" @change="toggleEditTool('tools_append_to_my_intro', $event)"> 📝 append_to_my_intro</label>
              <span x-if="edit.tools_append_to_my_intro" class="required-tag" :class="edit.tools_append_to_my_intro === 'required' ? 'required-tag--on' : ''" @click="cycleEditTool('tools_append_to_my_intro')">{{ edit.tools_append_to_my_intro === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="edit.tools_append_to_intro" @change="toggleEditTool('tools_append_to_intro', $event)"> 🗒️ append_to_intro</label>
              <span x-if="edit.tools_append_to_intro" class="required-tag" :class="edit.tools_append_to_intro === 'required' ? 'required-tag--on' : ''" @click="cycleEditTool('tools_append_to_intro')">{{ edit.tools_append_to_intro === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
            <div class="tool-row">
              <label class="checkbox"><input type="checkbox" :checked="edit.tools_dice_roll" @change="toggleEditTool('tools_dice_roll', $event)"> 🎲 request_dice_roll</label>
              <span x-if="edit.tools_dice_roll" class="required-tag" :class="edit.tools_dice_roll === 'required' ? 'required-tag--on' : ''" @click="cycleEditTool('tools_dice_roll')">{{ edit.tools_dice_roll === 'required' ? '⚠ required' : 'optional' }}</span>
            </div>
          </fieldset>

          <div class="form-actions">
            <button type="submit">Save agent</button>
            <button type="button" @click="cancelEdit">Cancel</button>
          </div>
        </form>

        <details class="form-tools-fieldset" style="padding:0.75rem">
          <summary style="cursor:pointer;font-size:0.75rem;color:#cbc3d7">Paste agent from JSON</summary>
          <div class="stack" style="margin-top:0.5rem">
            <textarea x-model="pasteJson" placeholder='{"name":"...","language":"en_GB",...}' rows="4"></textarea>
            <button type="button" @click="pasteAgent" :disabled="disabled || !pasteJson.trim()">Create from JSON</button>
          </div>
        </details>

        <!-- Expand modal (unified: introduction + appearance) -->
        <div x-if="expandModal" class="modal-overlay">
          <div class="modal-backdrop" @click="cancelExpand"></div>
          <div class="modal-card" style="max-width:36rem">
            <div class="modal-header">
              <h3>{{ expandTitle() }}</h3>
              <button type="button" class="modal-close" @click="cancelExpand">✕</button>
            </div>
            <div class="modal-body" style="display:grid;gap:1rem">
              <!-- Introduction -->
              <div class="form-label" style="gap:0.3rem">
                <span style="font-size:0.75rem;color:var(--text-tertiary)">Introduction</span>
                <textarea ref="expandIntroTextarea" x-model="expandIntro" placeholder="Character introduction…" rows="4" style="resize:vertical;width:100%;box-sizing:border-box"></textarea>
                <div class="ai-assist-llimi">
                  <button type="button" class="ai-assist-btn-sm" @click="generateField('expand-intro')" :disabled="modalAssist.loading || !expandIntro.trim()" title="Expand/rewrite"><span class="material-symbols-outlined" style="font-size:16px">auto_awesome</span></button>
                  <button type="button" class="ai-assist-btn-sm" @click="continueField('expand-intro')" :disabled="modalAssist.loading || !expandIntro.trim()" title="Continue writing"><span class="material-symbols-outlined" style="font-size:16px">play_arrow</span></button>
                  <span class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></span>
                  <span x-if="modalAssist.loading && modalAssist.mode === 'generate-intro'" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">Generating…</span>
                  <span x-if="modalAssist.loading && modalAssist.mode === 'continue-intro'" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">Continuing…</span>
                </div>
              </div>
              <!-- Appearance -->
              <div class="form-label" style="gap:0.3rem">
                <span style="font-size:0.75rem;color:var(--text-tertiary)">Appearance</span>
                <textarea ref="expandAppearanceTextarea" x-model="expandAppearance" placeholder="Physical appearance…" rows="4" style="resize:vertical;width:100%;box-sizing:border-box"></textarea>
                <div class="ai-assist-llimi">
                  <button type="button" class="ai-assist-btn-sm" @click="generateField('expand-appearance')" :disabled="modalAssist.loading || !expandAppearance.trim()" title="Expand/rewrite"><span class="material-symbols-outlined" style="font-size:16px">auto_awesome</span></button>
                  <button type="button" class="ai-assist-btn-sm" @click="continueField('expand-appearance')" :disabled="modalAssist.loading || !expandAppearance.trim()" title="Continue writing"><span class="material-symbols-outlined" style="font-size:16px">play_arrow</span></button>
                  <span class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssistSliderAppearance"> <span>{{ aiAssistSliderAppearance }}/5</span></span>
                  <span x-if="modalAssist.loading && modalAssist.mode === 'generate-appearance'" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">Generating…</span>
                  <span x-if="modalAssist.loading && modalAssist.mode === 'continue-appearance'" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">Continuing…</span>
                </div>
              </div>
              <!-- Imagen Appearance -->
              <div class="form-label" style="gap:0.3rem">
                <div style="display:flex;align-items:center;justify-content:space-between">
                  <span style="font-size:0.75rem;color:var(--text-tertiary)">Imagen Appearance</span>
                </div>
                <textarea ref="expandImagenTextarea" x-model="expandImagenAppearance" placeholder="Specialized prompt for image generation…" rows="3" style="resize:vertical;width:100%;box-sizing:border-box"></textarea>
                <div class="ai-assist-llimi">
                  <select x-model="expandImagenMode" style="font-size:0.75rem;padding:0.25rem 0.4rem;border-radius:6px;background:var(--bg-tertiary);color:var(--text-primary);border:1px solid var(--border-soft)">
                    <option value="classic">Classic</option>
                    <option value="flux">Flux-like</option>
                  </select>
                  <button type="button" class="ai-assist-btn-sm" @click="generateField('expand-imagen')" :disabled="modalAssist.loading || !(expandAppearance + expandImagenAppearance).trim()" title="Generate imagen prompt"><span class="material-symbols-outlined" style="font-size:16px">auto_awesome</span></button>
                  <span x-if="modalAssist.loading && modalAssist.mode === 'generate-imagen'" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">Generating…</span>
                </div>
              </div>
              <!-- Shared controls -->
              <div class="ai-assist-llimi">
                <label class="ai-assist-slider">Detail <input type="range" min="1" max="5" step="1" x-model="aiAssist.slider"> <span>{{ aiAssist.slider }}/5</span></label>
                <button type="button" class="ai-assist-btn-sm" @click="continueModalText" :disabled="modalAssist.loading || !(expandIntro + expandAppearance).trim()" title="Continue writing"><span class="material-symbols-outlined">arrow_forward</span></button>
                <span x-if="modalAssist.loading" class="ai-assist-loading" style="font-size:0.8rem;color:var(--text-tertiary)">{{ modalAssist.mode === 'continue' ? 'Continuing…' : 'Generating…' }}</span>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" @click="cancelExpand">Cancel</button>
              <button type="button" class="modal-save" @click="saveExpand">Save Changes</button>
            </div>
          </div>
        </div>
      </section>
    `;
  },
  data() {
    return {
      thinkingModeOptions,
      responseLengthOptions,
      form: this.emptyAgentForm(),
      edit: this.emptyEditForm(),
      pasteJson: '',
      copiedId: '',
      createFormVisible: false,
      aiAssist: { field: null, originalText: '', slider: 3, loading: false },
      expandModal: false,
      expandTarget: '',
      expandIntro: '',
      expandAppearance: '',
      expandImagenAppearance: '',
      expandImagenMode: 'classic',
      aiAssistSliderAppearance: 3,
      formKokoroLanguage: 'English (US)',
      editKokoroLanguage: 'English (US)',
      kokoroDownload: { voiceId: '', loading: false, error: '' },
      modalAssist: { loading: false, mode: '' },
      imagenLoading: false,
      imagenStyleDetail: 3
    };
  },
  init() {
    this.data.formKokoroLanguage.value = this.kokoroLanguageForVoice(this.data.form.value.kokoro_voice);
  },
  /** @returns {Agent} */
  emptyAgentForm() {
    return {
      name: '',
      language: 'en_GB',
      voice: 'en_GB-alan-medium',
      kokoro_voice: '',
      speed: '1.0',
      introduction: '',
      appearance: '',
      imagen_appearance: '',
      selected_model: '',
      thinking_mode: 'parent',
      response_length: 'concise',
      is_narrator: false,
      tools_imagen: true,
      tools_narrate: false,
      tools_add_agent: false,
      tools_append_to_my_intro: false,
      tools_append_to_intro: false,
      tools_dice_roll: false,
      audio_enabled: true,
      auto_select: true
    };
  },
  /** @returns {Agent} */
  emptyEditForm() {
    return {
      id: '',
      name: '',
      language: 'en_GB',
      voice: 'en_GB-alan-medium',
      kokoro_voice: '',
      speed: '1.0',
      introduction: '',
      appearance: '',
      imagen_appearance: '',
      selected_model: '',
      thinking_mode: 'parent',
      response_length: 'concise',
      is_narrator: false,
      tools_imagen: true,
      tools_narrate: false,
      tools_add_agent: false,
      tools_append_to_my_intro: false,
      tools_append_to_intro: false,
      tools_dice_roll: false,
      audio_enabled: true,
      auto_select: true
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
  /** @returns {VoiceOption[]} */
  formVoiceOptions() {
    return voicesByLanguage[this.data.form.value.language] || [];
  },
  /** @returns {VoiceOption[]} */
  editVoiceOptions() {
    return voicesByLanguage[this.data.edit.value.language] || [];
  },
  /** @param {string} language @param {VoiceOption} voice */
  voiceValue(language, voice) {
    return `${language}-${voice.name}-${voice.quality}`;
  },
  /** @param {VoiceOption} voice */
  voiceLabel(voice) {
    return `${voice.name} (${voice.quality})`;
  },
  setDefaultFormVoice() {
    const voices = this.formVoiceOptions();
    const voice = voices[0];
    this.data.form.value.voice = voice ? this.voiceValue(this.data.form.value.language, voice) : '';
  },
  setDefaultEditVoice() {
    const voices = this.editVoiceOptions();
    const voice = voices[0];
    this.data.edit.value.voice = voice ? this.voiceValue(this.data.edit.value.language, voice) : '';
  },
  /** @returns {SelectOption[]} */
  languageSelectOptions() {
    return languageOptions.map((language) => ({ value: language, label: language }));
  },
  /** @returns {SelectOption[]} */
  speedSelectOptions() {
    return speedOptions.map((speed) => ({ value: speed, label: speed }));
  },
  /** @returns {SelectOption[]} */
  formVoiceSelectOptions() {
    const language = this.data.form.value.language;
    return this.formVoiceOptions().map((voice) => ({ value: this.voiceValue(language, voice), label: this.voiceLabel(voice) }));
  },
  /** @returns {SelectOption[]} */
  editVoiceSelectOptions() {
    const language = this.data.edit.value.language;
    return this.editVoiceOptions().map((voice) => ({ value: this.voiceValue(language, voice), label: this.voiceLabel(voice) }));
  },
  /** @param {string} voiceId @returns {string} */
  kokoroLanguageForVoice(voiceId) {
    const voices = this.props.kokoroVoices || [];
    const match = voices.find((v) => v.id === voiceId);
    if (match) return match.language;
    return voices[0] ? voices[0].language : 'English (US)';
  },
  /** @returns {SelectOption[]} */
  kokoroLanguageSelectOptions() {
    const seen = new Set();
    const languages = [];
    for (const voice of (this.props.kokoroVoices || [])) {
      if (!seen.has(voice.language)) { seen.add(voice.language); languages.push(voice.language); }
    }
    return languages.map((language) => ({ value: language, label: language }));
  },
  /** @param {string} language @returns {SelectOption[]} */
  kokoroVoiceSelectOptions(language) {
    return (this.props.kokoroVoices || [])
      .filter((voice) => voice.language === language)
      .map((voice) => ({ value: voice.id, label: voice.installed ? voice.label : `${voice.label} ⬇` }));
  },
  /** @param {string} voiceId @returns {boolean} */
  kokoroVoiceNotInstalled(voiceId) {
    if (!voiceId) return false;
    const voice = (this.props.kokoroVoices || []).find((v) => v.id === voiceId);
    return !!voice && voice.installed === false;
  },
  /** @returns {SelectOption[]} */
  modelSelectOptions() {
    return (this.props.models || []).map((model) => ({ value: model.name || model.model, label: model.name || model.model }));
  },
  /** @param {string} value */
  onFormLanguageChange(value) {
    this.data.form.value.language = value;
    this.setDefaultFormVoice();
  },
  /** @param {string} value */
  onEditLanguageChange(value) {
    this.data.edit.value.language = value;
    this.setDefaultEditVoice();
  },
  /** @param {string} value */
  onFormKokoroLanguageChange(value) {
    this.data.formKokoroLanguage.value = value;
    this.setDefaultFormKokoroVoice();
  },
  /** @param {string} value */
  onEditKokoroLanguageChange(value) {
    this.data.editKokoroLanguage.value = value;
    this.setDefaultEditKokoroVoice();
  },
  setDefaultFormKokoroVoice() {
    const voices = this.kokoroVoiceSelectOptions(this.data.formKokoroLanguage.value);
    this.data.form.value.kokoro_voice = voices[0] ? voices[0].value : '';
  },
  setDefaultEditKokoroVoice() {
    const voices = this.kokoroVoiceSelectOptions(this.data.editKokoroLanguage.value);
    this.data.edit.value.kokoro_voice = voices[0] ? voices[0].value : '';
  },
  focusCreateForm() {
    this.cancelEdit();
    this.data.createFormVisible.value = true;
    this.data.form.value = this.emptyAgentForm();
    this.data.formKokoroLanguage.value = 'English (US)';
  },
  /** @param {string} voiceId */
  async requestKokoroVoiceDownload(voiceId) {
    this.data.kokoroDownload.value = { voiceId, loading: true, error: '' };
    try {
      await api.downloadKokoroVoice(voiceId);
      this.data.kokoroDownload.value = { voiceId: '', loading: false, error: '' };
      this.emit('refresh-kokoro-voices');
    } catch (error) {
      this.data.kokoroDownload.value = { voiceId, loading: false, error: error.message || 'Download failed' };
    }
  },
  createAgent() {
    const f = this.data.form.value;
    const payload = { ...f, tools: { imagen: toolsValue(f.tools_imagen), narrate: toolsValue(f.tools_narrate), add_agent: toolsValue(f.tools_add_agent), append_to_my_intro: toolsValue(f.tools_append_to_my_intro), append_to_intro: toolsValue(f.tools_append_to_intro), request_dice_roll: toolsValue(f.tools_dice_roll) }, audio_enabled: f.audio_enabled, auto_select: f.auto_select, response_length: f.response_length || null };
    this.emit('create', payload);
    this.data.createFormVisible.value = false;
    this.data.form.value = this.emptyAgentForm();
  },
  toggleTool(key, event) {
    const checked = event.target.checked;
    this.data.form.value = { ...this.data.form.value, [key]: checked };
  },
  cycleTool(key) {
    const current = this.data.form.value[key];
    this.data.form.value = { ...this.data.form.value, [key]: current === 'required' ? true : 'required' };
  },
  toggleEditTool(key, event) {
    const checked = event.target.checked;
    this.data.edit.value = { ...this.data.edit.value, [key]: checked };
  },
  cycleEditTool(key) {
    const current = this.data.edit.value[key];
    this.data.edit.value = { ...this.data.edit.value, [key]: current === 'required' ? true : 'required' };
  },
  /** @param {Agent} agent */
  selectForEdit(agent) {
    this.data.createFormVisible.value = false;
    this.data.edit.value = {
      ...this.emptyEditForm(),
      id: agent.id,
      name: agent.name,
      language: agent.language,
      voice: agent.voice,
      kokoro_voice: agent.kokoro_voice || '',
      speed: String(agent.speed || '1.0'),
      introduction: agent.introduction,
      appearance: agent.appearance || '',
      imagen_appearance: agent.imagen_appearance || '',
      selected_model: agent.selected_model,
      thinking_mode: agent.thinking_mode,
      response_length: agent.response_length || '',
      is_narrator: agent.is_narrator,
      tools_imagen: agent.tools ? agent.tools.imagen || false : true,
      tools_narrate: agent.tools ? agent.tools.narrate || false : false,
      tools_add_agent: agent.tools ? agent.tools.add_agent || false : false,
      tools_append_to_my_intro: agent.tools ? agent.tools.append_to_my_intro || false : false,
      tools_append_to_intro: agent.tools ? agent.tools.append_to_intro || false : false,
      tools_dice_roll: agent.tools ? agent.tools.request_dice_roll || false : false,
      audio_enabled: agent.audio_enabled !== false,
      auto_select: agent.auto_select !== false
    };
    this.data.editKokoroLanguage.value = this.kokoroLanguageForVoice(agent.kokoro_voice || '');
  },
  saveEdit() {
    const e = this.data.edit.value;
    this.emit('update', { id: e.id, payload: { ...e, tools: { imagen: toolsValue(e.tools_imagen), narrate: toolsValue(e.tools_narrate), add_agent: toolsValue(e.tools_add_agent), append_to_my_intro: toolsValue(e.tools_append_to_my_intro), append_to_intro: toolsValue(e.tools_append_to_intro), request_dice_roll: toolsValue(e.tools_dice_roll) }, audio_enabled: e.audio_enabled, auto_select: e.auto_select, response_length: e.response_length || null } });
    this.cancelEdit();
  },
  cancelEdit() {
    this.data.createFormVisible.value = false;
    this.data.edit.value = this.emptyEditForm();
  },
  /** @param {Agent} agent @param {Event} event */
  toggleNarrator(agent, event) {
    this.emit('update', { id: agent.id, payload: { is_narrator: event.target.checked } });
  },
  /** @param {Agent} agent */
  agentToolEnabled(agent, tool) {
    return agent.tools ? !!agent.tools[tool] : tool === 'imagen';
  },
  /** @param {Agent} agent */
  agentToolRequired(agent, tool) {
    return agent.tools && agent.tools[tool] === 'required';
  },
  /** @param {Agent} agent */
  remove(agent) {
    this.emit('delete', agent);
  },
  /** @param {Agent} agent */
  copyAgentJson(agent) {
    const json = JSON.stringify({
      name: agent.name,
      language: agent.language || 'en_GB',
      voice: agent.voice || '',
      kokoro_voice: agent.kokoro_voice || '',
      speed: Number(agent.speed || 1),
      introduction: agent.introduction || '',
      appearance: agent.appearance || '',
      imagen_appearance: agent.imagen_appearance || '',
      selected_model: agent.selected_model || '',
      thinking_mode: agent.thinking_mode || 'parent',
      response_length: agent.response_length || null,
      is_narrator: !!agent.is_narrator,
      tools: agent.tools || { imagen: true, narrate: false },
      audio_enabled: agent.audio_enabled !== false,
      auto_select: agent.auto_select !== false
    }, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      this.data.copiedId.value = agent.id;
      setTimeout(() => { this.data.copiedId.value = ''; }, 1500);
    }).catch(() => {});
  },
  /** @param {Agent} agent */
  duplicateAgent(agent) {
    this.emit('create', {
      name: agent.name + ' (copy)',
      language: agent.language || 'en_GB',
      voice: agent.voice || '',
      kokoro_voice: agent.kokoro_voice || '',
      speed: Number(agent.speed || 1),
      introduction: agent.introduction || '',
      appearance: agent.appearance || '',
      imagen_appearance: agent.imagen_appearance || '',
      selected_model: agent.selected_model || '',
      thinking_mode: agent.thinking_mode || 'parent',
      response_length: agent.response_length || null,
      is_narrator: !!agent.is_narrator,
      tools: agent.tools || { imagen: true, narrate: false },
      audio_enabled: agent.audio_enabled !== false,
      auto_select: agent.auto_select !== false
    });
  },
  pasteAgent() {
    let parsed;
    try {
      parsed = JSON.parse(this.data.pasteJson.value);
    } catch {
      return;
    }
    if (!parsed.name || typeof parsed.name !== 'string') return;
    this.emit('create', parsed);
    this.data.pasteJson.value = '';
  },
  _aiAssistFieldRef(field) {
    const isForm = field.startsWith('form');
    const prop = field.endsWith('appearance') ? 'appearance' : 'introduction';
    const formOrEdit = isForm ? this.data.form.value : this.data.edit.value;
    return { formOrEdit, prop, agentName: formOrEdit.name, language: formOrEdit.language };
  },
  startAiAssist(field) {
    const { formOrEdit, prop } = this._aiAssistFieldRef(field);
    const text = formOrEdit[prop];
    if (!text.trim()) return;
    this.data.aiAssist.value = { field, originalText: text, slider: this.data.aiAssist.value?.slider || 3, loading: false };
    this.generateAiAssist();
  },
  /** @param {boolean} isAppearance @returns {Record<number,string>} */
  _expandDetailDescriptions(isAppearance) {
    return isAppearance
      ? {
          1: 'Write a very brief one-line physical description (10-15 words).',
          2: 'Write a short physical description (20-40 words).',
          3: 'Write a medium-length appearance description (40-80 words).',
          4: 'Write a detailed appearance description (80-150 words).',
          5: 'Write an extensive, vivid physical description (150-250 words) covering face, body, clothing, posture, distinctive features, grooming, and any accessories.'
        }
      : {
          1: 'Write a very brief one-line description (10-15 words).',
          2: 'Write a short description (20-40 words).',
          3: 'Write a medium-length description (40-80 words).',
          4: 'Write a detailed description (80-150 words).',
          5: 'Write an extensive, richly detailed description (150-250 words) with personality traits, background, mannerisms, and speech patterns.'
        };
  },
  /** @param {boolean} isAppearance @param {number} detailLevel @returns {string} */
  _expandFocusExtra(isAppearance, detailLevel) {
    return isAppearance
      ? [
          detailLevel >= 3 ? '- Include: height, build, face, hair, eyes, skin tone, and clothing' : '',
          detailLevel >= 4 ? '- Include: posture, gait, voice quality, distinctive marks or scars, grooming style, accessories' : '',
          detailLevel >= 5 ? '- Include: micro-expressions, how their mood shows on their face, how others perceive them at first glance' : ''
        ].filter(Boolean).join('\n')
      : [
          detailLevel >= 3 ? '- Include: personality traits, speech style, key background elements' : '',
          detailLevel >= 4 ? '- Include: physical appearance, personality, background, speech patterns, loves, hates, quirks' : ''
        ].filter(Boolean).join('\n');
  },
  /** @param {string} originalText @param {string} field @param {number} detailLevel @returns {string} */
  buildExpandPrompt(originalText, field, detailLevel) {
    const { agentName, language } = this._aiAssistFieldRef(field);
    const isAppearance = field.endsWith('appearance');
    const detailDescriptions = this._expandDetailDescriptions(isAppearance);
    const subject = isAppearance
      ? `physical appearance description for "${agentName}" (language: ${language}) in third person (ex. Name is...)`
      : `character description for "${agentName}" (language: ${language}) in second person (ex. you are...), covering personality, background, and mannerisms always start with You are {agentName}...`;
    const focusExtra = this._expandFocusExtra(isAppearance, detailLevel);
    return `Expand and enrich the following ${isAppearance ? 'appearance' : 'character description'} ${subject}.

Detail level: ${detailLevel}/5 — ${detailDescriptions[detailLevel]}

Original text:
"""
${originalText}
"""
The result must be in ENGLISH only
Guidelines:
- Stay faithful to ALL details in the original text
- Write in ${language || 'English'}
- Output ONLY the description text, no meta-commentary, no quotes, no headers${focusExtra ? '\n' + focusExtra : ''}`;
  },
  /** @param {string} fullText @param {string} selectedText @param {string} field @param {number} detailLevel @returns {string} */
  buildExpandSelectionPrompt(fullText, selectedText, field, detailLevel) {
    const { agentName, language } = this._aiAssistFieldRef(field);
    const isAppearance = field.endsWith('appearance');
    const detailDescriptions = this._expandDetailDescriptions(isAppearance);
    const focusExtra = this._expandFocusExtra(isAppearance, detailLevel);
    const subject = isAppearance
      ? `physical appearance description for "${agentName}" (language: ${language})`
      : `character description for "${agentName}" (language: ${language})`;
    return `You are editing part of the following ${subject}.

Full text (for context only):
"""
${fullText}
"""

Rewrite and expand ONLY this selected portion of that text:
"""
${selectedText}
"""

Detail level: ${detailLevel}/5 — ${detailDescriptions[detailLevel]}

Guidelines:
- Stay faithful to ALL details in the selected portion
- Stay consistent with the rest of the full text (facts, tone, style)
- Write in ${language || 'English'}
- Output ONLY the replacement text for the selected portion — it will directly replace the selected text${focusExtra ? '\n' + focusExtra : ''}`;
  },
  /** @param {string} textBefore @param {string} textAfter @param {string} field @param {number} detailLevel @returns {string} */
  buildContinuePrompt(textBefore, textAfter, field, detailLevel) {
    const { agentName, language } = this._aiAssistFieldRef(field);
    const isAppearance = field.endsWith('appearance');
    const lengthDescriptions = {
      1: 'a very short continuation (10-15 words)',
      2: 'a short continuation (20-40 words)',
      3: 'a medium-length continuation (40-80 words)',
      4: 'a detailed continuation (80-150 words)',
      5: 'an extensive continuation (150-250 words)'
    };
    const subject = isAppearance
      ? `physical appearance description for "${agentName}" (language: ${language})`
      : `character description for "${agentName}" (language: ${language})`;
    if (!textAfter.trim()) {
      return `Continue the following ${subject}, picking up exactly where it leaves off.

Write ${lengthDescriptions[detailLevel]}, matching the existing tone, style and perspective.

Existing text:
"""
${textBefore}
"""
The result must be in ENGLISH only
Guidelines:
- Write in ${language || 'English'}
- Output ONLY the continuation text, no meta-commentary, no quotes, no headers
- Do not repeat or rephrase any part of the existing text`;
    }
    return `You are filling a gap in the following ${subject}.

Text before the gap:
"""
${textBefore}
"""

Text after the gap:
"""
${textAfter}
"""

Write ${lengthDescriptions[detailLevel]} that fits naturally in the gap, continuing from "Text before the gap" and leading smoothly into "Text after the gap".
The result must be in ENGLISH only
Guidelines:
- Write in ${language || 'English'}
- Output ONLY the text that fills the gap, no meta-commentary, no quotes, no headers
- Do not repeat any part of "Text before the gap" or "Text after the gap"`;
  },
  async generateAiAssist() {
    const assist = this.data.aiAssist.value;
    if (!assist || !assist.field) return;
    const { formOrEdit, prop } = this._aiAssistFieldRef(assist.field);
    const prompt = this.buildExpandPrompt(assist.originalText, assist.field, assist.slider);
    this.data.aiAssist.value = { ...assist, loading: true };
    try {
      const response = await api.generateText({ prompt, model: this.props.conversationModel || '' });
      formOrEdit[prop] = response.text || '';
      // Trigger reactivity by spreading
      const formKey = assist.field.startsWith('form') ? 'form' : 'edit';
      this.data[formKey].value = { ...this.data[formKey].value };
    } catch (error) {
      console.error('AI assist failed:', error);
    } finally {
      this.data.aiAssist.value = { ...this.data.aiAssist.value, loading: false };
    }
  },
  /** @param {string} which 'expand-intro' | 'expand-appearance' | 'expand-imagen' */
  generateField(which) {
    if (which === 'expand-imagen') {
      return this._generateImagenInExpand(this.data.expandImagenMode.value || 'classic');
    }
    const textarea = this.refs[which === 'expand-intro' ? 'expandIntroTextarea' : 'expandAppearanceTextarea'];
    if (!textarea) return;
    const field = this.data.expandTarget.value;
    const prop = which === 'expand-intro' ? 'expandIntro' : 'expandAppearance';
    const fullText = this.data[prop].value;
    if (!fullText.trim()) return;
    const selStart = textarea.selectionStart;
    const selEnd = textarea.selectionEnd;
    const hasSelection = selStart !== selEnd && fullText.slice(selStart, selEnd).trim().length > 0;
    const targetText = hasSelection ? fullText.slice(selStart, selEnd) : fullText;
    const isAppearance = which === 'expand-appearance';
    const detailLevel = Number(isAppearance ? this.data.aiAssistSliderAppearance.value : this.data.aiAssist.value.slider);
    const dummyField = (isAppearance ? 'appearance' : 'intro');
    const fieldWithPrefix = field.startsWith('form') ? 'form-' + dummyField : 'edit-' + dummyField;
    const prompt = hasSelection
      ? this.buildExpandSelectionPrompt(fullText, targetText, fieldWithPrefix, detailLevel)
      : this.buildExpandPrompt(targetText, fieldWithPrefix, detailLevel);
    this.data.modalAssist.value = { loading: true, mode: 'generate-' + (isAppearance ? 'appearance' : 'intro') };
    api.generateText({ prompt, model: this.props.conversationModel || '' }).then(response => {
      const result = (response.text || '').trim();
      if (result) {
        if (hasSelection) {
          this.data[prop].value = fullText.slice(0, selStart) + result + fullText.slice(selEnd);
          tick();
          textarea.focus();
          textarea.setSelectionRange(selStart, selStart + result.length);
        } else {
          this.data[prop].value = result;
        }
      }
    }).catch(err => {
      console.error('AI assist failed:', err);
    }).finally(() => {
      this.data.modalAssist.value = { loading: false, mode: '' };
    });
  },
  _generateImagenInExpand(mode) {
    const isFlux = mode === 'flux';
    const textarea = this.refs.expandImagenTextarea;
    const field = this.data.expandTarget.value;
    const prefix = field.startsWith('form') ? 'form' : 'edit';
    const ref = prefix === 'form' ? this.data.form.value : this.data.edit.value;
    const sourceText = (this.data.expandImagenAppearance.value || '').trim() || (this.data.expandAppearance.value || '').trim();
    if (!sourceText) return;
    this.data.modalAssist.value = { loading: true, mode: 'generate-imagen' };
    const agentName = ref.name || 'Character';
    const prompt = isFlux
      ? `Convert the following character description into a compact Flux-compatible image prompt.\n\nFormat: CharacterName: {brief visual description}\n\nRules:\n- Keep it short (1-2 sentences).\n- Describe only visual traits.\n- No camera terms, no lighting, no background.\n- Use {} curly braces around the description.\n\nExample: John: {a young man with brown hair, wearing black glasses}\n\nUser description:\n"""\n${sourceText}\n"""`
      : `You are an expert character appearance prompt writer.\n\nConvert the following description into a concise, visually grounded appearance prompt.\n\nRules: extract only visual traits (age, gender, height, build, face, skin, eyes, hair, clothing, posture). Remove scene info. Convert abstract traits to visible cues. Keep 45-100 words. No camera terms, lighting, background, image quality terms.\n\nUser description:\n"""\n${sourceText}\n"""`;
    api.generateText({ prompt, model: this.props.conversationModel || '' }).then(response => {
      let result = (response.text || '').trim();
      if (isFlux) {
        const braceMatch = result.match(/\{[^}]*\}/);
        if (braceMatch) result = braceMatch[0];
        result = agentName + ': ' + result;
      }
      this.data.expandImagenAppearance.value = result;
      if (textarea) { tick(); textarea.focus(); }
    }).catch(err => {
      console.error('Imagen generate failed:', err);
    }).finally(() => {
      this.data.modalAssist.value = { loading: false, mode: '' };
    });
  },
  continueField(which) {
    const refKey = which === 'expand-intro' ? 'expandIntroTextarea' : 'expandAppearanceTextarea';
    const prop = which === 'expand-intro' ? 'expandIntro' : 'expandAppearance';
    const textarea = this.refs[refKey];
    if (!textarea) return;
    const fullText = this.data[prop].value;
    if (!fullText.trim()) return;
    const field = this.data.expandTarget.value;
    const insertPos = textarea.selectionEnd;
    const textBefore = fullText.slice(0, insertPos);
    const textAfter = fullText.slice(insertPos);
    const isAppearance = which === 'expand-appearance';
    const dummyField = isAppearance ? 'appearance' : 'intro';
    const fieldWithPrefix = field.startsWith('form') ? 'form-' + dummyField : 'edit-' + dummyField;
    const prompt = this.buildContinuePrompt(textBefore, textAfter, fieldWithPrefix, this.data.aiAssist.value.slider);
    this.data.modalAssist.value = { loading: true, mode: 'continue' };
    api.generateText({ prompt, model: this.props.conversationModel || '' }).then(response => {
      const continuation = (response.text || '').trim();
      if (continuation) {
        const leadingSpace = textBefore && !/\s$/.test(textBefore) ? ' ' : '';
        const trailingSpace = textAfter && !/^\s/.test(textAfter) ? ' ' : '';
        this.data[prop].value = textBefore + leadingSpace + continuation + trailingSpace + textAfter;
        tick();
        const start = (textBefore + leadingSpace).length;
        textarea.focus();
        textarea.setSelectionRange(start, start + continuation.length);
      }
    }).catch(err => {
      console.error('AI continue failed:', err);
    }).finally(() => {
      this.data.modalAssist.value = { loading: false, mode: '' };
    });
  },
  /** @returns {string|null} */
  _activeRefForContinue() {
    const activeEl = document.activeElement;
    if (activeEl === this.refs?.expandIntroTextarea) return 'expandIntro';
    if (activeEl === this.refs?.expandAppearanceTextarea) return 'expandAppearance';
    return 'expandIntro';
  },
  async continueModalText() {
    const activeProp = this._activeRefForContinue();
    const refKey = activeProp === 'expandIntro' ? 'expandIntroTextarea' : 'expandAppearanceTextarea';
    const textarea = this.refs[refKey];
    if (!textarea) return;
    const fullText = this.data[activeProp].value;
    if (!fullText.trim()) return;
    const field = this.data.expandTarget.value;
    const insertPos = textarea.selectionEnd;
    const textBefore = fullText.slice(0, insertPos);
    const textAfter = fullText.slice(insertPos);
    const isAppearance = activeProp === 'expandAppearance';
    const dummyField = isAppearance ? 'appearance' : 'intro';
    const fieldWithPrefix = field.startsWith('form') ? 'form-' + dummyField : 'edit-' + dummyField;
    const prompt = this.buildContinuePrompt(textBefore, textAfter, fieldWithPrefix, this.data.aiAssist.value.slider);
    this.data.modalAssist.value = { loading: true, mode: 'continue' };
    try {
      const response = await api.generateText({ prompt, model: this.props.conversationModel || '' });
      const continuation = (response.text || '').trim();
      if (continuation) {
        const leadingSpace = textBefore && !/\s$/.test(textBefore) ? ' ' : '';
        const trailingSpace = textAfter && !/^\s/.test(textAfter) ? ' ' : '';
        this.data[activeProp].value = textBefore + leadingSpace + continuation + trailingSpace + textAfter;
        tick();
        const start = (textBefore + leadingSpace).length;
        textarea.focus();
        textarea.setSelectionRange(start, start + continuation.length);
      }
    } catch (error) {
      console.error('AI assist failed:', error);
    } finally {
      this.data.modalAssist.value = { loading: false, mode: '' };
    }
  },
  /** @param {'form'|'edit'} prefix */
  _imagenFormRef(prefix) {
    return prefix === 'form' ? this.data.form.value : this.data.edit.value;
  },
  /** @param {'form'|'edit'} prefix */
  async generateImagenClassic(prefix) {
    const ref = this._imagenFormRef(prefix);
    const sourceText = (ref.imagen_appearance || '').trim() || (ref.appearance || '').trim();
    if (!sourceText) {
      this.data.imagenLoading.value = false;
      return;
    }
    this.data.imagenLoading.value = true;
    const detail = Number(this.data.imagenStyleDetail.value);
    const prompt = `You are an expert character appearance prompt writer.

Your task is to convert the user's prose description of a character into a concise, precise, visually grounded appearance prompt suitable for modern image-generation models.

The output must describe the character's stable visual identity, not the full scene.

Rules:

1. Extract only visually observable and identity-defining traits:
   - apparent age range;
   - gender presentation;
   - height or body scale;
   - build, proportions and silhouette;
   - face shape and facial structure;
   - skin tone and complexion;
   - eye color, shape and characteristic gaze;
   - hair color, length, texture and usual styling;
   - distinctive facial or bodily features;
   - characteristic clothing, accessories and grooming;
   - habitual posture or restrained body language when it contributes to identity.

2. Remove temporary scene information unless it reveals a persistent character trait.

3. Convert abstract personality descriptions into visible cues only when justified by the source.

4. Distinguish stable appearance from temporary expression.

5. Correct obvious grammar mistakes or malformed wording silently.

6. Preserve all important contrasts and relationships between features.

7. Use clear natural language, not a disordered keyword list.

8. Organize the final description in this order:
   - character type and body silhouette;
   - face and complexion;
   - eyes and expression;
   - hair;
   - clothing and accessories;
   - posture and subtle behavioral cues.

9. Do not add: camera terms, lighting, background, image style, rendering quality terms, "4K", "HDR", "masterpiece", "highly detailed", negative prompts, personality biography, narrative explanation.

10. Do not mention the character's name unless the user explicitly wants the name preserved.

11. Prefer concrete visual language. Replace vague or literary expressions with renderable descriptions.

12. Keep the final prompt between 45 and 100 words unless the source contains unusually many essential traits.

13. Return only the final appearance prompt. Do not explain, analyze, label sections or add commentary.

User description:
"""
${sourceText}
"""`;
    try {
      const response = await api.generateText({ prompt, model: this.props.conversationModel || '' });
      ref.imagen_appearance = (response.text || '').trim();
      const key = prefix === 'form' ? 'form' : 'edit';
      this.data[key].value = { ...this.data[key].value };
    } catch (err) {
      console.error('Imagen classic failed:', err);
    } finally {
      this.data.imagenLoading.value = false;
    }
  },
  /** @param {'form'|'edit'} prefix */
  async generateImagenFlux(prefix) {
    const ref = this._imagenFormRef(prefix);
    const agentName = ref.name || 'Character';
    const sourceText = (ref.imagen_appearance || '').trim() || (ref.appearance || '').trim();
    if (!sourceText) {
      this.data.imagenLoading.value = false;
      return;
    }
    this.data.imagenLoading.value = true;
    const prompt = `Convert the following character description into a compact Flux-compatible image prompt.

Format: CharacterName: {brief visual description}

Rules:
- Keep it short (1-2 sentences).
- Describe only visual traits (age, gender, hair, eyes, clothing, expression).
- No camera terms, no lighting, no background, no image quality terms.
- Use {} curly braces around the description.

Example: John: {a young man with brown hair, wearing black glasses and a blue shirt, serious expression}

Alice: {a 50 year old woman with blonde hair, wearing a red dress, smiling warmly}

User description:
"""
${sourceText}
"""`;
    try {
      const response = await api.generateText({ prompt, model: this.props.conversationModel || '' });
      let result = (response.text || '').trim();
      // If the result contains the name prefix format, try to extract just the {description}
      const braceMatch = result.match(/\{[^}]*\}/);
      if (braceMatch) {
        result = braceMatch[0];
      }
      ref.imagen_appearance = `${agentName}: ${result}`;
      const key = prefix === 'form' ? 'form' : 'edit';
      this.data[key].value = { ...this.data[key].value };
    } catch (err) {
      console.error('Imagen flux failed:', err);
    } finally {
      this.data.imagenLoading.value = false;
    }
  },
  undoAiAssist() {
    const assist = this.data.aiAssist.value;
    if (!assist || !assist.field) return;
    const { formOrEdit, prop } = this._aiAssistFieldRef(assist.field);
    formOrEdit[prop] = assist.originalText;
    const formKey = assist.field.startsWith('form') ? 'form' : 'edit';
    this.data[formKey].value = { ...this.data[formKey].value };
    this.data.aiAssist.value = { field: null, originalText: '', slider: 3, loading: false };
  },
  /** @param {string} field */
  openExpand(field) {
    const { formOrEdit } = this._aiAssistFieldRef(field);
    this.data.expandTarget.value = field;
    this.data.expandIntro.value = formOrEdit.introduction || '';
    this.data.expandAppearance.value = formOrEdit.appearance || '';
    this.data.expandImagenAppearance.value = formOrEdit.imagen_appearance || '';
    this.data.expandModal.value = true;
  },
  saveExpand() {
    const field = this.data.expandTarget.value;
    const { formOrEdit } = this._aiAssistFieldRef(field);
    formOrEdit.introduction = this.data.expandIntro.value;
    formOrEdit.appearance = this.data.expandAppearance.value;
    formOrEdit.imagen_appearance = this.data.expandImagenAppearance.value;
    const formKey = field.startsWith('form') ? 'form' : 'edit';
    this.data[formKey].value = { ...this.data[formKey].value };
    this.data.expandModal.value = false;
    this.data.expandTarget.value = '';
  },
  cancelExpand() {
    this.data.expandModal.value = false;
    this.data.expandTarget.value = '';
  },
  /** @returns {string} */
  expandTitle() {
    const field = this.data.expandTarget.value;
    if (field.startsWith('form')) return 'Create Agent';
    const name = this.data.edit.value.name || 'Agent';
    return 'Edit ' + name;
  }
};

function toolsValue(value) {
  if (value === 'required') return 'required';
  if (value === true || value === 'true') return true;
  return false;
}
