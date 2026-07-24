import { Socket } from 'socket.io';
import { RpcAble } from 'rpcable';
import UserSession from '../UserSession';

const CHANNEL = '-userSession';
const sessions = new Map<string, UserSession>();

function getSessionKey(userData: any) {
    return String(userData?.sessionId ?? userData?.userId ?? userData?.id ?? 'anonymous');
}

export function attachUserSessionSocket(socket: Socket, userData: any) {
    const key = getSessionKey(userData);
    let session = sessions.get(key);

    if (!session) {
        session = new UserSession(userData);
        sessions.set(key, session);
    }

    session.setClient(new RpcAble({
        transport: 'socketio',
        socket,
        channel: CHANNEL,
    }) as any);

    socket.on(CHANNEL, (batch: any[]) => {
        session!.receiver.dispatch(batch, { role: userData?.role ?? null });
    });

    socket.on('disconnect', () => {
        // keep session in map for reconnection parity
    });

    session.client.joined({ user: userData });
    return session;
}
