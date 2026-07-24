import express from 'express';
import { RpcAble } from 'rpcable';
import UserSession from '../UserSession';

const app = express();
app.use(express.json());

const sessions = new Map<string, UserSession>();

function getUserFromRequest(req: express.Request) {
    return {
        userId: String(req.headers['x-user-id'] || '42'),
        role: String(req.headers['x-role'] || 'user'),
        sessionId: String(req.headers['x-session-id'] || req.headers['x-user-id'] || '42'),
    };
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

app.post('/rpc/user-session', async (req, res) => {
    const userData = getUserFromRequest(req);
    const session = getOrCreateSession(userData);
    const results = await session.receiver.dispatch(req.body, { role: userData?.role ?? null });

    res.json({
        results,
        push: session.client.flush(),
    });
});

app.listen(3000, () => {
    console.log('Listening on http://localhost:3000');
});
