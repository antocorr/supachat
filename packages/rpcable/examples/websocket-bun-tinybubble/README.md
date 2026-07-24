# WebSocket + Bun + TinyBubble

Test project that shows rpcable over native `websocket` with Bun server and TinyBubble client.

## Run

```bash
bun install
bun run dev
```

Open `http://localhost:3300`.

## What to try

- `Join (.request)` uses websocket request/response.
- `Get Games (push)` triggers `gamesReceived` push.
- `Ping (.request)` shows round-trip result with role.

Client push handlers are registered with `extend(userSession, ...)` in `public/main.js`.
