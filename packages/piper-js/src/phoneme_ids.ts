import { PiperConfig } from "./config.js";

/** Padding token */
const PAD = "_";
/** Beginning of sentence */
const BOS = "^";
/** End of sentence */
const EOS = "$";

/**
 * Convert a list of phoneme characters to a list of integer IDs
 * according to the model's phoneme ID map.
 *
 * Mirrors the Python `phonemes_to_ids()` in phoneme_ids.py:
 *   BOS -> PAD -> [phoneme PAD]* -> EOS
 */
export function phonemesToIds(
  phonemes: string[],
  config: PiperConfig,
): number[] {
  const idMap = config.phonemeIdMap;
  const ids: number[] = [];

  // BOS + PAD
  pushIds(ids, idMap, BOS);
  pushIds(ids, idMap, PAD);

  for (const ph of phonemes) {
    if (!(ph in idMap)) {
      console.warn(`Missing phoneme from id map: ${ph}`);
      continue;
    }
    pushIds(ids, idMap, ph);
    pushIds(ids, idMap, PAD);
  }

  // EOS
  pushIds(ids, idMap, EOS);

  return ids;
}

function pushIds(
  dest: number[],
  map: Record<string, number[]>,
  key: string,
): void {
  const mapped = map[key];
  if (mapped) {
    dest.push(...mapped);
  }
}
