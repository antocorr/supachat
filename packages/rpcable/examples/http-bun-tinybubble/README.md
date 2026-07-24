# HTTP + Bun + TinyBubble

Test project that shows rpcable over HTTP with Bun server and TinyBubble client.

## Run

```bash
bun install
bun run dev
```

Open `http://localhost:3200`.

## What to try

- `Join` shows request result + push (`joined`) in the same HTTP response.
- `Get Games` returns a numeric result and routes `gamesReceived` from `response.push`.
- `Ping` shows plain request/response timing.
- `Set&Forget (5s)` schedules a delayed server push (`readMessage`) and `Ping` collects it from pending queue, opening a client modal.

Client push handlers are registered with `extend(userSession, ...)` in `public/main.js`.
