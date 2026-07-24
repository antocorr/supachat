import { RpcAble, RpcAbleReceiver } from '../../../src/RpcAble.js';

export const WS_CHANNEL = '-tttArena';

export type Seat = 'sun' | 'lime';

type PlayerProfile = {
    seat: Seat;
    name: string;
    symbol: 'X' | 'O';
    accent: Seat;
};

export type RoomState = {
    roomId: string;
    createdAt: string;
    updatedAt: string;
    round: number;
    turn: Seat;
    nextStarter: Seat;
    status: 'playing' | 'won' | 'draw';
    winner: Seat | null;
    winningLine: number[];
    turnStartedAt: string;
    board: string[];
    scores: Record<Seat, number>;
    players: Record<Seat, PlayerProfile>;
    lastAction: string;
    chat: Array<{
        id: string;
        seat: Seat;
        text: string;
        createdAt: string;
        optimisticKey: string | null;
    }>;
};

type SessionSocket = Bun.ServerWebSocket<ConnectionData>;

export type ConnectionData = {
    roomId: string;
    seat: Seat;
    playerName: string;
    role: string;
};

function nowIso() {
    return new Date().toISOString();
}

export function normalizeRoomId(value: string | null | undefined) {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || 'room-demo';
}

export function normalizeSeat(value: string | null | undefined): Seat {
    return value === 'lime' ? 'lime' : 'sun';
}

export function normalizePlayerName(value: string | null | undefined, fallback: string) {
    const name = String(value || '').trim().replace(/\s+/g, ' ');
    return (name || fallback).slice(0, 24);
}

function otherSeat(seat: Seat): Seat {
    return seat === 'lime' ? 'sun' : 'lime';
}

function seatProfile(seat: Seat, name?: string): PlayerProfile {
    const base = seat === 'sun'
        ? { seat: 'sun' as Seat, name: 'Giulia', symbol: 'X' as const, accent: 'sun' as Seat }
        : { seat: 'lime' as Seat, name: 'Marco', symbol: 'O' as const, accent: 'lime' as Seat };

    if (name) {
        base.name = name;
    }

    return base;
}

function buildChatEntry(seat: Seat, text: string, optimisticKey: string | null = null) {
    return {
        id: crypto.randomUUID(),
        seat,
        text,
        createdAt: nowIso(),
        optimisticKey,
    };
}

function winningLine(board: string[]) {
    const lines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6],
    ];

    for (const [a, b, c] of lines) {
        if (board[a] && board[a] === board[b] && board[b] === board[c]) {
            return [a, b, c];
        }
    }

    return [];
}

export class TicTacToeRoomStore {
    #rooms = new Map<string, RoomState>();

    load(roomId: string) {
        if (!this.#rooms.has(roomId)) {
            this.#rooms.set(roomId, {
                roomId,
                createdAt: nowIso(),
                updatedAt: nowIso(),
                round: 1,
                turn: 'sun',
                nextStarter: 'lime',
                status: 'playing',
                winner: null,
                winningLine: [],
                turnStartedAt: nowIso(),
                board: Array(9).fill(''),
                scores: {
                    sun: 0,
                    lime: 0,
                },
                players: {
                    sun: seatProfile('sun'),
                    lime: seatProfile('lime'),
                },
                lastAction: 'Match ready. Sun opens the first move.',
                chat: [],
            });
        }

        return this.#rooms.get(roomId)!;
    }

    save(roomId: string, room: RoomState) {
        this.#rooms.set(roomId, room);
    }
}

export class TicTacToeWsSession {
    readonly receiver: RpcAbleReceiver;
    readonly role: string;
    readonly roomId: string;
    readonly seat: Seat;
    readonly socket: SessionSocket;
    playerName: string;
    client: any;

    constructor(
        ws: SessionSocket,
        data: ConnectionData,
        private readonly store: TicTacToeRoomStore,
        private readonly hub: TicTacToeRoomHub,
    ) {
        this.socket = ws;
        this.roomId = data.roomId;
        this.seat = data.seat;
        this.playerName = data.playerName;
        this.role = data.role;
        this.client = new RpcAble({
            transport: 'websocket',
            socket: this.socket,
            channel: WS_CHANNEL,
        });
        this.receiver = new RpcAbleReceiver({
            target: this,
            permissions: {
                bootstrap: ['user'],
                sync: ['user'],
                makeMove: ['user'],
                sendChat: ['user'],
                nextRound: ['user'],
            },
        });
    }

    bootstrap() {
        const room = this.syncPlayerProfile(this.store.load(this.roomId));
        return this.snapshotFor(room, this.seat);
    }

    sync() {
        const room = this.syncPlayerProfile(this.store.load(this.roomId));
        this.pushToSelf(room, 'sync');
    }

    makeMove(index: number) {
        if (index < 0 || index > 8) {
            throw new Error('Cell out of range.');
        }

        const room = this.syncPlayerProfile(this.store.load(this.roomId));
        if (room.status !== 'playing') {
            throw new Error('Round finished. Tap Rigioca.');
        }
        if (room.turn !== this.seat) {
            throw new Error('Wait for your turn.');
        }
        if (room.board[index] !== '') {
            throw new Error('That tile is already taken.');
        }

        room.board[index] = room.players[this.seat].symbol;
        room.updatedAt = nowIso();
        room.turnStartedAt = nowIso();
        room.lastAction = `${room.players[this.seat].name} marked tile ${index + 1}.`;

        const line = winningLine(room.board);
        if (line.length) {
            room.status = 'won';
            room.winner = this.seat;
            room.winningLine = line;
            room.scores[this.seat] += 1;
            room.lastAction = `${room.players[this.seat].name} won round ${room.round}.`;
        } else if (!room.board.includes('')) {
            room.status = 'draw';
            room.winner = null;
            room.winningLine = [];
            room.lastAction = 'Board full. It is a draw.';
        } else {
            room.turn = otherSeat(this.seat);
        }

        this.store.save(this.roomId, room);
        this.pushToSelf(room, 'move');
        this.hub.broadcast(this.roomId, room, 'move', this.socket);
    }

    sendChat(payload: { text?: string; optimisticKey?: string } = {}) {
        const text = String(payload.text || '').trim().slice(0, 160);
        if (!text) {
            throw new Error('Write a message first.');
        }

        const room = this.syncPlayerProfile(this.store.load(this.roomId));
        room.chat.push(buildChatEntry(this.seat, text, payload.optimisticKey || null));
        room.chat = room.chat.slice(-40);
        room.updatedAt = nowIso();
        room.lastAction = `${room.players[this.seat].name} sent a message.`;

        this.store.save(this.roomId, room);
        this.pushToSelf(room, 'chat');
        this.hub.broadcast(this.roomId, room, 'chat', this.socket);
    }

    nextRound() {
        const room = this.syncPlayerProfile(this.store.load(this.roomId));
        const starter = room.nextStarter ?? otherSeat(room.turn);

        room.round += 1;
        room.board = Array(9).fill('');
        room.turn = starter;
        room.nextStarter = otherSeat(starter);
        room.status = 'playing';
        room.winner = null;
        room.winningLine = [];
        room.updatedAt = nowIso();
        room.turnStartedAt = nowIso();
        room.lastAction = `Round ${room.round} started. ${room.players[starter].name} opens.`;

        this.store.save(this.roomId, room);
        this.pushToSelf(room, 'next-round');
        this.hub.broadcast(this.roomId, room, 'next-round', this.socket);
    }

    pushRoomUpdate(room: RoomState, event: string) {
        this.pushToSelf(room, event);
    }

    private pushToSelf(room: RoomState, event: string) {
        this.client.sessionUpdated({
            event,
            state: this.snapshotFor(room, this.seat),
        });
    }

    destroy() {
        this.client.destroy?.();
    }

    private syncPlayerProfile(room: RoomState) {
        if (room.players[this.seat].name !== this.playerName) {
            room.players[this.seat].name = this.playerName;
            room.updatedAt = nowIso();
            room.lastAction = `${this.playerName} joined the room.`;
            this.store.save(this.roomId, room);
            this.hub.broadcast(this.roomId, room, 'profile', this.socket);
        }

        return room;
    }

    private snapshotFor(room: RoomState, viewerSeat: Seat) {
        return {
            roomId: this.roomId,
            sessionKey: `ws:${this.roomId}:${viewerSeat}`,
            viewerSeat,
            viewer: room.players[viewerSeat],
            opponentSeat: otherSeat(viewerSeat),
            room,
            pollingSeconds: 5,
            serverNow: nowIso(),
            transport: 'websocket-bun',
            role: this.role,
        };
    }
}

export class TicTacToeRoomHub {
    #sessionsByRoom = new Map<string, Set<TicTacToeWsSession>>();

    register(session: TicTacToeWsSession) {
        if (!this.#sessionsByRoom.has(session.roomId)) {
            this.#sessionsByRoom.set(session.roomId, new Set());
        }
        this.#sessionsByRoom.get(session.roomId)!.add(session);
    }

    unregister(session: TicTacToeWsSession) {
        const sessions = this.#sessionsByRoom.get(session.roomId);
        if (!sessions) return;

        sessions.delete(session);
        if (sessions.size === 0) {
            this.#sessionsByRoom.delete(session.roomId);
        }
    }

    broadcast(roomId: string, room: RoomState, event: string, sender: SessionSocket) {
        const sessions = this.#sessionsByRoom.get(roomId);
        if (!sessions) return;

        for (const session of sessions) {
            if (session.socket === sender) continue;
            session.pushRoomUpdate(room, event);
        }
    }
}
