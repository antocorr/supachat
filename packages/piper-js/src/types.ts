/** Phoneme type used by the voice model */
export type PhonemeType = "espeak" | "text";

/** Runtime device for model inference */
export type Device = "wasm" | "webgpu" | "cpu";

/** Data type for model weights */
export type Dtype = "fp32" | "fp16" | "q8" | "q4" | "q4f16";

/** Loaded voice metadata entry */
export interface VoiceInfo {
  name: string;
  language: string;
  gender?: string;
  traits?: string;
  quality?: string;
  overallGrade?: string;
}

/** Options for generating audio */
export interface GenerateOptions {
  /** Speaking speed multiplier. < 1 is faster, > 1 is slower. */
  speed?: number;
  /** Speaker ID (multi-speaker models only). */
  speakerId?: number;
}

/** Options for streaming audio */
export interface StreamOptions extends GenerateOptions {
  /** Custom regex pattern to split text (default: sentence splitter). */
  splitPattern?: RegExp;
}

/** A chunk of synthesized audio */
export interface AudioChunk {
  /** Audio sample rate in Hz */
  sampleRate: number;
  /** Float32 audio data in range [-1, 1] */
  audio: Float32Array;
  /** Phonemes that produced this chunk */
  phonemes: string[];
  /** Phoneme IDs that produced this chunk */
  phonemeIds: number[];
  /** Input text for this chunk */
  text: string;
}
