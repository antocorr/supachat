import path from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { decodeRpcMessage, RpcAble, RpcAbleReceiver } from '../../src/RpcAble.js';

const CHANNEL = '-userSession';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

class UserSession {
    constructor(ws, id, role) {
        this.ws = ws;
        this.user = {
            id: `node-ws-${id}`,
            name: `node-user-${id}`,
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
                saveProfile: ['user'],
                ping: ['user'],
            },
            logging: { validationFailed: 'throw' },
            contract: {
                join: {
                    inputSchema: {
                        type: 'object',
                        required: ['name'],
                        additionalProperties: false,
                        properties: {
                            name: { type: 'string', minLength: 3, maxLength: 24 },
                        },
                    },
                },
                saveProfile: {
                    inputSchema: {
                        type: 'object',
                        required: ['displayName', 'favoriteNumber'],
                        additionalProperties: false,
                        properties: {
                            displayName: { type: 'string', minLength: 3, maxLength: 20 },
                            favoriteNumber: { type: 'integer', minimum: 1, maximum: 99 },
                        },
                    },
                },
            },
        });
    }

    async join({ name }, role) {
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

    async saveProfile(profile, role) {
        const savedProfile = {
            ...profile,
            role,
            updatedAt: new Date().toISOString(),
        };
        this.client.profileSaved(savedProfile);
        return { saved: true, role };
    }

    ping(role) {
        this.client.pong({ now: new Date().toISOString(), transport: 'websocket', role });
    }
}

let nextId = 1;
const sessions = new Map();

const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname === '/rpcable.js') {
        return sendFile(res, path.resolve(__dirname, '../../src/RpcAble.js'), 'text/javascript; charset=utf-8');
    }

    if (url.pathname.startsWith('/vendor/tinybubble/dist/')) {
        const filePath = path.join(__dirname, 'node_modules', url.pathname.replace(/^\/vendor\//, ''));
        return sendFile(res, filePath, contentType(filePath));
    }

    const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.resolve(publicDir, `.${requestPath}`);
    if (filePath !== publicDir && !filePath.startsWith(`${publicDir}${path.sep}`)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    await sendFile(res, filePath, contentType(filePath));
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
    const session = new UserSession(ws, nextId++, 'user');
    sessions.set(ws, session);
    session.client.joined({ user: session.user });

    ws.on('message', (raw) => {
        const batch = decodeRpcMessage(raw, CHANNEL);
        if (!batch) return;
        session.receiver.dispatch(batch, { role: session.user.role });
    });

    ws.on('close', () => {
        session.client.destroy();
        sessions.delete(ws);
    });
});

server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname !== '/ws') {
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

const PORT = 3390;
server.listen(PORT, () => {
    console.log(`WebSocket Node example running on http://localhost:${PORT}`);
});

async function sendFile(res, filePath, mimeType) {
    try {
        const file = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': mimeType });
        res.end(file);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
    }
}

function contentType(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    return 'text/plain; charset=utf-8';
}
