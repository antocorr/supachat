import { phonemize as phonemizerPhonemize } from "phonemizer";
import { PiperConfig } from "./config.js";

// Lazy-loaded espeak-ng WASM for multilingual support
let espeakNgModule: Promise<any> | null = null;

async function getEspeakNg() {
  if (!espeakNgModule) {
    espeakNgModule = import("espeak-ng").then((mod) => mod.default || mod);
  }
  return espeakNgModule;
}

/**
 * Preprocess and phonemize text for a Piper voice model.
 *
 * 1. **espeak voices** (default): phonemizes via espeak-ng.
 *    - English (en, en-us, en-gb, etc.) → uses `phonemizer` package (fast WASM).
 *    - All other languages (de, fr, it, es, ar, etc.) → uses full `espeak-ng` WASM.
 * 2. **text voices**: returns raw NFD-normalized Unicode codepoints.
 *
 * Returns phonemes grouped by sentence, each as an array of
 * NFD-decomposed Unicode codepoints, matching Piper's Python behavior.
 */
export async function textToPhonemes(
  text: string,
  config: PiperConfig,
): Promise<string[][]> {
  if (config.phonemeType === "text") {
    return [Array.from(text.normalize("NFD"))];
  }

  return espeakPhonemize(text, config.espeakVoice);
}

// ---------------------------------------------------------------------------
// English voices use the fast phonemizer package
// ---------------------------------------------------------------------------

const ENGLISH_REGIONS = new Set([
  "en",
  "en-us",
  "en-gb",
  "en-029",
  "en-scottish",
  "en-gb-scotland",
  "en-us-nyc",
  "en-gb-x-gbclan",
  "en-gb-x-gbcwmd",
  "en-gb-x-rp",
]);

function isEnglish(voice: string): boolean {
  const key = voice.toLowerCase().trim();
  return ENGLISH_REGIONS.has(key) || key.startsWith("en-");
}

// ---------------------------------------------------------------------------
// espeak phonemization
// ---------------------------------------------------------------------------

async function espeakPhonemize(
  text: string,
  voice: string,
): Promise<string[][]> {
  if (isEnglish(voice)) {
    return phonemizeEnglish(text, voice);
  }
  return phonemizeMultilingual(text, voice);
}

/**
 * Phonemize English text using the lightweight `phonemizer` package.
 * This is the same package used by kokoro-js — fast WASM with minimal overhead.
 */
async function phonemizeEnglish(
  text: string,
  voice: string,
): Promise<string[][]> {
  // Map Piper voice codes to phonemizer language codes
  const lang = mapVoiceToPhonemizerLang(voice);

  const phonemeSentences: string[] = await phonemizerPhonemize(text, lang);

  return phonemeSentences.map((sentence) =>
    Array.from(sentence.normalize("NFD")),
  );
}

/**
 * Phonemize text in any espeak-ng supported language using the full
 * espeak-ng WASM build. This supports all Piper voices.
 *
 * Uses espeak-ng's IPA phoneme output via its virtual filesystem.
 */
async function phonemizeMultilingual(
  text: string,
  voice: string,
): Promise<string[][]> {
  const espeakNg = await getEspeakNg();

  // espeak-ng CLI: output IPA phonemes, no audio, group characters
  const espeak = await espeakNg({
    arguments: [
      "--phonout=__piper_phonemes__",
      '--sep=""',
      "-q",
      "-b=1",
      "--ipa=3",
      "-v",
      voice,
      text,
    ],
  });

  // Read the generated phoneme output from the virtual filesystem
  const phonemeText: string = espeak.FS.readFile("__piper_phonemes__", {
    encoding: "utf8",
  });

  // Piper Python splits espeak output by sentence boundaries (newlines or terminators)
  const sentences = phonemeText
    .split(/\n+/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  if (sentences.length === 0) {
    // If espeak didn't split by sentences, treat whole text as one sentence
    return [Array.from(phonemeText.trim().normalize("NFD"))];
  }

  return sentences.map((s: string) => Array.from(s.normalize("NFD")));
}

// ---------------------------------------------------------------------------
// Voice mapping
// ---------------------------------------------------------------------------

/**
 * Map a Piper espeak voice identifier to a phonemizer language code.
 */
function mapVoiceToPhonemizerLang(voice: string): string {
  // phonemizer uses espeak identifiers like "en-us", "en-gb"
  // Piper uses the same identifiers
  return voice;
}
