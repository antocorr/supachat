import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { RpcAble, RpcAbleReceiver } from '../../src/RpcAble.js';

const CHANNEL = '-userSession';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
    transports: ['websocket'],
    allowUpgrades: false,
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));

app.get('/rpcable.js', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '../../src/RpcAble.js'));
});

class UserSession {
    constructor(socket) {
        this.socket = socket;
        this.user = {
            id: socket.id,
            name: `player-${socket.id.slice(0, 4)}`,
        };

        this.client = new RpcAble({
            transport: 'socketio',
            socket,
            channel: CHANNEL,
        });

        this.receiver = new RpcAbleReceiver({
            target: this,
            permissions: {
                join: ['user'],
                getGames: ['user'],
                ping: ['user'],
                adminOnlyMethod: ['admin'],
            },
        });

        socket.on(CHANNEL, (batch) => {
            if (!Array.isArray(batch)) return;
            this.receiver.dispatch(batch, { role: 'user' });
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
    //this won't be callable by non-admin clients, it's just here to demonstrate that the server can have methods that are not exposed to the client
    adminOnlyMethod() {
        console.error('This method should not be called by normal users!');
    }
    forbidden() {
        console.error('This method should not be called by anyone!');
    }
    async getGames(role) {
        const games = [
            { id: 1, name: 'Chess', mode: '1v1' },
            { id: 2, name: 'Rocket League', mode: '3v3' },
            { id: 3, name: 'Sea of Thieves', mode: 'Co-op' },
        ];
        this.client.gamesReceived(games);
        console.log(`[allowed:getGames] role=${role}`);
        return games.length;
    }

    ping(role) {
        this.client.pong({ now: new Date().toISOString(), transport: 'socket.io', role });
    }
}

io.on('connection', (socket) => {
    const userSession = new UserSession(socket);
    userSession.client.joined({ user: userSession.user });
});

const PORT = 3100;
server.listen(PORT, () => {
    console.log(`Socket.io example running on http://localhost:${PORT}`);
});
