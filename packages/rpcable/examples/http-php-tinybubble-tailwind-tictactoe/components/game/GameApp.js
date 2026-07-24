import MatchSummary from './MatchSummary.js';
import BoardGrid from './BoardGrid.js';
import StatusRibbon from './StatusRibbon.js';
import ChatComposer from './ChatComposer.js';
import ChatDrawer from './ChatDrawer.js';
import ToastNotice from './ToastNotice.js';
import { createGameClient } from '../../services/gameClient.js';
import {
    buildBanner,
    buildBoardCells,
    buildChatMessages,
    buildPlayerPanel,
    buildStatusText,
    formatClock,
    parseTime,
    randomId,
} from '../../utils/gameState.js';

export default function createGameApp(config) {
    return {
        name: 'GameApp',
        components: {
            'toast-notice': ToastNotice,
            'match-summary': MatchSummary,
            'board-grid': BoardGrid,
            'status-ribbon': StatusRibbon,
            'chat-drawer': ChatDrawer,
            'chat-composer': ChatComposer,
        },
        data() {
            return {
                viewerSeat: config.seat,
                viewerName: config.playerName,
                menuOpen: false,
                pollingEnabled: false,
                pollingLabel: 'Poll 5s off',
                roundLabel: 'Round 1',
                statusLine: config.transport === 'websocket' ? 'Connecting via WebSocket...' : 'Connecting to PHP session...',
                lastAction: 'Loading room state...',
                clockText: '00:00',
                leftPanel: buildPlayerPanel(null, 'sun'),
                rightPanel: buildPlayerPanel(null, 'lime'),
                boardCells: buildBoardCells(null, config.seat),
                banner: buildBanner(null, config.seat),
                chatMessages: [],
                chatOpen: false,
                draft: '',
                notificationVisible: false,
                notificationTitle: 'Nuovo messaggio',
                notificationBody: '',
            };
        },
        template() {
            return /*html*/`
            <main class="relative h-screen w-full overflow-hidden">
                <div class="absolute left-4 top-14 z-10">
                    <button class="grid h-10 w-10 place-items-center rounded-full bg-white/88 text-slate-500 shadow-sm" @click="toggleMenu" aria-label="Apri menu">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5">
                            <path d="M4 7a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5A1 1 0 0 1 4 7Zm0 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm1 4a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5Z"/>
                        </svg>
                    </button>

                    <div x-show="menuOpen" class="mt-2 w-40 rounded-[1.25rem] bg-white/92 p-2 shadow-[0_16px_32px_rgba(51,65,85,0.18)] backdrop-blur">
                        ${config.transport !== 'websocket' ? `<button class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-extrabold text-slate-600 transition hover:bg-slate-100" @click="togglePollingFromMenu">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
                                <path d="M12 3a9 9 0 1 0 9 9 1 1 0 1 0-2 0 7 7 0 1 1-2.05-4.95L14 10h6V4l-1.64 1.64A8.96 8.96 0 0 0 12 3Z"/>
                            </svg>
                            {{ pollingLabel }}
                        </button>` : ''}
                        <button class="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-extrabold text-slate-600 transition hover:bg-slate-100" @click="restartFromMenu">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
                                <path d="M12 5a7 7 0 1 1-6.32 4H3l3.5-3.5L10 9H7.74A5 5 0 1 0 12 7a1 1 0 1 1 0-2Z"/>
                            </svg>
                            Rigioca
                        </button>
                    </div>
                </div>

                <toast-notice
                    :visible="notificationVisible"
                    :title="notificationTitle"
                    :body="notificationBody"
                    @open-chat="openChat"
                ></toast-notice>

                <section class="hero-top relative overflow-hidden px-4 pb-2 pt-14">
                    <div class="absolute -left-8 top-7 h-24 w-24 rounded-full bg-white/10 blur-2xl"></div>
                    <div class="absolute right-0 top-2 h-28 w-28 rounded-full bg-lime-200/18 blur-2xl"></div>
                    <match-summary
                        :left-panel="leftPanel"
                        :right-panel="rightPanel"
                        :clock-text="clockText"
                        @toggle-chat="toggleChat"
                        @manual-sync="manualSync"
                    ></match-summary>
                </section>

                <section class="relative z-[2] px-4 pt-1">
                    <div class="rounded-[28px] bg-gradient-to-b from-[#ffb016] to-[#ffc72a] p-4 shadow-[0_20px_50px_rgba(255,167,36,0.28)]">
                        <board-grid :cells="boardCells" @play="playCell"></board-grid>
                    </div>
                    <status-ribbon :banner="banner"></status-ribbon>
                </section>

                <section class="px-4 pt-4">
                    <div class="rounded-[24px] bg-white/16 px-4 py-2 text-center text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#8b5f1f] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
                        {{ roundLabel }} · {{ statusLine }} · {{ lastAction }}
                    </div>
                </section>

                <chat-drawer
                    :open="chatOpen"
                    :messages="chatMessages"
                    @close="closeChat"
                ></chat-drawer>

                <chat-composer :draft="draft" @draft-change="updateDraft" @send="sendChat"></chat-composer>
            </main>
            `;
        },
        init() {
            this.pendingMessages = [];
            this.roomState = null;
            this.turnStartedAtMs = Date.now();
            this.clockTimer = null;
            this.pollTimer = null;
            this.toastTimer = null;
            this.player = createGameClient(config);
            this.player.extend({
                sessionUpdated: ({ event, state } = {}) => {
                    if (!state) return;
                    this.applySnapshot({ ...state, event }, 'push');
                    if (event === 'chat') {
                        const lastMessage = state.room?.chat?.at(-1);
                        if (lastMessage?.text && lastMessage.seat !== this.data.viewerSeat.value && !this.data.chatOpen.value) {
                            const sender = state.room?.players?.[lastMessage.seat]?.name || 'Nuovo messaggio';
                            this.showNotification(sender, lastMessage.text);
                        }
                        if (this.data.chatOpen.value) this.queueChatScroll();
                    }
                },
            });
        },
        mounted() {
            this.startClock();
            if (config.transport !== 'websocket') this.startPolling();
            this.bootstrap();
        },
        beforeDestroy() {
            clearInterval(this.clockTimer);
            clearInterval(this.pollTimer);
            clearTimeout(this.toastTimer);
            this.player?.destroy?.();
        },
        startClock() {
            this.refreshClock();
            clearInterval(this.clockTimer);
            this.clockTimer = setInterval(() => this.refreshClock(), 1000);
        },
        refreshClock() {
            const elapsed = Math.floor((Date.now() - this.turnStartedAtMs) / 1000);
            this.data.clockText.value = formatClock(elapsed);
        },
        queueChatScroll() {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const card = this.$element?.querySelector('.chat-panel-card');
                    if (card) {
                        card.scrollTop = card.scrollHeight;
                    }
                });
            });
        },
        clearComposerInput() {
            requestAnimationFrame(() => {
                const input = this.$element?.querySelector('.chat-input');
                if (input) {
                    input.value = '';
                }
            });
        },
        toggleMenu() {
            this.data.menuOpen.value = !this.data.menuOpen.value;
        },
        closeMenu() {
            this.data.menuOpen.value = false;
        },
        toggleChat() {
            this.data.chatOpen.value = !this.data.chatOpen.value;
            if (this.data.chatOpen.value) {
                this.hideNotification();
                this.queueChatScroll();
            }
        },
        openChat() {
            this.data.chatOpen.value = true;
            this.hideNotification();
            this.queueChatScroll();
        },
        closeChat() {
            this.data.chatOpen.value = false;
        },
        showNotification(title, body) {
            this.data.notificationTitle.value = title;
            this.data.notificationBody.value = body;
            this.data.notificationVisible.value = true;
            clearTimeout(this.toastTimer);
            this.toastTimer = setTimeout(() => this.hideNotification(), 3200);
        },
        hideNotification() {
            this.data.notificationVisible.value = false;
        },
        refreshChat(room) {
            const messages = Array.isArray(room.chat) ? room.chat : [];
            const deliveredKeys = new Set(
                messages
                    .map((message) => message?.optimisticKey)
                    .filter(Boolean)
            );

            this.pendingMessages = this.pendingMessages.filter((message) => !deliveredKeys.has(message.optimisticKey));
            this.data.chatMessages.value = buildChatMessages(messages, this.pendingMessages, this.data.viewerSeat.value);
            if (this.data.chatOpen.value) {
                this.queueChatScroll();
            }
        },
        applySnapshot(snapshot, source = 'response') {
            const room = snapshot?.room;
            if (!room) {
                return;
            }

            this.roomState = room;
            this.turnStartedAtMs = parseTime(room.turnStartedAt);
            this.data.roundLabel.value = `Round ${room.round}`;
            this.data.statusLine.value = source === 'push'
                ? `Push ${snapshot.event || 'sync'} received.`
                : buildStatusText(room, this.data.viewerSeat.value);
            this.data.lastAction.value = room.lastAction || 'Arena synced.';
            this.data.leftPanel.value = buildPlayerPanel(room, 'sun');
            this.data.rightPanel.value = buildPlayerPanel(room, 'lime');
            this.data.boardCells.value = buildBoardCells(room, this.data.viewerSeat.value);
            this.data.banner.value = buildBanner(room, this.data.viewerSeat.value);
            this.refreshChat(room);
            this.refreshClock();
        },
        async bootstrap() {
            try {
                const snapshot = await this.player.bootstrap();
                this.applySnapshot(snapshot);
            } catch (error) {
                this.data.statusLine.value = error?.message || 'Bootstrap failed.';
            }
        },
        async playCell(payload) {
            try {
                await this.player.makeMove(payload.index);
            } catch (error) {
                this.data.statusLine.value = error?.message || 'Move rejected.';
            }
        },
        updateDraft(payload) {
            this.data.draft.value = payload?.value || '';
        },
        sendChat() {
            const text = this.data.draft.value.trim();
            if (!text) {
                this.data.statusLine.value = 'Write a message first.';
                return;
            }

            const optimisticKey = randomId('chat');
            this.pendingMessages = this.pendingMessages.concat([{
                id: optimisticKey,
                optimisticKey,
                seat: this.data.viewerSeat.value,
                text,
            }]);
            this.data.draft.value = '';
            this.clearComposerInput();

            if (this.roomState) this.refreshChat(this.roomState);
            this.player.sendChat({ text, optimisticKey });
        },
        nextRound() {
            this.player.nextRound();
        },
        manualSync() {
            this.player.sync();
        },
        togglePollingFromMenu() {
            this.closeMenu();
            this.togglePolling();
        },
        async restartFromMenu() {
            this.closeMenu();
            await this.nextRound();
        },
        startPolling() {
            this.data.pollingEnabled.value = true;
            this.data.pollingLabel.value = 'Poll 5s on';
            clearInterval(this.pollTimer);
            this.pollTimer = setInterval(() => this.player.sync(), 5000);
        },
        stopPolling() {
            this.data.pollingEnabled.value = false;
            this.data.pollingLabel.value = 'Poll 5s off';
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        },
        togglePolling() {
            const enabled = !this.data.pollingEnabled.value;
            if (enabled) {
                this.startPolling();
            } else {
                this.stopPolling();
            }
        },
    };
}
