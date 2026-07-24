export default {
    name: 'ToastNotice',
    props: ['visible', 'title', 'body'],
    emits: ['open-chat'],
    template() {
        return /*html*/`
        <div class="ios-toast" :class="toastClass()" :style="toastStyle()" @click="openChat">
            <div class="flex items-start gap-3">
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-lg">💬</div>
                <div class="min-w-0">
                    <div class="flex items-center justify-between gap-3">
                        <div class="text-[12px] font-extrabold tracking-wide">{{ title }}</div>
                        <div class="text-[11px] font-bold text-white/65">ora</div>
                    </div>
                    <div class="mt-0.5 truncate text-[13px] text-white/88">{{ body }}</div>
                </div>
            </div>
        </div>
        `;
    },
    toastClass() {
        return this.props.visible ? 'visible' : '';
    },
    toastStyle() {
        return this.props.visible ? 'visibility: visible;' : 'visibility: hidden;';
    },
    openChat() {
        this.emit('open-chat');
    },
};
