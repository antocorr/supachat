# Rpc-Able

Transparent RPC with one API across socket.io, native WebSocket, and HTTP.

No string dispatch. No switch/case. Just method calls.

```js
// client
extend(userSession, {
    gamesReceived(games) {
        console.log(games);
    },
});
//calling server method directly in the client
userSession.getGames({ category: 'ball-games' });

// server
async getGames(filter) {
    const where = {};
    if(filter && typeof filter.category == 'string'){
        where.category = filter.category
    }
    const games = await db.find('games', where);
    this.client.gamesReceived(games);
}
```

## Install

```bash
npm install rpcable
```

## Core API

| Class | Role |
|---|---|
| `RpcAble` | Outbound proxy transport (`socketio`, `websocket`, `http`, `collector`) |
| `RpcAbleReceiver` | Routes incoming batch entries to class methods |
| `extend(proxy, handlers)` | Register push handlers on an `RpcAble` proxy |
| `getInstance(proxy)` | Return the internal `RpcAble` instance from a proxy |
| `getTransport(proxy)` | Return the transport string of an `RpcAble` proxy |

Calls in the same synchronous tick are automatically batched.

Use `extend(proxy, ...)` to register push handlers such as `gamesReceived`.

## Client setup (socket.io)

```js
import { RpcAble, RpcAbleReceiver, extend } from 'rpcable';
import socket from './socket.js';

const CHANNEL = '-userSession';

class Session {
    joined({ user }) {
        // store user
    }
}

const session = new Session();

export const userSession = new RpcAble({
    transport: 'socketio',
    socket,
    channel: CHANNEL,
    target: session,
});

extend(userSession, {
    gamesReceived(games) {
        session.games = games;
    },
});

const receiver = new RpcAbleReceiver({ target: session });
socket.on(CHANNEL, (batch) => receiver.dispatch(batch));
```

## Server setup (socket.io)

```js
import { RpcAble, RpcAbleReceiver } from 'rpcable';

const CHANNEL = '-userSession';

class UserSession {
    constructor(socket, userData) {
        this.user = userData;
        this.client = new RpcAble({
            transport: 'socketio',
            socket,
            channel: CHANNEL,
        });
        this.receiver = new RpcAbleReceiver({ target: this });

        socket.on(CHANNEL, (batch) => this.receiver.dispatch(batch, { role: userData.role }));
    }

    async getGames() {
        const games = await db.find('games', {});
        this.client.gamesReceived(games);
    }
}
```

## Request/response over WebSocket

Default WS calls are fire-and-forget:

```js
extend(userSession, {
    gamesReceived(games) {
        console.log(games);
    },
});

userSession.getGames();
```

If you need a returned value on any transport:

```js
const games = await userSession.getGames().request();
const same = await userSession.getGames().expects();
```

`await userSession.getGames()` now throws the same helpful fire-and-forget error on WebSocket and HTTP. Plain calls still send; use `.request()` or `.expects()` only when you need the response.

Server method:

```js
async getGames() {
    return await db.find('games', {});
}
```

## HTTP setup (Bun or Express)

Use the same `UserSession` class and a collector client server-side.

```js
import { RpcAble, RpcAbleReceiver } from 'rpcable';

class UserSession {
    constructor(userData) {
        this.user = userData;
        this.client = new RpcAble({ transport: 'collector' });
        this.receiver = new RpcAbleReceiver({ target: this });
    }

    async getGames() {
        const games = await db.find('games', {});
        this.client.gamesReceived(games);
        return games.length;
    }
}
```

Bun route:

```js
const session = getOrCreateSession(userData);
const results = await session.receiver.dispatch(await req.json(), { role: userData.role });
return Response.json({ results, push: session.client.flush() });
```

Express route:

```js
const session = getOrCreateSession(userData);
const results = await session.receiver.dispatch(req.body, { role: userData.role });
res.json({ results, push: session.client.flush() });
```

HTTP client:

```js
import { RpcAble, extend } from 'rpcable';

class Session {
    games = [];
}

const session = new Session();

const userSession = new RpcAble({
    transport: 'http',
    endpoint: '/rpc/user-session',
    target: session,
});

extend(userSession, {
    gamesReceived(games) {
        session.games = games;
    },
});

const gamesCount = await userSession.getGames().request();
```

The HTTP response shape is:

```json
{ "results": [...], "push": [{ "path": ["gamesReceived"], "args": [[...]] }] }
```

`push` entries are auto-routed on the HTTP client target.

## Pending push for HTTP

If you keep sessions in a server-side store (`Map`), pushes queued on `collector` survive between requests and are delivered on the next HTTP call.

Use a per-session key (session/token), not just `userId`, to avoid mixing tabs/devices.

## WebSocket lifecycle

When you pass a `new WebSocket(url)` to `RpcAble`, it manages the connection lifecycle automatically:

- **Pre-connect buffer** — calls made while the socket is still `CONNECTING` are buffered and sent as soon as `open` fires. No manual waiting required.
- **Auto-destroy on close** — when the socket emits `close`, `destroy()` is called automatically, rejecting all pending requests.

This applies to native WebSocket clients only (`transport: 'websocket'`). For socket.io, lifecycle stays under your control since socket.io reconnects internally.

## Native WebSocket

```js
import { RpcAble, RpcAbleReceiver, decodeRpcMessage } from 'rpcable';

const CHANNEL = '-userSession';
const receiver = new RpcAbleReceiver({ target: session });

ws.on('message', (raw) => {
    const batch = decodeRpcMessage(raw, CHANNEL);
    if (batch) receiver.dispatch(batch, { role: session.role });
});

session.client = new RpcAble({
    transport: 'websocket',
    socket: ws,
    channel: CHANNEL,
});
```

## Permissions and roles

```js
permissions = {
    getGames: ['user', 'admin'],
    ping: ['user', 'admin'],
    deleteAll: ['admin'],
};

receiver.dispatch(batch, { role: userRole });
```

When a role is provided and `permissions` exists, it works as a whitelist:

- methods not listed in `permissions` → denied (`permission`)
- methods listed but without the current role → denied (`forbidden`)
- methods listed with a non-array or empty value (e.g. `false`, `undefined`, `[]`) → denied for everyone

Roles are appended as the last method argument by `RpcAbleReceiver`.

Omitting the role (`dispatch(batch)`) bypasses all permission checks — useful for internal server calls or view-only scenarios.

Receiver logs are configurable:

```js
const receiver = new RpcAbleReceiver({
    target,
    notFound: 'console.error',
    permission: false,
    forbidden: 'console.log',
});
```

Accepted values per key: `false`, `undefined`, `'console.log'`, `'console.warn'`, `'console.error'`, `'error'`, `'throw'`.

- `notFound`: method path does not exist
- `permission`: method not listed in `permissions`
- `forbidden`: method listed in `permissions` but role is not allowed
- `validationFailed`: contract/input validation rejected the first argument

## Input validation (contract)

Pass a `contract` to `RpcAbleReceiver` to validate the first argument of each method before it runs.

- contract keys are receiver method paths such as `createGame` or `profile.save`
- only `args[0]` is validated; later arguments are untouched
- methods not listed in `contract` pass through normally
- works in JS receivers and in the PHP adapter receiver too

Basic JS example:

```js
const contract = {
    'createGame': {
        inputSchema: {
            type: 'object',
            required: ['name', 'maxPlayers'],
            properties: {
                name:       { type: 'string', minLength: 1 },
                maxPlayers: { type: 'integer', minimum: 2, maximum: 16 },
            },
            additionalProperties: false,
        },
    },
    'setUsername': {
        inputSchema: { type: 'string', minLength: 1, maxLength: 32 },
    },
};

const receiver = new RpcAbleReceiver({ target: userSession, contract });
```

Namespaced methods use dot paths:

```js
const contract = {
    'profile.save': {
        inputSchema: {
            type: 'object',
            required: ['displayName'],
            properties: {
                displayName: { type: 'string', minLength: 3, maxLength: 20 },
            },
            additionalProperties: false,
        },
    },
};

const session = {
    profile: {
        save(payload) {
            return payload.displayName;
        },
    },
};

const receiver = new RpcAbleReceiver({ target: session, contract });
```

If validation fails the method is not called.

- `validationFailed: 'throw'` throws on the receiver and turns `.request()` / `.expects()` calls into normal RPC errors
- any other log mode logs the failure and the call returns `undefined`

Logging is controlled by the `validationFailed` option:

```js
new RpcAbleReceiver({ target, contract, validationFailed: 'throw' });   // throws
new RpcAbleReceiver({ target, contract, validationFailed: false });     // silent
new RpcAbleReceiver({ target, contract, validationFailed: 'console.warn' });
```

Request/response example over WebSocket:

```js
const receiver = new RpcAbleReceiver({
    target: userSession,
    contract,
    validationFailed: 'throw',
});

const saved = await userSession.createGame({
    name: 'Ranked room',
    maxPlayers: 4,
}).request();

await userSession.createGame({
    name: '',
    maxPlayers: 1,
}).request();
// rejects with: [RpcAble] validation failed for "createGame": ...
```

Fire-and-forget example:

```js
const receiver = new RpcAbleReceiver({
    target: userSession,
    contract,
    validationFailed: 'console.warn',
});

userSession.createGame({ name: '', maxPlayers: 1 });
// method is skipped, warning is emitted, no response is sent back
```

PHP adapter example:

```php
$receiver = new RpcAbleReceiver([
    'target' => $session,
    'validationFailed' => 'throw',
    'contract' => [
        'saveProfile' => [
            'inputSchema' => [
                'type' => 'object',
                'required' => ['displayName', 'favoriteNumber'],
                'properties' => [
                    'displayName' => ['type' => 'string', 'minLength' => 3, 'maxLength' => 20],
                    'favoriteNumber' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 99],
                ],
                'additionalProperties' => false,
            ],
        ],
    ],
]);
```

Supported `inputSchema` features:

- boolean schemas: `true`, `false`
- `enum`
- `type`: `string`, `number`, `integer`, `boolean`, `null`, `array`, `object`
- `type` can be a single value or an array of values
- string rules: `minLength`, `maxLength`
- number rules: `minimum`, `maximum`
- object rules: `required`, `properties`, `additionalProperties: false`
- array rules: `items`

There is no full JSON Schema engine here on purpose: `contract` is a small built-in validator meant for common RPC payload checks.

## Standalone helpers

```js
import { extend, getInstance, getTransport } from 'rpcable';
```

### `extend(proxy, handlers)`

Register push handlers on an `RpcAble` proxy. Works in any context — module setup, Vue SFC `onMounted`, Bubble component mount:

```js
extend(userSession, {
    gamesReceived(games) {
        gamesList.value = games;
    },
    'scenes.deleted': ({ sceneId }) => {
        // ...
    },
});
```

Handlers are assigned directly on the target; calling `extend` again with the same key overwrites the previous handler.

### `getInstance(proxy)`

Returns the internal `RpcAble` instance from a proxy. Useful to access `transport`, `socket`, or call `destroy()` / `flush()` without reserving those names as RPC method paths:

```js
getInstance(userSession).destroy();
getInstance(userSession).flush();
```

### `getTransport(proxy)`

Shorthand for `getInstance(proxy).transport`:

```js
getTransport(userSession); // 'http' | 'socketio' | 'websocket' | 'collector'
```

## `.set` shorthand

```js
userSession.someProperty.set(value);
```

This maps to `target.someProperty = value` on receiver side.

## `destroy()`

Call `client.destroy()` to immediately reject all pending requests and clear internal state (e.g. on WebSocket disconnect):

```js
socket.on('close', () => session.client.destroy());
```

## Templates

Use `templates/` as starters:

- `templates/UserSession.ts`
- `templates/Session.js`
- `templates/SessionHttp.js`
- `templates/adapters/ws-socketio.ts`
- `templates/adapters/http-bun.ts`
- `templates/adapters/http-express.ts`

These starter files are included in the published npm package.

## Example projects

Ready-to-run playgrounds live in the GitHub repo under `examples/`.

They are not included in the published npm package; npm ships `src/` and `templates/` only.

- `examples/socketio-node-tinybubble-tailwind` (socket.io + Node + TinyBubble + Tailwind)
- `examples/http-bun-tinybubble` (HTTP + Bun + TinyBubble)
- `examples/websocket-bun-tinybubble` (native WebSocket + Bun + TinyBubble)
- `examples/websocket-node-tinybubble` (native WebSocket + Node + TinyBubble, with validation example)

See `examples/README.md` for full setup notes.

If you cloned the repo, useful commands from repo root are:

- `npm run example:socketio-node`
- `npm run example:http-bun`
- `npm run example:websocket-bun`
- `npm run example:websocket-node`
- `npm run examples:dev`

## License

MIT
