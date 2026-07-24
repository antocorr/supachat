// ============================================================================
// RpcAble v1 — transparent RPC over socket.io, native WebSocket, and HTTP.
//
// One ordered batch per flush window; every item is a 'call', 'request', or
// 'response'. The array order IS the protocol order — no timestamps for
// ordering. See .claude/RpcAbleTs-api.md (source of truth) and the plan docs.
//
// Concepts:
//   - RpcAbleSender   outbound proxy, transport, pending requests (tickets)
//   - RpcAbleReceiver inbound dispatch, permissions, contract, guards
//   - RpcAble         composer: wires a sender + receiver and returns the proxy
// ============================================================================

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RpcAbleTransport = 'socketio' | 'websocket' | 'http';
export type RpcVerb = 'call' | 'get' | 'set';

// 'parent' (default): this = the object that directly owns the invoked method.
// 'target': this = receiver.target — useful when the method lives on an object
// shared across multiple receivers/sessions (e.g. a shared "contextSpace"), so
// `this` becomes the calling session instead of the shared object itself.
export type RpcThisBinding = 'parent' | 'target';

export type RpcPermissionRoles = string[] | boolean;
export type RpcPermissionRule = RpcPermissionRoles | {
    call?: RpcPermissionRoles;
    get?: RpcPermissionRoles;
    set?: RpcPermissionRoles;
};

// Keys are dot-joined RPC paths, checked in this order:
//   1. exact path, e.g. "contextSpace.getUpdate"
//   2. "prefix.*" — matches any path strictly under "prefix" (not "prefix" itself);
//      the longest matching prefix wins, e.g. "a.b.*" beats "a.*" for "a.b.c"
//   3. "*" — global fallback for any path with no exact or wildcard match
// No match at all -> deny by default.
//
// Caution: a "prefix.*" rule grants the listed roles access to every current AND
// future path under that prefix — review what you expose under a wildcard namespace.
export type RpcPermissions = Record<string, RpcPermissionRule>;

export type RpcContract = Record<string, { inputSchema?: any; setSchema?: any }>;

export type LoggingMode = 'log' | 'info' | 'warn' | 'error' | 'throw' | null;
export type LoggingRuleKind = 'notFound' | 'forbidden' | 'validationFailed' | 'dispatchError';

export type LoggingFunctions = {
    log: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    throw: (message: string) => never;
};

export type LoggingOptions = {
    rules?: Partial<Record<LoggingRuleKind, LoggingMode>>;
    functions?: Partial<LoggingFunctions>;
};

export type RpcSerializedError = { name: string; message: string };

export type RpcCallBatchItem = {
    type: 'call';
    senderTimeMs: number;
    verb: RpcVerb;
    path: string[];
    args?: any[];
    value?: any;
};

export type RpcRequestBatchItem = {
    type: 'request';
    senderTimeMs: number;
    id: string;
    verb: RpcVerb;
    path: string[];
    args?: any[];
    value?: any;
};

export type RpcResponseBatchItem = {
    type: 'response';
    senderTimeMs: number;
    id: string;
    ok: boolean;
    result?: any;
    error?: RpcSerializedError;
};

export type RpcBatchItem = RpcCallBatchItem | RpcRequestBatchItem | RpcResponseBatchItem;

export type RpcEnvelope = { _rpcable: 1; batch: RpcBatchItem[] };

export type EncodedRpcMessage = { _rpcable: 1; channel: string; batch: RpcBatchItem[] };

export type RpcAbleRequestTicket<T = any> = {
    then(onFulfilled?: (value: T) => any, onRejected?: (reason: any) => any): Promise<any>;
    catch(onRejected?: (reason: any) => any): Promise<any>;
    finally(onFinally?: () => void): Promise<any>;
};

export type RpcAbleSenderOptions = {
    target?: any;
    transport?: RpcAbleTransport;
    connection?: any;
    channel?: string;
    requestTimeoutMs?: number;
    httpEndpoint?: string | null;
    httpHeaders?: Record<string, string>;
    fetchImpl?: typeof fetch;
};

export type RpcAbleReceiverOptions = {
    target?: any;
    permissions?: RpcPermissions;
    logging?: LoggingOptions;
    contract?: RpcContract;
    role: string;
    validatePaths?: boolean;
    valueGuard?: boolean | ((value: any, verb: RpcVerb, path: string[]) => boolean);
    thisBinding?: RpcThisBinding;
    maxBatchItems?: number;
    maxBatchSize?: number;
    exposeErrors?: boolean;
};

export type RpcAbleOptions = RpcAbleSenderOptions & RpcAbleReceiverOptions & {
    targetSender?: any;
    targetReceiver?: any;
};

export type RpcDispatchOptions = { role?: string };

export type RpcAbleExtendOptions = Partial<Omit<RpcAbleReceiverOptions, 'target'>>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const LOGGING_RULE_DEFAULTS: Record<LoggingRuleKind, LoggingMode> = {
    notFound: null,
    forbidden: 'warn',
    validationFailed: null,
    dispatchError: 'error',
};

const LOGGING_FN_DEFAULTS: LoggingFunctions = {
    log: (m) => console.log(m),
    info: (m) => console.info(m),
    warn: (m) => console.warn(m),
    error: (m) => console.error(m),
    throw: (m) => { throw new Error(m); },
};

const RECEIVER_OPTION_KEYS = [
    'target', 'permissions', 'logging', 'contract', 'role',
    'validatePaths', 'valueGuard', 'thisBinding', 'maxBatchItems', 'maxBatchSize', 'exposeErrors',
];

// Shared metadata link between a sender, its receiver, the proxy and the raw
// targets. Stored under a non-enumerable symbol so it never shadows a remote path.
const RPC_LINK = Symbol('rpcable.link');

// ---------------------------------------------------------------------------
// Schema validation (small built-in validator, ported from V0)
// ---------------------------------------------------------------------------

const SCHEMA_CHECKERS: Record<string, (v: any) => boolean> = {
    string: v => typeof v === 'string',
    number: v => typeof v === 'number' && !Number.isNaN(v),
    integer: v => Number.isInteger(v),
    boolean: v => typeof v === 'boolean',
    null: v => v === null,
    array: v => Array.isArray(v),
    object: v => v !== null && typeof v === 'object' && !Array.isArray(v),
};

type SchemaCheck = { valid: boolean; error?: string };

function validateSchema(schema: any, value: any): SchemaCheck {
    if (schema === true) return { valid: true };
    if (schema === false) return { valid: false, error: 'schema is false' };
    if (!schema || typeof schema !== 'object') return { valid: true };

    if (Array.isArray(schema.enum)) {
        if (!schema.enum.some((e: any) => e === value)) {
            return { valid: false, error: `value must be one of [${schema.enum.join(', ')}]` };
        }
    }

    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some((t: string) => (SCHEMA_CHECKERS[t] ? SCHEMA_CHECKERS[t](value) : true))) {
            const got = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
            return { valid: false, error: `expected type "${schema.type}" but got ${got}` };
        }
    }

    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            return { valid: false, error: `minLength is ${schema.minLength}, got ${value.length}` };
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            return { valid: false, error: `maxLength is ${schema.maxLength}, got ${value.length}` };
        }
    }

    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            return { valid: false, error: `minimum is ${schema.minimum}, got ${value}` };
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            return { valid: false, error: `maximum is ${schema.maximum}, got ${value}` };
        }
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (Array.isArray(schema.required)) {
            for (const req of schema.required) {
                if (!Object.prototype.hasOwnProperty.call(value, req)) {
                    return { valid: false, error: `missing required property "${req}"` };
                }
            }
        }
        if (schema.properties && typeof schema.properties === 'object') {
            for (const prop of Object.keys(schema.properties)) {
                if (Object.prototype.hasOwnProperty.call(value, prop)) {
                    const check = validateSchema(schema.properties[prop], value[prop]);
                    if (!check.valid) {
                        return { valid: false, error: `property "${prop}": ${check.error}` };
                    }
                }
            }
        }
        if (schema.additionalProperties === false && schema.properties) {
            for (const key of Object.keys(value)) {
                if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
                    return { valid: false, error: `additional property "${key}" not allowed` };
                }
            }
        }
    }

    if (Array.isArray(value) && schema.items !== undefined) {
        for (let i = 0; i < value.length; i++) {
            const check = validateSchema(schema.items, value[i]);
            if (!check.valid) {
                return { valid: false, error: `item[${i}]: ${check.error}` };
            }
        }
    }

    return { valid: true };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function randomId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function serializeError(error: any): RpcSerializedError {
    if (error instanceof Error) return { name: error.name, message: error.message };
    return { name: 'Error', message: String(error) };
}

function notFoundError(pathStr: string): RpcSerializedError {
    return { name: 'Error', message: `[RpcAble] ${pathStr} not found` };
}

function hasOwn(obj: any, key: string): boolean {
    return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

const getOwnDesc = Object.getOwnPropertyDescriptor;
const getProto = Object.getPrototypeOf;

// Prototypes that ship "for free" with built-in types. A plain object/array
// stored as RPC-exposed data sits directly on one of these — if the walk in
// findDescriptor didn't stop here, paths like ["todos","splice"] or
// ["users","slice"] would resolve to Array.prototype methods, letting a peer
// mutate or read through them regardless of permissions/contract/value guard.
const BUILTIN_PROTOTYPES = new Set<any>([
    Object.prototype,
    Function.prototype,
    Array.prototype,
    String.prototype,
    Number.prototype,
    Boolean.prototype,
    Symbol.prototype,
    Date.prototype,
    RegExp.prototype,
    Map.prototype,
    Set.prototype,
    WeakMap.prototype,
    WeakSet.prototype,
    Promise.prototype,
    Error.prototype,
    ArrayBuffer.prototype,
    DataView.prototype,
    getProto(Int8Array.prototype), // shared %TypedArray%.prototype
]);
if (typeof BigInt !== 'undefined') BUILTIN_PROTOTYPES.add(BigInt.prototype);
if (typeof SharedArrayBuffer !== 'undefined') BUILTIN_PROTOTYPES.add(SharedArrayBuffer.prototype);

// Find the property descriptor for `key` walking the prototype chain, stopping
// at any built-in prototype (see BUILTIN_PROTOTYPES). Returns null when
// unreachable, so built-in methods (push, splice, slice, toString, valueOf,
// call, apply, bind, ...) are never resolved unless shadowed as own.
// Application-defined prototypes are still walked, so `class { method() {} }`
// keeps working (parity V0), while the prototype-pollution and
// Function-constructor surfaces stay closed (together with UNSAFE_KEYS).
function findDescriptor(obj: any, key: string): PropertyDescriptor | null {
    let cur = obj;
    while (cur != null && !BUILTIN_PROTOTYPES.has(cur)) {
        const desc = getOwnDesc(cur, key);
        if (desc) return desc;
        cur = getProto(cur);
    }
    return null;
}

function isSafeLeaf(value: any): boolean {
    if (value === null) return true;
    const t = typeof value;
    return t === 'string' || t === 'number' || t === 'boolean';
}

function rawToString(raw: any): string | null {
    if (typeof raw === 'string') return raw;
    if (typeof Buffer !== 'undefined' && (Buffer as any).isBuffer(raw)) return (raw as any).toString('utf8');
    if (raw instanceof Uint8Array) return new TextDecoder().decode(raw);
    return null;
}

function assignPath(target: any, key: string, value: any): void {
    if (!target || typeof target !== 'object') return;
    if (key.indexOf('.') === -1) {
        if (UNSAFE_KEYS.has(key)) return;
        target[key] = value;
        return;
    }
    const parts = key.split('.');
    let current = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (UNSAFE_KEYS.has(part)) return;
        if (!current[part] || typeof current[part] !== 'object') current[part] = {};
        current = current[part];
    }
    const last = parts[parts.length - 1];
    if (UNSAFE_KEYS.has(last)) return;
    current[last] = value;
}

// ---------------------------------------------------------------------------
// WebSocket wire encode/decode (flat wrapper, no duplicated _rpcable)
// ---------------------------------------------------------------------------

export function encodeRpcMessage(channel: string, envelope: RpcEnvelope): string {
    return JSON.stringify({ _rpcable: 1, channel, batch: envelope.batch });
}

export function decodeRpcMessage(payload: any, channel?: string): RpcEnvelope | null {
    let parsed: any = payload;
    const str = rawToString(payload);
    if (str !== null) {
        try { parsed = JSON.parse(str); } catch { return null; }
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.batch)) return null;
    if (channel !== undefined && parsed.channel !== channel) return null;
    return { _rpcable: 1, batch: parsed.batch };
}

// ---------------------------------------------------------------------------
// Metadata link resolution
// ---------------------------------------------------------------------------

type RpcLink = {
    sender: RpcAbleSender | null;
    receiver: RpcAbleReceiver | null;
    instance: any | null; // composer RpcAble instance when composed
};

function defineLink(holder: any, link: RpcLink): void {
    if (!holder || (typeof holder !== 'object' && typeof holder !== 'function')) return;
    Object.defineProperty(holder, RPC_LINK, { value: link, enumerable: false, configurable: true, writable: true });
}

function attachLink(holder: any, role: 'sender' | 'receiver', value: any): RpcLink {
    let link: RpcLink | undefined = holder ? holder[RPC_LINK] : undefined;
    if (!link) {
        link = { sender: null, receiver: null, instance: null };
        defineLink(holder, link);
    }
    link[role] = value;
    return link;
}

function getLink(info: any): RpcLink | null {
    if (info == null || (typeof info !== 'object' && typeof info !== 'function')) return null;
    const direct: RpcLink | undefined = info[RPC_LINK];
    if (direct) return direct;
    // Explicit descriptor for separately-created targets.
    if (Object.prototype.hasOwnProperty.call(info, 'targetSender') || Object.prototype.hasOwnProperty.call(info, 'targetReceiver')) {
        const sender = info.targetSender ? getSender(info.targetSender) : null;
        const receiver = info.targetReceiver ? getReceiver(info.targetReceiver) : null;
        if (sender || receiver) return { sender, receiver, instance: null };
    }
    return null;
}

export function getSender(info: any): RpcAbleSender | null {
    const link = getLink(info);
    return link ? link.sender : null;
}

export function getReceiver(info: any): RpcAbleReceiver | null {
    const link = getLink(info);
    return link ? link.receiver : null;
}

export function getInstance(info: any): any | null {
    const link = getLink(info);
    if (!link) return null;
    return link.instance ?? link.sender ?? link.receiver;
}

export function getTransport(info: any): RpcAbleTransport | null {
    const sender = getSender(info);
    return sender ? sender.transport : null;
}

// ---------------------------------------------------------------------------
// RpcAbleSender — outbound proxy, transport, pending requests
// ---------------------------------------------------------------------------

type SenderOp = {
    kind: 'op';
    type: 'call' | 'request';
    verb: RpcVerb;
    path: string[];
    args: any[] | undefined;
    value: any;
    id: string | null;
    requestPromise: Promise<any> | null;
    flushedAsCall: boolean;
};

type ResponseEntry = { kind: 'response'; wire: RpcResponseBatchItem };
type BatchEntry = SenderOp | ResponseEntry;

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: any;
    path: string[];
};

type ConnectionListener = { event: string; fn: any; isSocketIo: boolean };

function inferTransport(options: RpcAbleSenderOptions): RpcAbleTransport {
    if (options.transport) return options.transport;
    if ('httpEndpoint' in options) return 'http';
    const conn = options.connection;
    if (conn && typeof conn.emit === 'function') return 'socketio';
    if (conn && typeof conn.send === 'function') return 'websocket';
    throw new Error('[RpcAble] cannot infer transport: pass an explicit "transport"');
}

export class RpcAbleSender {
    transport: RpcAbleTransport;
    channel: string;
    connection: any;
    requestTimeoutMs: number;
    httpEndpoint: string | null;
    httpHeaders: Record<string, string>;
    fetchImpl: typeof fetch | undefined;
    target: any;
    proxy: any;

    private _batch: BatchEntry[] | null = null;
    private _outbound: RpcBatchItem[] = [];
    private _pending = new Map<string, PendingRequest>();
    private _preConnect: RpcEnvelope[] = [];
    private _destroyed = false;
    private _activeAborts = new Set<AbortController>();
    private _listeners: ConnectionListener[] = [];
    private _nodeHandler!: ProxyHandler<any>;
    private _ticketProto!: any;

    constructor(options: RpcAbleSenderOptions) {
        if (!options || typeof options !== 'object') {
            throw new Error('[RpcAble] RpcAbleSender requires an options object');
        }
        this.transport = inferTransport(options);
        this.connection = options.connection || null;
        this.channel = options.channel ?? '';
        this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
        this.httpEndpoint = options.httpEndpoint ?? null;
        this.httpHeaders = options.httpHeaders || { 'Content-Type': 'application/json' };
        this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : undefined);
        this.target = options.target || {};

        if (this.transport === 'http' && this.httpEndpoint != null && typeof this.fetchImpl !== 'function') {
            throw new Error('[RpcAble] http client transport requires a fetch implementation');
        }
        if ((this.transport === 'socketio' || this.transport === 'websocket') && !this.connection) {
            throw new Error(`[RpcAble] ${this.transport} transport requires a connection`);
        }

        attachLink(this.target, 'sender', this);
        defineLink(this, this.target[RPC_LINK]);
        this._nodeHandler = this._buildNodeHandler();
        this._ticketProto = this._buildTicketProto();
        this.proxy = this._createProxy();
        this._subscribe();

        return this.proxy;
    }

    // ----- proxy -----

    private _createProxy(): any {
        const sender = this;
        const handler: ProxyHandler<any> = {
            get(target, prop, receiver) {
                if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
                if (prop === 'then') return undefined; // the root proxy is never a thenable
                if (prop in target) return target[prop]; // local props win
                return sender._node([prop]);
            },
            set(target, prop, value, receiver) {
                if (typeof prop === 'symbol') return Reflect.set(target, prop, value, receiver);
                if (hasOwn(target, prop as string)) { target[prop as string] = value; return true; }
                sender._enqueueOp('call', 'set', [prop as string], undefined, value);
                return true;
            },
        };
        return new Proxy(this.target, handler);
    }

    // A path node: navigable (get), callable (apply), assignable (set). The node
    // state (path + get-await op cache) lives on the carrier function; all nodes
    // of a sender share one handler, so navigation allocates only carrier + Proxy.
    private _node(path: string[]): any {
        const carrier: any = function () {};
        carrier._path = path;
        carrier._getOp = null;
        return new Proxy(carrier, this._nodeHandler);
    }

    private _buildNodeHandler(): ProxyHandler<any> {
        const sender = this;
        return {
            get(carrier: any, prop) {
                if (prop === 'then') {
                    // get-await: promote a 'get' request lazily, in the getter itself.
                    if (!carrier._getOp) carrier._getOp = sender._enqueueGetRequest(carrier._path);
                    const p = carrier._getOp.requestPromise as Promise<any>;
                    return p.then.bind(p);
                }
                if (prop === 'set') return (value: any) => sender._createSetTicket(carrier._path, value);
                if (typeof prop === 'symbol') return undefined;
                return sender._node(carrier._path.concat(prop as string));
            },
            apply(carrier: any, _thisArg, args: any[]) {
                return sender._createCallTicket(carrier._path, args);
            },
            set(carrier: any, prop, value) {
                if (typeof prop === 'symbol') return false;
                sender._enqueueOp('call', 'set', carrier._path.concat(prop as string), undefined, value);
                return true;
            },
        };
    }

    private _createCallTicket(path: string[], args: any[]): RpcAbleRequestTicket {
        const op = this._enqueueOp('call', 'call', path, args, undefined);
        return this._ticketFor(op);
    }

    private _createSetTicket(path: string[], value: any): RpcAbleRequestTicket {
        const op = this._enqueueOp('call', 'set', path, undefined, value);
        return this._ticketFor(op);
    }

    private _enqueueGetRequest(path: string[]): SenderOp {
        const op = this._enqueueOp('call', 'get', path, undefined, undefined);
        this._promote(op);
        return op;
    }

    // The ticket is a lazy thenable: touching .then/.catch/.finally converts the
    // op from a fire-and-forget call into an awaited request, before the flush.
    // The getters live on a shared per-sender prototype, so a ticket is one
    // Object.create + one own field instead of three fresh closures.
    private _ticketFor(op: SenderOp): RpcAbleRequestTicket {
        const t: any = Object.create(this._ticketProto);
        t._op = op;
        return t as RpcAbleRequestTicket;
    }

    private _buildTicketProto(): any {
        const sender = this;
        return {
            get then() { const p = sender._promote((this as any)._op); return p.then.bind(p); },
            get catch() { const p = sender._promote((this as any)._op); return p.catch.bind(p); },
            get finally() { const p = sender._promote((this as any)._op); return p.finally.bind(p); },
        };
    }

    private _promote(op: SenderOp): Promise<any> {
        if (op.requestPromise) return op.requestPromise;
        if (op.flushedAsCall) {
            return Promise.reject(new Error(`[RpcAble] ${op.path.join('.')} already flushed as fire-and-forget`));
        }
        op.type = 'request';
        op.id = randomId();
        const id = op.id;
        const timeoutMs = this.requestTimeoutMs;
        op.requestPromise = new Promise((resolve, reject) => {
            let timer: any = null;
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    this._pending.delete(id);
                    reject(new Error(`[RpcAble] request timeout after ${timeoutMs}ms: ${op.path.join('.')}`));
                }, timeoutMs);
            }
            this._pending.set(id, { resolve, reject, timer, path: op.path });
        });
        return op.requestPromise;
    }

    private _enqueueOp(type: 'call', verb: RpcVerb, path: string[], args: any[] | undefined, value: any): SenderOp {
        const op: SenderOp = {
            kind: 'op',
            type,
            verb,
            path,
            args,
            value,
            id: null,
            requestPromise: null,
            flushedAsCall: false,
        };
        this._ensureBatch();
        (this._batch as BatchEntry[]).push(op);
        return op;
    }

    // Called by the receiver/dispatch to send a produced response back to the peer.
    enqueueResponse(item: RpcResponseBatchItem): void {
        this._ensureBatch();
        (this._batch as BatchEntry[]).push({ kind: 'response', wire: item });
    }

    private _ensureBatch(): void {
        if (!this._batch) {
            this._batch = [];
            queueMicrotask(() => this._flush());
        }
    }

    // ----- flush -----

    private _flush(): void {
        const batch = this._batch;
        this._batch = null;
        if (!batch || !batch.length) return;

        // One timestamp per flush window: every op in a batch is sent together.
        const now = Date.now();
        const wire: RpcBatchItem[] = [];
        for (let i = 0; i < batch.length; i++) {
            const entry = batch[i];
            if (entry.kind === 'response') {
                wire.push(entry.wire);
                continue;
            }
            const verb = entry.verb;
            const item: any = { type: entry.type, senderTimeMs: now, verb, path: entry.path };
            if (entry.type === 'request') item.id = entry.id;
            else entry.flushedAsCall = true;
            if (verb === 'set') item.value = entry.value;
            else if (verb === 'call') item.args = entry.args || [];
            wire.push(item);
        }
        this._send(wire);
    }

    private _send(wire: RpcBatchItem[]): void {
        if (this._destroyed) return;
        if (this.transport === 'socketio') {
            this.connection.emit(this.channel, { _rpcable: 1, batch: wire });
            return;
        }
        if (this.transport === 'websocket') {
            this._sendWebSocket(wire);
            return;
        }
        // http server side: accumulate for flush(). Adopt the fresh array when the
        // queue is empty (the common single-flush case), otherwise append.
        if (this.httpEndpoint == null) {
            if (this._outbound.length === 0) {
                this._outbound = wire;
            } else {
                const out = this._outbound;
                for (let i = 0; i < wire.length; i++) out.push(wire[i]);
            }
            return;
        }
        void this._sendHttp({ _rpcable: 1, batch: wire });
    }

    private _sendWebSocket(wire: RpcBatchItem[]): void {
        const conn = this.connection;
        const envelope: RpcEnvelope = { _rpcable: 1, batch: wire };
        if (typeof conn.readyState === 'number') {
            const connecting = conn.CONNECTING ?? 0;
            const open = conn.OPEN ?? 1;
            if (conn.readyState === connecting) {
                this._preConnect.push(envelope);
                return;
            }
            if (conn.readyState !== open) {
                this._rejectRequests(wire, new Error('[RpcAble] WebSocket is not open'));
                return;
            }
        }
        conn.send(encodeRpcMessage(this.channel, envelope));
    }

    private async _sendHttp(envelope: RpcEnvelope): Promise<void> {
        const ac = new AbortController();
        this._activeAborts.add(ac);
        try {
            const res = await (this.fetchImpl as typeof fetch).call(globalThis, this.httpEndpoint as string, {
                method: 'POST',
                headers: this.httpHeaders,
                body: JSON.stringify(envelope),
                signal: ac.signal,
            });
            this._activeAborts.delete(ac);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const raw = await res.text();
            const incoming = this._parseIncoming(raw);
            if (incoming && !this._destroyed) void dispatch(this, incoming);
        } catch (error) {
            this._activeAborts.delete(ac);
            this._rejectRequests(envelope.batch, error);
        }
    }

    // Guard the raw inbound size against the coupled receiver's maxBatchSize.
    private _parseIncoming(raw: string): RpcEnvelope | null {
        const receiver = getReceiver(this);
        if (receiver && receiver.maxBatchSize > 0 && raw.length > receiver.maxBatchSize) {
            receiver._log('dispatchError', `[RpcAble] inbound frame exceeds maxBatchSize (${raw.length} > ${receiver.maxBatchSize})`);
            return null;
        }
        let parsed: any;
        try { parsed = JSON.parse(raw); } catch { return null; }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.batch)) return null;
        return { _rpcable: 1, batch: parsed.batch };
    }

    private _rejectRequests(wire: RpcBatchItem[], error: any): void {
        for (let i = 0; i < wire.length; i++) {
            const it = wire[i];
            if (it.type !== 'request') continue;
            const pending = this._pending.get(it.id);
            if (!pending) continue;
            if (pending.timer) clearTimeout(pending.timer);
            this._pending.delete(it.id);
            pending.reject(error);
        }
    }

    // ----- inbound responses -----

    handleResponse(item: RpcResponseBatchItem): void {
        const id = item.id;
        if (!id) return;
        const pending = this._pending.get(id);
        if (!pending) return; // unknown id (late or forged) — ignored silently
        if (pending.timer) clearTimeout(pending.timer);
        this._pending.delete(id);
        if (item.ok) { pending.resolve(item.result); return; }
        const info = item.error;
        const message = info && info.message ? info.message : '[RpcAble] request failed';
        const err = new Error(message);
        if (info && info.name) err.name = info.name;
        pending.reject(err);
    }

    // ----- queue drain (http server side) -----

    flushQueued(): RpcBatchItem[] {
        if (this._batch) this._flush();
        const out = this._outbound;
        this._outbound = [];
        return out;
    }

    // ----- subscription -----

    private _subscribe(): void {
        const conn = this.connection;
        if (!conn) return;

        if (this.transport === 'socketio' && typeof conn.on === 'function') {
            const fn = (payload: any) => {
                const envelope = this._coerceEnvelope(payload);
                if (envelope) void dispatch(this, envelope);
            };
            conn.on(this.channel, fn);
            this._listeners.push({ event: this.channel, fn, isSocketIo: true });
            return;
        }

        if (this.transport === 'websocket' && typeof conn.addEventListener === 'function') {
            const onMessage = (event: any) => {
                const raw = event && event.data !== undefined ? event.data : event;
                const str = rawToString(raw);
                if (str !== null) {
                    const receiver = getReceiver(this);
                    if (receiver && receiver.maxBatchSize > 0 && str.length > receiver.maxBatchSize) {
                        receiver._log('dispatchError', `[RpcAble] inbound frame exceeds maxBatchSize (${str.length} > ${receiver.maxBatchSize})`);
                        return;
                    }
                }
                const envelope = decodeRpcMessage(str ?? raw, this.channel);
                if (envelope) void dispatch(this, envelope);
            };
            conn.addEventListener('message', onMessage);
            this._listeners.push({ event: 'message', fn: onMessage, isSocketIo: false });

            const connecting = conn.CONNECTING ?? 0;
            if (typeof conn.readyState === 'number' && conn.readyState === connecting) {
                const onOpen = () => {
                    const pending = this._preConnect;
                    this._preConnect = [];
                    for (let i = 0; i < pending.length; i++) {
                        conn.send(encodeRpcMessage(this.channel, pending[i]));
                    }
                };
                conn.addEventListener('open', onOpen);
                this._listeners.push({ event: 'open', fn: onOpen, isSocketIo: false });
            }

            const onClose = () => this.destroy();
            conn.addEventListener('close', onClose);
            this._listeners.push({ event: 'close', fn: onClose, isSocketIo: false });
        }
    }

    private _coerceEnvelope(payload: any): RpcEnvelope | null {
        if (Array.isArray(payload)) return { _rpcable: 1, batch: payload };
        if (payload && typeof payload === 'object' && Array.isArray(payload.batch)) {
            return { _rpcable: 1, batch: payload.batch };
        }
        return null;
    }

    destroy(): void {
        this._destroyed = true;
        const error = new Error('[RpcAble] sender destroyed');
        for (const pending of this._pending.values()) {
            if (pending.timer) clearTimeout(pending.timer);
            pending.reject(error);
        }
        this._pending.clear();
        for (const ac of this._activeAborts) ac.abort();
        this._activeAborts.clear();
        this._batch = null;
        this._outbound = [];
        this._preConnect = [];

        const conn = this.connection;
        if (conn) {
            for (let i = 0; i < this._listeners.length; i++) {
                const l = this._listeners[i];
                if (l.isSocketIo && typeof conn.off === 'function') conn.off(l.event, l.fn);
                else if (typeof conn.removeEventListener === 'function') conn.removeEventListener(l.event, l.fn);
            }
        }
        this._listeners = [];
    }
}

// ---------------------------------------------------------------------------
// RpcAbleReceiver — inbound dispatch, permissions, contract, guards
// ---------------------------------------------------------------------------

type ResolveResult =
    | { status: 'error'; error: RpcSerializedError }
    | { status: 'value'; result: any }
    | { status: 'invoke'; fn: Function; parent: any; args: any[] };

export class RpcAbleReceiver {
    target: any;
    role: string;
    permissions: RpcPermissions | null;
    contract: RpcContract | null;
    validatePaths: boolean;
    valueGuard: boolean | ((value: any, verb: RpcVerb, path: string[]) => boolean);
    thisBinding: RpcThisBinding;
    maxBatchItems: number;
    maxBatchSize: number;
    exposeErrors: boolean;
    logging: { rules: Record<LoggingRuleKind, LoggingMode>; functions: LoggingFunctions };

    // Current dispatch context — valid only during the synchronous part of a handler.
    _currentRole: string | null = null;
    _currentSender: RpcAbleSender | null = null;

    constructor(options: RpcAbleReceiverOptions) {
        if (!options || typeof options !== 'object') {
            throw new Error('[RpcAble] RpcAbleReceiver requires an options object');
        }
        this._assertKnownOptions(options);
        if (typeof options.role !== 'string') {
            throw new Error('[RpcAble] RpcAbleReceiver requires a string "role"');
        }
        this.target = options.target || {};
        this.role = options.role;
        // Safe default: every call is allowed, get/set denied until declared.
        this.permissions = options.permissions ?? { '*': { call: true } };
        this.contract = options.contract ?? null;
        this.validatePaths = options.validatePaths ?? true;
        this.valueGuard = options.valueGuard ?? true;
        this.thisBinding = options.thisBinding ?? 'parent';
        this.maxBatchItems = options.maxBatchItems ?? 100;
        this.maxBatchSize = options.maxBatchSize ?? 1_000_000;
        this.exposeErrors = options.exposeErrors ?? false;
        this.logging = { rules: { ...LOGGING_RULE_DEFAULTS }, functions: { ...LOGGING_FN_DEFAULTS } };
        this._applyLogging(options.logging);

        attachLink(this.target, 'receiver', this);
        defineLink(this, this.target[RPC_LINK]);
    }

    private _assertKnownOptions(options: any): void {
        const keys = Object.keys(options);
        for (let i = 0; i < keys.length; i++) {
            if (RECEIVER_OPTION_KEYS.indexOf(keys[i]) === -1) {
                throw new Error(`[RpcAble] RpcAbleReceiver: unknown option "${keys[i]}"`);
            }
        }
    }

    _applyOptions(opts: RpcAbleExtendOptions): void {
        if (opts.permissions !== undefined) this.permissions = opts.permissions;
        if (opts.contract !== undefined) this.contract = opts.contract;
        if (opts.role !== undefined) this.role = opts.role;
        if (opts.validatePaths !== undefined) this.validatePaths = opts.validatePaths;
        if (opts.valueGuard !== undefined) this.valueGuard = opts.valueGuard;
        if (opts.thisBinding !== undefined) this.thisBinding = opts.thisBinding;
        if (opts.maxBatchItems !== undefined) this.maxBatchItems = opts.maxBatchItems;
        if (opts.maxBatchSize !== undefined) this.maxBatchSize = opts.maxBatchSize;
        if (opts.exposeErrors !== undefined) this.exposeErrors = opts.exposeErrors;
        if (opts.logging !== undefined) this._applyLogging(opts.logging);
    }

    private _applyLogging(logging?: LoggingOptions): void {
        if (!logging) return;
        if (logging.rules) {
            const keys = Object.keys(logging.rules) as LoggingRuleKind[];
            for (let i = 0; i < keys.length; i++) this.logging.rules[keys[i]] = logging.rules[keys[i]] as LoggingMode;
        }
        if (logging.functions) {
            const keys = Object.keys(logging.functions) as (keyof LoggingFunctions)[];
            for (let i = 0; i < keys.length; i++) {
                const fn = logging.functions[keys[i]];
                if (typeof fn === 'function') (this.logging.functions as any)[keys[i]] = fn;
            }
        }
    }

    _log(kind: LoggingRuleKind, message: string): void {
        const mode = this.logging.rules[kind];
        if (mode === null || mode === undefined) return;
        this.logging.functions[mode](message);
    }

    _validateEnvelope(envelope: RpcEnvelope): boolean {
        if (!envelope || envelope._rpcable !== 1 || !Array.isArray(envelope.batch)) {
            this._log('dispatchError', '[RpcAble] invalid envelope');
            return false;
        }
        if (envelope.batch.length > this.maxBatchItems) {
            this._log('dispatchError', `[RpcAble] batch exceeds maxBatchItems (${envelope.batch.length} > ${this.maxBatchItems})`);
            return false;
        }
        return true;
    }

    // Receiver-only dispatch: routes incoming responses to the coupled sender's
    // pending map, runs calls (fire-and-forget) and requests (awaited), and
    // returns the produced response items for the host to send.
    async dispatch(envelope: RpcEnvelope, options?: RpcDispatchOptions): Promise<RpcBatchItem[]> {
        const out: RpcBatchItem[] = [];
        if (!this._validateEnvelope(envelope)) return out;
        const role = options && options.role ? options.role : this.role;
        const sender = getSender(this);
        const batch = envelope.batch;
        for (let i = 0; i < batch.length; i++) {
            const item = batch[i];
            if (item.type === 'response') {
                if (sender) sender.handleResponse(item);
                continue;
            }
            if (item.type === 'call') {
                this.invokeCall(sender, role, item);
                continue;
            }
            if (item.type === 'request') {
                const r = this.invokeRequest(sender, role, item);
                out.push(typeof (r as any).then === 'function' ? await r : r as RpcResponseBatchItem);
                continue;
            }
            this._log('dispatchError', '[RpcAble] unknown batch item type');
        }
        return out;
    }

    // Resolves the `this` for a handler invocation: the owning object by
    // default, or the receiver's root target for objects shared across
    // multiple receivers/sessions (see RpcThisBinding).
    private _thisArg(parent: any): any {
        return this.thisBinding === 'target' ? this.target : parent;
    }

    // Fire-and-forget. Started but not awaited; context is cleared synchronously
    // so the next batch item never reads a stale role/sender.
    invokeCall(sender: RpcAbleSender | null, role: string, item: RpcCallBatchItem): void {
        this._currentRole = role;
        this._currentSender = sender;
        try {
            const resolved = this._resolve(role, item);
            if (resolved.status === 'invoke') {
                let ret: any;
                _callContext = { role, sender: sender ? sender.proxy : null, receiver: this };
                try {
                    ret = resolved.fn.apply(this._thisArg(resolved.parent), resolved.args);
                } catch (e) {
                    this._log('dispatchError', `[RpcAble] handler error at ${item.path.join('.')}: ${serializeError(e).message}`);
                    return;
                } finally {
                    _callContext = null;
                }
                if (ret && typeof ret.then === 'function') {
                    ret.then(undefined, (e: any) => {
                        this._log('dispatchError', `[RpcAble] handler error at ${item.path.join('.')}: ${serializeError(e).message}`);
                    });
                }
            }
        } finally {
            this._currentRole = null;
            this._currentSender = null;
        }
    }

    // Produces a response item. Synchronous handlers (the common case) resolve
    // with no await at all — only a thenable return is awaited — which avoids the
    // async-wrapper tax on every get/set/awaited-call. Context is cleared
    // synchronously: role/sender must be read before the first await.
    invokeRequest(sender: RpcAbleSender | null, role: string, item: RpcRequestBatchItem): RpcResponseBatchItem | Promise<RpcResponseBatchItem> {
        this._currentRole = role;
        this._currentSender = sender;
        let resolved: ResolveResult;
        let ret: any;
        try {
            resolved = this._resolve(role, item);
            if (resolved.status === 'invoke') {
                _callContext = { role, sender: sender ? sender.proxy : null, receiver: this };
                try {
                    ret = resolved.fn.apply(this._thisArg(resolved.parent), resolved.args);
                } finally {
                    _callContext = null;
                }
            }
        } catch (e) {
            return this._responseError(item, this._handlerErrorBody(item.path, e));
        } finally {
            this._currentRole = null;
            this._currentSender = null;
        }

        if (resolved.status === 'error') return this._responseError(item, resolved.error);
        if (resolved.status === 'value') return this._responseOk(item, resolved.result);
        if (ret && typeof ret.then === 'function') {
            return ret.then(
                (result: any) => this._responseOk(item, result),
                (e: any) => this._responseError(item, this._handlerErrorBody(item.path, e)),
            );
        }
        return this._responseOk(item, ret);
    }

    private _resolve(role: string, item: RpcCallBatchItem | RpcRequestBatchItem): ResolveResult {
        const path = item.path;
        const verb = item.verb;

        if (verb !== 'call' && verb !== 'get' && verb !== 'set') {
            return this._failResolve('notFound', '[RpcAble] invalid verb');
        }
        if (!Array.isArray(path) || path.length === 0) {
            return this._failResolve('notFound', '[RpcAble] empty path not found');
        }
        const validatePaths = this.validatePaths;
        for (let i = 0; i < path.length; i++) {
            const seg = path[i];
            if (UNSAFE_KEYS.has(seg)) return this._failResolve('notFound', `[RpcAble] ${path.join('.')} not found`);
            if (validatePaths && (typeof seg !== 'string' || seg.length === 0 || seg.indexOf('.') !== -1)) {
                return this._failResolve('notFound', `[RpcAble] ${path.join('.')} not found`);
            }
        }

        const pathStr = path.join('.');

        if (!this._checkPermission(role, verb, pathStr)) {
            // A deny is indistinguishable from a notFound to the peer; logged as forbidden.
            this._log('forbidden', `[RpcAble] access denied: ${verb} ${pathStr} for role "${role}"`);
            return { status: 'error', error: notFoundError(pathStr) };
        }

        if (this.contract) {
            const def = this.contract[pathStr];
            if (def) {
                if (verb === 'call' && def.inputSchema !== undefined) {
                    const check = validateSchema(def.inputSchema, item.args ? item.args[0] : undefined);
                    if (!check.valid) return this._failContract(pathStr, check.error);
                }
                if (verb === 'set' && def.setSchema !== undefined) {
                    const check = validateSchema(def.setSchema, item.value);
                    if (!check.valid) return this._failContract(pathStr, check.error);
                }
            }
        }

        if (verb === 'set') return this._resolveSet(path, pathStr, item.value);

        // call / get: walk the path. Intermediate segments must be data properties:
        // never traverse an accessor (it would fire a getter mid-walk). Resolution
        // stops before Object.prototype / Function.prototype.
        let current = this.target;
        let parent: any = null;
        for (let i = 0; i < path.length; i++) {
            if (current == null || (typeof current !== 'object' && typeof current !== 'function')) {
                return this._failResolve('notFound', `[RpcAble] ${pathStr} not found`);
            }
            const key = path[i];
            const desc = findDescriptor(current, key);
            if (!desc) return this._failResolve('notFound', `[RpcAble] ${pathStr} not found`);
            parent = current;
            if (i < path.length - 1) {
                // intermediate: must be a data property; use desc.value to avoid a
                // second prototype-chain walk via current[key].
                if (typeof desc.get === 'function') return this._failResolve('notFound', `[RpcAble] ${pathStr} not found`);
                current = desc.value;
            } else {
                // leaf: a get may legitimately read an accessor, so honor the getter.
                current = typeof desc.get === 'function' ? current[key] : desc.value;
            }
        }

        if (verb === 'get') {
            if (!this._guardGet(current, path)) {
                this._log('forbidden', `[RpcAble] value guard blocked get ${pathStr}`);
                return { status: 'error', error: notFoundError(pathStr) };
            }
            return { status: 'value', result: current };
        }

        // verb === 'call'
        if (typeof current !== 'function') return { status: 'value', result: current };
        return { status: 'invoke', fn: current, parent, args: item.args || [] };
    }

    private _resolveSet(path: string[], pathStr: string, value: any): ResolveResult {
        // set never creates parents or new properties: the leaf must already exist.
        // Intermediate accessors are not traversed; the leaf must be a data property
        // (a set never invokes a getter/setter).
        let current = this.target;
        for (let i = 0; i < path.length - 1; i++) {
            if (current == null || (typeof current !== 'object' && typeof current !== 'function')) {
                return this._failResolve('notFound', `[RpcAble] ${pathStr} not found`);
            }
            const key = path[i];
            const desc = findDescriptor(current, key);
            if (!desc || typeof desc.get === 'function') return this._failResolve('notFound', `[RpcAble] ${pathStr} not found`);
            current = desc.value;
        }
        if (current == null || (typeof current !== 'object' && typeof current !== 'function')) {
            return this._failResolve('notFound', `[RpcAble] ${pathStr} not found`);
        }
        const last = path[path.length - 1];
        const lastDesc = findDescriptor(current, last);
        if (!lastDesc || typeof lastDesc.get === 'function' || typeof lastDesc.set === 'function') {
            return this._failResolve('notFound', `[RpcAble] ${pathStr} not found`);
        }
        if (!this._guardSet(lastDesc.value, value, path)) {
            this._log('forbidden', `[RpcAble] value guard blocked set ${pathStr}`);
            return { status: 'error', error: notFoundError(pathStr) };
        }
        current[last] = value;
        return { status: 'value', result: value };
    }

    private _checkPermission(role: string, verb: RpcVerb, pathStr: string): boolean {
        const perms = this.permissions;
        if (!perms) return true;
        let rule: RpcPermissionRule | undefined;
        if (hasOwn(perms, pathStr)) {
            rule = perms[pathStr];
        } else {
            rule = this._matchWildcardRule(perms, pathStr);
            if (rule === undefined) {
                if (hasOwn(perms, '*')) rule = perms['*'];
                else return false; // permissions present but no rule: deny by default
            }
        }

        let roles: RpcPermissionRoles | undefined;
        if (rule !== null && typeof rule === 'object' && !Array.isArray(rule)) {
            roles = (rule as any)[verb];
        } else {
            // shorthand (array | boolean) applies to 'call' only
            roles = verb === 'call' ? (rule as RpcPermissionRoles) : undefined;
        }

        if (roles === true) return true;
        if (roles === false || roles === undefined) return false;
        if (Array.isArray(roles)) return roles.indexOf(role) !== -1;
        return false;
    }

    // "a.b.*" matches "a.b.c", "a.b.c.d", ... but not "a.b" itself. The longest
    // matching prefix wins, so a more specific namespace rule overrides a broader one.
    private _matchWildcardRule(perms: RpcPermissions, pathStr: string): RpcPermissionRule | undefined {
        const segments = pathStr.split('.');
        for (let i = segments.length - 1; i >= 1; i--) {
            const key = segments.slice(0, i).join('.') + '.*';
            if (hasOwn(perms, key)) return perms[key];
        }
        return undefined;
    }

    private _guardGet(value: any, path: string[]): boolean {
        const g = this.valueGuard;
        if (g === false) return true;
        if (typeof g === 'function') return g(value, 'get', path);
        return isSafeLeaf(value);
    }

    private _guardSet(existing: any, incoming: any, path: string[]): boolean {
        const g = this.valueGuard;
        if (g === false) return true;
        if (typeof g === 'function') return g(incoming, 'set', path);
        if (!isSafeLeaf(incoming)) return false;
        if (existing === undefined) return true; // already-existing prop holding undefined
        return isSafeLeaf(existing);
    }

    private _failResolve(kind: LoggingRuleKind, message: string): ResolveResult {
        this._log(kind, message);
        return { status: 'error', error: { name: 'Error', message } };
    }

    private _failContract(pathStr: string, error?: string): ResolveResult {
        const msg = `[RpcAble] validation failed for "${pathStr}": ${error}`;
        this._log('validationFailed', msg);
        return { status: 'error', error: { name: 'Error', message: msg } };
    }

    private _handlerErrorBody(path: string[], e: any): RpcSerializedError {
        this._log('dispatchError', `[RpcAble] handler error at ${path.join('.')}: ${serializeError(e).message}`);
        return this.exposeErrors ? serializeError(e) : { name: 'Error', message: '[RpcAble] dispatch failed' };
    }

    private _responseOk(item: RpcRequestBatchItem, result: any): RpcResponseBatchItem {
        return { type: 'response', senderTimeMs: Date.now(), id: item.id, ok: true, result };
    }

    private _responseError(item: RpcRequestBatchItem, error: RpcSerializedError): RpcResponseBatchItem {
        return { type: 'response', senderTimeMs: Date.now(), id: item.id, ok: false, error };
    }
}

// ---------------------------------------------------------------------------
// RpcAble — composer
// ---------------------------------------------------------------------------

export class RpcAble {
    sender!: RpcAbleSender;
    receiver!: RpcAbleReceiver;
    target: any;

    constructor(options: RpcAbleOptions) {
        if (!options || typeof options !== 'object') {
            throw new Error('[RpcAble] RpcAble requires an options object');
        }
        const shared = options.target;
        const targetSender = shared ?? options.targetSender ?? {};
        const targetReceiver = shared ?? options.targetReceiver ?? {};
        this.target = shared ?? null;

        const proxy = new RpcAbleSender({
            target: targetSender,
            transport: options.transport,
            connection: options.connection,
            channel: options.channel,
            requestTimeoutMs: options.requestTimeoutMs,
            httpEndpoint: options.httpEndpoint,
            httpHeaders: options.httpHeaders,
            fetchImpl: options.fetchImpl,
        });
        const senderInstance = getSender(proxy) as RpcAbleSender;

        const receiver = new RpcAbleReceiver({
            target: targetReceiver,
            permissions: options.permissions,
            logging: options.logging,
            contract: options.contract,
            role: options.role,
            validatePaths: options.validatePaths,
            valueGuard: options.valueGuard,
            thisBinding: options.thisBinding,
            maxBatchItems: options.maxBatchItems,
            maxBatchSize: options.maxBatchSize,
            exposeErrors: options.exposeErrors,
        });

        this.sender = senderInstance;
        this.receiver = receiver;

        // One shared link reachable from every handle: proxy, instances, raw targets, composer.
        const link: RpcLink = { sender: senderInstance, receiver, instance: this };
        defineLink(this, link);
        defineLink(targetSender, link);
        defineLink(targetReceiver, link);
        defineLink(senderInstance, link);
        defineLink(receiver, link);

        return proxy as any;
    }

    get targetSender(): any { return this.sender.proxy; }
    get outbound(): any { return this.sender.proxy; }
    get targetReceiver(): any { return this.receiver.target; }
    get inbound(): any { return this.receiver.target; }
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

// Single inbound processor: response → sender pending map, call → fire-and-forget
// on the receiver, request → awaited and its produced response queued on the sender.
export async function dispatch(info: any, envelope: RpcEnvelope, options?: RpcDispatchOptions): Promise<void> {
    const link = getLink(info);
    if (!link || (!link.sender && !link.receiver)) {
        throw new Error('[RpcAble] dispatch: could not resolve a sender or receiver from info');
    }
    const sender = link.sender;
    const receiver = link.receiver;
    if (receiver && !receiver._validateEnvelope(envelope)) return;
    if (!receiver && !Array.isArray(envelope && envelope.batch)) return;

    const role = options && options.role ? options.role : (receiver ? receiver.role : '');
    const batch = envelope.batch;
    for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        if (item.type === 'response') {
            if (sender) sender.handleResponse(item);
            continue;
        }
        if (item.type === 'call') {
            if (receiver) receiver.invokeCall(sender, role, item);
            continue;
        }
        if (item.type === 'request') {
            if (receiver) {
                const r = receiver.invokeRequest(sender, role, item);
                const resp = typeof (r as any).then === 'function' ? await r : r as RpcResponseBatchItem;
                if (sender) sender.enqueueResponse(resp);
            }
            continue;
        }
        if (receiver) receiver._log('dispatchError', '[RpcAble] unknown batch item type');
    }
}

// Register push/inbound handlers on the receiver target of the destination.
export function extend(target: any, methodsAndProps: Record<string, any>, options?: RpcAbleExtendOptions): any {
    if (!methodsAndProps || typeof methodsAndProps !== 'object') return target;
    const link = getLink(target);
    const receiver = link ? link.receiver : null;

    let dest: any;
    if (receiver) {
        dest = receiver.target;
    } else if (link && link.sender) {
        throw new Error('[RpcAble] extend: sender has no coupled receiver; pass the receiver or its target');
    } else {
        dest = target;
    }

    if (options) {
        if (!receiver) throw new Error('[RpcAble] extend: options require a linked receiver');
        receiver._applyOptions(options);
    }

    const keys = Object.keys(methodsAndProps);
    for (let i = 0; i < keys.length; i++) assignPath(dest, keys[i], methodsAndProps[keys[i]]);
    return target;
}

export function flush(info: any): RpcBatchItem[] {
    const sender = getSender(info);
    return sender ? sender.flushQueued() : [];
}

export function destroy(info: any): void {
    const sender = getSender(info);
    if (sender) sender.destroy();
}

export function getCurrentRole(info: any): string | null {
    const receiver = getReceiver(info);
    return receiver ? receiver._currentRole : null;
}

export function getCurrentSender(info: any): RpcAbleSender | null {
    const receiver = getReceiver(info);
    if (!receiver || !receiver._currentSender) return null;
    return receiver._currentSender.proxy;
}

// Module-level call context — valid only during the synchronous execution of an RPC handler.
let _callContext: { role: string; sender: any; receiver: RpcAbleReceiver } | null = null;

export function getCallContext(): { role: string; sender: any; receiver: RpcAbleReceiver } | null {
    return _callContext;
}

export function getCallReceiverTarget(): any {
    return _callContext ? _callContext.receiver.target : null;
}
export function getCallSender(): any {
    return _callContext ? _callContext.sender : null;
}
