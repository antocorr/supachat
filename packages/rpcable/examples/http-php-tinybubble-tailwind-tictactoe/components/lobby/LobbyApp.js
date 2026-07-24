import LobbyHeader from './LobbyHeader.js';
import PlayerFrameCard from './PlayerFrameCard.js';

function randomRoomId() {
    return `room-${Math.random().toString(16).slice(2, 8)}`;
}

function sanitizeRoomId(value) {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || randomRoomId();
}

function sanitizePlayerName(value, fallback) {
    const trimmed = String(value || '').trim().slice(0, 24);
    return trimmed || fallback;
}

function sanitizeTransport(value) {
    return value === 'ws' || value === 'websocket' ? 'websocket' : 'http';
}

function buildFrameSrc(roomId, seat, playerName, transport, wsUrl) {
    const params = new URLSearchParams({
        room: roomId,
        seat,
        name: playerName,
    });

    if (transport === 'websocket') {
        params.set('transport', 'ws');
        if (wsUrl) {
            params.set('wsUrl', wsUrl);
        }
    }

    return `./game.html?${params.toString()}`;
}

function buildShareUrl(roomId, sunName, limeName, transport, wsUrl) {
    const params = new URLSearchParams({
        room: roomId,
        sun: sunName,
        lime: limeName,
    });

    if (transport === 'websocket') {
        params.set('transport', 'ws');
        if (wsUrl) {
            params.set('wsUrl', wsUrl);
        }
    }

    return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

export default {
    name: 'LobbyApp',
    components: {
        'lobby-header': LobbyHeader,
        'player-frame-card': PlayerFrameCard,
    },
    data() {
        return {
            roomDraft: '',
            sunNameDraft: '',
            limeNameDraft: '',
            roomId: '',
            sunName: '',
            limeName: '',
            transport: 'http',
            wsUrl: '',
            shareUrl: '',
            sunSrc: '',
            limeSrc: '',
            toastText: '',
        };
    },
    template() {
        return /*html*/`
        <main class="w-screen min-h-screen">
            <section class="desktop-stage relative noise">
                <lobby-header
                    :room-draft="roomDraft"
                    :sun-name-draft="sunNameDraft"
                    :lime-name-draft="limeNameDraft"
                    :share-url="shareUrl"
                    @room-input="onRoomInput"
                    @sun-input="onSunInput"
                    @lime-input="onLimeInput"
                    @apply="applyRoom"
                    @random-room="generateRoom"
                    @copy-link="copyLink"
                ></lobby-header>

                <div class="divider-vertical"></div>

                <section class="arena-surface relative z-10 grid min-h-[calc(100vh-96px)] grid-cols-1 lg:grid-cols-2">
                    <div class="lg:border-r border-white/5">
                        <player-frame-card
                            :title="sunName"
                            :caption="'Player X'"
                            :seat-label="'X side'"
                            :src="sunSrc"
                            :caption-class="'text-orange-300/85'"
                            :name-class="'text-[#ff7300]'"
                        ></player-frame-card>
                    </div>

                    <div>
                        <player-frame-card
                            :title="limeName"
                            :caption="'Player O'"
                            :seat-label="'O side'"
                            :src="limeSrc"
                            :caption-class="'text-lime-300/85'"
                            :name-class="'text-[#82bb2e]'"
                        ></player-frame-card>
                    </div>
                </section>

                <div class="pointer-events-none fixed bottom-6 left-1/2 z-20 w-full max-w-xl -translate-x-1/2 px-4">
                    <p x-show="toastText" class="rounded-full border border-white/70 bg-white/90 px-5 py-4 text-center text-sm font-extrabold text-[#8a4a0d] shadow-sm">{{ toastText }}</p>
                </div>
            </section>
        </main>
        `;
    },
    init() {
        const params = new URLSearchParams(window.location.search);
        const roomId = sanitizeRoomId(params.get('room'));
        const sunName = sanitizePlayerName(params.get('sun'), 'Giulia');
        const limeName = sanitizePlayerName(params.get('lime'), 'Marco');
        const transport = sanitizeTransport(params.get('transport'));
        const wsUrl = params.get('wsUrl') || '';

        this.data.roomDraft.value = roomId;
        this.data.sunNameDraft.value = sunName;
        this.data.limeNameDraft.value = limeName;
        this.applyValues(roomId, sunName, limeName, transport, wsUrl, true);
    },
    applyValues(roomId, sunName, limeName, transport, wsUrl, silent = false) {
        this.data.roomId.value = roomId;
        this.data.sunName.value = sunName;
        this.data.limeName.value = limeName;
        this.data.transport.value = transport;
        this.data.wsUrl.value = wsUrl;
        this.data.sunSrc.value = buildFrameSrc(roomId, 'sun', sunName, transport, wsUrl);
        this.data.limeSrc.value = buildFrameSrc(roomId, 'lime', limeName, transport, wsUrl);
        this.data.shareUrl.value = buildShareUrl(roomId, sunName, limeName, transport, wsUrl);

        const params = new URLSearchParams({
            room: roomId,
            sun: sunName,
            lime: limeName,
        });

        if (transport === 'websocket') {
            params.set('transport', 'ws');
            if (wsUrl) {
                params.set('wsUrl', wsUrl);
            }
        }

        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);

        if (!silent) {
            this.data.toastText.value = `Room ${roomId} pronta: ${sunName} vs ${limeName}`;
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => {
                this.data.toastText.value = '';
            }, 2200);
        }
    },
    onRoomInput(payload) {
        this.data.roomDraft.value = payload?.value || '';
    },
    onSunInput(payload) {
        this.data.sunNameDraft.value = payload?.value || '';
    },
    onLimeInput(payload) {
        this.data.limeNameDraft.value = payload?.value || '';
    },
    applyRoom() {
        const roomId = sanitizeRoomId(this.data.roomDraft.value);
        const sunName = sanitizePlayerName(this.data.sunNameDraft.value, 'Giulia');
        const limeName = sanitizePlayerName(this.data.limeNameDraft.value, 'Marco');

        this.data.roomDraft.value = roomId;
        this.data.sunNameDraft.value = sunName;
        this.data.limeNameDraft.value = limeName;
        this.applyValues(roomId, sunName, limeName, this.data.transport.value, this.data.wsUrl.value);
    },
    generateRoom() {
        this.data.roomDraft.value = randomRoomId();
        this.applyRoom();
    },
    async copyLink() {
        try {
            await navigator.clipboard.writeText(this.data.shareUrl.value);
            this.data.toastText.value = 'Link lobby copiato negli appunti';
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => {
                this.data.toastText.value = '';
            }, 2200);
        } catch {
            this.data.toastText.value = this.data.shareUrl.value;
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => {
                this.data.toastText.value = '';
            }, 2200);
        }
    },
    beforeDestroy() {
        clearTimeout(this.toastTimer);
    },
};
