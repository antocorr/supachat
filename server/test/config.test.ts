import { expect, test } from 'bun:test';
import { defaults, mergeSettings } from '../src/config';

test('mergeSettings derives tts from piper.enabled when tts is absent', () => {
  const merged = mergeSettings({ piper: { enabled: true, voiceDir: '/custom/voices' } });
  expect(merged.tts).toEqual({ enabled: true, engine: 'piper' });
  expect(merged.piper.voiceDir).toBe('/custom/voices');
  expect(merged.kokoro.dtype).toBe(defaults.kokoro.dtype);
});

test('mergeSettings preserves an existing tts setting', () => {
  const merged = mergeSettings({ tts: { enabled: true, engine: 'kokoro' }, piper: { enabled: false } });
  expect(merged.tts).toEqual({ enabled: true, engine: 'kokoro' });
});

test('mergeSettings fills in kokoro defaults for unset fields', () => {
  const merged = mergeSettings({ kokoro: { dtype: 'q4' } });
  expect(merged.kokoro.dtype).toBe('q4');
  expect(merged.kokoro.modelDir).toBe(defaults.kokoro.modelDir);
  expect(merged.kokoro.mode).toBe('server');
});

test('mergeSettings keeps ai/drawThings fall-through behavior', () => {
  const merged = mergeSettings({});
  expect(merged.ai).toEqual(defaults.ai);
  expect(merged.drawThings).toEqual(defaults.drawThings);
});
