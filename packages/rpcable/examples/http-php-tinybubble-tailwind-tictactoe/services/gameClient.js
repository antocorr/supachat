import { decodeRpcMessage, RpcAble, RpcAbleReceiver, extend } from '../../../src/RpcAble.js';

const WS_CHANNEL = '-tttArena';

function buildWebSocketUrl(config) {
    const url = new URL(config.wsUrl || '/ws', window.location.href);
    url.searchParams.set('room', config.roomId);
    url.searchParams.set('seat', config.seat);
    url.searchParams.set('name', config.playerName);
    return url.toString();
}

export function createGameClient(config) {
    const target = {};
    let player, connected, destroy;

    if (config.transport === 'websocket') {
        const ws = new WebSocket(buildWebSocketUrl(config));
        player = new RpcAble({ transport: 'websocket', socket: ws, channel: WS_CHANNEL, target });
        const receiver = new RpcAbleReceiver({ target });

        connected = new Promise((resolve, reject) => {
            ws.addEventListener('open', resolve, { once: true });
            ws.addEventListener('error', () => reject(new Error('WebSocket connection failed.')), { once: true });
        });

        ws.addEventListener('message', (event) => {
            const batch = decodeRpcMessage(event.data, WS_CHANNEL);
            if (batch) receiver.dispatch(batch);
        });

        destroy = () => {
            player.destroy?.();
            if (ws.readyState <= WebSocket.OPEN) ws.close();
        };
    } else {
        player = new RpcAble({
            transport: 'http',
            endpoint: './rpc.php',
            target,
            headers: {
                'Content-Type': 'application/json',
                'x-room-id': config.roomId,
                'x-seat': config.seat,
                'x-player-name': config.playerName,
            },
        });
        connected = Promise.resolve();
        destroy = () => {};
    }

    return {
        transport: config.transport,
        extend:    (handlers) => extend(player, handlers),
        bootstrap: () => connected.then(() => player.bootstrap().request()),
        makeMove:  (index)   => connected.then(() => player.makeMove(index).request()),
        sendChat:  (payload) => player.sendChat(payload),
        sync:      () => player.sync(),
        nextRound: () => player.nextRound(),
        destroy,
    };
}
