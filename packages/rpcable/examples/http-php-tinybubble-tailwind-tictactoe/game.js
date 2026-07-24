import { createComponent } from '../http-php-tinybubble-tailwind/vendor/tinybubble/dist/bubble.js';
import createGameApp from './components/game/GameApp.js';

function sanitizeRoomId(value) {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || 'room-demo';
}

function sanitizeSeat(value) {
    return value === 'lime' ? 'lime' : 'sun';
}

function sanitizePlayerName(value, fallback) {
    const trimmed = String(value || '').trim().slice(0, 24);
    return trimmed || fallback;
}

function sanitizeTransport(value) {
    return value === 'ws' || value === 'websocket' ? 'websocket' : 'http';
}

function defaultWebSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.hostname}:3310/ws`;
}

const params = new URLSearchParams(window.location.search);
const seat = sanitizeSeat(params.get('seat'));
const defaults = {
    sun: 'Giulia',
    lime: 'Marco',
};

const config = {
    roomId: sanitizeRoomId(params.get('room')),
    seat,
    playerName: sanitizePlayerName(params.get('name'), defaults[seat]),
    transport: sanitizeTransport(params.get('transport')),
    wsUrl: params.get('wsUrl') || defaultWebSocketUrl(),
};

const root = document.getElementById('app');

if (root) {
    const app = createComponent(createGameApp(config));
    app.appendTo(root);
}
