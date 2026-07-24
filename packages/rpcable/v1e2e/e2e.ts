// ============================================================================
// RpcAble v1 — end-to-end test.
//
// Two distinct sessions talking over a REAL transport, one Bun process.
// The same battery of assertions runs over both transports:
//   - websocket : Bun.serve handler-object (manual dispatch) + global WebSocket
//   - socketio  : socket.io Server + socket.io-client (both auto-subscribe)
//
// The server session is a CLASS (methods on the prototype) to prove V0-like DX:
// path resolution walks the prototype chain (excluding Object.prototype).
//
// Run: bun v1e2e/e2e.ts        Logs: v1e2e/e2e.log
// ============================================================================

import { writeFileSync, appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import {
    RpcAble,
    RpcAbleReceiver,
    extend,
    dispatch,
    destroy,
    decodeRpcMessage,
    getCurrentRole,
    getCurrentSender,
} from '../src/RpcAble.ts';

const CHANNEL = '-userSession';
const LOG_PATH = `${import.meta.dir}/e2e.log`;
writeFileSync(LOG_PATH, '');

function log(...args: any[]): void {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    console.log(line);
    appendFileSync(LOG_PATH, line + '\n');
}

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: any): void {
    if (cond) { passed++; log('  PASS', name); }
    else { failed++; log('  FAIL', name, detail !== undefined ? `-> ${JSON.stringify(detail)}` : ''); }
}

function assertEq(name: string, actual: any, expected: any): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    assert(name, ok, ok ? undefined : { actual, expected });
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

type World = {
    serverEvents: string[];
    clientNotifications: string[];
    clientToasts: any[];
    clientChat: string[];
};

function makeWorld(): World {
    return { serverEvents: [], clientNotifications: [], clientToasts: [], clientChat: [] };
}

// Server session as a class: whoAmI / pingDevice / measure / relay live on the
// prototype, the namespaces are own instance fields. This exercises prototype
// resolution (the V0 class pattern).
class UserSession {
    counter = 0;
    config = { version: '1.0.0' };
    games = { list: async () => { await wait(5); return ['g1', 'g2']; } };
    profile = { save: (input: { displayName: string }) => `saved:${input.displayName}` };
    admin = { reset: () => 'reset-done' };
    analytics: { pageViewed: (data: { route: string }) => void };

    constructor(world: World) {
        this.analytics = { pageViewed: (data) => { world.serverEvents.push(data.route); } };
    }

    whoAmI() { return getCurrentRole(this); }

    pingDevice() {
        getCurrentSender(this).notifications.received({ text: 'pong' });
        return true;
    }

    // server asks the calling client for a value, then returns it (nested round-trip)
    async measure() {
        const sender = getCurrentSender(this);
        return await sender.window.getWidth();
    }

    // SPECULARE: grab the calling device's sender and call a mirror method back on it.
    relay(text: string) {
        getCurrentSender(this).chat.say(`echo:${text}`);
    }
}

const SERVER_PERMISSIONS = {
    '*': { call: ['user', 'admin'] },
    'config.version': { get: ['user', 'admin'] },
    'counter': { get: ['user', 'admin'], set: ['user', 'admin'] },
    'profile': { get: ['user', 'admin'] }, // get allowed, but value is an object -> valueGuard blocks
    'admin.reset': ['admin'],
};

const SERVER_CONTRACT = {
    'profile.save': {
        inputSchema: {
            type: 'object',
            required: ['displayName'],
            additionalProperties: false,
            properties: { displayName: { type: 'string', minLength: 1 } },
        },
    },
};

function attachClientHandlers(client: any, world: World): void {
    extend(client, {
        'notifications.received': (msg: { text: string }) => { world.clientNotifications.push(msg.text); },
        'window.getWidth': () => 1280,
        'toast.show': (msg: any) => { world.clientToasts.push(msg); },
        'chat.say': (msg: string) => { world.clientChat.push(msg); },
    });
}

// ---------------------------------------------------------------------------
// Shared assertion battery
// ---------------------------------------------------------------------------

async function runBattery(label: string, client: any, world: World, frameSizes: number[]): Promise<void> {
    log(`\n== [${label}] fire-and-forget + pre-connect ==`);
    client.analytics.pageViewed({ route: '/home' });
    await wait(30);
    assert(`[${label}] pre-connect call delivered (/early)`, world.serverEvents.includes('/early'), world.serverEvents);
    assert(`[${label}] fire-and-forget call delivered (/home)`, world.serverEvents.includes('/home'), world.serverEvents);

    log(`\n== [${label}] awaited request (async handler) ==`);
    const games = await client.games.list();
    assertEq(`[${label}] games.list() returns array`, games, ['g1', 'g2']);

    log(`\n== [${label}] get-await (leaf) ==`);
    const version = await client.config.version;
    assertEq(`[${label}] get config.version`, version, '1.0.0');

    log(`\n== [${label}] get-await blocked by valueGuard (object) ==`);
    try {
        await client.profile;
        assert(`[${label}] get on object should reject`, false);
    } catch (e: any) {
        assert(`[${label}] get on object rejected as not found`, String(e.message).includes('not found'), e.message);
    }

    log(`\n== [${label}] set (awaited request) ==`);
    const setResult = await client.counter.set(5);
    assertEq(`[${label}] set counter returns value`, setResult, 5);
    assertEq(`[${label}] counter is 5 after awaited set`, await client.counter, 5);

    log(`\n== [${label}] set (fire-and-forget assignment) ==`);
    client.counter = 9;
    await wait(20);
    assertEq(`[${label}] counter is 9 after assignment`, await client.counter, 9);

    log(`\n== [${label}] permission deny ==`);
    try {
        await client.admin.reset();
        assert(`[${label}] admin.reset should reject for role user`, false);
    } catch (e: any) {
        assert(`[${label}] admin.reset denied looks like not found`, String(e.message).includes('not found'), e.message);
    }

    log(`\n== [${label}] contract validation ==`);
    try {
        await client.profile.save({ displayName: '' });
        assert(`[${label}] invalid profile.save should reject`, false);
    } catch (e: any) {
        assert(`[${label}] invalid profile.save rejected (validation failed)`, String(e.message).includes('validation failed'), e.message);
    }
    assertEq(`[${label}] valid profile.save returns`, await client.profile.save({ displayName: 'Neo' }), 'saved:Neo');

    log(`\n== [${label}] getCurrentRole (prototype method on class) ==`);
    assertEq(`[${label}] whoAmI returns caller role`, await client.whoAmI(), 'user');

    log(`\n== [${label}] getCurrentSender push (server -> calling device) ==`);
    client.pingDevice();
    await wait(40);
    assert(`[${label}] client received pong push`, world.clientNotifications.includes('pong'), world.clientNotifications);

    log(`\n== [${label}] speculare: getCurrentSender mirror method back to caller ==`);
    client.relay('hi');
    await wait(40);
    assert(`[${label}] mirror method delivered back to caller`, world.clientChat.includes('echo:hi'), world.clientChat);

    log(`\n== [${label}] nested bidirectional request (client -> server -> client) ==`);
    assertEq(`[${label}] measure() returns client width via nested request`, await client.measure(), 1280);

    log(`\n== [${label}] batching in same tick ==`);
    const before = frameSizes.length;
    client.analytics.pageViewed({ route: '/a' });
    const batched = client.games.list();
    client.analytics.pageViewed({ route: '/b' });
    assertEq(`[${label}] batched request still resolves`, await batched, ['g1', 'g2']);
    const maxFrame = Math.max(...frameSizes.slice(before));
    assert(`[${label}] three same-tick ops shipped in one frame`, maxFrame >= 3, frameSizes.slice(before));

    log(`\n== [${label}] await after flush rejects (already flushed) ==`);
    const ticket = client.games.list();
    await wait(0); // microtask flush ships it as a fire-and-forget call
    try {
        await ticket;
        assert(`[${label}] awaiting a flushed call should reject`, false);
    } catch (e: any) {
        assert(`[${label}] flushed-as-call ticket rejects`, String(e.message).includes('already flushed'), e.message);
    }
}

// ---------------------------------------------------------------------------
// Transport: native WebSocket (Bun.serve handler-object + global WebSocket)
// ---------------------------------------------------------------------------

async function runWebSocket(): Promise<void> {
    log('\n##################### TRANSPORT: websocket #####################');
    const world = makeWorld();
    const frameSizes: number[] = [];

    const server = Bun.serve<{ role: string; proxy?: any }>({
        port: 0,
        fetch(req, srv) {
            const role = new URL(req.url).searchParams.get('role') || 'user';
            if (srv.upgrade(req, { data: { role } })) return;
            return new Response('rpcable v1 e2e');
        },
        websocket: {
            open(ws) {
                ws.data.proxy = new RpcAble({
                    transport: 'websocket',
                    connection: ws,
                    channel: CHANNEL,
                    targetReceiver: new UserSession(world),
                    role: ws.data.role,
                    permissions: SERVER_PERMISSIONS,
                    contract: SERVER_CONTRACT,
                    exposeErrors: true,
                });
            },
            message(ws, raw) {
                const envelope = decodeRpcMessage(raw, CHANNEL);
                if (!envelope) return;
                frameSizes.push(envelope.batch.length);
                dispatch(ws.data.proxy, envelope, { role: ws.data.role });
            },
            close(ws) {
                if (ws.data.proxy) destroy(ws.data.proxy);
            },
        },
    });
    log('[server] websocket listening on', `ws://localhost:${server.port}`);

    const clientWs = new WebSocket(`ws://localhost:${server.port}/?role=user`);
    const client: any = new RpcAble({
        transport: 'websocket',
        connection: clientWs,
        channel: CHANNEL,
        targetReceiver: {},
        role: 'peer',
    });
    attachClientHandlers(client, world);

    // Pre-connect buffer: this call happens while the socket is still CONNECTING.
    client.analytics.pageViewed({ route: '/early' });

    await new Promise<void>((resolve, reject) => {
        clientWs.addEventListener('open', () => resolve(), { once: true });
        clientWs.addEventListener('error', (e) => reject(e), { once: true });
    });
    await wait(30);

    await runBattery('ws', client, world, frameSizes);

    clientWs.close();
    await wait(30);
    server.stop(true);
}

// ---------------------------------------------------------------------------
// Transport: socket.io (both ends auto-subscribe to the channel)
// ---------------------------------------------------------------------------

async function runSocketIo(): Promise<void> {
    log('\n##################### TRANSPORT: socketio #####################');
    const world = makeWorld();
    const frameSizes: number[] = [];

    const httpServer = createServer();
    const ioServer = new SocketIoServer(httpServer);

    ioServer.on('connection', (socket: any) => {
        const role = (socket.handshake.query.role as string) || 'user';
        // extra listener purely to count inbound frames (does not dispatch)
        socket.on(CHANNEL, (env: any) => { if (env && Array.isArray(env.batch)) frameSizes.push(env.batch.length); });
        new RpcAble({
            transport: 'socketio',
            connection: socket,
            channel: CHANNEL,
            targetReceiver: new UserSession(world),
            role,
            permissions: SERVER_PERMISSIONS,
            contract: SERVER_CONTRACT,
            exposeErrors: true,
        });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const port = (httpServer.address() as any).port;
    log('[server] socketio listening on', `http://localhost:${port}`);

    const csock = ioClient(`http://localhost:${port}`, { query: { role: 'user' }, transports: ['websocket'] });
    const client: any = new RpcAble({
        transport: 'socketio',
        connection: csock,
        channel: CHANNEL,
        targetReceiver: {},
        role: 'peer',
    });
    attachClientHandlers(client, world);

    // Pre-connect: socket.io-client buffers this emit until the socket connects.
    client.analytics.pageViewed({ route: '/early' });

    await new Promise<void>((resolve, reject) => {
        csock.on('connect', () => resolve());
        csock.on('connect_error', (e: any) => reject(e));
    });
    await wait(40);

    await runBattery('socketio', client, world, frameSizes);

    csock.close();
    ioServer.close();
    httpServer.close();
    await wait(30);
}

// ---------------------------------------------------------------------------
// Security / defaults — in-process receiver fed crafted (attacker) envelopes
// ---------------------------------------------------------------------------

async function runSecurity(): Promise<void> {
    log('\n##################### SECURITY / DEFAULTS #####################');
    const fired = { danger: 0 };
    const target: any = {
        ping() { return 'pong'; },
        secretValue: 'shhh',
        get danger() { fired.danger++; return { reach: () => 'reached' }; },
    };
    // no permissions passed -> safe default { '*': { call: true } }
    const receiver = new RpcAbleReceiver({ target, role: 'user' });

    async function send(verb: string, path: string[], extra: any = {}): Promise<any> {
        const item = { type: 'request', senderTimeMs: Date.now(), id: 'x', verb, path, ...extra };
        const out = await receiver.dispatch({ _rpcable: 1, batch: [item as any] });
        return out[0];
    }

    let r = await send('call', ['ping'], { args: [] });
    assert('[sec] default perms: call allowed', r.ok === true && r.result === 'pong', r);

    r = await send('get', ['secretValue']);
    assert('[sec] default perms: get denied', r.ok === false && r.error.message.includes('not found'), r);

    r = await send('set', ['secretValue'], { value: 'x' });
    assert('[sec] default perms: set denied', r.ok === false, r);
    assertEq('[sec] secretValue untouched after denied set', target.secretValue, 'shhh');

    r = await send('call', ['constructor', 'constructor'], { args: ['return process'] });
    assert('[sec] constructor path blocked (RCE)', r.ok === false && r.error.message.includes('not found'), r);

    r = await send('call', ['ping', 'call'], { args: [] });
    assert('[sec] Function.prototype.call blocked', r.ok === false, r);

    r = await send('call', ['ping', 'apply'], { args: [] });
    assert('[sec] Function.prototype.apply blocked', r.ok === false, r);

    r = await send('call', ['toString'], { args: [] });
    assert('[sec] Object.prototype.toString blocked', r.ok === false, r);

    r = await send('call', ['danger', 'reach'], { args: [] });
    assert('[sec] intermediate accessor blocked, getter never fired', r.ok === false && fired.danger === 0, { r, fired });
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    await runWebSocket();
    await runSocketIo();
    await runSecurity();

    log('\n========================================');
    log(`RESULT: ${passed} passed, ${failed} failed`);
    log('========================================');
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    log('FATAL', e && e.stack ? e.stack : String(e));
    process.exit(1);
});
