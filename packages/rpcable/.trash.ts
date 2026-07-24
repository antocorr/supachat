const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SUPPORTED_TRANSPORTS = new Set(['socketio', 'websocket', 'http']);

export type RpcAbleTransport = 'socketio' | 'websocket' | 'http';

export type RpcBatchEntry = {
    path: string[];
    args: any[];
    id?: string;
};

export type RpcResponseEntry = {
    id: string;
    ok: boolean;
    result?: any;
    error?: { name: string; message: string };
};

export type RpcEnvelope = {
    batch: RpcBatchEntry[];
    responses: RpcResponseEntry[];
};

// === schema validation, used by RpcAbleReceiver's "contract" option ===

const CHECKERS: Record<string, (v: any) => boolean> = {
    string: v => typeof v === 'string',
    number: v => typeof v === 'number' && !isNaN(v),
    integer: v => Number.isInteger(v),
    boolean: v => typeof v === 'boolean',
    null: v => v === null,
    array: v => Array.isArray(v),
    object: v => v !== null && typeof v === 'object' && !Array.isArray(v),
};

/** Returns an error message, or null when the value matches the schema. */
function validateSchema(schema: any, value: any): string | null {
    if (schema === true) return null;
    if (schema === false) return 'schema is false';
    if (!schema || typeof schema !== 'object') return null;

    if (Array.isArray(schema.enum) && !schema.enum.some((e: any) => e === value)) {
        return `value must be one of [${schema.enum.join(', ')}]`;
    }

    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some((t: string) => (CHECKERS[t]?.(value) ?? true))) {
            const got = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
            return `expected type "${schema.type}" but got ${got}`;
        }
    }

    if (typeof value === 'string') {
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            return `minLength is ${schema.minLength}, got ${value.length}`;
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            return `maxLength is ${schema.maxLength}, got ${value.length}`;
        }
    }

    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) {
            return `minimum is ${schema.minimum}, got ${value}`;
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            return `maximum is ${schema.maximum}, got ${value}`;
        }
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        if (Array.isArray(schema.required)) {
            for (const req of schema.required) {
                if (!Object.prototype.hasOwnProperty.call(value, req)) {
                    return `missing required property "${req}"`;
                }
            }
        }
        if (schema.properties && typeof schema.properties === 'object') {
            for (const [prop, propSchema] of Object.entries(schema.properties)) {
                if (Object.prototype.hasOwnProperty.call(value, prop)) {
                    const propErr = validateSchema(propSchema, (value as any)[prop]);
                    if (propErr) return `property "${prop}": ${propErr}`;
                }
            }
        }
        if (schema.additionalProperties === false && schema.properties) {
            for (const key of Object.keys(value)) {
                if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
                    return `additional property "${key}" not allowed`;
                }
            }
        }
    }

    if (Array.isArray(value) && schema.items !== undefined) {
        for (let i = 0; i < value.length; i++) {
            const itemErr = validateSchema(schema.items, value[i]);
            if (itemErr) return `item[${i}]: ${itemErr}`;
        }
    }

    return null;
}

// === path helpers, used by dispatch's ".set" convention and extend() ===

function assignPath(target: any, key: string, value: any): void {
    if (!target || typeof target !== 'object') return;
    const parts = key.split('.');
    if (parts.some(p => UNSAFE_KEYS.has(p))) return;
    let current = target;
    for (const part of parts.slice(0, -1)) {
        if (!current[part] || typeof current[part] !== 'object') current[part] = {};
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

/** Register push handlers directly on the target wrapped by an RpcAble proxy. */
export function extend(proxy: any, methodsAndProps: Record<string, any>): void {
    const target = proxy?.target;
    if (!target || !methodsAndProps || typeof methodsAndProps !== 'object') return;
    for (const key of Object.keys(methodsAndProps)) {
        assignPath(target, key, methodsAndProps[key]);
    }
}

// === message helpers ===

function normalizePayload(payload: any): any {
    if (payload == null) return null;

    // Node's Buffer is a Uint8Array subclass, so this covers it too.
    if (payload instanceof Uint8Array) payload = new TextDecoder().decode(payload);

    if (typeof payload !== 'string') return payload;
    try { return JSON.parse(payload); } catch { return null; }
}

function serializeError(error: unknown): { name: string; message: string } {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }
    return { name: 'Error', message: String(error) };
}

/** Serialize a batch + pending responses to a WebSocket frame. */
export function encodeRpcMessage(channel: string, batch: RpcBatchEntry[], responses: RpcResponseEntry[] = []): string {
    return JSON.stringify({ _rpcable: 1, event: channel, batch, responses });
}

/** Parse a WebSocket frame back into its batch and responses. Returns null if the payload isn't a valid envelope. */
export function decodeRpcMessage(payload: any, expectedChannel: string | null = null): RpcEnvelope | null {
    const parsed = normalizePayload(payload);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!Array.isArray(parsed.batch)) return null;
    if (expectedChannel && parsed.event !== expectedChannel) return null;

    return {
        batch: parsed.batch,
        responses: Array.isArray(parsed.responses) ? parsed.responses : [],
    };
}

/**
 * Unifies the two HTTP roles under transport "http":
 * - client role (endpoint set): posts batches and parses { results, push } responses
 * - server role (no endpoint): queues outgoing push entries for the next response
 */
class RpcHTTPConnection {
    endpoint: string | null;
    headers: Record<string, string>;
    fetchImpl: typeof fetch;
    private _queue: RpcBatchEntry[] = [];

    constructor(endpoint: string | null, headers: Record<string, string>, fetchImpl: typeof fetch) {
        this.endpoint = endpoint;
        this.headers = headers;
        this.fetchImpl = fetchImpl;
    }

    get isClient(): boolean {
        return this.endpoint !== null;
    }

    async post(batch: RpcBatchEntry[], signal: AbortSignal): Promise<{ results: any[]; push: RpcBatchEntry[] }> {
        const res = await this.fetchImpl.call(globalThis, this.endpoint as string, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(batch.map(({ path, args }) => ({ path, args }))),
            signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();
        return {
            results: Array.isArray(json?.results) ? json.results : [],
            push: Array.isArray(json?.push) ? json.push : [],
        };
    }

    enqueue(entries: RpcBatchEntry[]): void {
        this._queue.push(...entries);
    }

    flush(): RpcBatchEntry[] {
        const out = this._queue;
        this._queue = [];
        return out;
    }
}

// === logging ===

export type LoggingMode = 'log' | 'info' | 'warn' | 'error' | 'throw' | null;
export type LoggingRuleKind = 'notFound' | 'permission' | 'forbidden' | 'validationFailed' | 'dispatchError';

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

const LOGGING_DEFAULTS: { rules: Record<LoggingRuleKind, LoggingMode>; functions: LoggingFunctions } = {
    rules: {
        notFound: null,
        permission: null,
        forbidden: null,
        validationFailed: null,
        dispatchError: 'error',
    },
    functions: {
        log: console.log,
        info: console.info,
        warn: console.warn,
        error: console.error,
        throw: (message: string) => { throw new Error(message); },
    },
};

// === request ids ===
// Ids only correlate request/response on the same connection,
// so Math.random is enough.

const randomId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// === RpcAble: outbound proxy / sender ===

export type RpcAbleRequestTicket<T = any> = {
    then(onFulfilled?: (value: T) => any, onRejected?: (reason: any) => any): Promise<any>;
    catch(onRejected?: (reason: any) => any): Promise<any>;
    finally(onFinally?: () => void): Promise<any>;
};

export type RpcAbleOptions = {
    target?: any;
    transport?: RpcAbleTransport;
    connection?: any;
    channel?: string;
    requestTimeoutMs?: number;
    httpEndpoint?: string | null;
    httpHeaders?: Record<string, string>;
    fetchImpl?: typeof fetch;
    receiver?: RpcAbleReceiver;
};

type PendingEntry = {
    path: string[];
    args: any[];
    id?: string;
    sent: boolean;
    requestPromise: Promise<any> | null;
    resolve?: (value: any) => void;
    reject?: (reason: any) => void;
};

export class RpcAble {
    target: any;
    transport: RpcAbleTransport;
    connection: any;
    channel: string;
    requestTimeoutMs: number;

    private _batch: PendingEntry[] | null = null;
    private _responses: RpcResponseEntry[] = [];
    private _pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (reason: any) => void; timer: ReturnType<typeof setTimeout> }>();
    private _preConnectBatches: RpcEnvelope[] = [];
    private _activeAborts = new Set<AbortController>();
    receiver: RpcAbleReceiver | null = null;
    private _destroyed = false;

    constructor(options: RpcAbleOptions = {}) {
        if (!options || typeof options !== 'object') {
            throw new Error('[RpcAble] options object is required');
        }

        this.transport = options.transport ?? 'websocket';
        if (!SUPPORTED_TRANSPORTS.has(this.transport)) {
            throw new Error(`[RpcAble] unsupported transport "${this.transport}"`);
        }

        this.channel = options.channel ?? '-userSession';
        this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
        this.target = options.target ?? {};

        if (this.transport === 'http') {
            this.connection = new RpcHTTPConnection(
                options.httpEndpoint ?? null,
                options.httpHeaders ?? { 'Content-Type': 'application/json' },
                options.fetchImpl ?? globalThis.fetch,
            );
            this.receiver = options.receiver ?? new RpcAbleReceiver({ target: this.target });
        } else {
            this.connection = options.connection ?? null;
            if (!this.connection) {
                throw new Error(`[RpcAble] connection is required for ${this.transport} transport`);
            }
            this.receiver = options.receiver ?? null;
        }

        this.prepareConnection();

        return new Proxy(this.target, {
            get: (target, prop) => {
                if (typeof prop === 'symbol') return Reflect.get(target, prop);
                if (prop in this) {
                    const val = (this as any)[prop];
                    return typeof val === 'function' ? val.bind(this) : val;
                }
                if (prop in target) return (target as any)[prop];
                // The root proxy must not look thenable: awaiting works on properties only.
                if (prop === 'then') return undefined;
                return this._createMethodProxy([String(prop)]);
            },
            // Mirrors the get precedence: own members, then local target, then remote ".set".
            set: (target, prop, value) => {
                if (typeof prop === 'symbol') return Reflect.set(target, prop, value);
                if (prop in this) {
                    (this as any)[prop] = value;
                    return true;
                }
                if (prop in target) {
                    (target as any)[prop] = value;
                    return true;
                }
                this._enqueue([String(prop), 'set'], [value]);
                return true;
            },
        });
    }

    /** Wires native WebSocket lifecycle: pre-connect buffering and auto-destroy on close. */
    prepareConnection(): void {
        if (this.transport !== 'websocket') return;
        if (typeof this.connection.addEventListener !== 'function') return;

        const connectingState = this.connection.CONNECTING ?? 0;
        if (typeof this.connection.readyState === 'number' && this.connection.readyState === connectingState) {
            this.connection.addEventListener('open', () => {
                for (const { batch, responses } of this._preConnectBatches) {
                    this.connection.send(encodeRpcMessage(this.channel, batch, responses));
                }
                this._preConnectBatches = [];
            });
        }

        this.connection.addEventListener('close', () => this.destroy());
    }

    /** Removes a pending awaited call by id, clearing its timer; null if unknown. */
    private _settlePending(id: string): { resolve: (value: any) => void; reject: (reason: any) => void } | null {
        const pending = this._pendingRequests.get(id);
        if (!pending) return null;
        clearTimeout(pending.timer);
        this._pendingRequests.delete(id);
        return pending;
    }

    destroy(): void {
        this._destroyed = true;
        const error = new Error('[RpcAble] client destroyed');
        for (const id of this._pendingRequests.keys()) {
            this._settlePending(id)?.reject(error);
        }
        for (const ac of this._activeAborts) ac.abort();
        this._activeAborts.clear();
        this._batch = null;
        this._responses = [];
        this._preConnectBatches = [];
    }

    /** Routes a raw incoming frame: settles awaited-call responses and dispatches the batch
     *  on the receiver (which resolves its own role/session). Returns false when the payload isn't
     *  an rpcable envelope for this channel, so multi-channel handlers can try the next session. */
    dispatchMessage(payload: any): boolean {
        const envelope = decodeRpcMessage(payload, this.transport === 'websocket' ? this.channel : null);
        if (!envelope) return false;

        for (const response of envelope.responses) {
            this._handleResponse(response);
        }
        if (envelope.batch.length && this.receiver) {
            this.receiver.dispatch(envelope.batch);
        }
        return true;
    }

    /** Drains queued push entries on the server side of http transport. */
    flush(): RpcBatchEntry[] {
        if (this.transport !== 'http' || this.connection.isClient) {
            console.warn('[RpcAble] flush() is only available on the server side of http transport');
            return [];
        }
        return this.connection.flush();
    }

    private _createMethodProxy(path: string[]): any {
        return new Proxy(() => {}, {
            get: (_, prop) => {
                // Awaiting a property proxy requests its remote value. Returning a lazy
                // function (instead of firing here) keeps thenable checks from sending requests.
                if (prop === 'then') {
                    return (onFulfilled: any, onRejected: any) =>
                        this._enqueue(path, []).then(onFulfilled, onRejected);
                }
                return this._createMethodProxy(path.concat(String(prop)));
            },
            apply: (_, __, args) => this._enqueue(path, args),
            set: (_, prop, value) => {
                this._enqueue(path.concat(String(prop), 'set'), [value]);
                return true;
            },
        });
    }

    /** Lazily creates the outgoing batch and schedules its flush. The extra microtask hop
     *  lets `await` thenable jobs (queued after the call) mark entries as requests first. */
    private _scheduleFlush(): PendingEntry[] {
        if (!this._batch) queueMicrotask(() => queueMicrotask(() => this._flush()));
        return (this._batch ??= []);
    }

    private _enqueue(path: string[], args: any[]): RpcAbleRequestTicket {
        const entry: PendingEntry = { path, args, sent: false, requestPromise: null };
        this._scheduleFlush().push(entry);

        // Awaiting the ticket upgrades the entry to a request; without await it stays fire-and-forget.
        return {
            then: (onFulfilled, onRejected) => this._markAsRequest(entry).then(onFulfilled, onRejected),
            catch: (onRejected) => this._markAsRequest(entry).catch(onRejected),
            finally: (onFinally) => this._markAsRequest(entry).finally(onFinally),
        };
    }

    /** Pushes a response payload onto the next outgoing envelope (called via RpcAbleReceiver's onResponse). */
    _enqueueResponse(payload: RpcResponseEntry): void {
        this._scheduleFlush();
        this._responses.push(payload);
    }

    private _markAsRequest(entry: PendingEntry): Promise<any> {
        if (entry.requestPromise) return entry.requestPromise;

        if (entry.sent) {
            return Promise.reject(new Error('[RpcAble] await must happen in the same tick as the call'));
        }

        if (this.transport === 'http' && !this.connection.isClient) {
            return Promise.reject(new Error('[RpcAble] responses are not supported on the server side of http transport'));
        }

        const timeoutMs = this.requestTimeoutMs;

        if (this.transport === 'http') {
            entry.requestPromise = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`[RpcAble] request timeout (${timeoutMs}ms)`));
                }, timeoutMs);
                entry.resolve = (value: any) => { clearTimeout(timer); resolve(value); };
                entry.reject = (reason: any) => { clearTimeout(timer); reject(reason); };
            });
            return entry.requestPromise;
        }

        const id = randomId();
        entry.id = id;

        entry.requestPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(id);
                reject(new Error(`[RpcAble] request timeout (${timeoutMs}ms)`));
            }, timeoutMs);

            this._pendingRequests.set(id, { resolve, reject, timer });
        });

        return entry.requestPromise;
    }

    /** Resolves a pending awaited call from a "responses" entry received over the connection. */
    _handleResponse(payload: RpcResponseEntry): void {
        const id = payload?.id;
        if (!id) return;

        const pending = this._settlePending(id);
        if (!pending) return;

        if (payload.ok) {
            pending.resolve(payload.result);
            return;
        }

        const errorInfo = payload.error;
        const message = errorInfo?.message || '[RpcAble] request failed';
        const err = new Error(message);
        if (errorInfo?.name) err.name = errorInfo.name;
        pending.reject(err);
    }

    private async _flush(): Promise<void> {
        const batch = this._batch ?? [];
        const responses = this._responses;
        this._batch = null;
        this._responses = [];

        if (!batch.length && !responses.length) return;

        batch.forEach(entry => { entry.sent = true; });
        const payload: RpcBatchEntry[] = batch.map(({ path, args, id }) => id ? { path, args, id } : { path, args });

        if (this.transport === 'socketio') {
            this.connection.emit(this.channel, { batch: payload, responses });
            return;
        }

        if (this.transport === 'websocket') {
            if (typeof this.connection.readyState === 'number') {
                const connectingState = this.connection.CONNECTING ?? 0;
                const openState = this.connection.OPEN ?? 1;

                if (this.connection.readyState === connectingState) {
                    this._preConnectBatches.push({ batch: payload, responses });
                    return;
                }

                if (this.connection.readyState !== openState) {
                    const error = new Error('[RpcAble] WebSocket is not open');
                    for (const entry of batch) {
                        if (entry.id) this._settlePending(entry.id)?.reject(error);
                    }
                    return;
                }
            }
            this.connection.send(encodeRpcMessage(this.channel, payload, responses));
            return;
        }

        // http
        if (!this.connection.isClient) {
            this.connection.enqueue(payload);
            return;
        }

        const ac = new AbortController();
        this._activeAborts.add(ac);
        try {
            const { results, push } = await this.connection.post(payload, ac.signal);
            this._activeAborts.delete(ac);

            if (push.length && !this._destroyed) {
                this.receiver?.dispatch(push);
            }

            batch.forEach((entry, index) => {
                entry.resolve?.(results[index]);
            });
        } catch (error) {
            this._activeAborts.delete(ac);
            batch.forEach(entry => {
                entry.reject?.(error);
            });
        }
    }
}

// === permissions, used by RpcAbleReceiver ===

export type RpcPermissionVerb = 'call' | 'get' | 'set';
export type RpcPermissionRoles = string[] | true | false;
export type RpcPermissionRule = RpcPermissionRoles | { call?: RpcPermissionRoles; get?: RpcPermissionRoles; set?: RpcPermissionRoles };
export type RpcPermissions = Record<string, RpcPermissionRule>;

/** Shorthand rules (true / role array) cover only "call": get/set always need the object form. */
function ruleAllowsVerb(rule: RpcPermissionRule | undefined, verb: RpcPermissionVerb, role: string): boolean {
    if (rule === true) return verb === 'call';
    if (Array.isArray(rule)) return verb === 'call' && rule.includes(role);
    if (rule && typeof rule === 'object') {
        const roles = rule[verb];
        if (roles === true) return true;
        return Array.isArray(roles) && roles.includes(role);
    }
    return false;
}

// === RpcAbleReceiver: routes incoming batch entries to target methods ===

/** Trailing argument appended to dispatched calls when a role or session is set. */
export class RpcCallContext {
    role: string | null;
    session: any;

    constructor(role: string | null, session: any) {
        this.role = role;
        this.session = session;
    }
}

/** Returns the RpcCallContext of the current invocation, or null when called locally. */
export function getCallContext(args: IArguments | any[]): RpcCallContext | null {
    const last = args.length ? args[args.length - 1] : undefined;
    return last instanceof RpcCallContext ? last : null;
}

export type RpcMethodContract = {
    inputSchema?: any;
};

export type RpcDispatchOptions = {
    role?: string | null;
    session?: any;
};

export type RpcAbleReceiverOptions = {
    target?: any;
    role?: string | null | (() => string | null);
    session?: any;
    permissions?: RpcPermissions | null;
    contract?: Record<string, RpcMethodContract> | null;
    logging?: LoggingOptions;
    exposeErrors?: boolean;
    onResponse?: (payload: RpcResponseEntry) => void;
};

export class RpcAbleReceiver {
    target: any;
    exposeErrors: boolean;

    private _role: string | null | (() => string | null);
    private _session: any;
    private _permissions: RpcPermissions | null;
    private _contract: Record<string, RpcMethodContract> | null;
    private _logging: { rules: Record<LoggingRuleKind, LoggingMode>; functions: LoggingFunctions };
    private _onResponse: ((payload: RpcResponseEntry) => void) | null;

    constructor(options: RpcAbleReceiverOptions = {}) {
        this.target = options.target ?? null;
        this._role = options.role ?? null;
        this._session = options.session ?? null;
        this._permissions = options.permissions ?? null;
        this._contract = options.contract ?? null;
        this._onResponse = options.onResponse ?? null;
        this.exposeErrors = options.exposeErrors ?? false;
        this._logging = {
            rules: { ...LOGGING_DEFAULTS.rules },
            functions: { ...LOGGING_DEFAULTS.functions },
        };
        if (options.logging) this.updateSettings('logging', options.logging);
    }

    updateSettings(key: 'logging', data: LoggingOptions): void;
    updateSettings(key: 'permissions', data: RpcPermissions): void;
    updateSettings(key: 'contract', data: Record<string, RpcMethodContract>): void;
    updateSettings(key: string, data: any): void {
        if (key === 'logging') {
            if (data.rules) Object.assign(this._logging.rules, data.rules);
            if (data.functions) Object.assign(this._logging.functions, data.functions);
        } else if (key === 'permissions') {
            this._permissions = { ...(this._permissions ?? {}), ...data };
        } else if (key === 'contract') {
            this._contract = { ...(this._contract ?? {}), ...data };
        }
    }

    resetSettings(key: 'logging', data?: LoggingOptions | null): void;
    resetSettings(key: 'permissions', data?: RpcPermissions | null): void;
    resetSettings(key: 'contract', data?: Record<string, RpcMethodContract> | null): void;
    resetSettings(key: string, data: any = null): void {
        if (key === 'logging') {
            this._logging = { rules: { ...LOGGING_DEFAULTS.rules }, functions: { ...LOGGING_DEFAULTS.functions } };
            if (data) this.updateSettings('logging', data);
        } else if (key === 'permissions') {
            this._permissions = data ? { ...data } : null;
        } else if (key === 'contract') {
            this._contract = data ? { ...data } : null;
        }
    }

    private _emitLog(kind: LoggingRuleKind, message: string): void {
        const mode = this._logging.rules[kind];
        if (!mode) return;
        this._logging.functions[mode](message);
    }

    /** Evaluates the rule for key; an exact match shadows the '*' base policy entirely. */
    private _checkPermission(role: string, key: string, verb: RpcPermissionVerb): boolean {
        const permissions = this._permissions;
        if (!permissions) return true;

        const hasRule = Object.prototype.hasOwnProperty.call(permissions, key);
        if (!hasRule && !Object.prototype.hasOwnProperty.call(permissions, '*')) {
            this._emitLog('permission', `[RpcAble] access denied: ${key} (${verb}) not listed in permissions`);
            return false;
        }

        const rule = hasRule ? permissions[key] : permissions['*'];
        if (ruleAllowsVerb(rule, verb, role)) return true;

        this._emitLog('forbidden', `[RpcAble] access denied: ${key} (${verb}) for role "${role}"`);
        return false;
    }

    /** The receiver's fallback role, used when dispatch is called without an explicit one. */
    resolveRole(): string | null {
        return typeof this._role === 'function' ? this._role() : this._role;
    }

    async dispatch(batch: RpcBatchEntry[], options: RpcDispatchOptions | null = null): Promise<any[]> {
        if (!Array.isArray(batch)) return [];
        // Explicit options (even null, to bypass checks) win over the receiver's own defaults.
        const role = options && Object.prototype.hasOwnProperty.call(options, 'role')
            ? options.role ?? null
            : this.resolveRole();
        const session = options && Object.prototype.hasOwnProperty.call(options, 'session')
            ? options.session ?? null
            : this._session;
        const context = role !== null || session !== null ? new RpcCallContext(role, session) : null;
        const results: any[] = [];

        for (const entry of batch) {
            results.push(await this._invokeEntry(context, entry));
        }

        return results;
    }

    private async _invokeEntry(context: RpcCallContext | null, entry: RpcBatchEntry): Promise<any> {
        try {
            const result = await this._invokeMethod(context, entry.path, entry.args || []);
            if (entry.id) this._onResponse?.({ id: entry.id, ok: true, result });
            return result;
        } catch (error) {
            if (entry.id) {
                const errorPayload = this.exposeErrors
                    ? serializeError(error)
                    : { name: 'Error', message: 'Internal error' };
                this._onResponse?.({ id: entry.id, ok: false, error: errorPayload });
            }
            const message = error instanceof Error ? error.message : String(error);
            this._emitLog('dispatchError', `[RpcAble] ${entry.path.join('.')} threw: ${message}`);
            return undefined;
        }
    }

    private async _invokeMethod(context: RpcCallContext | null, path: string[], args: any[]): Promise<any> {
        if (!Array.isArray(path) || !path.length) {
            return undefined;
        }
        const role = context ? context.role : null;

        let current = this.target;
        let parent: any = null;
        let propName: string | null = null;
        let isSetter = false;
        const className = current && current.constructor ? current.constructor.name : 'Object';

        for (let i = 0; i < path.length; i++) {
            const key = path[i];

            if (UNSAFE_KEYS.has(key)) {
                this._emitLog('notFound', `[RpcAble] ${path.join('.')} not found in ${className}`);
                return undefined;
            }

            if (current && typeof current[key] !== 'undefined') {
                parent = current;
                propName = key;
                current = current[key];
            } else {
                // The assignment itself runs after the permissions/contract checks below.
                if (key === 'set' && i === path.length - 1 && parent && propName) {
                    isSetter = true;
                    break;
                }
                this._emitLog('notFound', `[RpcAble] ${path.join('.')} not found in ${className}`);
                return undefined;
            }
        }

        if (role !== null) {
            const verb: RpcPermissionVerb = isSetter ? 'set' : typeof current === 'function' ? 'call' : 'get';
            const key = (isSetter ? path.slice(0, -1) : path).join('.');
            if (!this._checkPermission(role, key, verb)) return undefined;
        }

        if (this._contract) {
            const key = path.join('.');
            const def = this._contract[key];
            if (def?.inputSchema !== undefined) {
                const schemaErr = validateSchema(def.inputSchema, args[0]);
                if (schemaErr) {
                    this._emitLog('validationFailed', `[RpcAble] validation failed for "${key}": ${schemaErr}`);
                    return undefined;
                }
            }
        }

        if (isSetter) {
            parent[propName as string] = args[0];
            return args[0];
        }

        if (typeof current === 'function') {
            const callArgs = context ? [...args, context] : args;
            return await current.apply(parent ?? this.target, callArgs);
        }
        return current;
    }
}

// === RpcAbleSession: composes RpcAble + RpcAbleReceiver over a shared connection ===

export type RpcAbleSessionOptions = {
    target?: any;
    targetDispatcher?: any;
    targetSender?: any;
    transport?: RpcAbleTransport;
    connection?: any;
    channel?: string;
    requestTimeoutMs?: number;
    httpEndpoint?: string | null;
    httpHeaders?: Record<string, string>;
    fetchImpl?: typeof fetch;
    role?: string | null | (() => string | null);
    session?: any;
    permissions?: RpcPermissions | null;
    contract?: Record<string, RpcMethodContract> | null;
    logging?: LoggingOptions;
    exposeErrors?: boolean;
    returns?: 'proxy' | 'targets';
};

export class RpcAbleSession {
    receiver: RpcAbleReceiver;
    sender: any;

    constructor(options: RpcAbleSessionOptions = {}) {
        const targetDispatcher = options.targetDispatcher ?? options.target ?? {};
        const targetSender = options.targetSender ?? options.target ?? targetDispatcher;

        this.receiver = new RpcAbleReceiver({
            target: targetDispatcher,
            role: options.role,
            session: options.session,
            permissions: options.permissions,
            contract: options.contract,
            logging: options.logging,
            exposeErrors: options.exposeErrors,
            onResponse: (payload) => this.sender._enqueueResponse(payload),
        });

        this.sender = new RpcAble({
            target: targetSender,
            transport: options.transport,
            connection: options.connection,
            channel: options.channel,
            requestTimeoutMs: options.requestTimeoutMs,
            httpEndpoint: options.httpEndpoint,
            httpHeaders: options.httpHeaders,
            fetchImpl: options.fetchImpl,
            receiver: this.receiver,
        });

        this._wireConnection();

        if (options.returns === 'targets') {
            return { targetDispatcher, targetSender: this.sender } as any;
        }
        return this.sender;
    }

    /** Listens for incoming envelopes on socketio/websocket and routes them through the sender. http has no persistent connection to wire. */
    private _wireConnection(): void {
        const transport: RpcAbleTransport = this.sender.transport;
        if (transport === 'http') return;

        const connection = this.sender.connection;

        if (transport === 'socketio') {
            connection.on(this.sender.channel, (envelope: RpcEnvelope) => this.sender.dispatchMessage(envelope));
        } else if (typeof connection.addEventListener === 'function') {
            connection.addEventListener('message', (event: any) => this.sender.dispatchMessage(event.data));
        }
    }
}
