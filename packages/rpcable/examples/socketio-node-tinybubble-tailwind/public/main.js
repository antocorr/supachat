import { createComponent } from '/vendor/tinybubble/dist/bubble.js';
import { RpcAble, RpcAbleReceiver, extend } from '/rpcable.js';

const CHANNEL = '-userSession';
const socket = window.io({
    transports: ['websocket'],
    upgrade: false,
});

class Session {}
const session = new Session();

const userSession = new RpcAble({
    transport: 'socketio',
    socket,
    channel: CHANNEL,
    target: session,
});

const receiver = new RpcAbleReceiver({ target: session });
socket.on(CHANNEL, (batch) => receiver.dispatch(batch));

let dashboard = null;

extend(userSession, {
    joined({ user }) {
        if (!dashboard) return;
        dashboard.data.status.value = `Connected as ${user.name}`;
        dashboard.data.userLabel.value = `${user.name} (${user.id.slice(0, 6)})`;
        userSession.adminOnlyMethod();
        userSession.forbidden();
    },
    gamesReceived(games) {
        if (!dashboard) return;
        dashboard.data.gamesText.value = JSON.stringify(games, null, 2);
        dashboard.data.status.value = `Received ${games.length} games from push`;
    },
    pong({ now, transport, role }) {
        if (!dashboard) return;
        dashboard.data.lastPing.value = `${now} (${transport}, role=${role})`;
        dashboard.data.status.value = 'pong push received';
    },
});

const Dashboard = {
    name: 'SocketDashboard',
    template() {
        return /*html*/ `
            <section class="w-full overflow-hidden rounded-3xl border border-white/70 bg-white/80 p-6 shadow-2xl backdrop-blur">
                <p class="mb-2 text-sm font-medium uppercase tracking-[0.22em] text-mint">rpcable playground</p>
                <h1 class="text-3xl font-bold md:text-4xl">Socket.io + TinyBubble + Tailwind</h1>
                <p class="mt-2 text-slate-600">Single API: UI invokes methods, server pushes updates with the same shape.</p>

                <div class="mt-5 grid gap-3 md:grid-cols-3">
                    <button class="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:translate-y-[-1px]" @click="this.join()">Join (.request)</button>
                    <button class="rounded-xl bg-mint px-4 py-3 text-sm font-semibold text-white transition hover:translate-y-[-1px]" @click="this.loadGames()">Get Games (.request + push)</button>
                    <button class="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-ink ring-1 ring-slate-300 transition hover:translate-y-[-1px]" @click="this.ping()">Ping (push pong)</button>
                </div>

                <div class="mt-6 rounded-2xl bg-slate-900 p-4 text-sm text-emerald-200">
                    <p><strong>Status:</strong> {{ status }}</p>
                    <p><strong>User:</strong> {{ userLabel }}</p>
                    <p><strong>Last ping:</strong> {{ lastPing }}</p>
                </div>

                <div class="mt-4 rounded-2xl bg-slate-950 p-4 text-xs text-cyan-200">
                    <p class="mb-2 text-cyan-100">gamesReceived payload</p>
                    <pre class="overflow-x-auto">{{ gamesText }}</pre>
                </div>
            </section>
        `;
    },
    data() {
        return {
            status: 'Connecting socket...',
            userLabel: 'not joined yet',
            lastPing: '-',
            gamesText: '[]',
        };
    },
    async join() {
        this.data.status.value = 'Joining...';
        const randomName = `tiny-${Math.floor(Math.random() * 999)}`;
        const result = await userSession.join({ name: randomName }).request();
        this.data.status.value = `Join response: ${result.welcomedAs}`;
    },
    async loadGames() {
        this.data.status.value = 'Requesting games...';
        const count = await userSession.getGames().request();
        this.data.status.value = `Server returned count=${count} — games list incoming via push`;
    },
    ping() {
        this.data.status.value = 'Ping sent — awaiting pong push...';
        userSession.ping();
    },
};

dashboard = createComponent(Dashboard);
dashboard.appendTo(document.getElementById('app'));
