export default {
  name: 'ImageLightbox',
  props: ['attachment', 'message', 'streamingMessage', 'autoMode'],
  emits: ['close', 'stop'],
  template() {
    return /*html*/`
      <div>
        <div class="lightbox-overlay">
          <div class="lightbox-backdrop" @click="emit('close')"></div>

          <div class="lightbox-container">
            <!-- Top bar: close (left) + stop if autoMode (right) -->
            <div class="lightbox-topbar">
              <button type="button" class="lightbox-close-btn" @click="emit('close')" title="Close">
                <span class="material-symbols-outlined">close</span>
              </button>
              <div class="lightbox-topbar-spacer"></div>
              <button x-if="autoMode && streamingMessage" type="button" class="lightbox-stop-btn" @click="emit('stop')" title="Stop generation">
                <span class="material-symbols-outlined">stop</span>
              </button>
            </div>

            <!-- Image stage: image + overlaid bubble at bottom-right -->
            <div class="lightbox-image-stage">
              <img :src="activeUrl()" :alt="activeAlt()" class="lightbox-image" />

              <!-- Eye toggle: standalone when collapsed or no message -->
              <button x-if="collapsed || !activeMessage()" type="button" class="lightbox-eye-btn" @click="toggleCollapsed" title="Show message">
                <span class="material-symbols-outlined">visibility</span>
              </button>
          </div>
        </div>
         <!-- Message bubble (collapsible), bottom-right overlay -->
          <div x-if="!collapsed && activeMessage()" class="lightbox-message-bubble" :class="activeMessage().role || 'assistant'">
            <div class="lightbox-message-meta">
              <span class="lightbox-message-name">{{ speakerName(activeMessage()) }}</span>
              <span class="lightbox-message-time">{{ bubbleTime(activeMessage()) }}</span>
              <button type="button" class="lightbox-eye-inline" @click="toggleCollapsed" title="Hide message">
                <span class="material-symbols-outlined">visibility_off</span>
              </button>
            </div>
            <div class="lightbox-message-content">{{ activeMessage().rendered_content || activeMessage().content }}</div>
          </div>
        </div>
      </div>
    `;
  },
  data() {
    return { collapsed: false };
  },
  speakerName(message) {
    return message.speaker_name_snapshot || message.speakerName || message.role || 'Assistant';
  },
  // Active attachment: clicked attachment first, fall back to streaming message's first image
  activeAttachment() {
    if (this.props.attachment) return this.props.attachment;
    const sm = this.props.streamingMessage;
    if (sm && Array.isArray(sm.attachments)) {
      const img = sm.attachments.find(function (a) {
        return a.type === 'image' || String(a.mime_type || '').startsWith('image/');
      });
      if (img) return img;
    }
    return null;
  },
  activeUrl() {
    const a = this.activeAttachment();
    return a ? a.public_url || '' : '';
  },
  activeAlt() {
    const a = this.activeAttachment();
    if (!a) return 'Image';
    return a.metadata?.prompt || a.filename || 'Image';
  },
  activeMessage() {
    // When the user clicked a specific message, show that one.
    // streamingMessage is auto-detected from lastImageMessageId — don't let
    // it shadow the clicked message.
    return this.props.message || this.props.streamingMessage || null;
  },
  bubbleTime(message) {
    if (message.pending) return 'streaming';
    if (message.created_at) {
      try { return new Date(message.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { /* fall through */ }
    }
    return '';
  },
  toggleCollapsed() {
    this.data.collapsed.value = !this.data.collapsed.value;
  },
};
