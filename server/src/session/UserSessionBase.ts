import { RpcAbleReceiver, RpcAbleSender, dispatch, destroy, type RpcPermissions } from '../../../packages/rpcable/src/RpcAble';

export const RPC_CHANNEL = '-userSession';

/**
 * Creates a proxy that broadcasts calls to all connected clients.
 * Each client has its own RpcAbleSender for outbound messages.
 */
function createClientPoolProxy(pool: Map<string, any>, path: string[] = []): any {
  return new Proxy(() => {}, {
    get: (_, prop) => createClientPoolProxy(pool, path.concat(prop as string)),
    apply: (_, __, args) => {
      let result: any;
      pool.forEach((rpc) => {
        let target: any = rpc;
        for (const key of path.slice(0, -1)) target = target[key];
        const method = path[path.length - 1]!;
        if (typeof target[method] === 'function') result = target[method](...args);
      });
      return result;
    },
  });
}

export interface UserSessionOptions {
  connection?: any;
  sockId?: string;
  channel?: string;
  role?: string;
  permissions?: RpcPermissions;
}

/**
 * Base class for RpcAble-backed user sessions.
 *
 * Manages:
 * - RpcAbleReceiver for inbound dispatch (via dispatchFrom)
 * - Client pool for multi-tab/multi-device outbound pushes
 * - Automatic sender creation from connection
 */
export class UserSessionBase {
  clientPool = new Map<string, any>();
  receiver: RpcAbleReceiver;
  protected _role: string;

  constructor(options: UserSessionOptions = {}) {
    this._role = options.role || 'user';

    this.receiver = new RpcAbleReceiver({
      target: this,
      role: this._role,
      permissions: options.permissions,
    });

    if (options.connection) {
      this.setClient(options.sockId || 'default', options.connection, options.channel || RPC_CHANNEL);
    }
  }

  get role() { return this._role; }

  /**
   * Register or replace a client connection. In single-client mode
   * (default), each new connection replaces the previous one.
   */
  setClient(sockId: string, connection: any, channel: string = RPC_CHANNEL) {
    const id = sockId || 'default';

    // Remove existing connection for this sockId
    const existing = this.clientPool.get(id);
    if (existing) destroy(existing);

    const client = new RpcAbleSender({
      target: {},
      transport: 'websocket',
      connection,
      channel,
    });
    this.clientPool.set(id, client);
    return client;
  }

  removeClient(sockId: string) {
    const client = this.clientPool.get(sockId);
    if (client) destroy(client);
    this.clientPool.delete(sockId);
  }

  /**
   * Outbound proxy that broadcasts to all connected clients.
   * Example: this.client.someMethod(args) => fire-and-forget call on each.
   */
  get client() {
    return createClientPoolProxy(this.clientPool);
  }

  /**
   * Dispatch an RPC envelope from a specific client connection.
   * The receiver resolves methods on `this` (or extended targets).
   */
  dispatchFrom(sockId: string, envelope: any, options?: { role?: string }) {
    const client = this.clientPool.get(sockId || 'default');
    if (!client) return Promise.resolve();
    return dispatch({ targetSender: client, targetReceiver: this }, envelope, options);
  }

  /**
   * Clean up all clients.
   */
  close() {
    for (const client of this.clientPool.values()) destroy(client);
    this.clientPool.clear();
  }
}
