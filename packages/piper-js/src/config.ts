import type { PhonemeType } from "./types.js";

/** Default inference parameters */
const DEFAULT_NOISE_SCALE = 0.667;
const DEFAULT_LENGTH_SCALE = 1.0;
const DEFAULT_NOISE_W_SCALE = 0.8;
const DEFAULT_HOP_LENGTH = 256;

/**
 * Configuration loaded from a Piper voice model's config.json.
 */
export class PiperConfig {
  /** Number of phoneme symbols */
  numSymbols: number;
  /** Number of speakers */
  numSpeakers: number;
  /** Output audio sample rate */
  sampleRate: number;
  /** espeak-ng voice / language identifier */
  espeakVoice: string;
  /** Phoneme type */
  phonemeType: PhonemeType;
  /** Map from phoneme character to sequence of IDs */
  phonemeIdMap: Record<string, number[]>;
  /** Map from speaker name to speaker ID */
  speakerIdMap: Record<string, number>;
  /** Piper version */
  piperVersion?: string;

  // Inference settings
  lengthScale: number;
  noiseScale: number;
  noiseWScale: number;
  hopLength: number;

  constructor(raw: Record<string, unknown>) {
    const inference = (raw.inference ?? {}) as Record<string, unknown>;
    const audio = (raw.audio ?? {}) as Record<string, unknown>;

    this.numSymbols = raw.num_symbols as number;
    this.numSpeakers = raw.num_speakers as number;
    this.sampleRate = audio.sample_rate as number;
    this.espeakVoice = (raw.espeak as Record<string, unknown>)?.voice as string;
    this.phonemeType = (raw.phoneme_type as PhonemeType) ?? "espeak";
    this.phonemeIdMap = raw.phoneme_id_map as Record<string, number[]>;
    this.speakerIdMap = (raw.speaker_id_map as Record<string, number>) ?? {};
    this.piperVersion = raw.piper_version as string | undefined;

    this.noiseScale = (inference.noise_scale as number) ?? DEFAULT_NOISE_SCALE;
    this.lengthScale =
      (inference.length_scale as number) ?? DEFAULT_LENGTH_SCALE;
    this.noiseWScale = (inference.noise_w as number) ?? DEFAULT_NOISE_W_SCALE;
    this.hopLength = (raw.hop_length as number) ?? DEFAULT_HOP_LENGTH;
  }
}

/**
 * Runtime synthesis configuration.
 */
export class SynthesisConfig {
  /** Speaker ID (multi-speaker models only). */
  speakerId?: number;
  /** Phoneme length scale. < 1 is faster, > 1 is slower. */
  lengthScale?: number;
  /** Amount of generator noise to add. */
  noiseScale?: number;
  /** Amount of phoneme width noise to add. */
  noiseWScale?: number;
  /** Normalize audio to full range. */
  normalizeAudio: boolean;
  /** Volume multiplier. */
  volume: number;

  constructor(opts?: Partial<SynthesisConfig>) {
    this.speakerId = opts?.speakerId;
    this.lengthScale = opts?.lengthScale;
    this.noiseScale = opts?.noiseScale;
    this.noiseWScale = opts?.noiseWScale;
    this.normalizeAudio = opts?.normalizeAudio ?? true;
    this.volume = opts?.volume ?? 1.0;
  }
}
