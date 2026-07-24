import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaults } from '../config';

let ortModule: any = null;

async function getOrt() {
  if (ortModule) return ortModule;
  // Try native onnxruntime-node first (faster), fall back to onnxruntime-web (WASM)
  try {
    ortModule = await import('onnxruntime-node');
  } catch {
    ortModule = await import('onnxruntime-web');
  }
  return ortModule;
}

const voiceCache = new Map<string, any>();

export function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/);
  return parts.filter(p => p.trim());
}

export function listVoices(settings: any): { enabled: boolean; voiceDir: string; voices: string[] } {
  const dir = settings?.voiceDir || defaults.piper.voiceDir;
  if (!dir) return { enabled: !!settings?.enabled, voiceDir: dir, voices: [] };
  try {
    const files = readdirSync(dir);
    const voices = files
      .filter(f => f.endsWith('.onnx'))
      .map(f => f.replace(/\.onnx$/, ''))
      .sort();
    return { enabled: !!settings?.enabled, voiceDir: dir, voices };
  } catch {
    return { enabled: !!settings?.enabled, voiceDir: dir, voices: [] };
  }
}

async function loadVoice(voiceId: string, settings: any): Promise<any> {
  const voiceDir = settings?.voiceDir || defaults.piper.voiceDir;
  if (!voiceDir) throw new Error('Piper voice directory not configured');
  const cacheKey = `${voiceDir}:${voiceId}`;
  const cached = voiceCache.get(cacheKey);
  if (cached) return cached;

  const onnxPath = resolve(voiceDir, `${voiceId}.onnx`);
  const configPath = resolve(voiceDir, `${voiceId}.onnx.json`);

  const modelBytes = readFileSync(onnxPath);
  const configRaw = JSON.parse(readFileSync(configPath, 'utf-8'));
  // Lazy import piper-js — its Emscripten WASM dep (phonemizer)
  // doesn't survive Bun --watch reload.
  const { PiperVoice, PiperConfig } = await import('piper-js');
  const config = new PiperConfig(configRaw);
  const ort = await getOrt();

  const session = await ort.InferenceSession.create(modelBytes, {
    executionProviders: ['cpu'],
  });

  const voice = new (PiperVoice as any)(session, config);
  voiceCache.set(cacheKey, voice);
  return voice;
}

export async function synthesizePiper(
  text: string,
  settings: any,
  dataDir: string,
  voiceId?: string,
): Promise<{ filename: string; public_url: string; mime_type: string }> {
  if (!settings?.enabled) throw new Error('Piper disabled');
  if (!text?.trim()) throw new Error('Empty text');
  if (text.length > (settings.maxTextLength ?? 4000)) throw new Error('Text too long');

  const id = voiceId || settings.defaultVoice;
  if (!id) throw new Error('No voice selected');

  const outputDir = settings.outputDir || join(dataDir, 'audio');
  mkdirSync(outputDir, { recursive: true });

  const voice = await loadVoice(id, settings);

  const timeoutMs = settings.timeoutMs ?? 30000;
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error('Piper synthesis timed out')), timeoutMs);

  try {
    const wavBytes = await voice.generateWav(text, { speed: 1.0 });

    const filename = `${randomUUID()}.wav`;
    const outPath = join(outputDir, filename);
    writeFileSync(outPath, Buffer.from(wavBytes));

    return { filename, public_url: `/assets/audio/${filename}`, mime_type: 'audio/wav' };
  } finally {
    clearTimeout(timeout);
  }
}
export async function synthesizePiperBatched(
  text: string,
  settings: any,
  dataDir: string,
): Promise<Awaited<ReturnType<typeof synthesizePiper>>[]> {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];
  const out = [];
  for (const s of sentences) {
    out.push(await synthesizePiper(s, settings, dataDir));
  }
  return out;
}
