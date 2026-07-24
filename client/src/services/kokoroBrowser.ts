import { chunkForKokoro } from './text.ts';

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('../workers/kokoroWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

export function detectDevice(): 'wasm' | 'webgpu' {
  return (typeof navigator !== 'undefined' && 'gpu' in navigator) ? 'webgpu' : 'wasm';
}

/**
 * Synthesizes one chunk of text via the Kokoro worker.
 * Calls must be awaited sequentially — the worker processes one request at a time.
 */
export function synthesizeChunk(text: string, voice: string, dtype: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const onMessage = (event: MessageEvent) => {
      w.removeEventListener('message', onMessage);
      if (event.data?.type === 'result') resolve(event.data.wavBlob);
      else reject(new Error(event.data?.message || 'Kokoro synthesis failed'));
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'synthesize', text, voice, dtype, device: detectDevice() });
  });
}

export async function synthesizeMessage(content: string, voice: string, dtype: string): Promise<Blob[]> {
  const chunks = chunkForKokoro(content);
  const blobs: Blob[] = [];
  for (const chunk of chunks) blobs.push(await synthesizeChunk(chunk, voice, dtype));
  return blobs;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
