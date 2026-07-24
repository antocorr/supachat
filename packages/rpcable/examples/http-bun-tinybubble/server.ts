import { RpcAble, RpcAbleReceiver } from '../../src/RpcAble.js';

class UserSession {
    readonly user: any;
    readonly receiver: RpcAbleReceiver;
    client: any;

    constructor(userData: any) {
        this.user = userData;
        this.client = new RpcAble({ transport: 'collector' });
        this.receiver = new RpcAbleReceiver({ target: this });
    }

    async join({ name }: { name: string }) {
        const displayName = typeof name === 'string' && name.trim() ? name.trim() : this.user.name;
        this.user.name = displayName;
        this.client.joined({ user: this.user });
        return { welcomedAs: displayName, sessionId: this.user.sessionId };
    }

    async getGames() {
        const games = [
            { id: 1, name: 'Chess', players: 2 },
            { id: 2, name: 'Street Fighter', players: 2 },
            { id: 3, name: 'Mario Kart', players: 8 },
        ];
        this.client.gamesReceived(games);
        return games.length;
    }

    async ping() {
        return {
            now: new Date().toISOString(),
            transport: 'http',
        };
    }

    async setAndForgetMessage() {
        setTimeout(() => {
            this.client.readMessage({
                title: 'Hello',
                content: 'This is a message from the server after 5 seconds',
            });
        }, 5000);

        return {
            scheduled: true,
            delayMs: 5000,
        };
    }
}

const sessions = new Map<string, UserSession>();
const ROOT = import.meta.dir;

function getUserFromRequest(req: Request) {
    const sessionId = req.headers.get('x-session-id') ?? 'demo-session';
    return {
        userId: '42',
        role: 'user',
        sessionId,
        name: `http-user-${sessionId.slice(0, 4)}`,
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
    sessions.set(key, session);
    return session;
}

function contentType(filePath: string) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    return 'text/plain; charset=utf-8';
}

async function serveFile(filePath: string) {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return null;
    return new Response(file, {
        headers: {
            'Content-Type': contentType(filePath),
        },
    });
}

Bun.serve({
    port: 3200,
    async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === '/rpc/user-session' && req.method === 'POST') {
            const userData = getUserFromRequest(req);
            const session = getOrCreateSession(userData);
            const batch = await req.json();
            const results = await session.receiver.dispatch(batch, { role: userData.role });

            return Response.json({
                results,
                push: session.client.flush(),
            });
        }

        if (url.pathname === '/rpcable.js') {
            const file = await serveFile(`${ROOT}/../../src/RpcAble.js`);
            if (file) return file;
        }

        if (url.pathname.startsWith('/vendor/tinybubble/dist/')) {
            const tinybubbleFile = await serveFile(`${ROOT}/node_modules${url.pathname.replace('/vendor', '')}`);
            if (tinybubbleFile) return tinybubbleFile;
        }

        const publicPath = url.pathname === '/' ? '/index.html' : url.pathname;
        const staticFile = await serveFile(`${ROOT}/public${publicPath}`);
        if (staticFile) return staticFile;

        return new Response('Not found', { status: 404 });
    },
});

console.log('HTTP Bun example running on http://localhost:3200');
