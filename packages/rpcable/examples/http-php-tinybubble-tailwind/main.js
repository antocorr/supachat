import { createComponent } from './vendor/tinybubble/dist/bubble.js';
import { RpcAble, extend } from './rpcable.js';

const CONFIG_KEY = 'rpcable.http-php.demo.config';
const DEFAULT_NAME = `php-pilot-${Math.floor(Math.random() * 900 + 100)}`;
const session = {};

let dashboard = null;
let userSession = null;
let lastSignature = '';

function randomSessionId() {
    return `php-${Math.random().toString(36).slice(2, 10)}`;
}

function loadConfig() {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    return {
        displayName: typeof saved.displayName === 'string' && saved.displayName.trim() ? saved.displayName.trim() : DEFAULT_NAME,
        sessionId: typeof saved.sessionId === 'string' && saved.sessionId.trim() ? saved.sessionId.trim() : randomSessionId(),
        storageDriver: typeof saved.storageDriver === 'string' && saved.storageDriver.trim() ? saved.storageDriver.trim() : 'session',
        role: 'user',
    };
}

const config = loadConfig();

function saveConfig() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function currentSignature() {
    return JSON.stringify({
        displayName: config.displayName,
        sessionId: config.sessionId,
        storageDriver: config.storageDriver,
        role: config.role,
    });
}

function buildHeaders() {
    return {
        'Content-Type': 'application/json',
        'x-session-id': config.sessionId,
        'x-storage-driver': config.storageDriver,
        'x-user-name': config.displayName,
        'x-role': config.role,
    };
}

function appendLog(line) {
    if (!dashboard) return;
    const lines = dashboard.data.activity.value ? dashboard.data.activity.value.split('\n') : [];
    lines.unshift(`[${new Date().toLocaleTimeString()}] ${line}`);
    dashboard.data.activity.value = lines.slice(0, 8).join('\n');
}

function openModal(title, content) {
    if (!dashboard) return;
    dashboard.data.modalTitle.value = title;
    dashboard.data.modalContent.value = content;
    const modal = document.getElementById('server-message-modal');
    if (modal && typeof modal.showModal === 'function' && !modal.open) {
        modal.showModal();
    }
}

function closeModal() {
    const modal = document.getElementById('server-message-modal');
    if (modal && typeof modal.close === 'function') {
        modal.close();
    }
}

function syncDataFromConfig() {
    if (!dashboard) return;
    dashboard.data.currentName.value = config.displayName;
    dashboard.data.currentSession.value = config.sessionId;
    dashboard.data.currentStorage.value = config.storageDriver;
}

function syncFormFromConfig() {
    const nameInput = document.getElementById('display-name');
    const sessionInput = document.getElementById('session-key');
    const storageInput = document.getElementById('storage-driver');
    const messageInput = document.getElementById('pending-message');

    if (nameInput) nameInput.value = config.displayName;
    if (sessionInput) sessionInput.value = config.sessionId;
    if (storageInput) storageInput.value = config.storageDriver;
    if (messageInput && !messageInput.value) {
        messageInput.value = `Reminder for ${config.displayName}`;
    }
}

function readFieldValue(id, fallback = '') {
    const node = document.getElementById(id);
    if (!node) return fallback;
    return typeof node.value === 'string' ? node.value.trim() : fallback;
}

function applyConfigFromForm() {
    config.displayName = readFieldValue('display-name', config.displayName || DEFAULT_NAME) || DEFAULT_NAME;
    config.sessionId = readFieldValue('session-key', config.sessionId || randomSessionId()) || randomSessionId();
    config.storageDriver = readFieldValue('storage-driver', config.storageDriver || 'session') || 'session';
    saveConfig();
    syncDataFromConfig();
}

function createHttpClient() {
    const rpc = new RpcAble({
        transport: 'http',
        endpoint: './rpc.php',
        target: session,
        headers: buildHeaders(),
    });

    extend(rpc, {
        joined(payload) {
            if (!dashboard) return;
            dashboard.data.status.value = `Join push received for ${payload.user.name}`;
            dashboard.data.userLabel.value = `${payload.user.name} (${payload.user.sessionId})`;
            dashboard.data.serverMood.value = payload.user.mood;
            dashboard.data.storageLabel.value = payload.storage;
            appendLog(`push joined -> ${payload.user.name}`);
        },
        gamesReceived(games) {
            if (!dashboard) return;
            dashboard.data.gamesText.value = JSON.stringify(games, null, 2);
            dashboard.data.status.value = `Received ${games.length} games from push`;
            appendLog(`push gamesReceived -> ${games.length} games`);
        },
        readMessage(payload) {
            if (!dashboard) return;
            dashboard.data.status.value = 'Pending push drained from selected store';
            appendLog(`push readMessage -> ${payload.title}`);
            openModal(payload.title || 'Pending message', payload.content || '');
        },
    });

    return rpc;
}

function getClient() {
    const signature = currentSignature();
    if (!userSession || signature !== lastSignature) {
        userSession = createHttpClient();
        lastSignature = signature;
        appendLog(`client ready -> ${config.storageDriver}:${config.sessionId}`);
    }
    return userSession;
}

const PhpDashboard = {
    name: 'PhpDashboard',
    template() {
        return /*html*/ `
            <section class="grid w-full gap-6 xl:grid-cols-[minmax(0,1.35fr)_24rem]">
                <article class="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-panel backdrop-blur">
                    <div class="border-b border-slate-200/70 bg-[linear-gradient(145deg,rgba(251,146,60,0.16),rgba(255,247,237,0.92)_32%,rgba(45,212,191,0.14))] px-6 py-6 sm:px-8 sm:py-8">
                        <div class="flex flex-col gap-6">
                            <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                                <div class="max-w-3xl">
                                    <p class="text-sm font-semibold uppercase tracking-[0.3em] text-ember">rpcable playground</p>
                                    <h1 class="mt-3 text-3xl font-bold leading-tight sm:text-4xl">HTTP PHP transport, organised around the actual demo flow</h1>
                                    <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">Configure identity once, run the transport actions in sequence, and keep server feedback visible without mixing controls, hints, and payloads in the same block.</p>
                                </div>
                                <div class="grid gap-3 sm:grid-cols-2 lg:w-[24rem]">
                                    <div class="rounded-[1.5rem] border border-white/80 bg-white/85 px-4 py-4 shadow-sm">
                                        <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Endpoint</p>
                                        <code class="mt-2 block font-mono text-sm text-slate-900">./rpc.php</code>
                                        <p class="mt-2 text-xs leading-5 text-slate-500">Single-file PHP RPC entrypoint</p>
                                    </div>
                                    <div class="rounded-[1.5rem] border border-white/80 bg-slate-950 px-4 py-4 text-white shadow-sm">
                                        <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Current transport</p>
                                        <p class="mt-2 text-sm font-semibold">HTTP with request()/expects()</p>
                                        <p class="mt-2 text-xs leading-5 text-slate-400">Same client surface as the JS HTTP demo</p>
                                    </div>
                                </div>
                            </div>

                            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                <div class="rounded-[1.35rem] border border-amber-200/70 bg-amber-50/80 px-4 py-4">
                                    <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-800">Status</p>
                                    <p class="mt-2 text-sm font-semibold text-slate-900">{{ status }}</p>
                                </div>
                                <div class="rounded-[1.35rem] border border-cyan-200/80 bg-cyan-50/80 px-4 py-4">
                                    <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-800">User</p>
                                    <p class="mt-2 text-sm font-semibold text-slate-900">{{ userLabel }}</p>
                                </div>
                                <div class="rounded-[1.35rem] border border-emerald-200/80 bg-emerald-50/80 px-4 py-4">
                                    <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-800">Pending store</p>
                                    <p class="mt-2 text-sm font-semibold text-slate-900">{{ storageLabel }}</p>
                                </div>
                                <div class="rounded-[1.35rem] border border-slate-200 bg-white/90 px-4 py-4">
                                    <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Server mood</p>
                                    <p class="mt-2 text-sm font-semibold text-slate-900">{{ serverMood }}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="grid gap-6 px-6 py-6 sm:px-8 sm:py-8">
                        <section class="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                    <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Step 1</p>
                                    <h2 class="mt-2 text-2xl font-bold text-slate-950">Identity and storage</h2>
                                </div>
                                <p class="max-w-xl text-sm leading-6 text-slate-600">Keep the setup fields together so you can change who the client is, which session it uses, and where pending pushes are stored.</p>
                            </div>

                            <div class="mt-6 grid gap-4 lg:grid-cols-2">
                                <label class="block rounded-[1.5rem] border border-amber-200 bg-amber-50/70 p-4">
                                    <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Display name</span>
                                    <input id="display-name" type="text" class="mt-3 w-full rounded-xl border border-white bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-ember" />
                                </label>

                                <label class="block rounded-[1.5rem] border border-cyan-200 bg-cyan-50/70 p-4">
                                    <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Session key</span>
                                    <input id="session-key" type="text" class="mt-3 w-full rounded-xl border border-white bg-white px-4 py-3 text-sm font-mono outline-none ring-0 transition focus:border-pine" />
                                </label>
                            </div>

                            <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
                                <label class="block rounded-[1.5rem] border border-emerald-200 bg-emerald-50/70 p-4">
                                    <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Pending storage</span>
                                    <select id="storage-driver" class="mt-3 w-full rounded-xl border border-white bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-pine">
                                        <option value="session">session</option>
                                        <option value="file">json file</option>
                                        <option value="directory">json directory</option>
                                    </select>
                                </label>

                                <button class="rounded-2xl bg-dusk px-5 py-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-slate-800" @click="this.applySettings()">Apply settings</button>
                                <button class="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-sm font-semibold text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-400" @click="this.newSessionKey()">Generate new key</button>
                            </div>
                        </section>

                        <section class="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,247,237,0.72),rgba(255,255,255,0.96))] p-5 shadow-sm sm:p-6">
                            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                    <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Step 2</p>
                                    <h2 class="mt-2 text-2xl font-bold text-slate-950">Run transport actions</h2>
                                </div>
                                <p class="max-w-xl text-sm leading-6 text-slate-600">Primary RPC calls are separated from maintenance actions, so it is easier to scan what advances the demo and what adjusts server state.</p>
                            </div>

                            <div class="mt-6 grid gap-3 lg:grid-cols-3">
                                <button class="rounded-[1.4rem] bg-ember px-4 py-4 text-left text-white transition hover:-translate-y-0.5 hover:bg-orange-700" @click="this.join()">
                                    <span class="block text-xs font-semibold uppercase tracking-[0.22em] text-orange-100">Primary call</span>
                                    <span class="mt-2 block text-base font-semibold">Join now</span>
                                    <span class="mt-1 block text-sm text-orange-100/90">Create or refresh the active user session.</span>
                                </button>
                                <button class="rounded-[1.4rem] bg-pine px-4 py-4 text-left text-white transition hover:-translate-y-0.5 hover:bg-teal-700" @click="this.loadGames()">
                                    <span class="block text-xs font-semibold uppercase tracking-[0.22em] text-teal-50/90">Data call</span>
                                    <span class="mt-2 block text-base font-semibold">Get games</span>
                                    <span class="mt-1 block text-sm text-teal-50/90">Request the gamesReceived payload from the server.</span>
                                </button>
                                <button class="rounded-[1.4rem] bg-slate-950 px-4 py-4 text-left text-white transition hover:-translate-y-0.5 hover:bg-slate-800" @click="this.ping()">
                                    <span class="block text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Pending flow</span>
                                    <span class="mt-2 block text-base font-semibold">Ping + drain pending</span>
                                    <span class="mt-1 block text-sm text-slate-300">Confirm connectivity and consume queued server notes.</span>
                                </button>
                            </div>

                            <div class="mt-4 grid gap-3 md:grid-cols-3">
                                <button class="rounded-[1.4rem] border border-slate-300 bg-white px-4 py-4 text-left text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-400" @click="this.cycleMood()">
                                    <span class="block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">State update</span>
                                    <span class="mt-2 block text-base font-semibold text-slate-900">Change mood (.set)</span>
                                </button>
                                <button class="rounded-[1.4rem] border border-amber-200 bg-amber-50 px-4 py-4 text-left text-amber-900 transition hover:-translate-y-0.5 hover:border-amber-300" @click="this.queuePendingNote()">
                                    <span class="block text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Queue action</span>
                                    <span class="mt-2 block text-base font-semibold">Queue pending note</span>
                                </button>
                                <button class="rounded-[1.4rem] border border-slate-300 bg-white px-4 py-4 text-left text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-400" @click="this.clearPending()">
                                    <span class="block text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Maintenance</span>
                                    <span class="mt-2 block text-base font-semibold text-slate-900">Clear pending</span>
                                </button>
                            </div>
                        </section>

                        <section class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
                            <div class="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                                <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                    <div>
                                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Step 3</p>
                                        <h2 class="mt-2 text-2xl font-bold text-slate-950">Pending message</h2>
                                    </div>
                                    <p class="max-w-lg text-sm leading-6 text-slate-600">Prepare the message before queueing it, then use ping to drain it from the selected storage backend.</p>
                                </div>

                                <label class="mt-6 block rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                                    <span class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Pending note payload</span>
                                    <input id="pending-message" type="text" class="mt-3 w-full rounded-xl border border-white bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-ember" />
                                </label>

                                <div class="mt-4 rounded-[1.5rem] bg-slate-950 p-5 text-sm text-emerald-200">
                                    <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Live monitor</p>
                                    <div class="mt-4 grid gap-3 md:grid-cols-2">
                                        <div>
                                            <p class="text-slate-400">Last ping</p>
                                            <p class="mt-1 text-sm font-semibold text-white">{{ lastPing }}</p>
                                        </div>
                                        <div>
                                            <p class="text-slate-400">Client session</p>
                                            <p class="mt-1 break-all font-mono text-xs text-cyan-200">{{ currentSession }}</p>
                                        </div>
                                        <div>
                                            <p class="text-slate-400">Current status</p>
                                            <p class="mt-1 text-sm font-semibold text-white">{{ status }}</p>
                                        </div>
                                        <div>
                                            <p class="text-slate-400">Active store</p>
                                            <p class="mt-1 text-sm font-semibold text-white">{{ storageLabel }}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <aside class="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(30,41,59,0.98))] p-5 text-white shadow-sm sm:p-6">
                                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Suggested flow</p>
                                <ol class="mt-5 space-y-4 text-sm leading-6 text-slate-200">
                                    <li><span class="font-semibold text-white">1.</span> Set name, session key, and storage backend.</li>
                                    <li><span class="font-semibold text-white">2.</span> Run <strong>Join now</strong> to initialize the active user.</li>
                                    <li><span class="font-semibold text-white">3.</span> Queue a note, then use <strong>Ping + drain pending</strong>.</li>
                                    <li><span class="font-semibold text-white">4.</span> Switch storage or reuse the session key in another tab to compare behaviour.</li>
                                </ol>
                                <div class="mt-6 rounded-[1.35rem] border border-white/10 bg-white/5 p-4">
                                    <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Why this helps</p>
                                    <p class="mt-3 text-sm leading-6 text-slate-300">The panel keeps the demo order visible, so the main canvas can focus on inputs and feedback instead of repeating instructions.</p>
                                </div>
                            </aside>
                        </section>
                    </div>
                </article>

                <aside class="grid gap-6 self-start xl:sticky xl:top-6">
                    <section class="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur">
                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Client snapshot</p>
                        <div class="mt-5 space-y-4 text-sm text-slate-700">
                            <div class="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4">
                                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Display name</p>
                                <p class="mt-2 font-semibold text-slate-900">{{ currentName }}</p>
                            </div>
                            <div class="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4">
                                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Storage</p>
                                <p class="mt-2 font-semibold text-slate-900">{{ currentStorage }}</p>
                            </div>
                            <div class="rounded-[1.35rem] border border-slate-200 bg-slate-950 p-4">
                                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Session key</p>
                                <code class="mt-3 block break-all font-mono text-xs leading-6 text-cyan-200">{{ currentSession }}</code>
                            </div>
                        </div>
                    </section>

                    <section class="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur">
                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Recent activity</p>
                        <pre class="mt-4 min-h-56 whitespace-pre-wrap rounded-2xl bg-dusk p-4 font-mono text-xs leading-6 text-amber-100">{{ activity }}</pre>
                    </section>

                    <section class="rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur">
                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">gamesReceived payload</p>
                        <pre class="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 font-mono text-xs leading-6 text-cyan-200">{{ gamesText }}</pre>
                    </section>
                </aside>

                <dialog id="server-message-modal" class="w-[min(32rem,92vw)] rounded-[1.75rem] border border-white/70 bg-white p-0 shadow-panel backdrop:bg-slate-950/35">
                    <article class="p-6">
                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-ember">Pending push</p>
                        <h2 class="mt-2 text-2xl font-bold">{{ modalTitle }}</h2>
                        <p class="mt-3 text-sm leading-6 text-slate-600">{{ modalContent }}</p>
                        <div class="mt-6 flex justify-end">
                            <button class="rounded-2xl bg-dusk px-4 py-3 text-sm font-semibold text-white" @click="this.closeModal()">Close</button>
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
            serverMood: 'calm',
            storageLabel: config.storageDriver,
            currentName: config.displayName,
            currentSession: config.sessionId,
            currentStorage: config.storageDriver,
            gamesText: '[]',
            activity: 'waiting for actions...',
            modalTitle: 'Pending message',
            modalContent: '',
        };
    },
    applySettings() {
        applyConfigFromForm();
        userSession = null;
        this.data.status.value = `Settings applied for ${config.storageDriver}`;
        appendLog(`settings applied -> ${config.storageDriver}`);
    },
    newSessionKey() {
        config.sessionId = randomSessionId();
        saveConfig();
        syncDataFromConfig();
        syncFormFromConfig();
        userSession = null;
        this.data.status.value = 'Generated a new session key';
        appendLog(`new session key -> ${config.sessionId}`);
    },
    async join() {
        applyConfigFromForm();
        this.data.status.value = 'Joining...';
        const result = await getClient().join({ name: config.displayName }).request();
        this.data.status.value = `Join response: ${result.welcomedAs}`;
        this.data.storageLabel.value = result.storage;
        appendLog(`join response -> ${result.welcomedAs}`);
    },
    async loadGames() {
        applyConfigFromForm();
        this.data.status.value = 'Requesting games...';
        const count = await getClient().getGames().request();
        this.data.status.value = `Server returned count=${count}`;
        appendLog(`getGames response -> ${count}`);
    },
    async ping() {
        applyConfigFromForm();
        this.data.status.value = 'Pinging server...';
        const result = await getClient().ping().request();
        this.data.lastPing.value = `${result.now} (${result.transport}, ${result.storage})`;
        this.data.serverMood.value = result.mood;
        this.data.storageLabel.value = result.storage;
        this.data.status.value = 'Ping ok';
        appendLog(`ping -> drained ${result.storage} pending for ${result.sessionKey}`);
    },
    async cycleMood() {
        applyConfigFromForm();
        const moods = ['calm', 'arcade', 'focus', 'cosmic', 'sunset'];
        const currentMood = this.data.serverMood.value;
        const currentIndex = moods.indexOf(currentMood);
        const nextMood = moods[(currentIndex + 1 + moods.length) % moods.length];
        const savedMood = await getClient().mood.set(nextMood).request();
        this.data.serverMood.value = savedMood;
        this.data.status.value = `.set saved mood=${savedMood}`;
        appendLog(`mood.set -> ${savedMood}`);
    },
    async queuePendingNote() {
        applyConfigFromForm();
        const message = readFieldValue('pending-message', `Reminder for ${config.displayName}`) || `Reminder for ${config.displayName}`;
        this.data.status.value = 'Queueing pending note...';
        const result = await getClient().queueInboxNote(message).request();
        this.data.status.value = `Stored pending note (${result.pendingCount} queued)`;
        appendLog(`pending queued -> ${result.pendingCount} item(s)`);
    },
    async clearPending() {
        applyConfigFromForm();
        const result = await getClient().clearPending().request();
        this.data.status.value = `Cleared ${result.clearedCount} pending item(s)`;
        appendLog(`pending cleared -> ${result.clearedCount} item(s)`);
    },
    closeModal() {
        closeModal();
    },
};

dashboard = createComponent(PhpDashboard);
dashboard.appendTo(document.getElementById('app'));
syncDataFromConfig();
syncFormFromConfig();
appendLog('demo ready');
