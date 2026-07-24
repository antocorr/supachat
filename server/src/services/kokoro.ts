import { readdirSync, mkdirSync, writeFileSync, existsSync, unlinkSync, symlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { id } from '../db/database';

export type KokoroCatalogVoice = { id: string; language: string; name: string; grade: string };
export type KokoroVoice = KokoroCatalogVoice & { label: string; installed: boolean };

export const KOKORO_VOICE_CATALOG: KokoroCatalogVoice[] = [
  // English (US)
  { id: 'af_heart', language: 'English (US)', name: 'Heart', grade: 'A' },
  { id: 'af_alloy', language: 'English (US)', name: 'Alloy', grade: 'C' },
  { id: 'af_aoede', language: 'English (US)', name: 'Aoede', grade: 'C+' },
  { id: 'af_bella', language: 'English (US)', name: 'Bella', grade: 'A-' },
  { id: 'af_jessica', language: 'English (US)', name: 'Jessica', grade: 'D' },
  { id: 'af_kore', language: 'English (US)', name: 'Kore', grade: 'C+' },
  { id: 'af_nicole', language: 'English (US)', name: 'Nicole', grade: 'B-' },
  { id: 'af_nova', language: 'English (US)', name: 'Nova', grade: 'C' },
  { id: 'af_river', language: 'English (US)', name: 'River', grade: 'D' },
  { id: 'af_sarah', language: 'English (US)', name: 'Sarah', grade: 'C+' },
  { id: 'af_sky', language: 'English (US)', name: 'Sky', grade: 'C-' },
  { id: 'am_adam', language: 'English (US)', name: 'Adam', grade: 'F+' },
  { id: 'am_echo', language: 'English (US)', name: 'Echo', grade: 'D' },
  { id: 'am_eric', language: 'English (US)', name: 'Eric', grade: 'D' },
  { id: 'am_fenrir', language: 'English (US)', name: 'Fenrir', grade: 'C+' },
  { id: 'am_liam', language: 'English (US)', name: 'Liam', grade: 'D' },
  { id: 'am_michael', language: 'English (US)', name: 'Michael', grade: 'C+' },
  { id: 'am_onyx', language: 'English (US)', name: 'Onyx', grade: 'D' },
  { id: 'am_puck', language: 'English (US)', name: 'Puck', grade: 'C+' },
  { id: 'am_santa', language: 'English (US)', name: 'Santa', grade: 'D-' },
  // English (UK)
  { id: 'bf_alice', language: 'English (UK)', name: 'Alice', grade: 'D' },
  { id: 'bf_emma', language: 'English (UK)', name: 'Emma', grade: 'B-' },
  { id: 'bf_isabella', language: 'English (UK)', name: 'Isabella', grade: 'C' },
  { id: 'bf_lily', language: 'English (UK)', name: 'Lily', grade: 'D' },
  { id: 'bm_daniel', language: 'English (UK)', name: 'Daniel', grade: 'D' },
  { id: 'bm_fable', language: 'English (UK)', name: 'Fable', grade: 'C' },
  { id: 'bm_george', language: 'English (UK)', name: 'George', grade: 'C' },
  { id: 'bm_lewis', language: 'English (UK)', name: 'Lewis', grade: 'D+' },
  // Japanese
  { id: 'jf_alpha', language: 'Japanese', name: 'Alpha', grade: 'C+' },
  { id: 'jf_gongitsune', language: 'Japanese', name: 'Gongitsune', grade: 'C' },
  { id: 'jf_nezumi', language: 'Japanese', name: 'Nezumi', grade: 'C-' },
  { id: 'jf_tebukuro', language: 'Japanese', name: 'Tebukuro', grade: 'C' },
  { id: 'jm_kumo', language: 'Japanese', name: 'Kumo', grade: 'C-' },
  // Chinese
  { id: 'zf_xiaobei', language: 'Chinese', name: 'Xiaobei', grade: 'D' },
  { id: 'zf_xiaoni', language: 'Chinese', name: 'Xiaoni', grade: 'D' },
  { id: 'zf_xiaoxiao', language: 'Chinese', name: 'Xiaoxiao', grade: 'D' },
  { id: 'zf_xiaoyi', language: 'Chinese', name: 'Xiaoyi', grade: 'D' },
  { id: 'zm_yunjian', language: 'Chinese', name: 'Yunjian', grade: 'D' },
  { id: 'zm_yunxi', language: 'Chinese', name: 'Yunxi', grade: 'D' },
  { id: 'zm_yunxia', language: 'Chinese', name: 'Yunxia', grade: 'D' },
  { id: 'zm_yunyang', language: 'Chinese', name: 'Yunyang', grade: 'D' },
  // Spanish
  { id: 'ef_dora', language: 'Spanish', name: 'Dora', grade: '' },
  { id: 'em_alex', language: 'Spanish', name: 'Alex', grade: '' },
  { id: 'em_santa', language: 'Spanish', name: 'Santa', grade: '' },
  // French
  { id: 'ff_siwis', language: 'French', name: 'Siwis', grade: 'B-' },
  // Hindi
  { id: 'hf_alpha', language: 'Hindi', name: 'Alpha', grade: 'C' },
  { id: 'hf_beta', language: 'Hindi', name: 'Beta', grade: 'C' },
  { id: 'hm_omega', language: 'Hindi', name: 'Omega', grade: 'C' },
  { id: 'hm_psi', language: 'Hindi', name: 'Psi', grade: 'C' },
  // Italian
  { id: 'if_sara', language: 'Italian', name: 'Sara', grade: 'C' },
  { id: 'im_nicola', language: 'Italian', name: 'Nicola', grade: 'C' },
  // Portuguese
  { id: 'pf_dora', language: 'Portuguese', name: 'Dora', grade: '' },
  { id: 'pm_alex', language: 'Portuguese', name: 'Alex', grade: '' },
  { id: 'pm_santa', language: 'Portuguese', name: 'Santa', grade: '' }
];

export function listKokoroVoices(settings: any): { modelDir: string; voices: KokoroVoice[]; languages: string[] } {
  const modelDir = settings?.modelDir || '';
  const voicesDir = join(modelDir, 'voices');
  let installedFiles: string[];
  try {
    installedFiles = readdirSync(voicesDir);
  } catch {
    installedFiles = [];
  }
  const installedIds = new Set(installedFiles.filter(f => f.endsWith('.bin')).map(f => f.replace(/\.bin$/, '')));
  const voices = KOKORO_VOICE_CATALOG.map(entry => ({
    ...entry,
    label: entry.grade ? `${entry.name} (${entry.grade})` : entry.name,
    installed: installedIds.has(entry.id)
  }));
  const languages = [...new Set(KOKORO_VOICE_CATALOG.map(v => v.language))];
  return { modelDir, voices, languages };
}

const KOONX_MODEL_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main';

// Names must match what kokoro-js expects for each dtype.
// See: https://huggingface.co/onnx-community/Kokoro-v0.19/tree/main/onnx
// Names must match what kokoro-js / transformers.js expects for each dtype.
// See: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/main/onnx
const ONNX_FILE_MAP: Record<string, string> = {
  fp32: 'model.onnx',
  fp16: 'model_fp16.onnx',
  q8: 'model_quantized.onnx',
  q4: 'model_q4.onnx',
  q4f16: 'model_q4f16.onnx'
};

export function isKokoroModelReady(settings: any): { ready: boolean; missing: string[] } {
  const modelDir = settings?.modelDir;
  if (!modelDir) return { ready: false, missing: ['modelDir not configured'] };

  const dtype = settings?.dtype || 'q8';
  const requiredFiles = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    `onnx/${ONNX_FILE_MAP[dtype] || 'model_q8f16.onnx'}`
  ];

  const missing = requiredFiles.filter(f => !existsSync(join(modelDir, f)));
  return { ready: missing.length === 0, missing };
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destPath, buffer);
}

export async function ensureKokoroModel(settings: any): Promise<{ downloaded: string[] }> {
  const modelDir = settings?.modelDir;
  if (!modelDir) throw new Error('Kokoro model directory not configured');

  const { missing } = isKokoroModelReady(settings);
  if (missing.length === 0) return { downloaded: [] };

  mkdirSync(modelDir, { recursive: true });
  mkdirSync(join(modelDir, 'onnx'), { recursive: true });

  const downloaded: string[] = [];
  for (const file of missing) {
    const url = `${KOONX_MODEL_BASE}/${file}`;
    await downloadFile(url, join(modelDir, file));
    downloaded.push(file);
  }

  return { downloaded };
}

export async function downloadKokoroVoice(settings: any, voiceId: string): Promise<{ modelDir: string; voices: KokoroVoice[]; languages: string[]; modelDownloaded: string[] }> {
  const entry = KOKORO_VOICE_CATALOG.find(v => v.id === voiceId);
  if (!entry) throw new Error(`Unknown Kokoro voice: ${voiceId}`);

  const modelDir = settings?.modelDir || '';
  if (!modelDir) throw new Error('Kokoro model directory not configured');

  // Ensure model files exist before downloading voice
  const { modelDownloaded } = await ensureKokoroModel(settings);

  const voicesDir = join(modelDir, 'voices');
  mkdirSync(voicesDir, { recursive: true });

  const url = `${KOONX_MODEL_BASE}/voices/${voiceId}.bin`;
  await downloadFile(url, join(voicesDir, `${voiceId}.bin`));

  return { ...listKokoroVoices(settings), modelDownloaded };
}

let pipelinePromise: Promise<any> | null = null;
let lastSettingsKey = '';

async function getPipeline(settings: any) {
  const settingsKey = `${settings.modelDir}:${settings.dtype}`;
  if (pipelinePromise && lastSettingsKey !== settingsKey) {
    pipelinePromise = null;
  }
  if (!pipelinePromise) {
    // Ensure model files exist before loading
    await ensureKokoroModel(settings);
    const { KokoroTTS } = await import('kokoro-js');
    pipelinePromise = KokoroTTS.from_pretrained(settings.modelDir, {
      dtype: settings.dtype,
      device: 'cpu'
    });
    lastSettingsKey = settingsKey;
  }
  return pipelinePromise;
}

export async function synthesizeKokoro(text: string, settings: any, dataDir: string, voice?: string) {
  if (!text?.trim()) throw new Error('Empty text');
  if (text.length > (settings.maxTextLength ?? 2000)) throw new Error('Text too long');
  if (!settings?.modelDir) throw new Error('Kokoro model directory not configured');

  const tts = await getPipeline(settings);
  const selectedVoice = voice || settings.defaultVoice;
  const outputDir = settings.outputDir || join(dataDir, 'audio');
  mkdirSync(outputDir, { recursive: true });

  const filename = `${id()}.wav`;
  const out = join(outputDir, filename);
  const audio = await tts.generate(text, { voice: selectedVoice });
  await audio.save(out);

  return { filename, public_url: `/assets/audio/${filename}`, mime_type: 'audio/wav' };
}

/**
 * Synthesize text via kokoro-js streaming, yielding one audio chunk per sentence.
 * Each chunk is saved to disk.
 */
export async function* synthesizeKokoroStream(
  text: string, settings: any, dataDir: string, voice?: string, speed = 1
): AsyncGenerator<{ filename: string; public_url: string; mime_type: string; text: string }> {
  if (!text?.trim()) throw new Error('Empty text');
  if (!settings?.modelDir) throw new Error('Kokoro model directory not configured');

  const tts = await getPipeline(settings);
  const selectedVoice = voice || settings.defaultVoice;
  const outputDir = settings.outputDir || join(dataDir, 'audio');
  mkdirSync(outputDir, { recursive: true });

  // Use TextSplitterStream explicitly and close it after pushing all text.
  // This works around a kokoro-js bug where passing a string directly causes
  // the stream to hang because the internal splitter is never closed.
  // See: https://github.com/hexgrad/kokoro/pull/327
  const { TextSplitterStream } = await import('kokoro-js');
  const splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice: selectedVoice, speed });
  splitter.push(text);
  splitter.close();

  let chunkCount = 0;
  try {
    for await (const chunk of stream) {
      const filename = `${id()}.wav`;
      const out = join(outputDir, filename);
      await chunk.audio.save(out);
      chunkCount++;
      yield { filename, public_url: `/assets/audio/${filename}`, mime_type: 'audio/wav', text: chunk.text };
    }
  } catch (streamError: any) {
    console.warn('[kokoro] stream error after', chunkCount, 'chunks:', streamError.message);
  }

  if (chunkCount === 0) {
    // Stream yielded nothing — fall back to full generate
    console.warn('[kokoro] stream yielded 0 chunks, falling back to generate');
    const result = await synthesizeKokoro(text, settings, dataDir, voice);
    yield result;
  }
}
