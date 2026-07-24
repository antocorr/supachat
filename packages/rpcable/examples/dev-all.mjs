import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const procs = [];

function bin(name) {
    return process.platform === 'win32' ? `${name}.cmd` : name;
}

function start(name, command, args, cwd) {
    const child = spawn(command, args, {
        cwd,
        stdio: 'inherit',
        env: process.env,
    });

    child.on('exit', (code, signal) => {
        if (signal) {
            console.log(`[${name}] exited with signal ${signal}`);
            return;
        }
        if (typeof code === 'number' && code !== 0) {
            console.log(`[${name}] exited with code ${code}`);
            shutdown(code);
        }
    });

    procs.push(child);
}

function shutdown(exitCode = 0) {
    for (const proc of procs) {
        if (!proc.killed) {
            proc.kill('SIGTERM');
        }
    }
    process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Starting examples:');
console.log('- Socket.io + Node: http://localhost:3100');
console.log('- HTTP + Bun:      http://localhost:3200');
console.log('- WS + Bun:        http://localhost:3300');
console.log('- WS + Node:       http://localhost:3350');

start(
    'socketio-node',
    bin('npm'),
    ['run', 'dev'],
    `${root}examples/socketio-node-tinybubble-tailwind`
);

start(
    'http-bun',
    bin('bun'),
    ['run', 'dev'],
    `${root}examples/http-bun-tinybubble`
);

start(
    'websocket-bun',
    bin('bun'),
    ['run', 'dev'],
    `${root}examples/websocket-bun-tinybubble`
);

start(
    'websocket-node',
    bin('npm'),
    ['run', 'dev'],
    `${root}examples/websocket-node-tinybubble`
);
