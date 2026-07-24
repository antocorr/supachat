import { decodeRpcMessage, RpcAble, RpcAbleReceiver } from '../../src/RpcAble.js';

const CHANNEL = '-userSession';
const ROOT = import.meta.dir;

type SessionSocket = Bun.ServerWebSocket<{ role: string }>;

class UserSession {
    readonly user: { id: string; name: string; role: string };
    readonly receiver: RpcAbleReceiver;
    client: any;

    constructor(ws: SessionSocket, id: number, role: string) {
        this.user = {
            id: `ws-${id}`,
            name: `ws-user-${id}`,
            role,
        };

        this.client = new RpcAble({
            transport: 'websocket',
            socket: ws,
            channel: CHANNEL,
        });

        this.receiver = new RpcAbleReceiver({
            target: this,
            permissions: {
                join: ['user'],
                getGames: ['user'],
                ping: ['user'],
            },
        });
    }

    async join({ name }: { name?: string }, role: string) {
        if (typeof name === 'string' && name.trim()) {
            this.user.name = name.trim();
        }
        this.client.joined({ user: this.user });
        return {
            welcomedAs: this.user.name,
            socketId: this.user.id,
            role,
        };
    }

    async getGames(role: string) {
        const games = [
            { id: 1, name: 'Tetris', players: 1 },
            { id: 2, name: 'Overcooked', players: 4 },
            { id: 3, name: 'Rocket League', players: 6 },
        ];
        this.client.gamesReceived(games);
        return { count: games.length, role };
    }

    ping(role: string) {
        this.client.pong({ now: new Date().toISOString(), transport: 'websocket', role });
    }
}

let nextId = 1;
const sessions = new Map<SessionSocket, UserSession>();

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

const server = Bun.serve<{ role: string }>({
    port: 3300,
    async fetch(req, srv) {
        const url = new URL(req.url);

        if (url.pathname === '/ws') {
            if (srv.upgrade(req, { data: { role: 'user' } })) return;
            return new Response('WebSocket upgrade failed', { status: 500 });
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
    websocket: {
        open(ws) {
            const role = ws.data?.role || 'user';
            const session = new UserSession(ws, nextId++, role);
            sessions.set(ws, session);
            session.client.joined({ user: session.user });
        },
        message(ws, raw) {
            const session = sessions.get(ws);
            if (!session) return;

            const batch = decodeRpcMessage(raw, CHANNEL);
            if (!batch) return;

            session.receiver.dispatch(batch, { role: session.user.role });
        },
        close(ws) {
            sessions.get(ws)?.client.destroy();
            sessions.delete(ws);
        },
    },
});

console.log(`WebSocket Bun example running on http://localhost:${server.port}`);
