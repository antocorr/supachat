# WebSocket + Node + TinyBubble

Test project that shows rpcable over native `websocket` with a Node server, TinyBubble client, and receiver-side input validation.

The server uses `RpcAbleReceiver({ target, contract, validationFailed: 'throw' })`, so invalid `.request()` calls come back as normal RPC errors.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3350`.

## What to try

- `Join (.request)` uses websocket request/response.
- `Save Profile (valid)` passes `contract.inputSchema` validation and returns a result.
- `Save Profile (invalid)` fails validation and the request rejects with the receiver error.
- `Ping (push)` shows a fire-and-forget push.

Client push handlers are registered with `extend(userSession, ...)` in `public/main.js`.

## Contract used in the demo

```js
const receiver = new RpcAbleReceiver({
    target: this,
    validationFailed: 'throw',
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
```
