const REQUEST_PATH = '--request';
const RESPONSE_PATH = '--response';
const SUPPORTED_TRANSPORTS = new Set(['socketio', 'websocket', 'http', 'collector']);
const RECEIVER_LOG_DEFAULTS = Object.freeze({
    notFound: 'error',
    permission: 'error',
    forbidden: 'error',
    validationFailed: 'error',
});
const RECEIVER_LOG_MODES = new Set([false, 'console.log', 'console.warn', 'console.error', 'error', 'throw']);

const _checkers = {
    string:  v => typeof v === 'string',
    number:  v => typeof v === 'number' && !isNaN(v),
    integer: v => Number.isInteger(v),
    boolean: v => typeof v === 'boolean',
    null:    v => v === null,
    array:   v => Array.isArray(v),
    object:  v => v !== null && typeof v === 'object' && !Array.isArray(v),
};

function _validateSchema(schema, value) {
    if (schema === true)  return { valid: true };
    if (schema === false) return { valid: false, error: 'schema is false' };
    if (!schema || typeof schema !== 'object') return { valid: true };

    if (Array.isArray(schema.enum)) {
        if (!schema.enum.some(e => e === value)) {
            return { valid: false, error: `value must be one of [${schema.enum.join(', ')}]` };
        }
    }

    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some(t => (_checkers[t]?.(value) ?? true))) {
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
            for (const [prop, propSchema] of Object.entries(schema.properties)) {
                if (Object.prototype.hasOwnProperty.call(value, prop)) {
                    const check = _validateSchema(propSchema, value[prop]);
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
            const check = _validateSchema(schema.items, value[i]);
            if (!check.valid) {
                return { valid: false, error: `item[${i}]: ${check.error}` };
            }
        }
    }

    return { valid: true };
}

const INSTANCE = Symbol('rpcable.instance');

export function extend(proxy, methodsAndProps) {
    if (!methodsAndProps || typeof methodsAndProps !== 'object') return;
    const instance = proxy?.[INSTANCE];
    const target = instance ? instance.target : null;
    if (!target) return;
    for (const key of Object.keys(methodsAndProps)) {
        assignPath(target, key, methodsAndProps[key]);
    }
}

export function getInstance(proxy) {
    return proxy?.[INSTANCE] ?? null;
}

export function getTransport(proxy) {
    return proxy?.[INSTANCE]?.transport ?? null;
}

function assignPath(target, key, value) {
    if (!target || typeof target !== 'object') return;
    if (!key.includes('.')) {
        target[key] = value;
        return;
    }

    const parts = key.split('.');
    let current = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part] || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part];
    }
    current[parts[parts.length - 1]] = value;
}

function normalizePayload(payload) {
    if (payload == null) return null;

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) payload = payload.toString('utf8');
    else if (payload instanceof Uint8Array) payload = new TextDecoder().decode(payload);

    if (typeof payload !== 'string') return payload;
    try { return JSON.parse(payload); } catch { return null; }
}

function serializeError(error) {
    if (error instanceof Error) {
        return { name: error.name, message: error.message };
    }
    return { name: 'Error', message: String(error) };
}

function inferTransport(options) {
    if (options.transport) return String(options.transport).toLowerCase();
    if (options.endpoint) return 'http';
    if (options.socket && typeof options.socket.emit === 'function') return 'socketio';
    if (options.socket && typeof options.socket.send === 'function') return 'websocket';
    return 'collector';
}

export function encodeRpcMessage(event, batch) {
    return JSON.stringify({ _rpcable: 1, event, batch });
}

export function decodeRpcMessage(payload, expectedEvent = null) {
    const parsed = normalizePayload(payload);

    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.batch)) return null;
    if (expectedEvent && parsed.event !== expectedEvent) return null;

    return parsed.batch;
}

export class RpcAble {
    target = null;
    _batch = null;
    _pendingRequests = new Map();
    _collectorQueue = [];
    _preConnectBatches = [];
    _httpFetch = null;

    constructor(options = {}) {
        if (!options || typeof options !== 'object') {
            throw new Error('[RpcAble] options object is required');
        }

        this.transport = inferTransport(options);
        if (!SUPPORTED_TRANSPORTS.has(this.transport)) {
            throw new Error(`[RpcAble] unsupported transport "${this.transport}"`);
        }

        this.socket = options.socket || null;
        this.endpoint = options.endpoint || null;
        this.channel = options.channel || '';
        this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
        this.fetchImpl = options.fetchImpl || globalThis.fetch;
        this.httpHeaders = options.headers || { 'Content-Type': 'application/json' };
        this.target = options.target || this;

        if (this.transport === 'http' && typeof this.fetchImpl !== 'function') {
            throw new Error('[RpcAble] fetch is required for http transport');
        }
        if (this.transport === 'http' && !this.endpoint) {
            throw new Error('[RpcAble] endpoint is required for http transport');
        }
        if ((this.transport === 'socketio' || this.transport === 'websocket') && !this.socket) {
            throw new Error(`[RpcAble] socket is required for ${this.transport} transport`);
        }

        if ((this.transport === 'socketio' || this.transport === 'websocket') && typeof this.target[RESPONSE_PATH] !== 'function') {
            this.target[RESPONSE_PATH] = (payload) => this._handleResponse(payload);
        }

        if (this.transport === 'http') {
            this._httpFetch = this.fetchImpl.bind(globalThis);
            this._httpPushReceiver = new RpcAbleReceiver({ target: this.target });
        }

        if (this.transport === 'websocket' && typeof this.socket.addEventListener === 'function') {
            const connectingState = this.socket.CONNECTING ?? 0;
            if (typeof this.socket.readyState === 'number' && this.socket.readyState === connectingState) {
                this.socket.addEventListener('open', () => {
                    for (const { payload } of this._preConnectBatches) {
                        this.socket.send(encodeRpcMessage(this.channel, payload));
                    }
                    this._preConnectBatches = [];
                });
            }
            this.socket.addEventListener('close', () => this.destroy());
        }

        return new Proxy(this.target, {
            get: (target, prop) => {
                if (prop === INSTANCE) return this;
                if (typeof prop === 'symbol') return Reflect.get(target, prop);
                if (prop in this) {
                    const val = this[prop];
                    return typeof val === 'function' ? val.bind(this) : val;
                }
                if (prop in target) return target[prop];
                return this._createMethodProxy([prop]);
            },
        });
    }

    destroy() {
        const error = new Error('[RpcAble] client destroyed');
        for (const [, pending] of this._pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this._pendingRequests.clear();
        this._batch = null;
        this._collectorQueue = [];
        this._preConnectBatches = [];
    }

    flush() {
        if (this.transport !== 'collector') return [];
        const out = this._collectorQueue;
        this._collectorQueue = [];
        return out;
    }

    _createMethodProxy(path) {
        return new Proxy(() => {}, {
            get: (_, prop) => this._createMethodProxy(path.concat(prop)),
            apply: (_, __, args) => this._enqueue(path, args),
        });
    }

    _enqueue(path, args) {
        if (!this._batch) {
            this._batch = [];
            queueMicrotask(() => this._flush());
        }

        const entry = {
            path,
            args,
            requestPayload: null,
            requestPromise: null,
            sent: false,
            resultPromise: null,
            resolve: null,
            reject: null,
        };

        this._batch.push(entry);

        const requestFactory = (opts = {}) => this._markAsRequest(entry, opts);
        const fireAndForgetError = () => {
            throw new Error(
                '[RpcAble] This transport is fire-and-forget — remove the await, ' +
                'or use .request() / .expects() to get a response back from the server.'
            );
        };

        return {
            request: requestFactory,
            expects: requestFactory,
            then: fireAndForgetError,
            catch: fireAndForgetError,
            finally: fireAndForgetError,
        };
    }

    _markAsRequest(entry, opts) {
        if (this.transport === 'collector') {
            return Promise.reject(new Error('[RpcAble] collector transport does not support request()'));
        }
        if (entry.requestPromise) return entry.requestPromise;

        if (entry.sent) {
            return Promise.reject(new Error('[RpcAble] request() must be called in the same tick'));
        }

        if (this.transport === 'http') {
            entry.requestPromise = new Promise((resolve, reject) => {
                entry.resolve = resolve;
                entry.reject = reject;
            });
            return entry.requestPromise;
        }

        const id = typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        const timeoutMs = Number(opts?.timeoutMs ?? this.requestTimeoutMs);

        entry.requestPayload = { id, path: entry.path, args: entry.args };
        entry.path = [REQUEST_PATH];
        entry.args = [entry.requestPayload];

        entry.requestPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(id);
                reject(new Error(`[RpcAble] request timeout (${timeoutMs}ms)`));
            }, timeoutMs);

            this._pendingRequests.set(id, { resolve, reject, timer });
        });

        return entry.requestPromise;
    }

    _handleResponse(payload) {
        const id = payload?.id;
        if (!id) return;

        const pending = this._pendingRequests.get(id);
        if (!pending) return;

        clearTimeout(pending.timer);
        this._pendingRequests.delete(id);

        if (payload?.ok) {
            pending.resolve(payload.result);
            return;
        }

        const errorInfo = payload?.error;
        const message = typeof errorInfo === 'string'
            ? errorInfo
            : (errorInfo?.message || '[RpcAble] request failed');
        const err = new Error(message);
        if (errorInfo?.name) err.name = errorInfo.name;
        pending.reject(err);
    }

    async _flush() {
        const batch = this._batch;
        this._batch = null;
        if (!batch?.length) return;

        batch.forEach(entry => { entry.sent = true; });

        const payload = batch.map(entry => ({ path: entry.path, args: entry.args }));

        if (this.transport === 'collector') {
            this._collectorQueue = this._collectorQueue.concat(payload);
            return;
        }

        if (this.transport === 'socketio') {
            this.socket.emit(this.channel, payload);
            return;
        }

        if (this.transport === 'websocket') {
            if (typeof this.socket.readyState === 'number') {
                const connectingState = this.socket.CONNECTING ?? 0;
                const openState = this.socket.OPEN ?? 1;
                if (this.socket.readyState === connectingState) {
                    this._preConnectBatches.push({ batch, payload });
                    return;
                }
                if (this.socket.readyState !== openState) {
                    const error = new Error('[RpcAble] WebSocket is not open');
                    for (const entry of batch) {
                        const id = entry.requestPayload?.id;
                        if (!id) continue;
                        const pending = this._pendingRequests.get(id);
                        if (!pending) continue;
                        clearTimeout(pending.timer);
                        this._pendingRequests.delete(id);
                        pending.reject(error);
                    }
                    return;
                }
            }
            this.socket.send(encodeRpcMessage(this.channel, payload));
            return;
        }

        // http
        try {
            const res = await this._httpFetch(this.endpoint, {
                method: 'POST',
                headers: this.httpHeaders,
                body: JSON.stringify(payload),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const responseJson = await res.json();
            const results = Array.isArray(responseJson?.results) ? responseJson.results : [];
            const push = Array.isArray(responseJson?.push) ? responseJson.push : [];

            if (push.length) {
                this._httpPushReceiver.dispatch(push).catch((e) => {
                    console.error('[RpcAble] push handler error:', e?.message ?? e);
                });
            }

            batch.forEach((entry, index) => {
                if (typeof entry.resolve === 'function') {
                    entry.resolve(results[index]);
                }
            });
        } catch (error) {
            batch.forEach((entry) => {
                if (typeof entry.reject === 'function') {
                    entry.reject(error);
                }
            });
        }
    }
}

export class RpcAbleReceiver {
    target = null;
    _receiverLog = { ...RECEIVER_LOG_DEFAULTS };

    constructor(options = {}) {
        if (options.target) this.target = options.target;
        this._contract = options.contract ?? null;
        this._permissions = options.permissions ?? null;
        this.setSettings(options);
    }

    setSettings(settings = null) {
        for (const key of Object.keys(RECEIVER_LOG_DEFAULTS)) {
            const val = settings?.[key];
            this._receiverLog[key] = RECEIVER_LOG_MODES.has(val) ? val : RECEIVER_LOG_DEFAULTS[key];
        }
    }

    _emitReceiverLog(kind, message) {
        const mode = this._receiverLog?.[kind];
        if (mode === false) return;
        if (mode === 'console.log') { console.log(message); return; }
        if (mode === 'console.warn') { console.warn(message); return; }
        console.error(message);
    }

    async dispatch(batch, options = null) {
        if (!Array.isArray(batch)) return [];
        const role = options?.role ?? null;
        const results = [];
        for (const entry of batch) {
            results.push(await this._invokeMethod(role, entry.path, entry.args || []));
        }
        return results;
    }

    async _invokeMethod(role, path, args) {
        if (!Array.isArray(path) || !path.length) {
            return undefined;
        }

        if (path.length === 1 && path[0] === REQUEST_PATH) {
            return await this._handleRequest(role, args[0]);
        }

        let current = this.target;
        let parent = null;
        let propName = null;
        const className = current?.constructor?.name || 'Object';

        for (let i = 0; i < path.length; i++) {
            const key = path[i];

            if (current && typeof current[key] !== 'undefined') {
                parent = current;
                propName = key;
                current = current[key];
            } else {
                if (key === 'set' && i === path.length - 1 && parent && propName) {
                    parent[propName] = args[0];
                    return args[0];
                }
                this._emitReceiverLog('notFound', `[RpcAble] ${path.join('.')} not found in ${className}`);
                return undefined;
            }
        }

        // Permissions whitelist — checked against receiver-level permissions map.
        // role === null bypasses all checks (internal/server-initiated calls).
        if (role !== null && this._permissions) {
            const methodKey = path.join('.');
            if (Object.prototype.hasOwnProperty.call(this._permissions, methodKey)) {
                const allowedRoles = this._permissions[methodKey];
                const allowed = Array.isArray(allowedRoles) ? allowedRoles : [];
                if (!allowed.includes(role)) {
                    this._emitReceiverLog('forbidden', `[RpcAble] access denied: ${methodKey} for role "${role}"`);
                    return undefined;
                }
            } else {
                this._emitReceiverLog('permission', `[RpcAble] access denied: ${methodKey} not listed in permissions`);
                return undefined;
            }
        }

        if (this._contract) {
            const key = path.join('.');
            const def = this._contract[key];
            if (def?.inputSchema !== undefined) {
                const check = _validateSchema(def.inputSchema, args[0]);
                if (!check.valid) {
                    const msg = `[RpcAble] validation failed for "${key}": ${check.error}`;
                    const mode = this._receiverLog.validationFailed;
                    if (mode === 'throw') throw new Error(msg);
                    this._emitReceiverLog('validationFailed', msg);
                    return undefined;
                }
            }
        }

        if (typeof current === 'function') {
            if (role !== null) args.push(role);
            return await current.apply(this.target, args);
        }
        return current;
    }

    async _handleRequest(role, requestPayload) {
        const id = requestPayload?.id;
        const path = requestPayload?.path;
        const args = requestPayload?.args || [];

        if (!id || !Array.isArray(path)) {
            return undefined;
        }

        try {
            const result = await this._invokeMethod(role, path, args);
            this._sendResponse({ id, ok: true, result });
            return result;
        } catch (error) {
            this._sendResponse({ id, ok: false, error: serializeError(error) });
            return undefined;
        }
    }

    _sendResponse(payload) {
        const client = this.target?.client;
        if (!client) return;
        try {
            if (typeof client._enqueue === 'function') {
                client._enqueue([RESPONSE_PATH], [payload]);
                return;
            }
            client[RESPONSE_PATH](payload);
        } catch {
            // ignore missing response channel
        }
    }
}
