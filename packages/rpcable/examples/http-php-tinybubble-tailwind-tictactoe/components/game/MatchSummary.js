import PlayerBadge from './PlayerBadge.js';

export default {
    name: 'MatchSummary',
    components: {
        'player-badge': PlayerBadge,
    },
    props: ['leftPanel', 'rightPanel', 'clockText'],
    emits: ['toggle-chat', 'manual-sync'],
    template() {
        return /*html*/`
        <div class="soft-card compact-match rounded-[24px] px-4 py-3">
            <button class="match-chat-btn" @click="toggleChat" aria-label="Apri chat">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                    <path d="M4 5.75A2.75 2.75 0 0 1 6.75 3h10.5A2.75 2.75 0 0 1 20 5.75v7.5A2.75 2.75 0 0 1 17.25 16H9.81l-3.97 3.19A.75.75 0 0 1 4 18.6V16.9A2.74 2.74 0 0 1 2 14.25v-8.5Z"/>
                </svg>
            </button>

            <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <player-badge :panel="leftPanel"></player-badge>

                <div class="shrink-0 px-1 text-center">
                    <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gradient-to-b from-orange-400 to-orange-500 text-lg font-black text-white shadow-lg">VS</div>
                    <div class="mt-2 rounded-full bg-[#9d4f1e] px-3 py-1 text-[13px] font-black tracking-wide text-white">{{ clockText }}</div>
                    <button class="mt-2 inline-flex items-center justify-center rounded-full bg-white/85 p-2 text-[#64748b] shadow-sm" @click="manualSync" aria-label="Sincronizza">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
                            <path d="M12 4a8 8 0 0 1 7.75 6h-2.22a6 6 0 1 0-1.38 5.43.999.999 0 1 1 1.54 1.27A8 8 0 1 1 12 4Zm4 1v4h4a1 1 0 1 1 0 2h-5a1 1 0 0 1-1-1V5a1 1 0 1 1 2 0Z"/>
                        </svg>
                    </button>
                </div>

                <player-badge :panel="rightPanel"></player-badge>
            </div>
        </div>
        `;
    },
    toggleChat() {
        this.emit('toggle-chat');
    },
    manualSync() {
        this.emit('manual-sync');
    },
};
