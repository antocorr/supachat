import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../src/db/schema';
import { Repo } from '../src/db/repo';
import { runCommand } from '../src/services/commands';

function repo() { const db = new Database(':memory:'); migrate(db); return new Repo(db); }

test('slash commands cover required semantics', () => {
  const r = repo();
  const c: any = r.createConversation('cmd');
  expect(runCommand(r, c.id, '/achar Alice hello')?.result.name).toBe('Alice');
  expect((runCommand(r, c.id, '/lschar')?.result as any[]).length).toBe(1);
  expect(runCommand(r, c.id, '/iam Me user')?.result.name).toBe('Me');
  expect(runCommand(r, c.id, '/to Alice')?.result.forced_next_agent_id).toBeTruthy();
  expect(runCommand(r, c.id, '/next')?.result.name).toBe('Alice');
  const impersonated: any = runCommand(r, c.id, '/impersonate Alice I am speaking as Alice')?.result;
  expect(impersonated.role).toBe('assistant');
  expect(impersonated.speaker_type).toBe('agent');
  expect(impersonated.speaker_name_snapshot).toBe('Alice');
  expect(impersonated.content).toBe('I am speaking as Alice');
  expect(runCommand(r, c.id, '/auto on')?.result.auto_mode).toBe(true);
  expect(runCommand(r, c.id, '/to Alice')?.result.forced_next_agent_id).toBeTruthy();
  const stopped: any = runCommand(r, c.id, '/stop')?.result;
  expect(stopped.auto_mode).toBe(false);
  expect(stopped.forced_next_agent_id).toBeNull();
  expect(runCommand(r, c.id, '/flush')?.result.flushed).toBe(true);
  expect(runCommand(r, c.id, '/restore')?.error).toContain('No legacy snapshot');
  expect(runCommand(r, c.id, '/bye')?.result.status).toBe('archived');
  expect(runCommand(r, c.id, '/rchar Alice')?.result.deleted).toBe(true);
});
