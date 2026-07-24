import { api } from '../api/client.js';
import MagicCreateModal from './MagicCreateModal.bub.js';

export default {
  name: 'ConversationList',
  props: ['conversations', 'activeConversationId', 'loading', 'theme', 'conversationModel', 'kokoroVoices'],
  emits: ['select', 'create', 'archive', 'delete', 'duplicate', 'set-theme', 'create-from-blueprint'],
  components: {
    'magic-create-modal': MagicCreateModal
  },
  template() {
    return /*html*/`
      <aside class="conversation-list">
        <!-- Header: design style with add_box icon -->
        <div class="cl-header">
          <span class="cl-header-title">Conversations</span>
          <button type="button" class="cl-header-btn" @click="openCreateModal" :disabled="loading" title="New conversation">
            <span class="material-symbols-outlined">add_box</span>
          </button>
          <button type="button" class="cl-header-btn" @click="openMagicModal" :disabled="loading" title="Magic create">
            <span class="material-symbols-outlined">auto_awesome</span>
          </button>
          <div class="cl-header-btn-wrap" style="position:relative">
            <button type="button" class="cl-header-btn" @click="toggleThemeMenu" title="Theme">
              <span class="material-symbols-outlined">{{ themeIcon() }}</span>
            </button>
            <div x-if="themeMenuOpen" class="cl-menu-dropdown" style="right:0;left:auto" @click.stop>
              <button type="button" :class="{ active: theme === 'dark' }" @click="selectTheme('dark')">
                <span class="material-symbols-outlined dd-check" x-show="theme === 'dark'">check</span>
                <span class="material-symbols-outlined">dark_mode</span>
                <span>Dark</span>
              </button>
              <button type="button" :class="{ active: theme === 'light' }" @click="selectTheme('light')">
                <span class="material-symbols-outlined dd-check" x-show="theme === 'light'">check</span>
                <span class="material-symbols-outlined">light_mode</span>
                <span>Light</span>
              </button>
              <button type="button" :class="{ active: theme === 'tau' }" @click="selectTheme('tau')">
                <span class="material-symbols-outlined dd-check" x-show="theme === 'tau'">check</span>
                <span class="material-symbols-outlined">palette</span>
                <span>Tau</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Search bar -->
        <div class="cl-search">
          <span class="cl-search-icon material-symbols-outlined">search</span>
          <input type="text" x-model="searchQuery" placeholder="Search conversations…" />
        </div>

        <!-- Scrollable list -->
        <div class="cl-scroll" @click="closeThemeMenu">
          <template x-if="loading">
            <div class="cl-empty">Loading conversations…</div>
          </template>
          <template x-if="!loading && !filteredList().length">
            <div class="cl-empty">No conversations yet.</div>
          </template>

          <div x-for="conversation in filteredList()" class="cl-item" :class="{ 'cl-item--active': conversation.id === activeConversationId }" @click="onConversationClick(conversation)">
            <span class="material-symbols-outlined cl-item-icon">forum</span>
            <div class="cl-info">
              <div class="cl-info-top">
                <span class="cl-title">{{ conversation.title || 'Untitled' }}</span>
                <span class="cl-time">{{ formatTime(conversation.updated_at || conversation.created_at) }}</span>
              </div>
              <div class="cl-preview-row">
                <span class="cl-preview">
                  <template x-if="conversation.encrypted && conversation.locked">
                    <span class="material-symbols-outlined cl-preview-lock">lock</span>
                  </template>
                  <template x-if="conversation.encrypted && !conversation.locked">
                    <span class="material-symbols-outlined cl-preview-lock">lock_open</span>
                  </template>
                  <template x-if="!conversation.encrypted">
                    <template x-if="conversation.status === 'archived'">Archived</template>
                    <template x-if="conversation.status !== 'archived'">Active</template>
                  </template>
                </span>
              </div>
            </div>
            <div class="cl-actions" @click.stop>
              <button type="button" class="cl-menu-btn" @click="toggleMenu(conversation.id)" title="More">
                <span class="material-symbols-outlined">more_horiz</span>
              </button>
              <div x-if="openMenuId === conversation.id" class="cl-menu-dropdown" @click.stop>
                <button type="button" @click="openEditModal(conversation)">Edit</button>
                <button type="button" @click="doArchive(conversation.id)">Archive /bye</button>
                <button type="button" @click="doDuplicate(conversation.id)">Duplicate</button>
                <button type="button" class="cl-menu-danger" @click="doDelete(conversation.id)">Delete</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Create conversation modal -->
        <div x-if="showCreateModal" class="modal-overlay">
          <div class="modal-backdrop" @click="cancelCreate"></div>
          <div class="modal-card" style="max-width:26rem">
            <div class="modal-header">
              <h3>New conversation</h3>
              <button type="button" class="modal-close" @click="cancelCreate">✕</button>
            </div>
            <div class="modal-body" style="display:grid;gap:1rem">
              <label class="form-label">
                Title
                <input type="text" x-model="createTitle" placeholder="Conversation title" @keydown-enter="submitCreate" />
              </label>
              <label class="checkbox-label">
                <input type="checkbox" x-model="createEncrypted" />
                🔒 Protect with password
              </label>
              <div x-if="createEncrypted" class="password-field">
                <label class="form-label">
                  Password
                  <input type="password" x-model="createPassword" placeholder="Password (4+ characters)" />
                </label>
              </div>
              <div x-if="createError" class="error">{{ createError }}</div>
            </div>
            <div class="modal-footer">
              <button type="button" @click="cancelCreate">Cancel</button>
              <button type="button" class="modal-save" @click="submitCreate" :disabled="!canSubmitCreate()">Create</button>
            </div>
          </div>
        </div>

        <!-- Edit conversation modal -->
        <div x-if="showEditModal" class="modal-overlay">
          <div class="modal-backdrop" @click="cancelEdit"></div>
          <div class="modal-card" style="max-width:26rem">
            <div class="modal-header">
              <h3>Edit conversation</h3>
              <button type="button" class="modal-close" @click="cancelEdit">✕</button>
            </div>
            <div class="modal-body" style="display:grid;gap:1rem">
              <label class="form-label">
                Title
                <input type="text" x-model="editTitle" placeholder="Conversation title" @keydown-enter="saveEditTitle" />
              </label>

              <template x-if="editIsEncrypted">
                <div>
                  <div class="edit-badge">🔒 Encrypted</div>
                  <label class="form-label" style="margin-top:0.75rem">
                    New password
                    <input type="password" x-model="editNewPassword" placeholder="Leave empty to keep current" />
                  </label>
                  <label class="checkbox-label" style="margin-top:0.5rem">
                    <input type="checkbox" x-model="editRemoveEncryption" />
                    Remove encryption
                  </label>
                  <div x-if="editRemoveEncryption || editNewPassword" style="margin-top:0.5rem">
                    <label class="form-label">
                      Current password
                      <input type="password" x-model="editCurrentPassword" placeholder="Current password" />
                    </label>
                  </div>
                </div>
              </template>

              <template x-if="!editIsEncrypted">
                <div>
                  <label class="checkbox-label" style="margin-top:0.5rem">
                    <input type="checkbox" x-model="editEnableEncryption" />
                    🔒 Protect with password
                  </label>
                  <div x-if="editEnableEncryption" class="password-field">
                    <label class="form-label">
                      Password
                      <input type="password" x-model="editNewPassword" placeholder="Password (4+ characters)" />
                    </label>
                  </div>
                </div>
              </template>

              <div x-if="editError" class="error">{{ editError }}</div>
            </div>
            <div class="modal-footer">
              <button type="button" @click="cancelEdit">Cancel</button>
              <button type="button" class="modal-save" @click="saveEdit">{{ editSaveLabel() }}</button>
            </div>
          </div>
        </div>

        <magic-create-modal x-if="showMagicModal" :conversation-model="conversationModel" :kokoro-voices="kokoroVoices" @create-from-blueprint="onMagicBlueprint" @request-close="closeMagicModal"></magic-create-modal>

        <!-- Password unlock modal -->
        <div x-if="showPasswordModal" class="modal-overlay">
          <div class="modal-backdrop" @click="cancelPassword"></div>
          <div class="modal-card" style="max-width:26rem">
            <div class="modal-header">
              <h3>🔒 Conversation locked</h3>
              <button type="button" class="modal-close" @click="cancelPassword">✕</button>
            </div>
            <div class="modal-body" style="display:grid;gap:1rem">
              <p style="margin:0">Enter the password to unlock this conversation.</p>
              <input type="password" x-model="passwordInput" placeholder="Password" @keydown-enter="submitPassword" />
              <div x-if="passwordError" class="error">{{ passwordError }}</div>
            </div>
            <div class="modal-footer">
              <button type="button" @click="cancelPassword">Cancel</button>
              <button type="button" class="modal-save" @click="submitPassword" :disabled="!passwordInput || passwordInput.length < 4">Unlock</button>
            </div>
          </div>
        </div>
      </aside>
    `;
  },
  data() {
    return {
      searchQuery: '',
      openMenuId: '',
      showCreateModal: false,
      createTitle: '',
      createEncrypted: false,
      createPassword: '',
      createError: '',
      showEditModal: false,
      editConversation: null,
      editTitle: '',
      editIsEncrypted: false,
      editEnableEncryption: false,
      editRemoveEncryption: false,
      editNewPassword: '',
      editCurrentPassword: '',
      editError: '',
      showPasswordModal: false,
      passwordInput: '',
      passwordError: '',
      themeMenuOpen: false,
      pendingConversation: null,
      showMagicModal: false,
    };
  },
  filteredList() {
    const list = this.props.conversations || [];
    if (!this.data || !this.data.searchQuery) return list;
    const q = this.data.searchQuery.value.trim().toLowerCase();
    if (!q) return list;
    return list.filter(c => (c.title || '').toLowerCase().includes(q));
  },
  avatarColor(conversation) {
    const colors = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#e11d48', '#be123c'];
    const idx = (conversation.id || '').charCodeAt(0) % colors.length;
    return colors[idx];
  },
  avatarLetter(conversation) {
    const title = conversation.title || 'U';
    return title.charAt(0).toUpperCase();
  },
  formatTime(value) {
    if (!value) return '';
    const d = new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  },
  toggleMenu(id) {
    this.data.openMenuId.value = this.data.openMenuId.value === id ? '' : id;
    this.data.themeMenuOpen.value = false;
  },
  closeMenu() {
    this.data.openMenuId.value = '';
  },
  closeThemeMenu() {
    this.data.themeMenuOpen.value = false;
  },
  doArchive(id) {
    this.closeMenu();
    this.emit('archive', id);
  },
  doDuplicate(id) {
    this.closeMenu();
    this.emit('duplicate', id);
  },
  doDelete(id) {
    this.closeMenu();
    this.emit('delete', id);
  },
  // ---- Create modal ----
  openCreateModal() {
    this.data.showCreateModal.value = true;
    this.data.createTitle.value = '';
    this.data.createEncrypted.value = false;
    this.data.createPassword.value = '';
    this.data.createError.value = '';
  },
  canSubmitCreate() {
    const title = this.data.createTitle.value;
    const encrypted = this.data.createEncrypted.value;
    const password = this.data.createPassword.value;
    if (!title) return false;
    if (encrypted && (!password || password.length < 4)) return false;
    return true;
  },
  async submitCreate() {
    if (!this.canSubmitCreate()) return;
    const title = this.data.createTitle.value;
    const encrypted = this.data.createEncrypted.value;
    const password = this.data.createPassword.value;
    this.data.createError.value = '';
    this.data.showCreateModal.value = false;
    this.emit('create', { title, password: encrypted && password ? password : undefined });
  },
  cancelCreate() {
    this.data.showCreateModal.value = false;
  },
  // ---- Edit modal ----
  openEditModal(conversation) {
    this.closeMenu();
    this.data.editConversation.value = conversation;
    this.data.editTitle.value = conversation.title || '';
    this.data.editIsEncrypted.value = !!conversation.encrypted;
    this.data.editEnableEncryption.value = false;
    this.data.editRemoveEncryption.value = false;
    this.data.editNewPassword.value = '';
    this.data.editCurrentPassword.value = '';
    this.data.editError.value = '';
    this.data.showEditModal.value = true;
  },
  editSaveLabel() {
    const enc = this.data.editIsEncrypted.value;
    const remove = this.data.editRemoveEncryption.value;
    const changePw = !!this.data.editNewPassword.value;
    if (remove) return 'Remove encryption';
    if (!enc && changePw) return 'Enable encryption';
    if (enc && changePw) return 'Change password';
    return 'Save';
  },
  async saveEdit() {
    const conv = this.data.editConversation.value;
    if (!conv) return;
    const newTitle = this.data.editTitle.value.trim();
    const isEncrypted = this.data.editIsEncrypted.value;
    const enableEnc = this.data.editEnableEncryption.value;
    const removeEnc = this.data.editRemoveEncryption.value;
    const newPw = this.data.editNewPassword.value;
    const currentPw = this.data.editCurrentPassword.value;

    this.data.editError.value = '';

    try {
      // 1. Update title if changed
      if (newTitle && newTitle !== conv.title) {
        await api.patchConversation(conv.id, { title: newTitle });
      }

      // 2. Handle encryption changes
      if (!isEncrypted && enableEnc && newPw && newPw.length >= 4) {
        await api.lockConversation(conv.id, newPw);
      } else if (isEncrypted && removeEnc && currentPw) {
        // Remove encryption: pass empty new password = disable
        await api.changeConversationPassword(conv.id, currentPw, '');
      } else if (isEncrypted && newPw && newPw.length >= 4 && currentPw) {
        await api.changeConversationPassword(conv.id, currentPw, newPw);
      }

      this.data.showEditModal.value = false;
      // Refresh the parent to reflect changes
      this.emit('select', conv);
    } catch (err) {
      this.data.editError.value = err.message || 'Failed to save';
    }
  },
  cancelEdit() {
    this.data.showEditModal.value = false;
    this.data.editConversation.value = null;
  },
  saveEditTitle() {
    // Quick-save on Enter in the title field
    this.saveEdit();
  },
  // ---- Click on conversation ----
  onConversationClick(conversation) {
    if (conversation.encrypted && conversation.locked) {
      this.data.pendingConversation.value = conversation;
      this.data.showPasswordModal.value = true;
      this.data.passwordInput.value = '';
      this.data.passwordError.value = '';
      return;
    }
    this.emit('select', conversation);
  },
  // ---- Unlock modal ----
  async submitPassword() {
    const password = this.data.passwordInput.value;
    const conversation = this.data.pendingConversation.value;
    if (!password || password.length < 4 || !conversation) return;
    this.data.passwordError.value = '';
    try {
      await api.unlockConversation(conversation.id, password);
      this.data.showPasswordModal.value = false;
      this.data.pendingConversation.value = null;
      this.emit('select', conversation);
    } catch (err) {
      this.data.passwordError.value = err.message || 'Invalid password';
    }
  },
  cancelPassword() {
    this.data.showPasswordModal.value = false;
    this.data.pendingConversation.value = null;
    this.data.passwordError.value = '';
  },
  // ---- Legacy ----
  archive() { this.emit('archive', this.props.activeConversationId); },
  remove() { this.emit('delete', this.props.activeConversationId); },
  formatDate(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleString(); } catch { return value; }
  },
  // ---- Magic create ----
  openMagicModal() {
    this.data.showMagicModal.value = true;
  },
  closeMagicModal() {
    this.data.showMagicModal.value = false;
  },
  onMagicBlueprint(blueprint) {
    this.closeMagicModal();
    this.emit('create-from-blueprint', blueprint);
  },
  themeIcon() {
    const icons = { dark: 'dark_mode', light: 'light_mode', tau: 'palette' };
    return icons[this.props.theme] || 'palette';
  },
  toggleThemeMenu() {
    this.data.themeMenuOpen.value = !this.data.themeMenuOpen.value;
  },
  selectTheme(theme) {
    this.data.themeMenuOpen.value = false;
    this.emit('set-theme', theme);
  }
};
