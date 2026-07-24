import { createComponent } from '/vendor/tinybubble/dist/bubble.js';
import { decodeRpcMessage, RpcAble, RpcAbleReceiver, extend } from '/rpcable.js';

const CHANNEL = '-userSession';
const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws`);

class Session {}
const session = new Session();

const userSession = new RpcAble({
    transport: 'websocket',
    socket: ws,
    channel: CHANNEL,
    target: session,
});

const receiver = new RpcAbleReceiver({ target: session });

let app = null;

ws.addEventListener('open', () => {
    if (!app) return;
    app.data.status.value = 'WebSocket connected';
});

ws.addEventListener('close', () => {
    if (!app) return;
    app.data.status.value = 'WebSocket disconnected';
});

ws.addEventListener('message', (event) => {
    const batch = decodeRpcMessage(event.data, CHANNEL);
    if (batch) receiver.dispatch(batch);
});

extend(userSession, {
    joined({ user }) {
        if (!app) return;
        app.data.userLabel.value = `${user.name} (${user.id})`;
        app.data.status.value = 'joined push received';
    },
    gamesReceived(games) {
        if (!app) return;
        app.data.gamesText.value = JSON.stringify(games, null, 2);
        app.data.status.value = `gamesReceived push (${games.length})`;
    },
    pong({ now, transport, role }) {
        if (!app) return;
        app.data.lastPing.value = `${now} (${transport}, role=${role})`;
        app.data.status.value = 'pong push received';
    },
});

function ensureConnected() {
    return ws.readyState === WebSocket.OPEN;
}

const WebSocketPanel = {
    name: 'WebSocketPanel',
    template() {
        return /*html*/ `
            <section style="background: var(--card); border: 1px solid #bfdbfe; border-radius: 24px; box-shadow: 0 26px 52px #33415524; overflow: hidden;">
                <header style="padding: 24px 24px 12px; border-bottom: 1px solid #e2e8f0;">
                    <p style="margin: 0; letter-spacing: .17em; text-transform: uppercase; font-size: 12px; color: #0369a1; font-weight: 700;">rpcable playground</p>
                    <h1 style="margin: 10px 0 0; font-size: 30px; line-height: 1.12;">WebSocket + Bun + TinyBubble</h1>
                    <p style="margin: 10px 0 0; color: #334155;">Native websocket transport with request/response and push handlers.</p>
                </header>

                <main style="padding: 18px 24px 24px; display: grid; gap: 12px;">
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button style="border: 0; background: var(--accent); color: white; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.join()">Join (.request)</button>
                        <button style="border: 0; background: #0f172a; color: white; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.getGames()">Get Games (.request + push)</button>
                        <button style="border: 1px solid #7dd3fc; background: #e0f2fe; color: #0c4a6e; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.ping()">Ping (push pong)</button>
                    </div>

                    <div style="background: #082f49; color: #d1fae5; border-radius: 14px; padding: 14px; font-size: 14px;">
                        <p style="margin: 0 0 6px;"><strong>Status:</strong> {{ status }}</p>
                        <p style="margin: 0 0 6px;"><strong>User:</strong> {{ userLabel }}</p>
                        <p style="margin: 0;"><strong>Last ping:</strong> {{ lastPing }}</p>
                    </div>

                    <div style="background: #020617; color: #a5f3fc; border-radius: 14px; padding: 14px; font-size: 12px;">
                        <p style="margin: 0 0 8px; color: #cffafe;">gamesReceived payload</p>
                        <pre style="margin: 0; overflow-x: auto;">{{ gamesText }}</pre>
                    </div>
                </main>
            </section>
        `;
    },
    data() {
        return {
            status: 'Connecting websocket...',
            userLabel: 'not joined yet',
            lastPing: '-',
            gamesText: '[]',
        };
    },
    async join() {
        if (!ensureConnected()) {
            this.data.status.value = 'Wait: websocket not ready';
            return;
        }
        this.data.status.value = 'Joining...';
        const randomName = `ws-${Math.floor(Math.random() * 999)}`;
        const result = await userSession.join({ name: randomName }).request();
        this.data.status.value = `Join response: ${result.welcomedAs}`;
    },
    async getGames() {
        if (!ensureConnected()) {
            this.data.status.value = 'Wait: websocket not ready';
            return;
        }
        this.data.status.value = 'Requesting games...';
        const result = await userSession.getGames().request();
        this.data.status.value = `Server returned count=${result.count} — games list incoming via push`;
    },
    ping() {
        if (!ensureConnected()) {
            this.data.status.value = 'Wait: websocket not ready';
            return;
        }
        this.data.status.value = 'Ping sent — awaiting pong push...';
        userSession.ping();
    },
};

app = createComponent(WebSocketPanel);
app.appendTo(document.getElementById('app'));
