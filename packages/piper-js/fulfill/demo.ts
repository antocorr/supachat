/**
 * piper-js — demo interattivo.
 *
 * Prova Piper-js con voci in diverse lingue.
 * Usa modelli già scaricati dalla cache HF per essere più rapido.
 *
 * Uso:
 *   bun run fulfill/demo.ts              # scarica modello ~13MB
 *   bun run fulfill/demo.ts --no-tts     # solo test fonemizzazione (nessun download)
 */

import { PiperConfig } from "../src/config.ts";
import { phonemesToIds } from "../src/phoneme_ids.ts";
import { textToPhonemes } from "../src/utils.ts";
import { PiperVoice } from "../src/voice.ts";

const RUN_TTS = !process.argv.includes("--no-tts");

// Colori per output
const RST = "\x1b[0m";
const GRN = "\x1b[32m";
const CYN = "\x1b[36m";
const YLW = "\x1b[33m";
const MAG = "\x1b[35m";

async function main() {
  console.log(`\n${CYN}╔══════════════════════════════════╗${RST}`);
  console.log(`${CYN}║        piper-js  DEMO            ║${RST}`);
  console.log(`${CYN}╚══════════════════════════════════╝${RST}\n`);

  // ── 1. Config parsing ──────────────────────────────────────────────────
  console.log(`${YLW}📋 Config${RST}`);

  const deConfig = await loadConfig(
    "speaches-ai/piper-de_DE-thorsten-high",
  );
  logConfig(deConfig, "🇩🇪  German (thorsten)");

  const enConfig = await loadConfig(
    "speaches-ai/piper-en_US-lessac-medium",
  );
  logConfig(enConfig, "🇺🇸  English (lessac)");

  // ── 2. Phonemization ──────────────────────────────────────────────────
  console.log(`\n${YLW}🔤 Phonemization${RST}`);

  // English
  const enSentences = await textToPhonemes(
    "The quick brown fox jumps over the lazy dog.",
    enConfig,
  );
  console.log(
    `  ${GRN}EN:${RST} The quick brown fox jumps over the lazy dog.`,
  );
  console.log(`       → ${MAG}${enSentences[0]?.join("") ?? "(empty)"}${RST}`);

  // German
  const deSentences = await textToPhonemes(
    "Guten Morgen! Wie geht es Ihnen?",
    deConfig,
  );
  console.log(
    `  ${GRN}DE:${RST} Guten Morgen! Wie geht es Ihnen?`,
  );
  for (const s of deSentences) {
    console.log(`       → ${MAG}${s.join("")}${RST}`);
  }

  // French
  const frConfig = await loadConfig(
    "speaches-ai/piper-fr_FR-mls-medium",
  );
  const frSentences = await textToPhonemes(
    "Bonjour tout le monde. Comment allez-vous?",
    frConfig,
  );
  console.log(
    `  ${GRN}FR:${RST} Bonjour tout le monde. Comment allez-vous?`,
  );
  for (const s of frSentences) {
    console.log(`       → ${MAG}${s.join("")}${RST}`);
  }

  // Italian
  try {
    const itConfig = await loadConfig(
      "speaches-ai/piper-it_IT-paola-medium",
    );
    const itSentences = await textToPhonemes(
      "Ciao mondo! Come stai oggi?",
      itConfig,
    );
    console.log(
      `  ${GRN}IT:${RST} Ciao mondo! Come stai oggi?`,
    );
    for (const s of itSentences) {
      console.log(`       → ${MAG}${s.join("")}${RST}`);
    }
  } catch {
    console.log(`  ${GRN}IT:${RST} (config non trovata su HF, skip)`);
  }

  // ── 3. Phoneme IDs ────────────────────────────────────────────────────
  console.log(`\n${YLW}🔢 Phoneme → IDs${RST}`);
  const samplePhonemes = deSentences[0] ?? [];
  if (samplePhonemes.length > 0) {
    const ids = phonemesToIds(samplePhonemes, deConfig);
    console.log(
      `  Primi 10 fonemi: ${MAG}${samplePhonemes.slice(0, 10).join(" ")}${RST}`,
    );
    console.log(
      `  Primi 10 IDs:    ${MAG}${ids.slice(0, 10).join(", ")}${RST}`,
    );
    console.log(`  Totale IDs:      ${ids.length}`);
  }

  // ── 4. TTS (full pipeline) ────────────────────────────────────────────
  if (RUN_TTS) {
    console.log(`\n${YLW}🎧 Text-to-Speech (download modello ~13MB)${RST}`);

    const voice = await PiperVoice.fromPretrained(
      "speaches-ai/piper-de_DE-thorsten-high",
      {
        device: "wasm",
        progressCallback: (p) => {
          if (p.file)
            process.stdout.write(
              `\r  Download: ${p.file} — ${p.percent ?? 0}%     `,
            );
        },
      },
    );
    console.log("\n");

    console.log(`  Modello caricato:`);
    console.log(`    Sample rate: ${voice.sampleRate} Hz`);
    console.log(`    Simboli:     ${voice.numSymbols}`);

    // Genera audio
    const text = "Hallo Welt! Dies ist ein Test der Sprachsynthese.";
    console.log(`\n  Sintesi: "${text}"`);
    const audio = await voice.generate(text, { speed: 1.0 });

    console.log(
      `  Output: ${audio.length} samples @ ${voice.sampleRate} Hz = ${(audio.length / voice.sampleRate).toFixed(2)}s`,
    );

    // Salva WAV
    const wav = await voice.generateWav(text);
    const outPath = "/tmp/piper-js-demo.wav";
    await Bun.write(outPath, wav);
    console.log(`  WAV salvato: ${outPath} (${(wav.length / 1024).toFixed(0)} KB)`);

    // Riproduci audio (se possibile)
    try {
      const proc = Bun.spawnSync(["ffplay", "-nodisp", "-autoexit", outPath], {
        timeout: 5000,
      });
      if (proc.exitCode === 0) {
        console.log(`  🔊 Riproduzione completata`);
      }
    } catch {
      console.log(`  💡 Apri ${outPath} col tuo player preferito`);
    }

    console.log(`\n${GRN}✅ Demo completata!${RST}\n`);
  } else {
    console.log(
      `\n  ${YLW}⏭ TTS saltato (usa --no-tts). Per provarlo: bun run fulfill/demo.ts${RST}\n`,
    );
  }
}

// Helper per caricare un config
async function loadConfig(modelId: string): Promise<PiperConfig> {
  const res = await fetch(
    `https://huggingface.co/${modelId}/raw/main/config.json`,
  );
  if (!res.ok) throw new Error(`Config not found for ${modelId}`);
  return new PiperConfig(await res.json());
}

function logConfig(config: PiperConfig, label: string) {
  console.log(
    `  ${GRN}${label}${RST}: ${config.sampleRate}Hz, espeak=${config.espeakVoice}, speakers=${config.numSpeakers}, symbols=${config.numSymbols}`,
  );
}

main().catch(console.error);
