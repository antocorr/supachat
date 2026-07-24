/// <reference lib="webworker" />

import { env } from '@huggingface/transformers';

type KokoroDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

let ttsPromise: Promise<any> | null = null;

/**
 * Convert RWAudio/Float32Array to WAV blob with proper header.
 * Manual conversion (not RawAudio.toBlob()) because in a cross-realm worker
 * context the class methods may not survive the structured clone round-trip.
 */
function audioToWavBlob(audio: { audio: Float32Array; sampling_rate: number }): Blob {
  const numSamples = audio.audio.length;
  const sampleRate = audio.sampling_rate;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, audio.audio[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function getTts(dtype: KokoroDtype, device: 'wasm' | 'webgpu') {
  if (!ttsPromise) {
    // ── Serve model files from the local server ──
    const origin = self.location.origin;
    env.localModelPath = origin + '/models/';
    env.allowLocalModels = true;
    env.allowRemoteModels = false;

    // ── Intercept voice requests to HuggingFace, serve from local /voices/ ──
    const origFetch = globalThis.fetch.bind(globalThis);
    const VOICE_RE = /^https?:\/\/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/main\/voices\/([^/]+\.bin)/;
    globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
      const match = url.match(VOICE_RE);
      if (match) {
        return origFetch(origin + '/voices/' + match[1], init as RequestInit);
      }
      return origFetch(input, init as RequestInit);
    } as typeof globalThis.fetch;

    const { KokoroTTS } = await import('kokoro-js');
    ttsPromise = KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype, device });
  }
  return ttsPromise;
}

self.onmessage = async (event: MessageEvent) => {
  const { type, text, voice, dtype, device } = event.data || {};
  if (type !== 'synthesize') return;

  try {
    const tts = await getTts((dtype || 'q4') as KokoroDtype, device || 'wasm');
    const audio: { audio: Float32Array; sampling_rate: number } = await tts.generate(text, { voice });
    const wavBlob = audioToWavBlob(audio);
    self.postMessage({ type: 'result', wavBlob });
  } catch (error: any) {
    console.error('[kokoroWorker] synthesis error:', error);
    self.postMessage({ type: 'error', message: error?.message || String(error) });
  }
};
