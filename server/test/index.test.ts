import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'supachat-test-'));
process.env.DB_PATH = join(tmp, 'test.sqlite');
process.env.DATA_DIR = tmp;

const { handle } = await import('../src/index');
const { repo, settings, audioDir } = await import('../src/index');
const { defaults } = await import('../src/config');

test('audioDir resolves to piper.outputDir by default', () => {
  expect(audioDir(settings())).toBe(defaults.piper.outputDir);
});

test('audioDir resolves to kokoro.outputDir when the kokoro engine is active', () => {
  repo.patchSettings({ tts: { enabled: true, engine: 'kokoro' }, kokoro: { ...defaults.kokoro, outputDir: '/tmp/kokoro-audio' } });
  expect(audioDir(settings())).toBe('/tmp/kokoro-audio');
});

test('tts/audio action dispatches to kokoro when tts.engine is kokoro', async () => {
  repo.patchSettings({ tts: { enabled: true, engine: 'kokoro' }, kokoro: { ...defaults.kokoro, modelDir: '' } });
  const conversation: any = repo.createConversation('dispatch-test');
  const agent: any = repo.createAgent(conversation.id, { name: 'Bot', kokoro_voice: 'af_heart' });
  const message: any = repo.addMessage(conversation.id, { role: 'assistant', speaker_type: 'agent', speaker_id: agent.id, speaker_name_snapshot: 'Bot', content: 'hi' });

  const res = await handle(new Request(`http://localhost/api/conversations/${conversation.id}/actions/tts`, {
    method: 'POST',
    body: JSON.stringify({ messageId: message.id })
  }));
  const body = await res.json();
  // generateAudioForAssistant silently returns when the model is not ready.
  expect(body.ok).toBe(true);
});

test('tts/audio action dispatches to piper when tts.engine is piper', async () => {
  repo.patchSettings({ tts: { enabled: true, engine: 'piper' }, piper: { ...defaults.piper } });
  const conversation: any = repo.createConversation('dispatch-test-2');
  const agent: any = repo.createAgent(conversation.id, { name: 'Bot', voice: 'en_GB-alan-medium' });
  const message: any = repo.addMessage(conversation.id, { role: 'assistant', speaker_type: 'agent', speaker_id: agent.id, speaker_name_snapshot: 'Bot', content: 'hi' });

  const res = await handle(new Request(`http://localhost/api/conversations/${conversation.id}/actions/tts`, {
    method: 'POST',
    body: JSON.stringify({ messageId: message.id })
  }));
  const body = await res.json();
  expect(body.error).toBe('Piper audio generation not implemented via action');
});

test('kokoroAudio action stores uploaded audio as an attachment', async () => {
  const conversation: any = repo.createConversation('kokoro-audio-test');
  const message: any = repo.addMessage(conversation.id, { role: 'assistant', speaker_type: 'agent', speaker_name_snapshot: 'Bot', content: 'hi' });
  const audioBase64 = Buffer.from('fake-wav-bytes').toString('base64');

  const res = await handle(new Request(`http://localhost/api/conversations/${conversation.id}/actions/kokoroAudio`, {
    method: 'POST',
    body: JSON.stringify({ messageId: message.id, voice: 'af_heart', mimeType: 'audio/wav', audioBase64 })
  }));
  const attachment = await res.json();

  expect(attachment.type).toBe('audio');
  expect(attachment.mime_type).toBe('audio/wav');
  expect(attachment.metadata.voice).toBe('af_heart');
  expect(attachment.public_url).toMatch(/^\/assets\/audio\/.+\.wav$/);
});

test('kokoroAudio action requires messageId, mimeType, and audioBase64', async () => {
  const conversation: any = repo.createConversation('kokoro-audio-validation');
  const res = await handle(new Request(`http://localhost/api/conversations/${conversation.id}/actions/kokoroAudio`, {
    method: 'POST',
    body: JSON.stringify({ voice: 'af_heart' })
  }));
  const body = await res.json();
  expect(body.error).toBe('messageId is required');
});

test('GET /assets/kokoro/... serves files from kokoro.modelDir', async () => {
  const modelDir = mkdtempSync(join(tmpdir(), 'kokoro-model-'));
  mkdirSync(join(modelDir, 'voices'), { recursive: true });
  writeFileSync(join(modelDir, 'voices', 'af_heart.bin'), 'fake-voice-data');
  repo.patchSettings({ kokoro: { ...defaults.kokoro, modelDir } });

  const res = await handle(new Request('http://localhost/assets/kokoro/voices/af_heart.bin'));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('fake-voice-data');

  rmSync(modelDir, { recursive: true, force: true });
});

test('GET /assets/kokoro/... returns 404 for a missing file', async () => {
  const res = await handle(new Request('http://localhost/assets/kokoro/voices/missing.bin'));
  expect(res.status).toBe(404);
});

test('GET /assets/kokoro rejects a path with no subpath', async () => {
  const res = await handle(new Request('http://localhost/assets/kokoro'));
  expect(res.status).toBe(400);
});
