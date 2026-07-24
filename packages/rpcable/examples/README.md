# Examples

From repo root you can start all demo servers with:

```bash
npm run examples:dev
```

Or start a single one:

```bash
npm run example:websocket-node
```

## 1) socketio-node-tinybubble-tailwind

Transport: `socketio` on Node.
Client: TinyBubble + Tailwind.

```bash
cd examples/socketio-node-tinybubble-tailwind
npm install
npm run dev
```

Open `http://localhost:3100`.

## 2) http-bun-tinybubble

Transport: `http` on Bun.
Client: TinyBubble.

```bash
cd examples/http-bun-tinybubble
bun install
bun run dev
```

Open `http://localhost:3200`.

## 3) websocket-bun-tinybubble

Transport: native `websocket` on Bun.
Client: TinyBubble.

```bash
cd examples/websocket-bun-tinybubble
bun install
bun run dev
```

Open `http://localhost:3300`.

## 4) websocket-node-tinybubble

Transport: native `websocket` on Node.
Client: TinyBubble.
Purpose: request/response, push handlers, and `contract.inputSchema` validation demo.

```bash
cd examples/websocket-node-tinybubble
npm install
npm run dev
```

Open `http://localhost:3350`.

What to try:

- `Join (.request)`
- `Save Profile (valid)`
- `Save Profile (invalid)`
- `Ping (push)`

## 5) http-php-tinybubble-tailwind

Transport: `http` on plain PHP.
Client: TinyBubble + Tailwind.

No rewrite/routing required: the example uses `index.php` + `rpc.php` in the same folder.
Requires PHP 8+.

```bash
php -S 127.0.0.1:3400 -t examples/http-php-tinybubble-tailwind
```

Open `http://127.0.0.1:3400`.

## 6) http-php-tinybubble-tailwind-tictactoe

Transport: `http` on plain PHP.
Client: TinyBubble + Tailwind, split across Bubble components.

The host page renders two iframes for player X and player O, both pointing at the same room.
Requires PHP 8+.

```bash
php -S 127.0.0.1:3500 -t examples/http-php-tinybubble-tailwind-tictactoe
```

Open `http://127.0.0.1:3500/index.php`.

## Legacy

- `examples/http/` remains as a minimal low-level reference.
