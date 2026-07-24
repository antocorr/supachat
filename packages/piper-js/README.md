# piper-js

Pure JavaScript port of [Piper](https://github.com/OHF-Voice/piper1-gpl) — a fast and local neural text-to-speech engine.

Runs 100% offline in the browser, Node.js, and Bun. Built on the same philosophy as [kokoro-js](https://www.npmjs.com/package/kokoro-js).

## Features

- 🚀 **100% local** — no server, no API keys, no Python
- 🌐 **Cross-platform** — browser (WASM/WebGPU), Node.js, Bun
- 🗣️ **Multilingual** — English (fast phonemizer), German, French, Spanish, Arabic, Chinese, and [100+ espeak-ng voices](https://github.com/espeak-ng/espeak-ng)
- 📦 **ONNX models** — uses the same voice models as Piper (from HuggingFace Hub)
- 🎯 **Clean API** — inspired by Transformers.js and kokoro-js

## Quick Start

```bash
npm install piper-js
```

```ts
import { PiperVoice } from "piper-js";

// Load a voice (downloads from HuggingFace Hub)
const voice = await PiperVoice.fromPretrained(
  "speaches-ai/piper-de_DE-thorsten-high"
);

// Generate audio
const audio = await voice.generate("Hallo Welt!");
// audio is a Float32Array at 22050 Hz

// Or get WAV bytes directly
const wav = await voice.generateWav("Hallo Welt!");
```

For Node.js with native performance, install the optional peer:

```bash
npm install onnxruntime-node
```

## Voices

Find Piper voices on HuggingFace:

- [speaches-ai/piper-de_DE-thorsten-high](https://huggingface.co/speaches-ai/piper-de_DE-thorsten-high)
- [speaches-ai/piper-en_US-lessac-medium](https://huggingface.co/speaches-ai/piper-en_US-lessac-medium)
- [speaches-ai/piper-fr_FR-mls-medium](https://huggingface.co/speaches-ai/piper-fr_FR-mls-medium)

Browse all at [huggingface.co/models?search=piper](https://huggingface.co/models?search=piper)

## API

### `PiperVoice.fromPretrained(modelId, opts?)`

Load a voice model.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `modelId` | `string` | — | HuggingFace model ID or local path |
| `opts.device` | `"wasm" \| "webgpu" \| "cpu"` | `"wasm"` | Execution device |
| `opts.progressCallback` | `function` | — | Download progress callback |

### `voice.generate(text, opts?)`

Synthesize audio from text. Returns `Float32Array` in range [-1, 1].

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | `string` | — | Input text |
| `opts.speed` | `number` | `1.0` | Speaking speed |
| `opts.speakerId` | `number` | `0` | Speaker ID (multi-speaker models) |

### `voice.generateWav(text, opts?)`

Same as `generate()` but returns a WAV file as `Uint8Array`.

### `voice.stream(text, opts?)`

Async generator yielding `AudioChunk` per sentence.

### Browser Setup

For browser usage, copy the ONNX WASM files to your public directory:

```ts
import { env } from "piper-js";
env.wasmPaths = "/path/to/ort-wasm-simd.wasm";
```

Or use a CDN:

```ts
import { env } from "piper-js";
env.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
```

## Architecture

```
Text → [phonemizer/phonemize-espeak] → phonemes (Unicode)
     → [phoneme_ids] → phoneme IDs (int64)
     → [ONNX Runtime] → audio (float32)
     → [WAV encoder] → .wav file
```

## License

GPL-3.0-or-later (same as Piper)
