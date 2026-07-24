import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { id } from '../db/database';

type Logger = (tag: string, msg: string, data?: unknown) => void;
let _log: Logger = () => {};
export function setDrawThingsLogger(fn: Logger) { _log = fn; }

// --- Queue: serialise image generation (DrawThings is single-instance heavy) ---
type _QueueTask<T = any> = () => Promise<T>;
const _queue: _QueueTask[] = [];
let _processing = false;

function _enqueue<T>(fn: _QueueTask<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    _queue.push(async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
    });
    if (!_processing) {
      _processQueue();
    }
  });
}

async function _processQueue() {
  _processing = true;
  //delay 3s
  await new Promise((resolve) => setTimeout(resolve, 3000));
  while (_queue.length > 0) {
    const task = _queue.shift()!;
    await task();
  }
  _processing = false;
}

export const DEFAULT_DRAW_THINGS_MODELS_DIR = process.env.DRAW_THINGS_MODELS_DIR || resolve(homedir(), 'Library/Containers/com.liuliu.draw-things/Data/Documents/Models');

const MODEL_EXTENSIONS = new Set(['.ckpt', '.safetensors', '.pt', '.pth', '.bin', '.gguf']);

/**
 * Reads installed models from the local Draw Things Models directory.
 * Returns at least `[]` if the path is missing.
 * @param {string} modelsDir
 * @returns {{ id: string, name: string, filename: string, size: number }[]}
 */
export function listDrawThingsModels(modelsDir: string) {
  let entries;
  try {
    entries = readdirSync(modelsDir);
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const dot = entry.lastIndexOf('.');
    if (dot <= 0) continue;
    const ext = entry.slice(dot).toLowerCase();
    if (!MODEL_EXTENSIONS.has(ext)) continue;
    const filePath = join(modelsDir, entry);
    let size = 0;
    try {
      size = statSync(filePath).size;
    } catch {
      size = 0;
    }
    out.push({ id: entry, name: entry, filename: entry, size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function probeDrawThings(baseUrl: string, modelsDir: string) {
  const out: any = { ok: false, models: null, samplers: null, options: null, filesystemModels: null, modelsDir };
  const response = await fetch(`${baseUrl}/sdapi/v1/options`);
  if (!response.ok) throw new Error(`options probe failed ${response.status}`);
  out.options = await response.json();
  out.filesystemModels = listDrawThingsModels(modelsDir);
  out.ok = true;
  return out;
}

export async function generateImage(
  baseUrl: string,
  dataDir: string,
  payload: {
    prompt: string;
    width: number;
    height: number;
    timeoutMs: number;
    model?: string;
    sampler?: string;
    steps?: number;
    cfgScale?: number;
    textGuidance?: number;
    negativePrompt?: string;
  }
) {
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), payload.timeoutMs);
  try {
    return await _enqueue(async () => {
      const body: any = {
        prompt: payload.prompt,
        width: Number(payload.width),
        height: Number(payload.height),
        batch_size: 1
      };

      if (payload.negativePrompt) body.negative_prompt = payload.negativePrompt;
      if (payload.steps) body.steps = Number(payload.steps);
      // Draw Things treats cfg_scale and guidance_scale as aliases; send only one.
      // Prefer the explicit Text guidance setting; keep cfgScale as legacy fallback.
      if (payload.textGuidance != null) body.guidance_scale = Number(payload.textGuidance);
      else if (payload.cfgScale != null) body.cfg_scale = Number(payload.cfgScale);
      if (payload.sampler) body.sampler_name = payload.sampler;
      if (payload.model) body.model = payload.model;

      _log('drawthings', 'txt2img_request', { url: `${baseUrl}/sdapi/v1/txt2img`, body });

      const response = await fetch(`${baseUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        _log('drawthings', 'txt2img_error', { status: response.status, text: text.slice(0, 1000) });
        throw new Error(`txt2img failed ${response.status}: ${text.slice(0, 1000)} payload=${JSON.stringify(body)}`);
      }

      const json: any = await response.json();
      const firstImage = json.images && json.images[0] ? json.images[0] : '';
      if (!firstImage) throw new Error('txt2img returned no image');

      mkdirSync(join(dataDir, 'images'), { recursive: true });
      const filename = `${id()}.png`;
      writeFileSync(
        join(dataDir, 'images', filename),
        Buffer.from(firstImage.replace(/^data:image\/png;base64,/, ''), 'base64')
      );
      _log('drawthings', 'txt2img_response', { status: response.status, filename, model: payload.model || null });
      return { filename, public_url: `/assets/images/${filename}`, mime_type: 'image/png' };
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      _log('drawthings', 'txt2img_error', { status: 'timeout', timeoutMs: payload.timeoutMs });
      throw new Error(`txt2img timed out after ${payload.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
