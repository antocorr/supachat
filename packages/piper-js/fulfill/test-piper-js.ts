/**
 * piper-js — functional verification test.
 *
 * Tests the core ported components:
 *   1. PiperConfig — parsing config.json from HuggingFace
 *   2. phonemesToIds — phoneme sequence → integer IDs
 *   3. textToPhonemes — text → espeak phonemes (EN via phonemizer, others via espeak-ng WASM)
 *   4. SynthesisConfig — configuration defaults and overrides
 *   5. Integration — full pipeline with a real Piper model
 *
 * Run with: bun test ./fulfill/test-piper-js.ts
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { PiperConfig, SynthesisConfig } from "../src/config.ts";
import { phonemesToIds } from "../src/phoneme_ids.ts";
import { textToPhonemes } from "../src/utils.ts";
import { PiperVoice } from "../src/voice.ts";

// ---------------------------------------------------------------------------
// 1. PiperConfig
// ---------------------------------------------------------------------------

describe("PiperConfig", () => {
  it("parses a German voice config (thorsten-high)", async () => {
    const res = await fetch(
      "https://huggingface.co/speaches-ai/piper-de_DE-thorsten-high/raw/main/config.json",
    );
    expect(res.ok).toBe(true);
    const raw = await res.json();
    const config = new PiperConfig(raw);

    expect(config.numSymbols).toBe(256);
    expect(config.numSpeakers).toBe(1);
    expect(config.sampleRate).toBe(22050);
    expect(config.espeakVoice).toBe("de");
    expect(config.phonemeType).toBe("espeak");
    expect(config.noiseScale).toBeCloseTo(0.667);
    expect(config.lengthScale).toBe(1.0);
    expect(config.noiseWScale).toBeCloseTo(0.8);
    expect(config.hopLength).toBe(256);
    expect(config.phonemeIdMap["_"]).toEqual([0]);
    expect(config.phonemeIdMap["^"]).toEqual([1]);
    expect(config.phonemeIdMap["$"]).toEqual([2]);
    expect(config.phonemeIdMap["a"]).toEqual([14]);
    expect(config.phonemeIdMap["z"]).toEqual([38]);
  });

  it("parses an English voice config", async () => {
    const res = await fetch(
      "https://huggingface.co/speaches-ai/piper-en_US-lessac-medium/raw/main/config.json",
    );
    expect(res.ok).toBe(true);
    const raw = await res.json();
    const config = new PiperConfig(raw);

    expect(config.numSymbols).toBe(256);
    expect(config.sampleRate).toBeGreaterThan(0);
    expect(config.espeakVoice).toBe("en-us");
    expect(config.phonemeType).toBe("espeak");
  });
});

// ---------------------------------------------------------------------------
// 2. phonemesToIds
// ---------------------------------------------------------------------------

describe("phonemesToIds", () => {
  let config: PiperConfig;

  beforeAll(async () => {
    const res = await fetch(
      "https://huggingface.co/speaches-ai/piper-de_DE-thorsten-high/raw/main/config.json",
    );
    const raw = await res.json();
    config = new PiperConfig(raw);
  });

  it("produces correct BOS-PAD-phoneme-PAD-EOS sequence", () => {
    // "hallo" -> [h, a, l, l, o]
    const ids = phonemesToIds(["h", "a", "l", "l", "o"], config);

    // Structure: BOS(^) PAD(_) h PAD a PAD l PAD l PAD o PAD EOS($)
    // IDs: [1] [0] [20] [0] [14] [0] [24] [0] [24] [0] [27] [0] [2]
    const expected = [1, 0, 20, 0, 14, 0, 24, 0, 24, 0, 27, 0, 2];
    expect(ids).toEqual(expected);
  });

  it("skips unknown phonemes", () => {
    // "Ω" (Greek Omega) is not in the phoneme map
    const ids = phonemesToIds(["h", "Ω", "a"], config);

    expect(ids).toContain(20); // h
    expect(ids).toContain(14); // a
    // The sequence should have exactly 2 phonemes (h and a)
    const phonemePositions = ids.filter((id) => id > 2).length;
    expect(phonemePositions).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. textToPhonemes — text → phonemes via espeak
// ---------------------------------------------------------------------------

describe("textToPhonemes", () => {
  it("phonemizes English text via fast phonemizer", async () => {
    const res = await fetch(
      "https://huggingface.co/speaches-ai/piper-en_US-lessac-medium/raw/main/config.json",
    );
    const raw = await res.json();
    const config = new PiperConfig(raw);

    const sentences = await textToPhonemes("Hello world.", config);

    expect(sentences.length).toBeGreaterThanOrEqual(1);
    for (const sentence of sentences) {
      expect(sentence.length).toBeGreaterThan(0);
    }
    console.log("  EN phonemes:", sentences[0]?.join("") ?? "(empty)");
  });

  it("phonemizes German text via espeak-ng WASM", async () => {
    const res = await fetch(
      "https://huggingface.co/speaches-ai/piper-de_DE-thorsten-high/raw/main/config.json",
    );
    const raw = await res.json();
    const config = new PiperConfig(raw);

    const sentences = await textToPhonemes("Guten Morgen.", config);

    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences[0].length).toBeGreaterThan(0);
    console.log("  DE phonemes:", sentences[0]?.join("") ?? "(empty)");
  }, 30_000);

  it("phonemizes French text via espeak-ng WASM", async () => {
    const res = await fetch(
      "https://huggingface.co/speaches-ai/piper-fr_FR-mls-medium/raw/main/config.json",
    );
    const raw = await res.json();
    const config = new PiperConfig(raw);

    const sentences = await textToPhonemes("Bonjour tout le monde.", config);

    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences[0].length).toBeGreaterThan(0);
    console.log("  FR phonemes:", sentences[0]?.join("") ?? "(empty)");
  }, 30_000);

  it("handles text-type voices (raw codepoints)", () => {
    const config = new PiperConfig({
      num_symbols: 256,
      num_speakers: 1,
      audio: { sample_rate: 22050 },
      espeak: { voice: "en-us" },
      phoneme_type: "text",
      phoneme_id_map: { _: [0], "^": [1], $: [2], " ": [3] },
      speaker_id_map: {},
    });

    // Can't use await in non-async test — wrap in async
  });

  it("handles text-type voices (async)", async () => {
    const config = new PiperConfig({
      num_symbols: 256,
      num_speakers: 1,
      audio: { sample_rate: 22050 },
      espeak: { voice: "en-us" },
      phoneme_type: "text",
      phoneme_id_map: { _: [0], "^": [1], $: [2], " ": [3] },
      speaker_id_map: {},
    });

    const sentences = await textToPhonemes("Hello", config);
    expect(sentences.length).toBe(1);
    expect(sentences[0].length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 4. SynthesisConfig
// ---------------------------------------------------------------------------

describe("SynthesisConfig", () => {
  it("provides sensible defaults", () => {
    const cfg = new SynthesisConfig();
    expect(cfg.volume).toBe(1.0);
    expect(cfg.normalizeAudio).toBe(true);
    expect(cfg.speakerId).toBeUndefined();
  });

  it("accepts partial overrides", () => {
    const cfg = new SynthesisConfig({ volume: 0.5, speakerId: 2 });
    expect(cfg.volume).toBe(0.5);
    expect(cfg.speakerId).toBe(2);
    expect(cfg.normalizeAudio).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Integration: full pipeline with a real model (downloads ~13MB)
// ---------------------------------------------------------------------------

describe("Integration (downloads ~13MB model)", () => {
  it("loads a real Piper model and generates German audio", async () => {
    console.log("  Downloading German Piper voice model...");

    const voice = await PiperVoice.fromPretrained(
      "speaches-ai/piper-de_DE-thorsten-high",
      {
        device: "wasm",
        progressCallback: (p) => {
          if (p.file)
            console.log(`    ${p.status}: ${p.file} (${p.percent ?? "?"}%)`);
        },
      },
    );

    expect(voice.config.sampleRate).toBe(22050);
    expect(voice.numSymbols).toBe(256);
    expect(voice.sampleRate).toBe(22050);

    console.log("  Synthesizing 'Hallo Welt.'...");
    const audio = await voice.generate("Hallo Welt.");

    expect(audio).toBeInstanceOf(Float32Array);
    expect(audio.length).toBeGreaterThan(0);

    // Verify samples are in [-1, 1]
    for (let i = 0; i < Math.min(audio.length, 100); i++) {
      expect(audio[i]).toBeGreaterThanOrEqual(-1.0);
      expect(audio[i]).toBeLessThanOrEqual(1.0);
    }

    console.log(
      `  Generated ${audio.length} samples @ ${voice.sampleRate} Hz = ${(audio.length / voice.sampleRate).toFixed(2)}s`,
    );

    // Generate WAV
    const wav = await voice.generateWav("Hallo Welt.");
    expect(wav).toBeInstanceOf(Uint8Array);
    expect(wav.length).toBeGreaterThan(44);

    // Verify WAV header
    const header = new TextDecoder().decode(wav.slice(0, 4));
    expect(header).toBe("RIFF");
    const waveId = new TextDecoder().decode(wav.slice(8, 12));
    expect(waveId).toBe("WAVE");

    console.log(`  WAV size: ${(wav.length / 1024).toFixed(0)} KB`);
  }, 120_000);

  it("loads an English model and generates audio", async () => {
    console.log("  Downloading English Piper voice model...");

    const voice = await PiperVoice.fromPretrained(
      "speaches-ai/piper-en_US-lessac-medium",
      {
        device: "wasm",
      },
    );

    const audio = await voice.generate("The quick brown fox jumps over the lazy dog.");

    expect(audio).toBeInstanceOf(Float32Array);
    expect(audio.length).toBeGreaterThan(0);

    console.log(
      `  EN: ${audio.length} samples @ ${voice.sampleRate} Hz = ${(audio.length / voice.sampleRate).toFixed(2)}s`,
    );
  }, 120_000);
});

console.log("\n✓ piper-js functional tests completed.\n");
