/**
 * piper-js demo server.
 *
 * Bun HTTP server che serve:
 *   - `/`   → demo UI (index.html)
 *   - `/dist/*` → file compilati (per client WASM mode)
 *   - `/api/tts` → genera audio via piper-js e ritorna WAV
 *
 * Avvio:
 *   bun run fulfill/demo-server.ts
 *   → http://localhost:3000
 */

import { PiperVoice } from "../src/voice.ts";

const PORT = parseInt(process.env.PORT || "3000");
const DIST_DIR = import.meta.dirname
  ? `${import.meta.dirname}/../dist`
  : `${process.cwd()}/dist`;

// Cache per le voci caricate — voice_id → PiperVoice
const voiceCache = new Map<string, PiperVoice>();

// Mappa voice IDs → config per info extra
const VOICE_META: Record<string, { language: string; label: string }> = {
  "speaches-ai/piper-en_US-lessac-medium": {
    language: "en_US",
    label: "English (US) — lessac medium",
  },
  "speaches-ai/piper-en_GB-vctk-medium": {
    language: "en_GB",
    label: "English (UK) — vctk medium",
  },
  "speaches-ai/piper-de_DE-thorsten-high": {
    language: "de_DE",
    label: "German — thorsten high",
  },
  "speaches-ai/piper-de_DE-thorsten-medium": {
    language: "de_DE",
    label: "German — thorsten medium",
  },
  "speaches-ai/piper-fr_FR-mls-medium": {
    language: "fr_FR",
    label: "French — mls medium",
  },
  "speaches-ai/piper-it_IT-paola-medium": {
    language: "it_IT",
    label: "Italian — paola medium",
  },
  "speaches-ai/piper-es_ES-davefx-medium": {
    language: "es_ES",
    label: "Spanish — davefx medium",
  },
};

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    try {
      // ── Serve demo UI ─────────────────────────────────────────────────
      if (path === "/" || path === "/index.html") {
        const file = Bun.file("fulfill/demo-public/index.html");
        if (await file.exists()) {
          return new Response(file, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      }

      // ── Serve compiled dist files (for browser WASM mode) ─────────────
      if (path.startsWith("/dist/")) {
        const relPath = path.replace("/dist/", "");
        const filePath = `${DIST_DIR}/${relPath}`;
        const file = Bun.file(filePath);
        if (await file.exists()) {
          const ext = filePath.split(".").pop() || "";
          const mime: Record<string, string> = {
            js: "application/javascript",
            mjs: "application/javascript",
            cjs: "application/javascript",
            ts: "application/typescript",
            map: "application/json",
            dts: "text/plain",
          };
          return new Response(file, {
            headers: { "Content-Type": mime[ext] || "application/octet-stream" },
          });
        }
      }

      // ── API: TTS ──────────────────────────────────────────────────────
      if (path === "/api/tts" && method === "POST") {
        return handleTts(req);
      }

      // ── API: Health / info ────────────────────────────────────────────
      if (path === "/api/info" && method === "GET") {
        return Response.json({
          status: "ok",
          voices: Object.entries(VOICE_META).map(([id, meta]) => ({
            id,
            ...meta,
          })),
        });
      }

      // ── Favicon (silence 404) ─────────────────────────────────────────
      if (path === "/favicon.ico") {
        return new Response(null, { status: 204 });
      }

      // ── 404 ───────────────────────────────────────────────────────────
      return new Response("Not Found", { status: 404 });
    } catch (err: any) {
      console.error("Server error:", err);
      return new Response(
        JSON.stringify({ error: err.message || "Internal Server Error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});

console.log(`\n  🚀 piper-js demo server running`);
console.log(`  ─────────────────────────────`);
console.log(`  📍  http://localhost:${PORT}`);
console.log(`  🖥  Server mode:  tutti i linguaggi`);
console.log(`  🌐  Client mode: tutte le lingue (WASM nel browser)`);
console.log(
  `  📦  Modelli: ${Object.keys(VOICE_META).length} voci disponibili\n`,
);

// ---------------------------------------------------------------------------
// TTS handler
// ---------------------------------------------------------------------------

async function handleTts(req: Request): Promise<Response> {
  const body = await req.json();
  const text = (body.text || "").trim();
  const voiceId = body.voice || "speaches-ai/piper-de_DE-thorsten-high";
  const speed = body.speed ?? 1.0;

  if (!text) {
    return Response.json({ error: "Campo 'text' obbligatorio" }, { status: 400 });
  }

  // Ottieni o carica la voce
  let voice = voiceCache.get(voiceId);
  if (!voice) {
    console.log(`  📥 Caricamento voce: ${voiceId}...`);
    voice = await PiperVoice.fromPretrained(voiceId, {
      device: "wasm",
      progressCallback: (p) => {
        if (p.file) {
          console.log(`     ${p.status}: ${p.file} (${p.percent ?? "?"}%)`);
        }
      },
    });
    voiceCache.set(voiceId, voice);
    console.log(`  ✅ Voce caricata: ${voiceId}`);
  }

  // Phonemize (per gli IPA da mostrare)
  const sentences = await voice.phonemize(text);
  const phonemes = sentences.map((s) => s.join("")).join("\n");

  // Genera audio
  console.log(`  🔊 Sintesi: "${text.slice(0, 60)}..."`);
  const audio = await voice.generate(text, { speed });

  // Converti in WAV
  const wav = await voice.generateWav(text, { speed });

  const meta = VOICE_META[voiceId];

  return new Response(wav, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": 'attachment; filename="piper-tts.wav"',
      "x-sample-rate": String(voice.sampleRate),
      "x-language": meta?.language || voiceId,
      "x-phonemes": encodeURIComponent(phonemes),
      "x-voice-id": voiceId,
    },
  });
}
