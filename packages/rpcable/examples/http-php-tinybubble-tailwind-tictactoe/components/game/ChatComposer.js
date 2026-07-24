export default {
    name: 'ChatComposer',
    props: ['draft'],
    emits: ['draft-change', 'send'],
    template() {
        return /*html*/`
        <section class="input-bar-wrap">
            <form class="input-shell" @submit-prevent="submitMessage">
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-yellow-300 text-lg">🙂</div>
                <input
                    class="chat-input"
                    type="text"
                    placeholder="Scrivi un messaggio..."
                    :value="draft"
                    maxlength="160"
                    @input="updateDraft"
                    @keydown="onKeydown"
                />
                <button type="submit" class="send-icon-btn" :disabled="!draft || !draft.trim()" aria-label="Invia messaggio">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                        <path d="M3.43 2.84a.75.75 0 0 1 .83-.18l16.5 7.5a.75.75 0 0 1 0 1.36l-16.5 7.5A.75.75 0 0 1 3.2 18.3l1.77-5.75H10a.75.75 0 0 0 0-1.5H4.97L3.2 5.3a.75.75 0 0 1 .23-.81Z"/>
                    </svg>
                </button>
            </form>
        </section>
        `;
    },
    updateDraft(nextValue) {
        this.emit('draft-change', { value: nextValue });
    },
    onKeydown(event) {
        if (event?.key === 'Enter') {
            event.preventDefault();
            this.emit('send');
        }
    },
    submitMessage() {
        this.emit('send');
    },
};
