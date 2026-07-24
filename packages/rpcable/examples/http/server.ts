import { RpcAble, RpcAbleReceiver } from '../../src/RpcAble.js';

class UserSession {
    readonly receiver: RpcAbleReceiver;
    readonly userId: string;
    readonly user: any;
    client: any;

    constructor(userData: any) {
        this.user = userData;
        this.userId = userData?.userId ?? userData?.id ?? '';
        this.client = new RpcAble({ transport: 'collector' });
        this.receiver = new RpcAbleReceiver({ target: this });
    }

    async join({ user, motto }: { user: string; motto: string }) {
        console.log(`${user} joined with motto: "${motto}"`);
        this.client.joined({ user: this.user });
        return { success: true, welcomedAs: user };
    }

    async getGames() {
        const games = [
            { id: 1, name: 'Chess' },
            { id: 2, name: 'Checkers' },
        ];
        this.client.gamesReceived(games);
        return games.length;
    }

    scenes = {
        getAll: async () => [{ id: 1, name: 'Intro' }],
        delete: async ({ sceneId }: { sceneId: number }) => {
            this.client.scenes.deleted({ sceneId });
            return { deleted: sceneId };
        },
    };
}

const sessions = new Map<string, UserSession>();

function getUserFromRequest(_req: Request) {
    return { userId: '42', sessionId: 'browser-42', role: 'user', name: 'antocorr' };
}

function getOrCreateSession(userData: any) {
    const key = String(userData?.sessionId ?? userData?.userId ?? userData?.id ?? 'anonymous');
    let session = sessions.get(key);
    if (!session) {
        session = new UserSession(userData);
        sessions.set(key, session);
    }
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
        const results = await session.receiver.dispatch(batch, { role: userData.role });

        return Response.json({
            results,
            push: session.client.flush(),
        });
    },
});

console.log('Listening on http://localhost:3000');
