export default {
    name: 'ChatList',
    props: ['messages'],
    template() {
        return /*html*/`
        <div class="flex flex-col gap-3">
            <div x-show="!messages.length" class="bubble-chat-left">
                Nessun messaggio ancora.
            </div>

            <div x-for="message in messages" :class="message.rowClass">
                <div :class="message.bubbleClass">{{ message.text }}</div>
            </div>
        </div>
        `;
    },
};
