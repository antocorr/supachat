import { describe, test, expect } from 'bun:test';
import { RpcAble, RpcAbleReceiver, RpcAbleSession, RpcCallContext, getCallContext, encodeRpcMessage, decodeRpcMessage, extend } from '../src/RpcAble.js';

function makeSocket() {
    const emitted = [];
    return {
        emit: (event, data) => emitted.push({ event, data }),
        _emitted: emitted,
    };
}

function makeSession(socket, channel = 'ch') {
    class Session {}
    const session = new Session();
    const client = new RpcAble({ transport: 'socketio', socket, channel, target: session });
    session.client = client;
    return { session, client };
}

describe('RpcAble socketio transport', () => {
    test('batches calls in the same microtask into one emit', async () => {
        const socket = makeSocket();
        const client = new RpcAble({ transport: 'socketio', socket, channel: 'ch' });

        client.getGames();
        client.getUsers();
        await Promise.resolve();

        expect(socket._emitted).toHaveLength(1);
        expect(socket._emitted[0].event).toBe('ch');
        expect(socket._emitted[0].data).toEqual([
            { path: ['getGames'], args: [] },
            { path: ['getUsers'], args: [] },
        ]);
    });

    test('sends args correctly', async () => {
        const socket = makeSocket();
        const client = new RpcAble({ transport: 'socketio', socket, channel: 'ch' });

        client.deleteUser({ userId: '42' });
        await Promise.resolve();

        expect(socket._emitted[0].data[0]).toEqual({
            path: ['deleteUser'],
            args: [{ userId: '42' }],
        });
    });

    test('supports namespace chaining', async () => {
        const socket = makeSocket();
        const client = new RpcAble({ transport: 'socketio', socket, channel: 'ch' });

        client.scenes.getAll();
        await Promise.resolve();

        expect(socket._emitted[0].data[0].path).toEqual(['scenes', 'getAll']);
    });

    test('calls in different ticks are separate emits', async () => {
        const socket = makeSocket();
        const client = new RpcAble({ transport: 'socketio', socket, channel: 'ch' });

        client.foo();
        await Promise.resolve();
        client.bar();
        await Promise.resolve();

        expect(socket._emitted).toHaveLength(2);
    });

    test('extend adds methods to target', () => {
        const socket = makeSocket();
        const client = new RpcAble({ transport: 'socketio', socket, channel: 'ch' });
        let called = false;

        extend(client, { onData: () => { called = true; } });
        client.onData();

        expect(called).toBe(true);
    });

    test('extend supports dot notation for namespaces', () => {
        const socket = makeSocket();
        const client = new RpcAble({ transport: 'socketio', socket, channel: 'ch' });
        let called = false;

        extend(client, {
            'scenes.listed': () => {
                called = true;
            },
        });

        client.scenes.listed();
        expect(called).toBe(true);
    });

    test('awaiting a fire-and-forget call throws a helpful error', () => {
        const socket = makeSocket();
        const client = new RpcAble({ transport: 'socketio', socket, channel: 'ch' });
        const ticket = client.getGames();

        expect(() => ticket.then()).toThrow('fire-and-forget');
        expect(() => ticket.catch()).toThrow('fire-and-forget');
        expect(() => ticket.finally()).toThrow('fire-and-forget');
    });
});

describe('RpcAble request/response over websocket-like transports', () => {
    test('request() sends --request envelope and resolves on --response', async () => {
        const socket = makeSocket();
        const { session } = makeSession(socket);

        const promise = session.client.getGames().request();
        await Promise.resolve();

        const batch = socket._emitted[0].data;
        expect(batch[0].path).toEqual(['--request']);
        const reqId = batch[0].args[0].id;

        session['--response']({ id: reqId, ok: true, result: [1, 2, 3] });
        expect(await promise).toEqual([1, 2, 3]);
    });

    test('expects() is an alias for request()', async () => {
        const socket = makeSocket();
        const { session } = makeSession(socket);

        const promise = session.client.getGames().expects();
        await Promise.resolve();

        const reqId = socket._emitted[0].data[0].args[0].id;
        session['--response']({ id: reqId, ok: true, result: 'ok' });
        expect(await promise).toBe('ok');
    });

    test('request() rejects on error response', async () => {
        const socket = makeSocket();
        const { session } = makeSession(socket);

        const promise = session.client.doSomething().request();
        await Promise.resolve();

        const reqId = socket._emitted[0].data[0].args[0].id;
        session['--response']({ id: reqId, ok: false, error: { name: 'Error', message: 'bad' } });
        await expect(promise).rejects.toThrow('bad');
    });

    test('multiple concurrent request() calls resolve independently', async () => {
        const socket = makeSocket();
        const { session } = makeSession(socket);

        const p1 = session.client.foo().request();
        const p2 = session.client.bar().request();
        await Promise.resolve();

        const batch = socket._emitted[0].data;
        const id1 = batch[0].args[0].id;
        const id2 = batch[1].args[0].id;

        session['--response']({ id: id2, ok: true, result: 'b' });
        session['--response']({ id: id1, ok: true, result: 'a' });

        expect(await p1).toBe('a');
        expect(await p2).toBe('b');
    });

    test('request() called after flush rejects immediately', async () => {
        const socket = makeSocket();
        const { session } = makeSession(socket);

        const ticket = session.client.foo();
        await Promise.resolve();

        await expect(ticket.request()).rejects.toThrow('same tick');
    });
});

describe('RpcAble collector transport', () => {
    test('collects calls and flushes them', async () => {
        const collector = new RpcAble({ transport: 'collector' });

        collector.notifications.newMessage({ text: 'hi' });
        collector.badge.set(3);
        await Promise.resolve();

        expect(collector.flush()).toEqual([
            { path: ['notifications', 'newMessage'], args: [{ text: 'hi' }] },
            { path: ['badge', 'set'], args: [3] },
        ]);
        expect(collector.flush()).toEqual([]);
    });

    test('request() is not supported on collector', async () => {
        const collector = new RpcAble({ transport: 'collector' });
        const ticket = collector.foo();
        await expect(ticket.request()).rejects.toThrow('does not support request');
    });
});

describe('RpcAble destroy', () => {
    test('destroy() rejects all pending requests immediately', async () => {
        const socket = makeSocket();
        const { session } = makeSession(socket);

        const p1 = session.client.foo().request();
        const p2 = session.client.bar().request();
        await Promise.resolve();

        session.client.destroy();

        await expect(p1).rejects.toThrow('destroyed');
        await expect(p2).rejects.toThrow('destroyed');
    });

    test('destroy() clears the collector queue', async () => {
        const collector = new RpcAble({ transport: 'collector' });
        collector.foo();
        await Promise.resolve();
        collector.destroy();
        expect(collector.flush()).toEqual([]);
    });
});

describe('RpcAble websocket pre-connect buffer and auto-destroy', () => {
    function makeWsSocket(initialState = 0) {
        const listeners = { open: [], close: [] };
        const sent = [];
        const socket = {
            CONNECTING: 0,
            OPEN: 1,
            readyState: initialState,
            send: (data) => sent.push(data),
            addEventListener: (event, cb) => { if (listeners[event]) listeners[event].push(cb); },
            _sent: sent,
            _open() { socket.readyState = 1; listeners.open.forEach(cb => cb()); },
            _close() { socket.readyState = 3; listeners.close.forEach(cb => cb()); },
        };
        return socket;
    }

    test('calls made while CONNECTING are sent after open', async () => {
        const ws = makeWsSocket(0);
        const client = new RpcAble({ transport: 'websocket', socket: ws, channel: 'ch' });

        client.getGames();
        await Promise.resolve();
        expect(ws._sent).toHaveLength(0);

        ws._open();
        expect(ws._sent).toHaveLength(1);
        expect(JSON.parse(ws._sent[0]).batch[0].path).toEqual(['getGames']);
    });

    test('close event triggers destroy() and rejects pending requests', async () => {
        const ws = makeWsSocket(0);
        const session = {};
        const client = new RpcAble({ transport: 'websocket', socket: ws, channel: 'ch', target: session });

        ws._open();
        const p = client.foo().request();
        await Promise.resolve();

        ws._close();
        await expect(p).rejects.toThrow('destroyed');
    });
});

describe('RpcAbleReceiver', () => {
    test('dispatch invokes a method and returns results', async () => {
        class Target {
            getGames() { return [1, 2, 3]; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['getGames'], args: [] },
        ]);
        expect(result).toEqual([1, 2, 3]);
    });

    test('dispatch passes args correctly', async () => {
        class Target {
            add(a, b) { return a + b; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['add'], args: [2, 3] },
        ]);
        expect(result).toBe(5);
    });

    test('dispatch supports namespace path', async () => {
        class Target {
            scenes = { getAll() { return ['s1']; } };
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['scenes', 'getAll'], args: [] },
        ]);
        expect(result).toEqual(['s1']);
    });

    test('dispatch awaits async methods', async () => {
        class Target {
            async getItems() { return ['a', 'b']; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['getItems'], args: [] },
        ]);
        expect(result).toEqual(['a', 'b']);
    });

    test('.set convention mutates a property', async () => {
        class Target { count = 0; }
        const target = new Target();
        await new RpcAbleReceiver({ target }).dispatch([
            { path: ['count', 'set'], args: [42] },
        ]);
        expect(target.count).toBe(42);
    });

    test('missing method returns undefined and logs error', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        class Target {}
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['missing'], args: [] },
        ]);

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('missing');
    });

    test('dispatch returns a Promise', () => {
        class Target { greet() { return 'hi'; } }
        const result = new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['greet'], args: [] },
        ]);
        expect(result).toBeInstanceOf(Promise);
    });

    test('dispatch accepts role in options', async () => {
        class Target {
            whoAmI() { return getCallContext(arguments).role; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['whoAmI'], args: [null] },
        ], { role: 'admin' });
        expect(result).toBe('admin');
    });


    test('permissions block forbidden roles', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        class Target {
            deleteAll() { return 'deleted'; }
        }
        const receiver = new RpcAbleReceiver({ target: new Target(), permissions: { deleteAll: ['superadmin'] } });
        const [result] = await receiver.dispatch([
            { path: ['deleteAll'], args: [] },
        ], { role: 'user' });

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('access denied');
    });

    test('permissions allow matching role', async () => {
        class Target {
            secret() { return 'ok'; }
        }
        const receiver = new RpcAbleReceiver({ target: new Target(), permissions: { secret: ['admin'] } });
        const [result] = await receiver.dispatch([
            { path: ['secret'], args: [] },
        ], { role: 'admin' });
        expect(result).toBe('ok');
    });

    test('permissions with falsy value block all roles', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        class Target {
            deleteAll() { return 'deleted'; }
        }
        const receiver = new RpcAbleReceiver({ target: new Target(), permissions: { deleteAll: false } });
        const [result] = await receiver.dispatch([
            { path: ['deleteAll'], args: [] },
        ], { role: 'admin' });

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('access denied');
    });

    test('permissions with undefined value block all roles', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        class Target {
            deleteAll() { return 'deleted'; }
        }
        const receiver = new RpcAbleReceiver({ target: new Target(), permissions: { deleteAll: undefined } });
        const [result] = await receiver.dispatch([
            { path: ['deleteAll'], args: [] },
        ], { role: 'admin' });

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('access denied');
    });

    test('--request triggers request/response round-trip', async () => {
        const responses = [];
        class Target {
            client = { '--response': (p) => responses.push(p) };
            async getGames() { return [1, 2]; }
        }
        await new RpcAbleReceiver({ target: new Target() }).dispatch([{
            path: ['--request'],
            args: [{ id: 'r1', path: ['getGames'], args: [] }],
        }]);
        expect(responses[0]).toMatchObject({ id: 'r1', ok: true, result: [1, 2] });
    });

    test('--request sends error response on exception', async () => {
        const responses = [];
        class Target {
            client = { '--response': (p) => responses.push(p) };
            async fail() { throw new Error('boom'); }
        }
        await new RpcAbleReceiver({ target: new Target() }).dispatch([{
            path: ['--request'],
            args: [{ id: 'r2', path: ['fail'], args: [] }],
        }]);
        expect(responses[0]).toMatchObject({ id: 'r2', ok: false });
        expect(responses[0].error.message).toBe('boom');
    });

    test('method named same as a receiver method resolves on target', async () => {
        class Target {
            dispatch() { return 'target dispatch'; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['dispatch'], args: [] },
        ]);
        expect(result).toBe('target dispatch');
    });
});

describe('RpcAbleReceiver contract validation', () => {
    function makeReceiver(contract, logMode = 'error') {
        class Target {
            greet(name) { return `hello ${name}`; }
            update(data) { return data; }
            anything(x) { return x; }
        }
        return new RpcAbleReceiver({
            target: new Target(),
            contract,
            logging: { validationFailed: logMode },
        });
    }

    test('valid input passes and method is called', async () => {
        const receiver = makeReceiver({
            greet: { inputSchema: { type: 'string', minLength: 1 } },
        });
        const [result] = await receiver.dispatch([{ path: ['greet'], args: ['world'] }]);
        expect(result).toBe('hello world');
    });

    test('wrong type blocks call and returns undefined', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        const receiver = makeReceiver({ greet: { inputSchema: { type: 'string' } } });
        const [result] = await receiver.dispatch([{ path: ['greet'], args: [42] }]);

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('validation failed');
    });

    test('missing required property blocks call', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        const receiver = makeReceiver({
            update: { inputSchema: { type: 'object', required: ['id'] } },
        });
        const [result] = await receiver.dispatch([{ path: ['update'], args: [{ name: 'x' }] }]);

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('missing required property');
    });

    test('method not listed in contract passes through', async () => {
        const receiver = makeReceiver({ greet: { inputSchema: { type: 'string' } } });
        const [result] = await receiver.dispatch([{ path: ['anything'], args: [99] }]);
        expect(result).toBe(99);
    });

    test('validationFailed: throw throws instead of returning undefined', async () => {
        const receiver = makeReceiver({ greet: { inputSchema: { type: 'string' } } }, 'throw');
        await expect(
            receiver.dispatch([{ path: ['greet'], args: [false] }])
        ).rejects.toThrow('validation failed');
    });

    test('validationFailed: false suppresses log and returns undefined', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a);

        const receiver = makeReceiver({ greet: { inputSchema: { type: 'string' } } }, false);
        const [result] = await receiver.dispatch([{ path: ['greet'], args: [123] }]);

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors).toHaveLength(0);
    });

    test('enum validation blocks value not in list', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        const receiver = makeReceiver({ greet: { inputSchema: { enum: ['alice', 'bob'] } } });
        const [result] = await receiver.dispatch([{ path: ['greet'], args: ['charlie'] }]);

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('must be one of');
    });

    test('array items validation blocks invalid item', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        const receiver = makeReceiver({
            update: { inputSchema: { type: 'array', items: { type: 'number' } } },
        });
        const [result] = await receiver.dispatch([{ path: ['update'], args: [[1, 'two', 3]] }]);

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('item[1]');
    });
});

describe('RpcAbleReceiver dispatch with role', () => {
    test('an RpcCallContext is appended as the last argument', async () => {
        class Target {
            doSomething(data, ctx) { return { data, isContext: ctx instanceof RpcCallContext, role: ctx.role }; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch(
            [{ path: ['doSomething'], args: [{ x: 1 }] }],
            { role: 'admin' }
        );
        expect(result).toEqual({ data: { x: 1 }, isContext: true, role: 'admin' });
    });

    test('works with namespace path', async () => {
        class Target {
            scenes = {
                delete: async ({ sceneId }, ctx) => ({ deleted: sceneId, by: ctx.role }),
            };
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch(
            [{ path: ['scenes', 'delete'], args: [{ sceneId: 7 }] }],
            { role: 'admin' }
        );
        expect(result).toEqual({ deleted: 7, by: 'admin' });
    });

    test('permission allows matching role', async () => {
        class Target {
            secret(ctx) { return `ok as ${ctx.role}`; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target(), permissions: { secret: ['admin'] } }).dispatch(
            [{ path: ['secret'], args: [] }],
            { role: 'admin' }
        );
        expect(result).toBe('ok as admin');
    });

    test('permission blocks non-matching role', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        class Target {
            secret() { return 'ok'; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target(), permissions: { secret: ['admin'] } }).dispatch(
            [{ path: ['secret'], args: [] }],
            { role: 'guest' }
        );

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('access denied');
        expect(errors[0]).toContain('guest');
    });

    test('blocks methods not listed in permissions', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        let called = false;
        class Target {
            hidden() {
                called = true;
                return 'should-not-run';
            }
        }

        const [result] = await new RpcAbleReceiver({ target: new Target(), permissions: { safe: ['user'] } }).dispatch(
            [{ path: ['hidden'], args: [] }],
            { role: 'user' }
        );

        console.error = orig;
        expect(result).toBeUndefined();
        expect(called).toBe(false);
        expect(errors[0]).toContain('access denied');
    });

    test('receiver settings can silence notFound logs', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        const [result] = await new RpcAbleReceiver({ target: {}, logging: { notFound: false } }).dispatch(
            [{ path: ['missing'], args: [] }],
            { role: 'user' }
        );

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors).toHaveLength(0);
    });

    test('receiver settings can route forbidden logs to console.log', async () => {
        const logs = [];
        const errors = [];
        const origLog = console.log;
        const origError = console.error;
        console.log = (...a) => logs.push(a.join(' '));
        console.error = (...a) => errors.push(a.join(' '));

        class Target {
            secret() { return 'ok'; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target(), permissions: { secret: ['admin'] }, logging: { forbidden: 'log', permission: false, notFound: false } }).dispatch([{ path: ['secret'], args: [] }], { role: 'user' });

        console.log = origLog;
        console.error = origError;
        expect(result).toBeUndefined();
        expect(logs[0]).toContain('access denied');
        expect(errors).toHaveLength(0);
    });

    test('receiver settings accept "error" alias for console.error', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        class Target {
            secret() { return 'ok'; }
        }

        const [result] = await new RpcAbleReceiver({ target: new Target(), permissions: { secret: ['admin'] }, logging: { forbidden: 'error' } }).dispatch(
            [{ path: ['secret'], args: [] }],
            { role: 'user' }
        );

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('access denied');
    });

    test('missing method returns undefined and logs error', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        class Target {}
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch(
            [{ path: ['missing'], args: [] }],
            { role: 'admin' }
        );

        console.error = orig;
        expect(result).toBeUndefined();
        expect(errors[0]).toContain('missing');
    });

    test('multiple args are passed correctly before the call context', async () => {
        class Target {
            add(a, b, ctx) { return { sum: a + b, role: ctx.role }; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch(
            [{ path: ['add'], args: [3, 4] }],
            { role: 'user' }
        );
        expect(result).toEqual({ sum: 7, role: 'user' });
    });

    test('no role bypasses permission checks', async () => {
        class Target {
            secret() { return 'ok'; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target(), permissions: { secret: ['admin'] } }).dispatch([
            { path: ['secret'], args: [] },
        ]);
        expect(result).toBe('ok');
    });

    test('session from receiver options is delivered in the call context', async () => {
        const userSession = { name: 'us1' };
        class Target {
            hello() { return getCallContext(arguments).session.name; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target(), session: userSession }).dispatch([
            { path: ['hello'], args: [] },
        ]);
        expect(result).toBe('us1');
    });

    test('session in dispatch options overrides the receiver default', async () => {
        class Target {
            hello() { return getCallContext(arguments).session.name; }
        }
        const receiver = new RpcAbleReceiver({ target: new Target(), session: { name: 'default' } });
        const [result] = await receiver.dispatch([
            { path: ['hello'], args: [] },
        ], { session: { name: 'override' } });
        expect(result).toBe('override');
    });

    test('session works on nested-path methods whose this is the parent object', async () => {
        const userSession = { name: 'us1' };
        class Space {
            initialized = false;
            getUpdate() { return { initialized: this.initialized, session: getCallContext(arguments).session.name }; }
        }
        class Target {
            contextSpace = new Space();
        }
        const [result] = await new RpcAbleReceiver({ target: new Target(), session: userSession }).dispatch([
            { path: ['contextSpace', 'getUpdate'], args: [] },
        ], { role: 'user' });
        expect(result).toEqual({ initialized: false, session: 'us1' });
    });

    test('getCallContext returns null on a local call', () => {
        class Target {
            hello() { return getCallContext(arguments); }
        }
        expect(new Target().hello()).toBeNull();
    });

    test('without role and session nothing is appended to the args', async () => {
        class Target {
            count() { return arguments.length; }
        }
        const [result] = await new RpcAbleReceiver({ target: new Target() }).dispatch([
            { path: ['count'], args: [] },
        ]);
        expect(result).toBe(0);
    });

    test('logging.warnFunction is called instead of console.warn when mode is warn', async () => {
        const captured = [];
        class Target {
            secret() { return 'ok'; }
        }
        const receiver = new RpcAbleReceiver({
            target: new Target(),
            permissions: { secret: ['admin'] },
            logging: { forbidden: 'warn', warnFunction: (msg) => captured.push(msg) },
        });
        await receiver.dispatch([{ path: ['secret'], args: [] }], { role: 'user' });
        expect(captured).toHaveLength(1);
        expect(captured[0]).toContain('access denied');
    });

    test('logging.logFunction is called instead of console.log when mode is log', async () => {
        const captured = [];
        const receiver = new RpcAbleReceiver({
            target: {},
            logging: { notFound: 'log', logFunction: (msg) => captured.push(msg) },
        });
        await receiver.dispatch([{ path: ['missing'], args: [] }]);
        expect(captured).toHaveLength(1);
        expect(captured[0]).toContain('not found');
    });

    test('updateSettings merges logging without touching other keys', async () => {
        const captured = [];
        const receiver = new RpcAbleReceiver({
            target: {},
            logging: { notFound: false, permission: 'error' },
        });
        receiver.updateSettings('logging', { notFound: 'log', logFunction: (msg) => captured.push(msg) });
        await receiver.dispatch([{ path: ['missing'], args: [] }]);
        expect(captured).toHaveLength(1);
    });

    test('resetSettings restores logging defaults then applies data', async () => {
        const errors = [];
        const orig = console.error;
        console.error = (...a) => errors.push(a.join(' '));

        const receiver = new RpcAbleReceiver({ target: {}, logging: { notFound: false } });
        receiver.resetSettings('logging', { notFound: 'error' });
        await receiver.dispatch([{ path: ['missing'], args: [] }]);

        console.error = orig;
        expect(errors).toHaveLength(1);
    });
});

describe('encodeRpcMessage / decodeRpcMessage', () => {
    const batch = [{ path: ['foo'], args: [1] }];

    test('encode produces a JSON string with _rpcable envelope', () => {
        const parsed = JSON.parse(encodeRpcMessage('ch', batch));
        expect(parsed._rpcable).toBe(1);
        expect(parsed.event).toBe('ch');
        expect(parsed.batch).toEqual(batch);
    });

    test('decode returns batch from envelope', () => {
        expect(decodeRpcMessage(encodeRpcMessage('ch', batch), 'ch')).toEqual(batch);
    });

    test('decode filters out wrong event', () => {
        expect(decodeRpcMessage(encodeRpcMessage('ch', batch), 'other')).toBeNull();
    });

    test('decode accepts raw array (socket.io legacy format)', () => {
        expect(decodeRpcMessage(batch)).toEqual(batch);
    });

    test('decode returns null for garbage', () => {
        expect(decodeRpcMessage('not json')).toBeNull();
        expect(decodeRpcMessage(null)).toBeNull();
        expect(decodeRpcMessage('{}')).toBeNull();
    });

    test('decode handles Buffer input', () => {
        const buf = Buffer.from(encodeRpcMessage('ch', batch), 'utf8');
        expect(decodeRpcMessage(buf, 'ch')).toEqual(batch);
    });
});

describe('verb-based permissions', () => {
    test("'*' base policy applies when no exact rule matches", async () => {
        class Target {
            ping() { return 'pong'; }
        }
        const receiver = new RpcAbleReceiver({ target: new Target(), permissions: { '*': { call: ['user'] } } });
        const [allowed] = await receiver.dispatch([{ path: ['ping'], args: [] }], { role: 'user' });
        const [denied] = await receiver.dispatch([{ path: ['ping'], args: [] }], { role: 'guest' });
        expect(allowed).toBe('pong');
        expect(denied).toBeUndefined();
    });

    test("exact rule shadows '*' entirely: undeclared verb is denied", async () => {
        const target = { userId: 7 };
        const receiver = new RpcAbleReceiver({
            target,
            permissions: { '*': { set: ['admin'] }, userId: { get: ['admin'] } },
        });
        await receiver.dispatch([{ path: ['userId', 'set'], args: [99] }], { role: 'admin' });
        expect(target.userId).toBe(7);
    });

    test('object form get gates property reads by role', async () => {
        const receiver = new RpcAbleReceiver({ target: { userId: 7 }, permissions: { userId: { get: ['admin'] } } });
        const [allowed] = await receiver.dispatch([{ path: ['userId'], args: [] }], { role: 'admin' });
        const [denied] = await receiver.dispatch([{ path: ['userId'], args: [] }], { role: 'user' });
        expect(allowed).toBe(7);
        expect(denied).toBeUndefined();
    });

    test('object form set gates the .set convention', async () => {
        const target = { badge: 1 };
        const receiver = new RpcAbleReceiver({ target, permissions: { badge: { set: ['admin'] } } });
        await receiver.dispatch([{ path: ['badge', 'set'], args: [99] }], { role: 'user' });
        expect(target.badge).toBe(1);
        await receiver.dispatch([{ path: ['badge', 'set'], args: [99] }], { role: 'admin' });
        expect(target.badge).toBe(99);
    });

    test('array shorthand covers call but not property get', async () => {
        class Target {
            counter = 5;
            getGames() { return [1]; }
        }
        const receiver = new RpcAbleReceiver({
            target: new Target(),
            permissions: { getGames: ['user'], counter: ['user'] },
        });
        const [games] = await receiver.dispatch([{ path: ['getGames'], args: [] }], { role: 'user' });
        const [counter] = await receiver.dispatch([{ path: ['counter'], args: [] }], { role: 'user' });
        expect(games).toEqual([1]);
        expect(counter).toBeUndefined();
    });

    test('true shorthand allows call for any role but not set', async () => {
        const target = {
            badge: 1,
            ping() { return 'pong'; },
        };
        const receiver = new RpcAbleReceiver({ target, permissions: { ping: true, badge: true } });
        const [result] = await receiver.dispatch([{ path: ['ping'], args: [] }], { role: 'whoever' });
        await receiver.dispatch([{ path: ['badge', 'set'], args: [99] }], { role: 'whoever' });
        expect(result).toBe('pong');
        expect(target.badge).toBe(1);
    });

    test('verb true inside the object form allows any role', async () => {
        const receiver = new RpcAbleReceiver({ target: { userId: 7 }, permissions: { userId: { get: true } } });
        const [result] = await receiver.dispatch([{ path: ['userId'], args: [] }], { role: 'guest' });
        expect(result).toBe(7);
    });

    test('nested property paths use the dotted key', async () => {
        const target = { user: { name: 'ada' } };
        const receiver = new RpcAbleReceiver({
            target,
            permissions: { 'user.name': { get: ['admin'], set: ['admin'] } },
        });
        const [name] = await receiver.dispatch([{ path: ['user', 'name'], args: [] }], { role: 'admin' });
        await receiver.dispatch([{ path: ['user', 'name', 'set'], args: ['bob'] }], { role: 'user' });
        expect(name).toBe('ada');
        expect(target.user.name).toBe('ada');
        await receiver.dispatch([{ path: ['user', 'name', 'set'], args: ['bob'] }], { role: 'admin' });
        expect(target.user.name).toBe('bob');
    });

    test('a real method named set resolves as a call with the full path key', async () => {
        const target = { badge: { set(v) { this.value = v; return 'called'; } } };
        const receiver = new RpcAbleReceiver({ target, permissions: { 'badge.set': ['admin'] } });
        const [result] = await receiver.dispatch([{ path: ['badge', 'set'], args: [42] }], { role: 'admin' });
        expect(result).toBe('called');
        expect(target.badge.value).toBe(42);
    });
});

describe('proxy assignment and await sugar', () => {
    function makeConnection() {
        const emitted = [];
        return {
            emit: (event, data) => emitted.push({ event, data }),
            _emitted: emitted,
        };
    }

    function makeClient(target = {}) {
        const connection = makeConnection();
        const client = new RpcAble({ transport: 'socketio', connection, channel: 'ch', target });
        return { client, connection };
    }

    const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));

    test('top-level assignment enqueues a .set entry', async () => {
        const { client, connection } = makeClient();
        client.badge = 3;
        await nextTick();
        expect(connection._emitted[0].data.batch[0]).toEqual({ path: ['badge', 'set'], args: [3] });
    });

    test('nested assignment enqueues the full path', async () => {
        const { client, connection } = makeClient();
        client.user.name = 'ada';
        await nextTick();
        expect(connection._emitted[0].data.batch[0]).toEqual({ path: ['user', 'name', 'set'], args: ['ada'] });
    });

    test('assignment to a local target property stays local', async () => {
        const target = { localFlag: false };
        const { client, connection } = makeClient(target);
        client.localFlag = true;
        await nextTick();
        expect(target.localFlag).toBe(true);
        expect(connection._emitted.length).toBe(0);
    });

    test('assignment to an RpcAble own property stays on the instance', async () => {
        const { client, connection } = makeClient();
        client.requestTimeoutMs = 99;
        await nextTick();
        expect(client.requestTimeoutMs).toBe(99);
        expect(connection._emitted.length).toBe(0);
    });

    test('awaiting a property proxy sends a request entry and resolves with the response', async () => {
        const { client, connection } = makeClient();
        const pending = (async () => await client.user.badge)();
        await nextTick();
        const entry = connection._emitted[0].data.batch[0];
        expect(entry.path).toEqual(['user', 'badge']);
        expect(typeof entry.id).toBe('string');
        client._handleResponse({ id: entry.id, ok: true, result: 42 });
        expect(await pending).toBe(42);
    });

    test('a thenable check does not send a request', async () => {
        const { client, connection } = makeClient();
        expect(typeof client.badge.then).toBe('function');
        await nextTick();
        expect(connection._emitted.length).toBe(0);
    });

    test('the root proxy is not thenable', () => {
        const { client } = makeClient();
        expect(client.then).toBeUndefined();
    });

    test('awaiting a call sends a request entry and resolves with the response', async () => {
        const { client, connection } = makeClient();
        const pending = (async () => await client.join({ name: 'x' }))();
        await nextTick();
        const entry = connection._emitted[0].data.batch[0];
        expect(entry.path).toEqual(['join']);
        expect(entry.args).toEqual([{ name: 'x' }]);
        expect(typeof entry.id).toBe('string');
        client._handleResponse({ id: entry.id, ok: true, result: 'joined' });
        expect(await pending).toBe('joined');
    });

    test('a call without await stays fire-and-forget (no id)', async () => {
        const { client, connection } = makeClient();
        client.notify('hi');
        await nextTick();
        expect(connection._emitted[0].data.batch[0]).toEqual({ path: ['notify'], args: ['hi'] });
    });

    test('awaiting after the batch was sent rejects', async () => {
        const { client } = makeClient();
        const ticket = client.foo();
        await nextTick();
        await expect(ticket.then(v => v)).rejects.toThrow('same tick');
    });

    test('an error response rejects the awaited call', async () => {
        const { client, connection } = makeClient();
        const pending = (async () => await client.boom())();
        await nextTick();
        const entry = connection._emitted[0].data.batch[0];
        client._handleResponse({ id: entry.id, ok: false, error: { name: 'GameError', message: 'nope' } });
        await expect(pending).rejects.toThrow('nope');
    });
});

describe('dispatchMessage and receiver role', () => {
    class Target {
        secret() { return 'ok'; }
    }

    test('receiver role option gates dispatch by default', async () => {
        const allowed = new RpcAbleReceiver({ target: new Target(), role: 'admin', permissions: { secret: ['admin'] } });
        expect((await allowed.dispatch([{ path: ['secret'], args: [] }]))[0]).toBe('ok');
        const denied = new RpcAbleReceiver({ target: new Target(), role: 'user', permissions: { secret: ['admin'] } });
        expect((await denied.dispatch([{ path: ['secret'], args: [] }]))[0]).toBeUndefined();
    });

    test('explicit role in dispatch options overrides the receiver role', async () => {
        const receiver = new RpcAbleReceiver({ target: new Target(), role: 'user', permissions: { secret: ['admin'] } });
        expect((await receiver.dispatch([{ path: ['secret'], args: [] }], { role: 'admin' }))[0]).toBe('ok');
    });

    test('explicit null role bypasses checks even with a receiver role', async () => {
        const receiver = new RpcAbleReceiver({ target: new Target(), role: 'user', permissions: { secret: ['admin'] } });
        expect((await receiver.dispatch([{ path: ['secret'], args: [] }], { role: null }))[0]).toBe('ok');
    });

    test('role can be a function resolved per dispatch', async () => {
        let current = 'user';
        const receiver = new RpcAbleReceiver({ target: new Target(), role: () => current, permissions: { secret: ['admin'] } });
        expect((await receiver.dispatch([{ path: ['secret'], args: [] }]))[0]).toBeUndefined();
        current = 'admin';
        expect((await receiver.dispatch([{ path: ['secret'], args: [] }]))[0]).toBe('ok');
    });

    test('dispatchMessage routes a websocket frame end to end', async () => {
        const ws = { sent: [], send(d) { this.sent.push(d); }, readyState: 1 };
        const target = { ping() { return 'pong'; } };
        const session = new RpcAbleSession({
            transport: 'websocket',
            connection: ws,
            channel: 'ch',
            target,
            role: 'user',
            permissions: { ping: ['user'] },
        });
        const handled = session.dispatchMessage(encodeRpcMessage('ch', [{ path: ['ping'], args: [], id: 'r1' }]));
        expect(handled).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 0));
        const out = JSON.parse(ws.sent[0]);
        expect(out.responses[0]).toMatchObject({ id: 'r1', ok: true, result: 'pong' });
    });

    test('dispatchMessage returns false for frames of another channel', () => {
        const ws = { send() {}, readyState: 1 };
        const session = new RpcAbleSession({ transport: 'websocket', connection: ws, channel: 'ch', target: {} });
        expect(session.dispatchMessage(encodeRpcMessage('other', [{ path: ['x'], args: [] }]))).toBe(false);
        expect(session.dispatchMessage('garbage')).toBe(false);
    });
});
