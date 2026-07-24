# SupaChat

**Storytelling chat with local AI.** A privacy-first, fully local roleplay and storytelling platform powered by Bun + TinyBubble + Ollama. Designed for running entirely on your machine — no cloud, no data leaving your computer.

> **SupaChat** is an AI-driven roleplay chat where you create characters (Agents), define your own Profile, and converse with local LLMs through Ollama. It supports text-to-speech (Piper / Kokoro), AI image generation (Draw Things), dice rolling with 3D physics, conversation encryption, world-building (chapters / facts / settings), and a rich plugin-like tool system.

---

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Concepts](#concepts)
  - [Conversations](#conversations)
  - [Agents](#agents)
  - [Profiles](#profiles)
- [Slash Commands](#slash-commands)
- [AI Tools](#ai-tools)
  - [Tool Calling Modes](#tool-calling-modes)
  - [Available Tools](#available-tools)
- [Text-to-Speech](#text-to-speech)
  - [Kokoro (recommended)](#kokoro-recommended)
  - [Piper](#piper)
- [Image Generation (Draw Things)](#image-generation-draw-things)
- [Dice Rolling](#dice-rolling)
- [World System](#world-system)
- [Conversation Encryption](#conversation-encryption)
- [AI-Assisted Writing](#ai-assisted-writing)
- [System Prompt System](#system-prompt-system)
- [Themes](#themes)
- [Configuration](#configuration)
  - [Environment Variables](#environment-variables)
  - [Settings Persistence](#settings-persistence)
- [Development](#development)
  - [Server Architecture](#server-architecture)
  - [Client Architecture](#client-architecture)
  - [Transport Protocol (RpcAble over WebSocket)](#transport-protocol-rpcable-over-websocket)
  - [Testing](#testing)
- [FAQ / Troubleshooting](#faq--troubleshooting)

---

## Features

- **100% local**: Everything runs on your machine — no cloud APIs, no data exfiltration
- **Roleplay-first**: Create AI characters (Agents) with voice, appearance, personality, and tool permissions
- **Multi-model support**: Any Ollama model; per-conversation model selection
- **Rich tool ecosystem**: AI can generate images, narrate scenes, create new characters on-the-fly, roll dice, and update its own lore
- **Text-to-Speech**: Two engines — Kokoro (browser or server-side) and Piper (native JS, no external binary)
- **Image generation**: Integrates with Draw Things via its local HTTP API
- **3D dice rolling**: Physics-based dice (d4–d100) using Three.js + Cannon-es, rendered in a modal
- **World building**: Chapters, facts, and settings injected into the system prompt for persistent story context
- **Conversation encryption**: AES-256-GCM opt-in encryption for messages, media, agent data, and profile data
- **AI-assisted writing**: ✨ button on agent introductions and appearances, with regenerate and undo
- **Streaming responses**: Token-by-token streaming via WebSocket push events
- **Audio streaming**: Chunked TTS audio playback with auto-advance, preload, and cursor-driven queue
- **Dark / Light / Tau themes**: CSS variable-based theming with a dropdown selector
- **Responsive design**: Desktop grid + mobile portrait overlay layout (≤760px)
- **Conversation compaction**: Automatic summarization of older messages to fit context windows
- **Event-driven architecture**: Server-push events for state changes, message delivery, tool results, audio readiness

---

## Quick Start

### 1. Prerequisites

- **Bun** ≥ 1.2 (runtime for both server and scripts)
- **Ollama** running at `http://127.0.0.1:11434` with a model, e.g.:
  ```bash
  ollama pull socialnetwooky/opencrystal:12b
  ```
- **npm** (for the Vite-based client)

### 2. Install

```bash
git clone <url>
cd supachat

# Enable git hooks (handles rpcable symlink during commits)
bash scripts/githooks/setup.sh

npm install                    # root (installs concurrently for `npm run dev`)
cd server && bun install       # backend dependencies
cd ../client && npm install    # frontend dependencies
```

> **Note on `packages/rpcable`**: this directory is committed as real files so
> anyone cloning or forking gets everything. In local development it's a symlink
> to an external rpcable repo for live editing. Git hooks handle the conversion
> automatically — no manual setup needed after `setup.sh`.

### 3. Start

```bash
# From the project root
npm run dev
```

This starts both the server and Vite dev server concurrently. Open the URL printed by Vite (default `http://localhost:49174`).

### 4. Your first chat

1. Click **+ New Conversation**
2. Add an **Agent** (AI character): give it a name, introduction, and optionally a TTS voice
3. Add a **Profile** (yourself): name and introduction
4. Start typing in the chat — the AI will respond through Ollama

### 5. (Optional) Enable TTS

- **Kokoro** (recommended): In Settings → TTS, choose "Kokoro" as engine. Voices are auto-downloaded on first use.
- **Piper**: Place `.onnx` voice models in the configured voice directory. Piper runs purely in JS (no external binary).

### 6. (Optional) Enable image generation

- Start **Draw Things** desktop app with `--enableHttpApi`
- In SupaChat: Settings → Image Generation → "Probe" to auto-detect

---

## Architecture

```ascii
┌─────────────────────────────────────────────────────────┐
│                 SupaChat Architecture                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐    WebSocket (RpcAble)   ┌─────────┐ │
│  │  TinyBubble   │ ◄──────────────────────► │  Bun    │ │
│  │  SPA (Vite)   │                          │ Server  │ │
│  │              │     HTTP fallback         │         │ │
│  │  kokoro-js   │ ◄──────────────────────► │ Ollama  │ │
│  │  (browser)   │     (assets, health)      │ (HTTP)  │ │
│  │              │                          │         │ │
│  │  Three.js    │                          │ Piper   │ │
│  │  (dice 3D)   │                          │ (native)│ │
│  │              │                          │         │ │
│  │  AudioManager│                          │ Kokoro  │ │
│  │  (playback)  │                          │ (server)│ │
│  │              │                          │         │ │
│  └──────────────┘                          │ SQLite  │ │
│                                            │ (Bun)   │ │
│                                            │         │ │
│                                            │ Draw    │ │
│                                            │ Things  │ │
│                                            │ (HTTP)  │ │
│                                            └─────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Frontend**: TinyBubble SPA built with Vite — reactive components using signals/h, history-mode routing, pub-sub via EventTopic
- **Backend**: Bun `Bun.serve` accepting both WebSocket upgrades and HTTP requests on a single port
- **AI**: Local Ollama instance with two tool-calling modes (native tool calls or structured-output JSON)
- **Transport**: RpcAble v1 over WebSocket (Bun raw frames) — bidirectional RPC with envelope/batch support, ticket-based requests, role-based permissions
- **Database**: SQLite via Bun's native `bun:sqlite` with WAL mode and `synchronous=NORMAL`
- **TTS**: Kokoro-js (server-side or in-browser via Web Worker) and Piper-js (native JS, no binary)
- **Image generation**: Draw Things desktop app via `http://127.0.0.1:7860` (or custom URL)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) ≥ 1.2 |
| Frontend | [TinyBubble](https://github.com/voxeline/tinybubble) (reactive components, signals, router) |
| Build | [Vite](https://vitejs.dev) |
| AI Engine | [Ollama](https://ollama.ai) (local LLM) |
| TTS Engine 1 | [Kokoro-js](https://github.com/nicedouble/Kokoro-js) (server or browser Web Worker) |
| TTS Engine 2 | [Piper-js](https://github.com/rhasspy/piper-js) (native JS, no binary) |
| Image Generation | [Draw Things](https://drawthings.ai) HTTP API |
| Database | SQLite via `bun:sqlite` |
| Transport | WebSocket + [RpcAble](https://github.com/voxeline/rpcable) v1 (bidirectional RPC) |
| Encryption | AES-256-GCM + PBKDF2 (Bun Web Crypto API) |
| 3D Physics | [Three.js](https://threejs.org) + [Cannon-es](https://github.com/pmndrs/cannon-es) |
| Concurrent dev | [concurrently](https://github.com/open-cli-tools/concurrently) |

---

## Project Structure

```
supachat/
├── client/                     # TinyBubble SPA frontend
│   └── src/
│       ├── api/
│       │   └── client.js       # RpcAble WebSocket client + HTTP fallback
│       ├── components/
│       │   ├── AgentPanel.bub.js        # Agent creation/editing modal
│       │   ├── AudioPlayer.bub.js       # Per-message audio player with progress/seek
│       │   ├── ChatView.bub.js          # Main chat view (message list + composer)
│       │   ├── ConversationList.bub.js  # Left sidebar conversation list
│       │   ├── CustomSelect.bub.js      # Re-themed <select> component
│       │   ├── DiceRoller.bub.js        # 3D dice rolling modal (Three.js + Cannon)
│       │   ├── DrawThingsSettings.bub.js# Image generation settings panel
│       │   ├── ImageLightbox.bub.js     # Full-screen image viewer
│       │   ├── MagicCreateModal.bub.js  # 2-step AI-assisted conversation setup
│       │   ├── MessageComposer.bub.js   # Chat input box + attachments
│       │   ├── MessageItem.bub.js       # Single message rendering
│       │   ├── MessageList.bub.js       # Scrollable message list
│       │   ├── ProfilePanel.bub.js      # User profile editor
│       │   ├── SettingsPanel.bub.js     # Global settings panel
│       │   ├── Toggle.bub.js            # Reusable toggle switch component
│       │   ├── TtsSettings.bub.js       # TTS engine voice/speed settings
│       │   └── WorldPanel.bub.js        # World building (chapters, facts, settings)
│       ├── lib/
│       │   ├── AudioManager.js          # Singleton audio playback controller
│       │   └── DiceTable.js             # 3D dice scene setup (Three.js + Cannon)
│       ├── services/
│       ├── workers/
│       │   └── kokoroWorker.ts          # Kokoro TTS Web Worker (browser-side)
│       ├── App.bub.js                   # Root application component
│       ├── main.ts                      # Entry point
│       ├── router.ts                    # History-mode URL router
│       ├── shared/                      # Shared utilities
│       └── styles.css                   # All styles (~71KB, CSS variables)
├── server/                     # Bun TypeScript backend
│   └── src/
│       ├── ai/
│       │   └── ollama.ts                # Ollama chat/tool-calling integration
│       ├── db/
│       │   ├── database.ts              # SQLite connection (WAL mode, helpers)
│       │   ├── repo.ts                  # Data access layer (CRUD for all entities)
│       │   └── schema.ts                # Schema definitions + auto-migration
│       ├── lib/
│       │   ├── Actor.ts                 # Agent data interface
│       │   ├── Conversation.ts          # Conversation context interface
│       │   ├── LastMessageBuilder.ts    # Builds last user message from templates
│       │   ├── LastMessageTemplates.ts  # Templates for the last user message
│       │   ├── PromptBuilder.ts         # Iterates promptStack to build system prompt
│       │   ├── PromptTemplates.ts       # All system prompt fragments as static methods
│       │   └── ToolResult.ts            # MCP-compatible tool result creation
│       ├── services/
│       │   ├── commands.ts              # Slash command parser and executor
│       │   ├── crypto.ts                # AES-256-GCM encryption/decryption
│       │   ├── drawThings.ts            # Draw Things HTTP API client with queue
│       │   ├── events.ts                # Event publish/subscribe system (push events)
│       │   ├── kokoro.ts                # Kokoro-js TTS (server-side synthesis)
│       │   ├── passwordManager.ts       # In-memory password cache with optional disk persistence
│       │   ├── piper.ts                 # Piper-js TTS (native JS, ONNX runtime)
│       │   ├── speaker.ts               # Speaker selection + system prompt assembly
│       │   └── text.ts                  # Text chunking utilities for TTS
│       ├── session/
│       │   ├── UserSession.ts           # RPC methods exposed to the client
│       │   └── UserSessionBase.ts       # RpcAble base class (envelope dispatch, permissions)
│       ├── tools/
│       │   └── registry.ts              # Tool call dispatcher (imagen, narrate, add_agent, etc.)
│       ├── types/
│       │   └── dirty-json.d.ts          # Type declaration for dirty-json
│       ├── app.ts                       # Singleton initialization, config, helpers, log buffer
│       ├── config.ts                    # Environment config with defaults
│       ├── http.ts                      # HTTP handler (assets, health, actions, fallback)
│       ├── index.ts                     # Entry point (Bun.serve, WebSocket upgrade)
│       └── validation.ts               # Input validation helpers
├── packages/
│   └── rpcable -> /path/to/rpcable      # Symlink to local rpcable package
├── package.json                  # Root package (concurrently orchestration)
└── AGENTS.md                     # Agent/project instructions
```

---

## Concepts

### Conversations

A **Conversation** is a chat room with:
- A title and status (`active` / `archived`)
- One or more **Agents** (AI characters)
- A **Profile** (the human user)
- Per-conversation state (model, tool mode, auto mode, audio auto-play, compaction settings, queue)
- Optional **encryption** with a password
- Optional **story entries** for world-building context

Conversations can be created quickly via the **Magic Create** modal (✨ button) — a 2-step wizard that suggests agents and settings based on your description.

### Agents

An **Agent** is an AI character with:
- `name`, `language`, `voice` (TTS voice ID)
- `introduction` — character backstory and personality
- `appearance` — physical description (used by system prompt and image generation)
- `imagen_appearance` — detailed appearance prompt specifically for image generation
- `is_narrator` — if true, acts as a third-person narrator
- `selected_model`, `thinking_mode` — per-agent AI model/tuning overrides
- `tools_json` — which tools the agent can use (imagen, narrate, etc.)
- `kokoro_voice` — per-agent Kokoro voice override
- `audio_enabled` — whether this agent generates audio
- `auto_select` — whether the speaker selection can pick this agent automatically
- `response_length` — preferred response length

Agents can be created via the Agent Panel, the `/achar` slash command, the Magic Create modal, or by the AI itself using the `add_agent` tool during conversation.

### Profiles

A **Profile** represents the human user:
- `name`, `introduction`, `appearance`
- Can be switched during conversation via `/iam`
- Used in the system prompt to describe the user to the AI

---

## Slash Commands

Type these in the chat input:

| Command | Effect |
|---|---|
| `/bye` | Archive the current conversation |
| `/to <agent name>` | Force the next AI response to be from that agent |
| `/auto on` / `/auto off` | Enable/disable automatic continuation (AI keeps responding) |
| `/iam <profile name>` | Switch to a different user profile |
| `/model <model name>` | Change the AI model for this conversation |
| `/achar <name> <voice> <introduction>` | Create a new agent on the fly |
| `/rchar <agent name>` | Remove an agent from the conversation |
| `/allow-tool <tool name>` | Allow a specific tool for the next turn only |
| `/restore` | Restore an archived conversation |

---

## AI Tools

### Tool Calling Modes

Ollama supports two tool-calling strategies, configurable per-conversation:

- **Native** (`toolMode: 'native'`): Uses Ollama's built-in tool calling support (recommended for models that support it)
- **Structured output** (`toolMode: 'structured'`): Uses JSON-constrained grammar decoding via Ollama's `format` parameter — works with models that don't support native tools

Required tools (e.g., `imagen`) can be enforced at the conversation or agent level, meaning the model *must* call them every turn.

### Available Tools

| Tool | Description |
|---|---|
| `imagen` | Generate an image via Draw Things. Supports `{appearance:agentName}` placeholders that resolve to the agent's imagen_appearance. |
| `narrate` | Generate third-person narration describing the scene |
| `add_agent` | Create a new agent/character during conversation (name, voice, language, introduction, appearance) |
| `append_to_my_intro` | Permanently update the speaking agent's own introduction |
| `append_to_intro` | Permanently update another agent's introduction |
| `request_dice_roll` | Request a dice roll (d4–d100) with optional comparison operators (>, <, >=, <=, =) and target values. Supports public and private reasons. |

### Dice Rolling

The `request_dice_roll` tool triggers a non-blocking CTA in the chat composer. Clicking it opens a modal with a 3D physics scene (Three.js + Cannon-es) where the dice roll is animated. The roll result includes:
- The dice type and value
- Whether it succeeded/failed against the target
- A public reason (shown in the UI) and a private reason (kept in context only)

---

## Text-to-Speech

### Kokoro (recommended)

Kokoro is a lightweight TTS engine that can run **server-side** (via `kokoro-js` + `onnxruntime-node`) or **in-browser** (via a Web Worker using `@huggingface/transformers` + ONNX).

- **Server mode**: Synthesizes audio on the server, returns chunks via WebSocket push events (`audio_ready`)
- **Browser mode**: Loads the model into a Web Worker in the browser; the worker sends audio chunks back to the server, which broadcasts them to all clients

Voices are categorized by language (English US/UK, Japanese, Korean, Chinese, French, etc.) with quality grades (A+ to F-). The model file (`model_q4.onnx`) is loaded from a local path — no HuggingFace CDN downloads during runtime.

**Per-agent voices**: Each agent can have its own Kokoro voice via the `kokoro_voice` field.

### Piper

Piper-js is a native JavaScript TTS engine (no external binary required). It uses ONNX runtime to run Piper models directly:
- Place `.onnx` voice files in the configured voice directory
- Models are loaded and run entirely in-process
- Supports text splitting by sentences for streaming generation

---

## Image Generation (Draw Things)

Integration with the [Draw Things](https://drawthings.ai) desktop app via its local HTTP API:

- **Endpoint**: `/sdapi/v1/txt2img` with flat `model` field (Draw Things native format — NOT A1111 `override_settings`)
- **Queue**: Serializes requests since Draw Things handles one generation at a time
- **Model selection**: Choose from available models (probed via `/sdapi/v1/sd-models`)
- **Configuration**: Width/height (default 384×512), batch size, text guidance, prompt prepend/append
- **Appearance placeholders**: Prompts can reference `{appearance:agentName}` to inject agent appearance descriptions

---

## World System

The World system lets you build persistent story context through three entry types:

| Type | Purpose |
|---|---|
| **Chapters** | Story arcs or narrative sections |
| **Facts** | Canonical truths about the world |
| **Settings** | Locations, rules, or environmental context |

All entries are injected into the **system prompt** (not the last user message), giving the AI persistent knowledge across turns. Entries can be:
- Created/edited/deleted via the **World Panel** (tab between Profile and Settings)
- Created by the AI itself via `add_story_entry`, `update_story_entry`, `remove_story_entry` tools
- AI-assisted generation using the ✨ button per entry

---

## Conversation Encryption

Opt-in encryption for privacy-sensitive conversations:

- **Algorithm**: AES-256-GCM with PBKDF2 key derivation (100,000 iterations, random salt per encryption)
- **Scope**: Encrypts conversation title, agent names/introductions/appearances, profile data, all message content, and media files (images, audio)
- **Password**: Set at conversation creation or lock existing conversations. Password lives in server RAM only.
- **Password cache**: In-memory `Map<conversationId, {password, unlockedAt}>`. Optional disk persistence via `PASSWORD_CACHE=1` env var (disabled by default).
- **Verification**: A verifier token (`SUPACHAT_VERIFIED:{conversationId}`) is encrypted and stored — the server verifies passwords without storing them in plaintext
- **Asset serving**: Encrypted media files are decrypted on-the-fly when served; locked conversations return HTTP 423

**Operations**: Lock, unlock, change password, enable/disable encryption (decrypts all data on disable).

---

## AI-Assisted Writing

The ✨ button appears on agent and profile textareas (introduction and appearance):

- **How it works**: Sends the current text + a detail level (1–5 slider) to an Ollama model via the `/api/generate-text` endpoint
- **Features**: Regenerate (🔄) and Undo (↩) to restore the original text
- **Coverage**: Agent introduction, Agent appearance, Profile introduction, Profile appearance — each with tailored prompts

---

## System Prompt System

The server uses a template-based system prompt builder for maximum flexibility:

### PromptBuilder + PromptTemplates

- `PromptBuilder` iterates a `promptStack` array, calling each method on the templates class
- `PromptTemplates` contains all fragments as static methods, each returning `string | null`
- Fragments are joined with `\n` separators

### LastMessageBuilder + LastMessageTemplates

Same pattern but for the **last user message** injected before every generation:
- `getSpeakingInstruction` — tells the AI how to respond ("In the next message...")
- `getConversationAdvance` — reminds the AI not to repeat itself

### Prompt fragments include

- Narrator prompts and fact-keeping rules
- Actor identity and appearance
- World entries (chapters, facts, settings)
- Language and voice instructions
- Tool availability (imagen, narrate, dice roll)
- Response length preferences
- User profile and appearance context

---

## Themes

Three themes controlled by CSS custom properties:

| Theme | Description |
|---|---|
| **Dark** | Dark background, light text |
| **Light** | Light background, dark text |
| **Tau** | Warm cream/sepia tone |

Selectable from a dropdown in the settings. The default theme is Tau.

---

## Configuration

### Environment Variables

Set these in a `.env` file in the project root, or as system environment variables:

| Variable | Default | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Server bind address |
| `PORT` | `49173` | Server port |
| `DB_PATH` | `data/supachat.sqlite` | SQLite database path |
| `DATA_DIR` | `data` | Runtime data directory (audio, images, logs) |
| `OLLAMA_NUM_CTX` | `24000` | Ollama context window size |
| `COMPACTION_THRESHOLD` | `0.4` | Compaction trigger threshold (ratio or %) |
| `COMPACTION_CHARS_PER_TOKEN` | `4` | Estimated characters per token |
| `PASSWORD_CACHE` | *(not set)* | Set to `1` to persist password cache to disk |
| `DRAW_THINGS_MODELS_DIR` | `~/Library/.../Models` | Draw Things models directory |

### Settings Persistence

Most settings are saved to the SQLite database and are editable via the Settings UI. Priority order: `homedir()` defaults → env var overrides → UI/DB persisted values.

Settings categories:
- **AI**: Provider, model, base URL, tool mode, thinking mode, context size, temperature, compaction
- **Draw Things**: Enabled, base URL, models dir, dimensions, guidance, prompt prefix/suffix
- **Piper**: Enabled, voice directory, output directory, default voice
- **Kokoro**: Mode (server/browser), model directory, dtype, output directory, default voice
- **TTS**: Enabled, engine selection

---

## Development

### Server Architecture

The server follows an **oo2 pattern**:

```
index.ts (37 lines)    → Entry point: Bun.serve + WebSocket upgrade
app.ts                 → Singleton initialization, helpers, log buffer
http.ts                → HTTP handler (REST API, asset serving, index fallback)
session/
  UserSession.ts       → RPC methods exposed via WebSocket
  UserSessionBase.ts   → RpcAble base class (dispatch, permissions, this-binding)
```

- **TypeScript** is run directly by Bun (no build step needed)
- **Hot reload**: `bun --watch` for auto-restart on file changes
- **Database**: SQLite via Bun's native `bun:sqlite` with WAL mode + `PRAGMA synchronous=NORMAL`
- **Log buffer**: Log writes are buffered and flushed every 200ms or every 20 lines to reduce I/O pressure

Key server components:
- **Event system**: Server-push events (`message_start`, `token`, `message_done`, `image_ready`, `audio_ready`, `state_changed`, etc.) published via WebSocket
- **Speaker selection**: Random selection from eligible agents, with support for forced next-agent, queue-based turns, and `/to` overrides
- **Audio generation**: Chunked TTS (server Kokoro, Piper, or receives browser-Kokoro chunks), with `sequence` metadata for ordered playback
- **Thinking auto-fix**: If Ollama responds that the model doesn't support thinking, the server auto-disables thinking mode and retries (up to 5 retries)

### Client Architecture

- **TinyBubble SPA**: Reactive components using signals and `h()` (hyperscript)
- **History-mode routing**: URL-based navigation without hash
- **AudioManager**: Singleton controller for audio playback — cursor-driven, dynamic queue, tail-wait for chunks, preload of next chunk
- **Components**: 17+ TinyBubble components, from chat view to settings panels

### Transport Protocol (RpcAble over WebSocket)

- **RpcAble v1**: Bidirectional RPC using envelopes/batches over Bun WebSocket raw frames
- **Fire-and-forget**: Non-critical calls (`addMessage`, `logEvent`) are sent without awaiting a response
- **Awaited calls**: Bootstrap/query calls (`getSettings`, `getConversations`, `getMessages`) use request-response over the same socket
- **Push events**: Server pushes state changes, message tokens, audio chunks, tool results via the event system — the client never polls
- **No HTTP-over-socket**: Design principle — avoid request/response patterns for things that don't need results

### Testing

Functional/integration tests live in `fullfill/` and `fulfilled/`:

```bash
# Run all server tests
cd server && bun test

# Run specific functional tests
bun run fullfill/test-audio-stream.js
bun run fullfill/test-encryption.js
bun run fullfill/test-world-prompt.ts
bun run fullfill/test-server-split.js
bun run fullfill/test-request-dice-roll.js
```

Test categories:
- **Audio**: Streaming, queue management, multi-chunk playback, turn coordination
- **Encryption**: 40 scenarios (create, lock, unlock, change password, agent/profile CRUD, media)
- **World system**: Prompt injection, CRUD operations
- **Server split**: 33 tests verifying the oo2 refactored architecture
- **Kokoro browser**: Local model loading and voice synthesis
- **Dice rolling**: Request flow, persistence, cancellation
- **Bugfix validation**: Targeted regression tests

---

## FAQ / Troubleshooting

**Q: The server won't start — port in use?**
A: Check if another instance is running. Default port is 49173. Set `PORT` in `.env` to change it.

**Q: Ollama connection errors?**
A: Ensure Ollama is running (`ollama serve` or check the Ollama app). Verify the model is pulled: `ollama list`.

**Q: Images not generating?**
A: Make sure Draw Things is running with `--enableHttpApi`. Go to Settings → Image Generation → "Probe" to verify the connection.

**Q: No audio playing?**
A: Check TTS settings. For Kokoro server mode, ensure the model is downloaded (first use auto-downloads). For Kokoro browser mode, check the browser console for worker errors.

**Q: "Does not support thinking" error?**
A: The server auto-fixes this by disabling thinking mode and retrying. If it persists, manually set thinking mode to "inactive" in the conversation settings.

**Q: Conversation shows as locked?**
A: Enter the password when prompted. If you've forgotten it, the conversation cannot be recovered — encryption is designed to be unrecoverable without the password.

**Q: Can I use cloud models instead of Ollama?**
A: Currently, only Ollama is supported as the AI provider. The architecture is designed to be provider-agnostic, but only Ollama integration is implemented.

**Q: Where is my data stored?**
A: Everything lives in the `data/` directory (SQLite DB, audio, images, logs). This is gitignored and never leaves your machine.
