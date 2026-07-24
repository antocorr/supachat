import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../src/db/schema';
import { Repo } from '../src/db/repo';
import { buildPrompt, buildMessages, chooseSpeaker } from '../src/services/speaker';

function repo() { const db = new Database(':memory:'); migrate(db); return new Repo(db); }

test('speaker selection, narrator prompt, buildMessages role mapping', () => {
  const r = repo();
  const c: any = r.createConversation('s');
  const a: any = r.createAgent(c.id, { name: 'A', introduction: 'a' });
  const n: any = r.createAgent(c.id, { name: 'Narrator', introduction: 'n', is_narrator: true });
  r.patchState(c.id, { forced_next_agent_id: n.id });
  expect(chooseSpeaker(r, c.id).id).toBe(n.id);
  expect(buildPrompt(n, null)).toContain('narrator');

  const msgs = [
    { kind: 'chat', role: 'user',      speaker_type: 'profile', speaker_id: null,  speaker_name_snapshot: 'User', content: 'hi' },
    { kind: 'chat', role: 'assistant', speaker_type: 'agent',   speaker_id: a.id,  speaker_name_snapshot: 'A',    content: 'yo' }
  ];
  const built = buildMessages(msgs, a, null);
  expect(built[0].role).toBe('system');
  expect(built[2].role).toBe('assistant'); // A's message
  expect(built[1].role).toBe('user');      // user message
});
