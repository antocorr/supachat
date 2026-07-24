import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync as mkdtemp, rmSync as removeDir } from 'node:fs';
import { tmpdir, tmpdir as osTmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults } from '../src/config';
import { downloadKokoroVoice, listKokoroVoices, synthesizeKokoro } from '../src/services/kokoro';

test('listKokoroVoices returns all 54 catalog voices marked as not installed when modelDir has no voices directory', () => {
  const modelDir = join(tmpdir(), 'kokoro-missing-' + Math.random().toString(36).slice(2));
  const result = listKokoroVoices({ modelDir });
  expect(result.modelDir).toBe(modelDir);
  expect(result.voices).toHaveLength(54);
  expect(result.voices.every(v => v.installed === false)).toBe(true);
  expect(result.languages).toEqual([
    'English (US)', 'English (UK)', 'Japanese', 'Chinese', 'Spanish', 'French', 'Hindi', 'Italian', 'Portuguese'
  ]);
});

test('listKokoroVoices marks catalog voices as installed when their .bin file exists, and formats labels with grades', () => {
  const modelDir = mkdtempSync(join(tmpdir(), 'kokoro-voices-'));
  const voicesDir = join(modelDir, 'voices');
  mkdirSync(voicesDir);
  for (const name of ['af_heart.bin', 'if_sara.bin', 'ef_dora.bin', 'notes.txt']) {
    writeFileSync(join(voicesDir, name), '');
  }

  const result = listKokoroVoices({ modelDir });

  const heart = result.voices.find(v => v.id === 'af_heart');
  expect(heart).toEqual({ id: 'af_heart', language: 'English (US)', name: 'Heart', grade: 'A', label: 'Heart (A)', installed: true });

  const sara = result.voices.find(v => v.id === 'if_sara');
  expect(sara?.installed).toBe(true);
  expect(sara?.label).toBe('Sara (C)');

  const dora = result.voices.find(v => v.id === 'ef_dora');
  expect(dora?.installed).toBe(true);
  expect(dora?.label).toBe('Dora');
  expect(dora?.grade).toBe('');

  const bella = result.voices.find(v => v.id === 'af_bella');
  expect(bella?.installed).toBe(false);

  rmSync(modelDir, { recursive: true, force: true });
});

test('downloadKokoroVoice rejects voice ids not in the catalog', async () => {
  const modelDir = mkdtempSync(join(tmpdir(), 'kokoro-download-'));
  await expect(downloadKokoroVoice({ modelDir }, 'xx_unknown')).rejects.toThrow('Unknown Kokoro voice');
  rmSync(modelDir, { recursive: true, force: true });
});

test('downloadKokoroVoice rejects when modelDir is not configured', async () => {
  await expect(downloadKokoroVoice({ modelDir: '' }, 'af_heart')).rejects.toThrow('Kokoro model directory not configured');
});

test('downloadKokoroVoice throws when the download response is not ok', async () => {
  const modelDir = mkdtempSync(join(tmpdir(), 'kokoro-download-'));
  const originalFetch = global.fetch;
  global.fetch = (async (_url: string) => new Response('not found', { status: 404 })) as typeof fetch;

  try {
    await expect(downloadKokoroVoice({ modelDir }, 'af_heart')).rejects.toThrow('404');
  } finally {
    global.fetch = originalFetch;
    rmSync(modelDir, { recursive: true, force: true });
  }
});

test('synthesizeKokoro rejects empty text', async () => {
  await expect(synthesizeKokoro('', defaults.kokoro, '/tmp', 'af_heart')).rejects.toThrow('Empty text');
});

test('synthesizeKokoro rejects text over maxTextLength', async () => {
  const longText = 'a'.repeat(defaults.kokoro.maxTextLength + 1);
  await expect(synthesizeKokoro(longText, defaults.kokoro, '/tmp', 'af_heart')).rejects.toThrow('Text too long');
});

test('synthesizeKokoro rejects when modelDir is not configured', async () => {
  await expect(synthesizeKokoro('Hello', { ...defaults.kokoro, modelDir: '' }, '/tmp', 'af_heart')).rejects.toThrow('Kokoro model directory not configured');
});

const hasModel = existsSync(join(defaults.kokoro.modelDir, 'onnx'));

test.skipIf(!hasModel)('synthesizeKokoro writes a wav file for a short sentence', async () => {
  const tmp = mkdtemp(join(osTmpdir(), 'kokoro-out-'));
  const result = await synthesizeKokoro('Hello from Kokoro.', { ...defaults.kokoro, outputDir: tmp }, tmp, defaults.kokoro.defaultVoice);
  expect(result.mime_type).toBe('audio/wav');
  expect(result.public_url).toBe(`/assets/audio/${result.filename}`);
  expect(existsSync(join(tmp, result.filename))).toBe(true);
  removeDir(tmp, { recursive: true, force: true });
});
