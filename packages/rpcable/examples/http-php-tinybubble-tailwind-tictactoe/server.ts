import { decodeRpcMessage } from '../../src/RpcAble.js';
import {
    normalizePlayerName,
    normalizeRoomId,
    normalizeSeat,
    TicTacToeRoomHub,
    TicTacToeRoomStore,
    TicTacToeWsSession,
    WS_CHANNEL,
    type ConnectionData,
} from './server/gameDomain.ts';

const PORT = 3350;
const store = new TicTacToeRoomStore();
const hub = new TicTacToeRoomHub();
const sessions = new Map<Bun.ServerWebSocket<ConnectionData>, TicTacToeWsSession>();

const server = Bun.serve<ConnectionData>({
    port: PORT,
    fetch(req, srv) {
        const url = new URL(req.url);

        if (url.pathname === '/ws') {
            const seat = normalizeSeat(url.searchParams.get('seat'));
            const playerName = normalizePlayerName(
                url.searchParams.get('name'),
                seat === 'sun' ? 'Giulia' : 'Marco',
            );

            if (srv.upgrade(req, {
                data: {
                    roomId: normalizeRoomId(url.searchParams.get('room')),
                    seat,
                    playerName,
                    role: 'user',
                },
            })) {
                return;
            }

            return new Response('WebSocket upgrade failed', { status: 500 });
        }

        return Response.json({
            name: 'ttt-arena-websocket-server',
            transport: 'websocket-bun',
            endpoint: `ws://localhost:${PORT}/ws?room=room-demo&seat=sun&name=Giulia`,
            clientHint: 'Open the existing game.html with ?transport=ws',
        });
    },
    websocket: {
        open(ws) {
            const session = new TicTacToeWsSession(ws, ws.data, store, hub);
            sessions.set(ws, session);
            hub.register(session);
        },
        async message(ws, raw) {
            const session = sessions.get(ws);
            if (!session) return;

            const batch = decodeRpcMessage(raw, WS_CHANNEL);
            if (!batch) return;

            await session.receiver.dispatch(batch, { role: session.role });
        },
        close(ws) {
            const session = sessions.get(ws);
            if (!session) return;

            session.destroy();
            hub.unregister(session);
            sessions.delete(ws);
        },
    },
});

console.log(`TTT Arena WebSocket Bun server running on ws://localhost:${server.port}/ws`);
