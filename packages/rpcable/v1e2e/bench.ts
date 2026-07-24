// ============================================================================
// RpcAble v1 — micro-benchmarks.
//
// Measures throughput (ops/sec, ns/op) of the hot paths:
//   1. Outbound build+flush of fire-and-forget calls, at path depth 1/2/3.
//   2. Full request/response round trip via an in-process loopback
//      (sender -> flush -> receiver.dispatch -> sender.handleResponse).
//   3. Inbound receiver.dispatch of pre-built envelopes (call/get/set),
//      A/B on permissions, contract, validatePaths, valueGuard.
//   4. Sub-cost isolation: findDescriptor-style path walk, permission check,
//      validateSchema, in isolation from the rest of dispatch.
//
// Run: bun v1e2e/bench.ts
// ============================================================================

import {
    RpcAbleSender,
    RpcAbleReceiver,
    getSender,
    flush,
    dispatch,
    type RpcEnvelope,
    type RpcBatchItem,
    type RpcCallBatchItem,
    type RpcRequestBatchItem,
} from '../src/RpcAble.ts';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Result = { name: string; ops: number; nsPerOp: number; iters: number; totalMs: number };

const results: Result[] = [];

async function bench(name: string, iters: number, warmup: number, fn: (i: number) => any): Promise<void> {
    for (let i = 0; i < warmup; i++) await fn(i);
    const start = performance.now();
    for (let i = 0; i < iters; i++) await fn(i);
    const totalMs = performance.now() - start;
    const nsPerOp = (totalMs * 1e6) / iters;
    const ops = 1e9 / nsPerOp;
    results.push({ name, ops, nsPerOp, iters, totalMs });
}

function printResults(title: string): void {
    console.log(`\n=== ${title} ===`);
    for (const r of results) {
        console.log(
            `${r.name.padEnd(52)} ${fmt(r.ops).padStart(14)} ops/sec  ${fmt(r.nsPerOp).padStart(10)} ns/op  ` +
            `(${r.iters} iters, ${r.totalMs.toFixed(2)} ms)`
        );
    }
    results.length = 0;
}

function fmt(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: n < 100 ? 2 : 0 });
}

// ---------------------------------------------------------------------------
// Server session — class with prototype methods + nested namespaces.
// ---------------------------------------------------------------------------

class Games {
    list() { return ['g1', 'g2', 'g3']; }
}

class Analytics {
    pageViewed(_data: { route: string; ts: number }) { /* no-op */ }
}

class Config {
    version = '1.0.0';
}

class ServerSession {
    counter = 0;
    games = new Games();
    analytics = new Analytics();
    config = new Config();

    ping() { return 'pong'; }

    a = {
        b: {
            c: {
                pageViewed(_data: { x: number }) { /* depth-3 leaf */ },
            },
            pageViewed(_data: { x: number }) { /* depth-2 leaf */ },
        },
        pageViewed(_data: { x: number }) { /* depth-1 leaf */ },
    };

    echo(x: any) { return x; }
}

const SERVER_PERMISSIONS = {
    '*': { call: ['user', 'admin'] },
    'config.version': { get: ['user', 'admin'] },
    'counter': { get: ['user', 'admin'], set: ['user', 'admin'] },
};

const SERVER_CONTRACT = {
    'analytics.pageViewed': {
        inputSchema: {
            type: 'object',
            required: ['route', 'ts'],
            additionalProperties: false,
            properties: {
                route: { type: 'string', minLength: 1 },
                ts: { type: 'number' },
            },
        },
    },
    'a.b.c.pageViewed': {
        inputSchema: {
            type: 'object',
            required: ['x'],
            additionalProperties: false,
            properties: { x: { type: 'number' } },
        },
    },
};

// ---------------------------------------------------------------------------
// Helpers to build senders / receivers
// ---------------------------------------------------------------------------

function makeHttpSender(): any {
    return new RpcAbleSender({ transport: 'http', httpEndpoint: null, target: {} });
}

function makeReceiver(opts: Partial<{
    permissions: any; contract: any; validatePaths: boolean; valueGuard: boolean;
}> = {}): RpcAbleReceiver {
    return new RpcAbleReceiver({
        target: new ServerSession(),
        role: 'user',
        permissions: 'permissions' in opts ? opts.permissions : SERVER_PERMISSIONS,
        contract: 'contract' in opts ? opts.contract : undefined,
        validatePaths: opts.validatePaths ?? true,
        valueGuard: opts.valueGuard ?? true,
        maxBatchItems: 100_000,
    });
}

// Drain whatever queueMicrotask-scheduled flush is pending.
function microtaskFlush(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(() => resolve()));
}

// ---------------------------------------------------------------------------
// 1. Outbound: build + flush fire-and-forget calls at varying path depth
// ---------------------------------------------------------------------------

async function benchOutboundFlush(): Promise<void> {
    const ITERS = 50_000;
    const WARMUP = 2_000;

    // depth 1: client.ping(...)  (no nested namespace, just a top-level call)
    {
        const proxy = makeHttpSender();
        await bench('outbound depth=1  client.ping({x:1})', ITERS, WARMUP, async () => {
            proxy.ping({ x: 1 });
            await microtaskFlush();
            flush(proxy);
        });
    }

    // depth 2: client.analytics.pageViewed(...)
    {
        const proxy = makeHttpSender();
        await bench('outbound depth=2  client.analytics.pageViewed({x:1})', ITERS, WARMUP, async () => {
            proxy.analytics.pageViewed({ x: 1 });
            await microtaskFlush();
            flush(proxy);
        });
    }

    // depth 3: client.a.b.pageViewed(...)
    {
        const proxy = makeHttpSender();
        await bench('outbound depth=3  client.a.b.pageViewed({x:1})', ITERS, WARMUP, async () => {
            proxy.a.b.pageViewed({ x: 1 });
            await microtaskFlush();
            flush(proxy);
        });
    }

    // depth 4: client.a.b.c.pageViewed(...)
    {
        const proxy = makeHttpSender();
        await bench('outbound depth=4  client.a.b.c.pageViewed({x:1})', ITERS, WARMUP, async () => {
            proxy.a.b.c.pageViewed({ x: 1 });
            await microtaskFlush();
            flush(proxy);
        });
    }

    // batched: 10 fire-and-forget calls in the same microtask, one flush
    {
        const proxy = makeHttpSender();
        const BATCH = 10;
        await bench(`outbound batch=${BATCH}  10x analytics.pageViewed in one flush`, ITERS / BATCH, WARMUP / BATCH, async () => {
            for (let i = 0; i < BATCH; i++) proxy.analytics.pageViewed({ x: i });
            await microtaskFlush();
            flush(proxy);
        });
    }

    printResults('1. Outbound build + flush (fire-and-forget calls)');
}

// ---------------------------------------------------------------------------
// 2. Full request/response loopback (in-process)
// ---------------------------------------------------------------------------

// Feed a flushed wire batch into the receiver, then feed the produced
// responses back to the client sender.
async function roundTrip(clientProxy: any, receiver: RpcAbleReceiver): Promise<void> {
    await microtaskFlush();
    const wire = flush(clientProxy);
    if (wire.length === 0) return;
    const envelope: RpcEnvelope = { _rpcable: 1, batch: wire };
    const responses = await receiver.dispatch(envelope, { role: 'user' });
    if (responses.length === 0) return;
    const clientSender = getSender(clientProxy)!;
    for (const resp of responses) clientSender.handleResponse(resp as any);
}

async function benchRoundTrip(): Promise<void> {
    const ITERS = 20_000;
    const WARMUP = 1_000;

    // 2a. awaited call -> request: client.ping() awaited (sync handler, no args)
    {
        const proxy = makeHttpSender();
        const receiver = makeReceiver();
        await bench('roundtrip  await client.ping()', ITERS, WARMUP, async () => {
            const p = proxy.ping();
            const rt = roundTrip(proxy, receiver);
            const [result] = await Promise.all([p, rt]);
            return result;
        });
    }

    // 2b. awaited call with args + contract validation: analytics.pageViewed
    {
        const proxy = makeHttpSender();
        const receiver = makeReceiver({ contract: SERVER_CONTRACT });
        await bench('roundtrip  await client.analytics.pageViewed({route,ts}) [+contract]', ITERS, WARMUP, async (i) => {
            const p = proxy.analytics.pageViewed({ route: '/home', ts: i });
            const rt = roundTrip(proxy, receiver);
            await Promise.all([p, rt]);
        });
    }

    // 2c. get-await leaf: await client.config.version
    {
        const proxy = makeHttpSender();
        const receiver = makeReceiver();
        await bench('roundtrip  await client.config.version (get)', ITERS, WARMUP, async () => {
            const p = proxy.config.version;
            const rt = roundTrip(proxy, receiver);
            const [value] = await Promise.all([p, rt]);
            return value;
        });
    }

    // 2d. set-await: await client.counter.set(N)
    {
        const proxy = makeHttpSender();
        const receiver = makeReceiver();
        await bench('roundtrip  await client.counter.set(n)', ITERS, WARMUP, async (i) => {
            const p = proxy.counter.set(i);
            const rt = roundTrip(proxy, receiver);
            await Promise.all([p, rt]);
        });
    }

    // 2e. nested call (depth 3) awaited: await client.a.b.pageViewed({x})
    {
        const proxy = makeHttpSender();
        const receiver = makeReceiver();
        await bench('roundtrip  await client.a.b.pageViewed({x}) (depth=3)', ITERS, WARMUP, async (i) => {
            const p = proxy.a.b.pageViewed({ x: i });
            const rt = roundTrip(proxy, receiver);
            await Promise.all([p, rt]);
        });
    }

    printResults('2. Full request/response loopback');
}

// ---------------------------------------------------------------------------
// 3. Inbound dispatch of pre-built envelopes (call/get/set), A/B on config
// ---------------------------------------------------------------------------

function buildCallEnvelope(n: number, path: string[], args: any[]): RpcEnvelope {
    const batch: RpcCallBatchItem[] = [];
    for (let i = 0; i < n; i++) {
        batch.push({ type: 'call', senderTimeMs: Date.now(), verb: 'call', path, args });
    }
    return { _rpcable: 1, batch };
}

function buildRequestEnvelope(n: number, verb: 'call' | 'get' | 'set', path: string[], extra: any): RpcEnvelope {
    const batch: RpcRequestBatchItem[] = [];
    for (let i = 0; i < n; i++) {
        batch.push({ type: 'request', senderTimeMs: Date.now(), id: `r${i}`, verb, path, ...extra });
    }
    return { _rpcable: 1, batch };
}

async function benchInboundDispatch(): Promise<void> {
    const N = 50; // items per envelope
    const ITERS = 4_000;
    const WARMUP = 200;

    // ---- 3a. N call items: client.ping() fire-and-forget x N ----
    {
        const envelope = buildCallEnvelope(N, ['ping'], []);
        const receiver = makeReceiver();
        await bench(`dispatch  N=${N} call items (ping, default cfg)`, ITERS, WARMUP, async () => {
            await receiver.dispatch(envelope, { role: 'user' });
        });
    }

    // ---- 3b. N get-request items: get config.version x N ----
    {
        const envelope = buildRequestEnvelope(N, 'get', ['config', 'version'], {});
        const receiver = makeReceiver();
        await bench(`dispatch  N=${N} get-request items (config.version, default cfg)`, ITERS, WARMUP, async () => {
            await receiver.dispatch(envelope, { role: 'user' });
        });
    }

    // ---- 3c. N set-request items: set counter = i x N ----
    {
        const envelope = buildRequestEnvelope(N, 'set', ['counter'], { value: 7 });
        const receiver = makeReceiver();
        await bench(`dispatch  N=${N} set-request items (counter, default cfg)`, ITERS, WARMUP, async () => {
            await receiver.dispatch(envelope, { role: 'user' });
        });
    }

    // ---- 3d. N call-request items with contract: analytics.pageViewed ----
    {
        const envelope = buildRequestEnvelope(N, 'call', ['analytics', 'pageViewed'], { args: [{ route: '/x', ts: 123 }] });
        const receiverWithContract = makeReceiver({ contract: SERVER_CONTRACT });
        const receiverNoContract = makeReceiver({ contract: undefined });
        await bench(`dispatch  N=${N} call-request items (pageViewed, WITH contract)`, ITERS, WARMUP, async () => {
            await receiverWithContract.dispatch(envelope, { role: 'user' });
        });
        await bench(`dispatch  N=${N} call-request items (pageViewed, NO contract)`, ITERS, WARMUP, async () => {
            await receiverNoContract.dispatch(envelope, { role: 'user' });
        });
    }

    // ---- A/B: permissions on vs off (call to a deep path) ----
    {
        const envelope = buildCallEnvelope(N, ['a', 'b', 'c', 'pageViewed'], [{ x: 1 }]);
        const receiverWithPerms = makeReceiver({ permissions: SERVER_PERMISSIONS });
        const receiverNoPerms = makeReceiver({ permissions: null as any });
        await bench(`dispatch  N=${N} call items depth=4 (WITH permissions)`, ITERS, WARMUP, async () => {
            await receiverWithPerms.dispatch(envelope, { role: 'user' });
        });
        await bench(`dispatch  N=${N} call items depth=4 (NO permissions / open)`, ITERS, WARMUP, async () => {
            await receiverNoPerms.dispatch(envelope, { role: 'user' });
        });
    }

    // ---- A/B: validatePaths on vs off (get config.version) ----
    {
        const envelope = buildRequestEnvelope(N, 'get', ['config', 'version'], {});
        const receiverValidate = makeReceiver({ validatePaths: true });
        const receiverNoValidate = makeReceiver({ validatePaths: false });
        await bench(`dispatch  N=${N} get-request (validatePaths=true)`, ITERS, WARMUP, async () => {
            await receiverValidate.dispatch(envelope, { role: 'user' });
        });
        await bench(`dispatch  N=${N} get-request (validatePaths=false)`, ITERS, WARMUP, async () => {
            await receiverNoValidate.dispatch(envelope, { role: 'user' });
        });
    }

    // ---- A/B: valueGuard on vs off (get config.version) ----
    {
        const envelope = buildRequestEnvelope(N, 'get', ['config', 'version'], {});
        const receiverGuard = makeReceiver({ valueGuard: true });
        const receiverNoGuard = makeReceiver({ valueGuard: false });
        await bench(`dispatch  N=${N} get-request (valueGuard=true)`, ITERS, WARMUP, async () => {
            await receiverGuard.dispatch(envelope, { role: 'user' });
        });
        await bench(`dispatch  N=${N} get-request (valueGuard=false)`, ITERS, WARMUP, async () => {
            await receiverNoGuard.dispatch(envelope, { role: 'user' });
        });
    }

    printResults(`3. Inbound dispatch (N=${N} items/envelope)`);
}

// ---------------------------------------------------------------------------
// 4. Sub-cost isolation: path walk, permission check, schema validation
// ---------------------------------------------------------------------------

// Re-implement findDescriptor locally (it's not exported) to isolate its cost.
function findDescriptor(obj: any, key: string): PropertyDescriptor | null {
    let cur = obj;
    while (cur != null && cur !== Object.prototype && cur !== Function.prototype) {
        const desc = Object.getOwnPropertyDescriptor(cur, key);
        if (desc) return desc;
        cur = Object.getPrototypeOf(cur);
    }
    return null;
}

async function benchSubCosts(): Promise<void> {
    const ITERS = 200_000;
    const WARMUP = 5_000;

    const session = new ServerSession();

    // 4a. findDescriptor walk for a depth-1 own-data path: 'counter'
    await bench('subcost  findDescriptor("counter") [own data prop]', ITERS, WARMUP, () => {
        findDescriptor(session, 'counter');
    });

    // 4b. findDescriptor walk for a prototype method: 'ping' (1 level up proto chain)
    await bench('subcost  findDescriptor("ping") [prototype method]', ITERS, WARMUP, () => {
        findDescriptor(session, 'ping');
    });

    // 4c. full path walk depth=4: a -> b -> c -> pageViewed
    await bench('subcost  full path-walk depth=4 (a.b.c.pageViewed)', ITERS, WARMUP, () => {
        let current: any = session;
        for (const key of ['a', 'b', 'c', 'pageViewed']) {
            const desc = findDescriptor(current, key);
            if (!desc) throw new Error('unexpected');
            current = current[key];
        }
    });

    // 4d. permission check, in isolation: replicate _checkPermission logic
    const perms = SERVER_PERMISSIONS as any;
    function checkPermission(role: string, verb: string, pathStr: string): boolean {
        let rule: any;
        if (Object.prototype.hasOwnProperty.call(perms, pathStr)) rule = perms[pathStr];
        else if (Object.prototype.hasOwnProperty.call(perms, '*')) rule = perms['*'];
        else return false;
        let roles: any;
        if (rule !== null && typeof rule === 'object' && !Array.isArray(rule)) roles = rule[verb];
        else roles = verb === 'call' ? rule : undefined;
        if (roles === true) return true;
        if (roles === false || roles === undefined) return false;
        if (Array.isArray(roles)) return roles.indexOf(role) !== -1;
        return false;
    }
    await bench('subcost  permission check (wildcard call rule)', ITERS, WARMUP, () => {
        checkPermission('user', 'call', 'a.b.c.pageViewed');
    });
    await bench('subcost  permission check (exact-path get rule)', ITERS, WARMUP, () => {
        checkPermission('user', 'get', 'config.version');
    });

    // 4e. validateSchema in isolation — import via dynamic require not possible
    // (not exported); reproduce the exact shape used in SERVER_CONTRACT and
    // measure a structurally equivalent validator inline using the receiver's
    // dispatch as ground truth is covered in section 3. Here we just measure
    // the cost of JSON.stringify(path) / array join, which dispatch does per item.
    const path4 = ['a', 'b', 'c', 'pageViewed'];
    await bench('subcost  path.join(".") for depth=4 path', ITERS, WARMUP, () => {
        path4.join('.');
    });

    // 4f. randomId-equivalent cost (used per request to mint an id)
    function randomId(): string {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }
    await bench('subcost  randomId() (request id minting)', ITERS, WARMUP, () => {
        randomId();
    });

    // 4g. JSON.stringify/parse of a small envelope (proxy for HTTP transport cost)
    const sampleEnvelope = buildRequestEnvelope(5, 'call', ['analytics', 'pageViewed'], { args: [{ route: '/x', ts: 123 }] });
    const sampleStr = JSON.stringify(sampleEnvelope);
    await bench('subcost  JSON.stringify(envelope) (5 items)', ITERS, WARMUP, () => {
        JSON.stringify(sampleEnvelope);
    });
    await bench('subcost  JSON.parse(envelope) (5 items)', ITERS, WARMUP, () => {
        JSON.parse(sampleStr);
    });

    printResults('4. Sub-cost isolation');
}

// ---------------------------------------------------------------------------
// 5. Extra: isolate async-function-call overhead (call vs request dispatch)
// ---------------------------------------------------------------------------

async function benchAsyncOverhead(): Promise<void> {
    const N = 50;
    const ITERS = 4000;
    const WARMUP = 200;

    // Same target path/verb (call 'ping'), but as 'call' item (sync, invokeCall)
    // vs 'request' item (async, invokeRequest) to isolate the async-call tax.
    {
        const callEnvelope = buildCallEnvelope(N, ['ping'], []);
        const requestEnvelope = buildRequestEnvelope(N, 'call', ['ping'], { args: [] });
        const receiver1 = makeReceiver();
        const receiver2 = makeReceiver();
        await bench(`dispatch  N=${N} 'call' items -> invokeCall (sync path)`, ITERS, WARMUP, async () => {
            await receiver1.dispatch(callEnvelope, { role: 'user' });
        });
        await bench(`dispatch  N=${N} 'request' items -> invokeRequest (async path)`, ITERS, WARMUP, async () => {
            await receiver2.dispatch(requestEnvelope, { role: 'user' });
        });
    }

    printResults("5. call (sync invokeCall) vs request (async invokeRequest) for the SAME handler");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    console.log('RpcAble v1 — micro-benchmarks');
    console.log(`Bun ${typeof Bun !== 'undefined' ? Bun.version : '?'}`);

    await benchOutboundFlush();
    await benchRoundTrip();
    await benchInboundDispatch();
    await benchAsyncOverhead();
    await benchSubCosts();
}

main().catch((e) => {
    console.error('FATAL', e && e.stack ? e.stack : String(e));
    process.exit(1);
});
