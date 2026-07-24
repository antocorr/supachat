export const seatPalette = {
    sun: {
        fallbackName: 'Giulia',
        symbol: 'X',
        avatarClass: 'bg-gradient-to-br from-orange-200 to-yellow-100',
        symbolClass: 'text-orange-500',
        nameClass: 'text-orange-600',
        scoreClass: 'text-orange-500',
    },
    lime: {
        fallbackName: 'Marco',
        symbol: 'O',
        avatarClass: 'bg-gradient-to-br from-lime-200 to-lime-50',
        symbolClass: 'text-lime-600',
        nameClass: 'text-lime-600',
        scoreClass: 'text-lime-600',
    },
};

export function otherSeat(seat) {
    return seat === 'lime' ? 'sun' : 'lime';
}

export function randomId(prefix) {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }

    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseTime(value) {
    const stamp = Date.parse(value || '');
    return Number.isFinite(stamp) ? stamp : Date.now();
}

export function formatClock(value) {
    const total = Math.max(0, value | 0);
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function shortenName(value, fallback) {
    const name = String(value || fallback || 'Player');
    return name.length > 9 ? `${name.slice(0, 9)}…` : name;
}

export function buildPlayerPanel(room, seat) {
    const palette = seatPalette[seat] || seatPalette.sun;
    const player = room?.players?.[seat] || {};

    return {
        symbol: player.symbol || palette.symbol,
        displayName: shortenName(player.name, palette.fallbackName),
        score: room?.scores?.[seat] || 0,
        avatarClass: palette.avatarClass,
        symbolClass: palette.symbolClass,
        nameClass: palette.nameClass,
        scoreClass: palette.scoreClass,
    };
}

export function buildBoardCells(room, viewerSeat) {
    const canPlay = room?.status === 'playing' && room?.turn === viewerSeat;
    const board = Array.isArray(room?.board) ? room.board : Array(9).fill('');

    return board.map((value, index) => ({
        index,
        disabled: value !== '' || !canPlay,
        markClass: value === 'X' ? 'mark-x' : value === 'O' ? 'mark-o' : '',
    }));
}

export function buildBanner(room, viewerSeat) {
    const viewer = room?.players?.[viewerSeat];
    const opponent = room?.players?.[otherSeat(viewerSeat)];

    if (room?.status === 'won') {
        return {
            text: room?.winner === viewerSeat ? 'YOU WIN!' : `${shortenName(opponent?.name, 'Rival')} WINS`,
        };
    }

    if (room?.status === 'draw') {
        return { text: 'DRAW GAME' };
    }

    if (room?.turn === viewerSeat) {
        return { text: 'YOUR MOVE' };
    }

    return { text: 'WAITING' };
}

export function buildStatusText(room, viewerSeat) {
    const viewer = room?.players?.[viewerSeat];
    const opponent = room?.players?.[otherSeat(viewerSeat)];

    if (room?.status === 'won') {
        return room?.winner === viewerSeat
            ? `${shortenName(viewer?.name, 'You')} sealed the round.`
            : `${shortenName(opponent?.name, 'Opponent')} took this one.`;
    }

    if (room?.status === 'draw') {
        return 'Board full. Nobody blinked.';
    }

    return room?.turn === viewerSeat
        ? `${shortenName(viewer?.name, 'You')} to move.`
        : `${shortenName(opponent?.name, 'Opponent')} to move.`;
}

export function buildChatMessages(serverMessages, pendingMessages, viewerSeat) {
    const optimisticKeys = new Set(
        serverMessages
            .map((message) => message?.optimisticKey)
            .filter(Boolean)
    );

    const merged = [
        ...serverMessages,
        ...pendingMessages.filter((message) => !optimisticKeys.has(message.optimisticKey)),
    ];

    return merged.map((message) => ({
        id: message?.id || randomId('bubble'),
        text: message?.text || '',
        rowClass: message?.seat === viewerSeat ? 'flex justify-end' : 'flex justify-start',
        bubbleClass: message?.seat === viewerSeat ? 'bubble-chat-right' : 'bubble-chat-left',
    }));
}
