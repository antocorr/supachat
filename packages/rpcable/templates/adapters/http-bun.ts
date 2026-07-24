import { RpcAble } from 'rpcable';
import UserSession from '../UserSession';

const sessions = new Map<string, UserSession>();

function getUserFromRequest(_req: Request) {
    return { userId: '42', role: 'user' };
}

function getSessionKey(userData: any) {
    return String(userData?.sessionId ?? userData?.userId ?? userData?.id ?? 'anonymous');
}

function getOrCreateSession(userData: any) {
    const key = getSessionKey(userData);
    const existing = sessions.get(key);
    if (existing) return existing;

    const session = new UserSession(userData);
    session.setClient(new RpcAble({ transport: 'collector' }) as any);
    sessions.set(key, session);
    return session;
}

Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== '/rpc/user-session' || req.method !== 'POST') {
            return new Response('Not found', { status: 404 });
        }

        const userData = getUserFromRequest(req);
        const session = getOrCreateSession(userData);
        const batch = await req.json();
        const results = await session.receiver.dispatch(batch, { role: userData?.role ?? null });

        return Response.json({
            results,
            push: session.client.flush(),
        });
    },
});
