import ChatList from './ChatList.js';

export default {
    name: 'ChatDrawer',
    components: {
        'chat-list': ChatList,
    },
    props: ['open', 'messages'],
    emits: ['close'],
    template() {
        return /*html*/`
        <section :class="panelClass()" :style="panelStyle()">
            <div class="chat-panel-card">
                <div class="mb-3 flex justify-end">
                    <button class="grid h-9 w-9 place-items-center rounded-full bg-slate-900/8 text-slate-500" @click="closeChat" aria-label="Chiudi chat">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
                                <path d="M6.28 5.22a.75.75 0 0 1 1.06 0L12 9.94l4.66-4.72a.75.75 0 1 1 1.08 1.04L13.06 11l4.68 4.74a.75.75 0 0 1-1.08 1.04L12 12.06l-4.66 4.72a.75.75 0 0 1-1.08-1.04L10.94 11 6.28 6.26a.75.75 0 0 1 0-1.04Z"/>
                        </svg>
                    </button>
                </div>
                <chat-list :messages="messages"></chat-list>
            </div>
        </section>
        `;
    },
    panelClass() {
        return this.props.open ? 'chat-panel open' : 'chat-panel';
    },
    panelStyle() {
        return this.props.open
            ? 'visibility: visible;'
            : 'visibility: hidden;';
    },
    closeChat() {
        this.emit('close');
    },
};
