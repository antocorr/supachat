# Socket.io + Node + TinyBubble + Tailwind

Test project that shows rpcable over `socket.io` with a TinyBubble UI and Tailwind styling.

This demo forces Socket.IO to websocket-only (no polling fallback and no upgrade flow from polling).

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3100`.

## What to try

- `Join (.request)` sends a request/response RPC call.
- `Get Games (push)` triggers server push via `gamesReceived`.
- `Ping (.request)` shows request/response with payload.
- `forbidden()` is called by the client on join and is denied server-side by permissions.

Client push handlers are registered with `extend(userSession, ...)` in `public/main.js`.

Transport config is in:

- `server.mjs` -> `new SocketIOServer(server, { transports: ['websocket'], allowUpgrades: false })`
- `public/main.js` -> `io({ transports: ['websocket'], upgrade: false })`
