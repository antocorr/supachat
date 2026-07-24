import { cfg, taggedLog, sessions, RPC_CHANNEL, nextSessionId } from './app';
import { serve } from './http';
import { UserSession } from './session/UserSession';
import { decodeRpcMessage } from '../../packages/rpcable/src/RpcAble';

if (import.meta.main) {
  Bun.serve<{ role: string }>({
    hostname: cfg.host,
    port: cfg.port,
    fetch: serve,
    websocket: {
      open(ws) {
        const role = ws.data?.role || 'user';
        sessions.set(ws, new UserSession(ws, role));
      },
      async message(ws, raw) {
        const session = sessions.get(ws);
        if (!session) return;
        const envelope = decodeRpcMessage(raw, RPC_CHANNEL);
        if (!envelope) return;
        // dispatchFrom uses the raw sender from the pool (not the proxy),
        // ensuring only the requesting client gets the response.
        session.dispatchFrom('default', envelope, { role: session.role });
      },
      close(ws) {
        const session = sessions.get(ws);
        if (session) session.close();
        sessions.delete(ws);
      }
    }
  });

  taggedLog('server', 'startup', { host: cfg.host, port: cfg.port });
}

// Re-export for downstream use (client Vite proxy, tests)
export { handle } from './http';
export { repo, settings, audioDir } from './app';
