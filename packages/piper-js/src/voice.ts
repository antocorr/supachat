import { PiperConfig } from "./config.js";
import { phonemesToIds } from "./phoneme_ids.js";
import { textToPhonemes } from "./utils.js";
import type { AudioChunk, Dtype, Device } from "./types.js";

// ---------------------------------------------------------------------------
// ONNX Runtime — try native Node.js first, fall back to WASM web
// ---------------------------------------------------------------------------

interface OrtModule {
  InferenceSession: {
    create(
      model: Uint8Array,
      options?: { executionProviders?: string[] },
    ): Promise<InferenceSession>;
  };
  Tensor: new (
    type: string,
    data: import("onnxruntime-common").Tensor.DataType,
    dims?: readonly number[],
  ) => import("onnxruntime-common").Tensor;
}

interface InferenceSession {
  run(
    feeds: Record<string, import("onnxruntime-common").Tensor>,
  ): Promise<Record<string, import("onnxruntime-common").Tensor>>;
  outputNames: readonly string[];
}

let ortModule: OrtModule | null = null;

async function getOrt(): Promise<OrtModule> {
  if (ortModule) return ortModule;

  // Node.js: prefer native onnxruntime-node (no WASM needed)
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      // @ts-expect-error — onnxruntime-node is an optional peer dep
      const nodeOrt: OrtModule = await import("onnxruntime-node");
      ortModule = nodeOrt;
      return ortModule;
    } catch {
      // Fall through to WASM
    }
  }

  // Browser / Bun: use onnxruntime-web (WASM)
  const webOrt = await import("onnxruntime-web");
  ortModule = webOrt as unknown as OrtModule;
  return ortModule;
}

// ---------------------------------------------------------------------------
// Env: expose WASM path configuration
// ---------------------------------------------------------------------------

/** Configure WASM paths for onnxruntime-web (browser only). */
export const env = {
  /** WASM file paths for onnxruntime-web. Set before loading models. */
  wasmPaths: undefined as string | undefined,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_WAV_VALUE = 32767.0;

// ---------------------------------------------------------------------------
// PiperVoice
// ---------------------------------------------------------------------------

/**
 * A voice for Piper — fast and local neural text-to-speech.
 *
 * ```ts
 * const voice = await PiperVoice.fromPretrained(
 *   "speaches-ai/piper-de_DE-thorsten-high"
 * );
 * const audio = await voice.generate("Hallo Welt");
 * ```
 */
export class PiperVoice {
  private session: InferenceSession;
  config: PiperConfig;

  constructor(session: InferenceSession, config: PiperConfig) {
    this.session = session;
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  /**
   * Load a Piper voice model from a HuggingFace model ID or local path.
   *
   * The repository / path must contain:
   *   - `model.onnx` — the ONNX voice model
   *   - `config.json` — model configuration
   *
   * @param modelId - HuggingFace model ID, e.g. "speaches-ai/piper-de_DE-thorsten-high"
   * @param opts - Optional loading options
   */
  static async fromPretrained(
    modelId: string,
    opts?: {
      dtype?: Dtype;
      device?: Device;
      progressCallback?: (p: {
        status: string;
        file?: string;
        percent?: number;
      }) => void;
    },
  ): Promise<PiperVoice> {
    const ort = await getOrt();
    const device = opts?.device ?? "wasm";

    const [config, modelBytes] = await Promise.all([
      loadConfig(modelId),
      loadModelBytes(modelId, opts?.progressCallback),
    ]);

    // Set WASM paths if configured
    if (env.wasmPaths && "env" in ort) {
      try {
        (ort as any).env.wasm.wasmPaths = env.wasmPaths;
      } catch {
        // Silently ignore — likely onnxruntime-node which doesn't need WASM
      }
    }

    const executionProviders: string[] =
      device === "webgpu" ? ["webgpu"] : device === "cpu" ? ["cpu"] : ["wasm"];

    const session = await ort.InferenceSession.create(modelBytes, {
      executionProviders: executionProviders as any,
    });

    return new PiperVoice(session, config);
  }

  // -------------------------------------------------------------------------
  // Phonemization
  // -------------------------------------------------------------------------

  /**
   * Convert text to phoneme characters grouped by sentence.
   */
  async phonemize(text: string): Promise<string[][]> {
    return textToPhonemes(text, this.config);
  }

  // -------------------------------------------------------------------------
  // Synthesis
  // -------------------------------------------------------------------------

  /**
   * Synthesize audio from text.
   *
   * @param text - Input text to speak
   * @param opts - Optional synthesis parameters
   * @returns Float32Array of audio samples in range [-1, 1]
   */
  async generate(
    text: string,
    opts?: { speed?: number; speakerId?: number },
  ): Promise<Float32Array> {
    const sentencePhonemes = await this.phonemize(text);
    const chunks: Float32Array[] = [];

    for (const phonemes of sentencePhonemes) {
      if (phonemes.length === 0) continue;
      const ids = phonemesToIds(phonemes, this.config);
      const audio = await this.idsToAudio(ids, opts);
      chunks.push(audio);
    }

    const total = chunks.reduce((sum, a) => sum + a.length, 0);
    const result = new Float32Array(total);
    let offset = 0;
    for (const a of chunks) {
      result.set(a, offset);
      offset += a.length;
    }
    return result;
  }

  /**
   * Synthesize audio from phoneme IDs.
   *
   * Low-level method — in most cases use `generate()` instead.
   */
  async idsToAudio(
    phonemeIds: number[],
    opts?: { speed?: number; speakerId?: number },
  ): Promise<Float32Array> {
    const ort = await getOrt();

    const config = this.config;
    const lengthScale = opts?.speed != null ? 1.0 / opts.speed : config.lengthScale;

    // Input: phoneme IDs (int64)
    const inputData = BigInt64Array.from(phonemeIds.map((id) => BigInt(id)));
    const inputLengths = BigInt64Array.from([BigInt(inputData.length)]);
    const scales = Float32Array.from([
      config.noiseScale,
      lengthScale,
      config.noiseWScale,
    ]);

    const feeds: Record<string, import("onnxruntime-common").Tensor> = {
      input: new ort.Tensor("int64", inputData, [1, inputData.length]),
      input_lengths: new ort.Tensor("int64", inputLengths, [1]),
      scales: new ort.Tensor("float32", scales, [3]),
    };

    // Multi-speaker
    if (config.numSpeakers > 1) {
      const sid = opts?.speakerId ?? 0;
      const sidData = BigInt64Array.from([BigInt(sid)]);
      feeds.sid = new ort.Tensor("int64", sidData, [1]);
    }

    const results = await this.session.run(feeds);

    const outputName = this.session.outputNames[0];
    const audioTensor = results[outputName];
    const audio = audioTensor.data as Float32Array;

    // Normalize to [-1, 1]
    const maxVal = absMax(audio);
    if (maxVal > 1e-8) {
      for (let i = 0; i < audio.length; i++) {
        audio[i] /= maxVal;
      }
    }

    return audio;
  }

  /**
   * Synthesize text and return WAV bytes (16-bit PCM).
   */
  async generateWav(
    text: string,
    opts?: { speed?: number; speakerId?: number },
  ): Promise<Uint8Array> {
    const audio = await this.generate(text, opts);
    return encodeWav(audio, this.config.sampleRate);
  }

  /**
   * Streaming synthesis — yields one AudioChunk per sentence.
   */
  async *stream(
    text: string,
    opts?: { speed?: number; speakerId?: number },
  ): AsyncGenerator<AudioChunk> {
    const sentencePhonemes = await this.phonemize(text);

    for (const phonemes of sentencePhonemes) {
      if (phonemes.length === 0) continue;
      const ids = phonemesToIds(phonemes, this.config);
      const audio = await this.idsToAudio(ids, opts);

      yield {
        sampleRate: this.config.sampleRate,
        audio,
        phonemes,
        phonemeIds: ids,
        text: "",
      };
    }
  }

  get numSymbols(): number {
    return this.config.numSymbols;
  }

  get sampleRate(): number {
    return this.config.sampleRate;
  }
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

async function loadConfig(modelId: string): Promise<PiperConfig> {
  const url = resolveUrl(modelId, "config.json");
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to load config from ${url} (${res.status} ${res.statusText})`,
    );
  }
  const raw: Record<string, unknown> = await res.json();
  return new PiperConfig(raw);
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

async function loadModelBytes(
  modelId: string,
  progressCallback?: (p: {
    status: string;
    file?: string;
    percent?: number;
  }) => void,
): Promise<Uint8Array> {
  const url = resolveUrl(modelId, "model.onnx");
  progressCallback?.({ status: "download", file: "model.onnx", percent: 0 });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to load model from ${url} (${res.status} ${res.statusText})`,
    );
  }

  const buffer = await res.arrayBuffer();
  progressCallback?.({ status: "done", file: "model.onnx", percent: 100 });
  return new Uint8Array(buffer);
}

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

function resolveUrl(modelId: string, filename: string): string {
  if (
    modelId.startsWith("/") ||
    modelId.startsWith("./") ||
    modelId.startsWith("../") ||
    modelId.startsWith("file:")
  ) {
    return `${modelId.replace(/\/?$/, "")}/${filename}`;
  }
  return `https://huggingface.co/${modelId}/resolve/main/${filename}`;
}

// ---------------------------------------------------------------------------
// WAV encoder
// ---------------------------------------------------------------------------

function encodeWav(audio: Float32Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = audio.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buf = new ArrayBuffer(totalSize);
  const v = new DataView(buf);

  writeStr(v, 0, "RIFF");
  v.setUint32(4, totalSize - 8, true);
  writeStr(v, 8, "WAVE");

  writeStr(v, 12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);

  writeStr(v, 36, "data");
  v.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    v.setInt16(off, Math.round(s * MAX_WAV_VALUE), true);
    off += 2;
  }

  return new Uint8Array(buf);
}

function writeStr(v: DataView, off: number, str: string): void {
  for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i));
}

function absMax(arr: Float32Array): number {
  let max = 0;
  for (let i = 0; i < arr.length; i++) {
    const abs = Math.abs(arr[i]);
    if (abs > max) max = abs;
  }
  return max;
}
