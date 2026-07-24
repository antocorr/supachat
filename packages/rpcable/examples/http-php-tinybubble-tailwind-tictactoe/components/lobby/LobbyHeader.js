export default {
    name: 'LobbyHeader',
    props: ['roomDraft', 'sunNameDraft', 'limeNameDraft', 'shareUrl'],
    emits: ['room-input', 'sun-input', 'lime-input', 'apply', 'random-room', 'copy-link'],
    template() {
        return /*html*/`
        <header class="citrus-header relative z-10 flex min-h-[96px] flex-col justify-center gap-3 border-b border-white/25 px-6 py-4 text-white md:px-10 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex min-w-0 items-center gap-4">
                <div>
                    <div class="text-[10px] font-semibold uppercase tracking-[0.35em] text-white/80 md:text-xs">Desktop Arena</div>
                    <h1 class="font-display text-4xl font-black leading-none tracking-tight md:text-5xl">TTT Arena</h1>
                </div>
            </div>

            <form class="flex flex-col items-start gap-2 lg:items-end" @submit-prevent="applyRoom">
                <div class="flex flex-wrap items-center gap-2 md:gap-3">
                    <label class="rounded-full border border-white/30 bg-white/18 px-3 py-2 text-white shadow-inner md:px-4">
                        <input
                            type="text"
                            :value="roomDraft"
                            class="w-[7.2rem] bg-transparent text-center text-sm font-extrabold outline-none md:w-[8.4rem] md:text-lg"
                            placeholder="#325678"
                            @input="onRoomInput"
                            @change="applyRoom"
                        />
                    </label>

                    <label class="rounded-full border border-white/35 bg-white/20 px-3 py-2 text-orange-50 shadow-inner md:px-4">
                        <input
                            type="text"
                            :value="sunNameDraft"
                            class="w-[7.6rem] bg-transparent text-center text-sm font-bold outline-none md:w-[9rem] md:text-lg"
                            placeholder="nicknameX"
                            @input="onSunInput"
                            @change="applyRoom"
                        />
                    </label>

                    <label class="rounded-full border border-white/35 bg-lime-500/35 px-3 py-2 text-lime-50 shadow-inner md:px-4">
                        <input
                            type="text"
                            :value="limeNameDraft"
                            class="w-[7.6rem] bg-transparent text-center text-sm font-bold outline-none md:w-[9rem] md:text-lg"
                            placeholder="nicknameO"
                            @input="onLimeInput"
                            @change="applyRoom"
                        />
                    </label>
                </div>

                <div class="flex flex-wrap items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-white/85">
                    <button type="button" class="rounded-full bg-white/14 px-3 py-1.5 transition hover:bg-white/24" @click="applyRoom">Aggiorna</button>
                    <button type="button" class="rounded-full bg-white/14 px-3 py-1.5 transition hover:bg-white/24" @click="randomRoom">Random</button>
                    <button type="button" class="rounded-full bg-white/14 px-3 py-1.5 transition hover:bg-white/24" @click="copyLink">Copia link</button>
                    <span :title="shareUrl" class="rounded-full bg-white/10 px-3 py-1.5 tracking-[0.1em] text-white/80">Query live</span>
                </div>
            </form>
        </header>
        `;
    },
    onRoomInput(nextValue) {
        this.emit('room-input', { value: nextValue });
    },
    onSunInput(nextValue) {
        this.emit('sun-input', { value: nextValue });
    },
    onLimeInput(nextValue) {
        this.emit('lime-input', { value: nextValue });
    },
    applyRoom() {
        this.emit('apply');
    },
    randomRoom() {
        this.emit('random-room');
    },
    copyLink() {
        this.emit('copy-link');
    },
};
