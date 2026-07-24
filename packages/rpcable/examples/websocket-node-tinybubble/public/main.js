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
    profileSaved(profile) {
        if (!app) return;
        app.data.profileText.value = JSON.stringify(profile, null, 2);
        app.data.status.value = 'profileSaved push received';
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

const NodeWebSocketPanel = {
    name: 'NodeWebSocketPanel',
    template() {
        return /*html*/ `
            <section style="background: var(--card); border: 1px solid #99f6e4; border-radius: 24px; box-shadow: 0 26px 52px #0f172a1f; overflow: hidden;">
                <header style="padding: 24px 24px 12px; border-bottom: 1px solid #d1fae5; background: linear-gradient(135deg, #f0fdfa, #eff6ff);">
                    <p style="margin: 0; letter-spacing: .17em; text-transform: uppercase; font-size: 12px; color: #0f766e; font-weight: 700;">rpcable playground</p>
                    <h1 style="margin: 10px 0 0; font-size: 30px; line-height: 1.12;">WebSocket + Node + TinyBubble</h1>
                    <p style="margin: 10px 0 0; color: #334155;">Native websocket transport with request/response, push handlers, and receiver-side validation.</p>
                </header>

                <main style="padding: 18px 24px 24px; display: grid; gap: 14px;">
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button style="border: 0; background: var(--accent); color: white; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.join()">Join (.request)</button>
                        <button style="border: 0; background: #0f172a; color: white; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.saveProfileValid()">Save Profile (valid)</button>
                        <button style="border: 1px solid #fecaca; background: #fef2f2; color: var(--danger); padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.saveProfileInvalid()">Save Profile (invalid)</button>
                        <button style="border: 1px solid #99f6e4; background: var(--accent-soft); color: #115e59; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.ping()">Ping (push)</button>
                    </div>

                    <div style="background: #082f49; color: #d1fae5; border-radius: 14px; padding: 14px; font-size: 14px;">
                        <p style="margin: 0 0 6px;"><strong>Status:</strong> {{ status }}</p>
                        <p style="margin: 0 0 6px;"><strong>User:</strong> {{ userLabel }}</p>
                        <p style="margin: 0;"><strong>Last ping:</strong> {{ lastPing }}</p>
                    </div>

                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px;">
                        <div style="background: #020617; color: #a5f3fc; border-radius: 14px; padding: 14px; font-size: 12px;">
                            <p style="margin: 0 0 8px; color: #cffafe;">Last saved profile (push payload)</p>
                            <pre style="margin: 0; overflow-x: auto;">{{ profileText }}</pre>
                        </div>
                        <div style="background: #fff7ed; color: #7c2d12; border-radius: 14px; padding: 14px; font-size: 12px; border: 1px solid #fdba74;">
                            <p style="margin: 0 0 8px; color: #9a3412;">Validation rules on the server</p>
                            <pre style="margin: 0; overflow-x: auto; white-space: pre-wrap;">{{ schemaHint }}</pre>
                        </div>
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
            profileText: '{}',
            schemaHint: JSON.stringify({
                saveProfile: {
                    inputSchema: {
                        type: 'object',
                        required: ['displayName', 'favoriteNumber'],
                        additionalProperties: false,
                        properties: {
                            displayName: { type: 'string', minLength: 3, maxLength: 20 },
                            favoriteNumber: { type: 'integer', minimum: 1, maximum: 99 },
                        },
                    },
                },
            }, null, 2),
        };
    },
    async join() {
        if (!ensureConnected()) {
            this.data.status.value = 'Wait: websocket not ready';
            return;
        }
        this.data.status.value = 'Joining...';
        const randomName = `node-${Math.floor(Math.random() * 999)}`;
        const result = await userSession.join({ name: randomName }).request();
        this.data.status.value = `Join response: ${result.welcomedAs}`;
    },
    async saveProfileValid() {
        if (!ensureConnected()) {
            this.data.status.value = 'Wait: websocket not ready';
            return;
        }
        this.data.status.value = 'Saving valid profile...';
        try {
            const result = await userSession.saveProfile({
                displayName: 'Marta',
                favoriteNumber: 7,
            }).request();
            this.data.status.value = `Save response: ${result.saved ? 'ok' : 'unexpected'}`;
        } catch (error) {
            this.data.status.value = `Unexpected error: ${error.message}`;
        }
    },
    async saveProfileInvalid() {
        if (!ensureConnected()) {
            this.data.status.value = 'Wait: websocket not ready';
            return;
        }
        this.data.status.value = 'Sending invalid payload...';
        try {
            await userSession.saveProfile({
                displayName: 'No',
                favoriteNumber: 120,
                extra: true,
            }).request();
            this.data.status.value = 'Unexpected success';
        } catch (error) {
            this.data.status.value = `Validation error: ${error.message}`;
        }
    },
    ping() {
        if (!ensureConnected()) {
            this.data.status.value = 'Wait: websocket not ready';
            return;
        }
        this.data.status.value = 'Ping sent - awaiting pong push...';
        userSession.ping();
    },
};

app = createComponent(NodeWebSocketPanel);
app.appendTo(document.getElementById('app'));
