import { createComponent } from '/vendor/tinybubble/dist/bubble.js';
import { RpcAble, extend } from '/rpcable.js';

class Session {}
const session = new Session();

const userSession = new RpcAble({
    transport: 'http',
    endpoint: '/rpc/user-session',
    target: session,
    headers: {
        'Content-Type': 'application/json',
        'x-session-id': 'tinybubble-http-demo',
    },
});

let panel = null;

extend(userSession, {
    joined({ user }) {
        if (!panel) return;
        panel.data.userLabel.value = `${user.name} (${user.sessionId})`;
        panel.data.status.value = 'Join push received (in HTTP response.push)';
    },
    gamesReceived(games) {
        if (!panel) return;
        panel.data.gamesText.value = JSON.stringify(games, null, 2);
        panel.data.status.value = `Received ${games.length} games from response.push`;
    },
    readMessage(payload) {
        if (!panel) return;
        panel.data.modalTitle.value = payload?.title || 'Message';
        panel.data.modalContent.value = payload?.content || '';
        panel.data.status.value = 'readMessage push collected from pending queue';

        const modal = document.getElementById('server-message-modal');
        if (modal && typeof modal.showModal === 'function' && !modal.open) {
            modal.showModal();
        }
    },
});

const HttpPanel = {
    name: 'HttpPanel',
    template() {
        return /*html*/ `
            <section style="background: var(--panel); border: 1px solid #dbeafe; border-radius: 24px; box-shadow: 0 24px 50px #6b7fd126; overflow: hidden;">
                <header style="padding: 24px 24px 16px; border-bottom: 1px solid #e2e8f0;">
                    <p style="margin: 0; letter-spacing: .18em; text-transform: uppercase; font-size: 12px; color: #0284c7; font-weight: 800;">rpcable playground</p>
                    <h1 style="margin: 10px 0 0; font-size: 30px; line-height: 1.15;">HTTP + Bun + TinyBubble</h1>
                    <p style="margin: 10px 0 0; color: #334e68;">Same client shape: call methods, receive push handlers via <code>response.push</code>.</p>
                </header>

                <main style="padding: 20px 24px 24px; display: grid; gap: 14px;">
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button style="border: 0; background: var(--accent); color: white; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.join()">Join</button>
                        <button style="border: 0; background: #0f172a; color: white; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.getGames()">Get Games</button>
                        <button style="border: 0; background: #ea580c; color: white; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.setAndForget()">Set&Forget (5s)</button>
                        <button style="border: 1px solid #93c5fd; background: #eff6ff; color: #0c4a6e; padding: 10px 14px; border-radius: 12px; font-weight: 700; cursor: pointer;" @click="this.ping()">Ping</button>
                    </div>
                    <p style="margin: 0; color: #475569; font-size: 13px;">Tip: click <strong>Set&Forget (5s)</strong>, wait 5 seconds, then click <strong>Ping</strong> to collect pending push and open the modal.</p>

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

                <dialog id="server-message-modal" style="border: 0; border-radius: 16px; width: min(520px, 92vw); padding: 0; box-shadow: 0 30px 80px #0f172a4a;">
                    <article style="padding: 18px 18px 14px;">
                        <h2 style="margin: 0 0 8px; font-size: 20px;">{{ modalTitle }}</h2>
                        <p style="margin: 0 0 16px; color: #334155;">{{ modalContent }}</p>
                        <div style="display: flex; justify-content: flex-end;">
                            <button style="border: 0; background: #0f172a; color: white; padding: 8px 12px; border-radius: 10px; font-weight: 700; cursor: pointer;" @click="this.closeModal()">Close</button>
                        </div>
                    </article>
                </dialog>
            </section>
        `;
    },
    data() {
        return {
            status: 'Ready',
            userLabel: 'not joined yet',
            lastPing: '-',
            gamesText: '[]',
            modalTitle: 'Server Message',
            modalContent: '',
        };
    },
    async join() {
        this.data.status.value = 'Joining...';
        const randomName = `http-${Math.floor(Math.random() * 999)}`;
        const result = await userSession.join({ name: randomName }).request();
        this.data.status.value = `Join response: ${result.welcomedAs}`;
    },
    async getGames() {
        this.data.status.value = 'Requesting games...';
        const count = await userSession.getGames().request();
        this.data.status.value = `Server returned count=${count}`;
    },
    async ping() {
        this.data.status.value = 'Requesting ping...';
        const result = await userSession.ping().request();
        this.data.lastPing.value = `${result.now} (${result.transport})`;
        this.data.status.value = 'Ping ok (also drains pending push)';
    },
    async setAndForget() {
        this.data.status.value = 'Scheduling server message in 5 seconds...';
        userSession.setAndForgetMessage();
        this.data.status.value = 'Scheduled. Wait 5s, then click Ping to collect pending push.';
    },
    closeModal() {
        const modal = document.getElementById('server-message-modal');
        if (modal && typeof modal.close === 'function') {
            modal.close();
        }
    },
};

panel = createComponent(HttpPanel);
panel.appendTo(document.getElementById('app'));
