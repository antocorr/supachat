// Type declarations for RpcAble v1 — mirrors the public API of RpcAble.ts

export type RpcAbleTransport = 'socketio' | 'websocket' | 'http';
export type RpcVerb = 'call' | 'get' | 'set';

export type RpcPermissionRoles = string[] | boolean;
export type RpcPermissionRule = RpcPermissionRoles | {
    call?: RpcPermissionRoles;
    get?: RpcPermissionRoles;
    set?: RpcPermissionRoles;
};
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

export function encodeRpcMessage(channel: string, envelope: RpcEnvelope): string;
export function decodeRpcMessage(payload: any, channel?: string): RpcEnvelope | null;

export function getSender(info: any): RpcAbleSender | null;
export function getReceiver(info: any): RpcAbleReceiver | null;
export function getInstance(info: any): any | null;
export function getTransport(info: any): RpcAbleTransport | null;

export function dispatch(info: any, envelope: RpcEnvelope, options?: RpcDispatchOptions): Promise<void>;
export function extend(target: any, methodsAndProps: Record<string, any>, options?: RpcAbleExtendOptions): any;
export function flush(info: any): RpcBatchItem[];
export function destroy(info: any): void;
export function getCurrentRole(info: any): string | null;
export function getCurrentSender(info: any): RpcAbleSender | null;

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

    constructor(options: RpcAbleSenderOptions);

    enqueueResponse(item: RpcResponseBatchItem): void;
    flushQueued(): RpcBatchItem[];
    handleResponse(item: RpcResponseBatchItem): void;
    destroy(): void;
}

export class RpcAbleReceiver {
    target: any;
    role: string;
    permissions: RpcPermissions | null;
    contract: RpcContract | null;
    validatePaths: boolean;
    valueGuard: boolean | ((value: any, verb: RpcVerb, path: string[]) => boolean);
    maxBatchItems: number;
    maxBatchSize: number;
    exposeErrors: boolean;
    logging: { rules: Record<LoggingRuleKind, LoggingMode>; functions: LoggingFunctions };
    _currentRole: string | null;
    _currentSender: RpcAbleSender | null;

    constructor(options: RpcAbleReceiverOptions);

    dispatch(envelope: RpcEnvelope, options?: RpcDispatchOptions): Promise<RpcBatchItem[]>;
    invokeCall(sender: RpcAbleSender | null, role: string, item: RpcCallBatchItem): void;
    invokeRequest(sender: RpcAbleSender | null, role: string, item: RpcRequestBatchItem): RpcResponseBatchItem | Promise<RpcResponseBatchItem>;
}

export class RpcAble {
    sender: RpcAbleSender;
    receiver: RpcAbleReceiver;
    target: any;

    constructor(options: RpcAbleOptions);

    get targetSender(): any;
    get outbound(): any;
    get targetReceiver(): any;
    get inbound(): any;
}
