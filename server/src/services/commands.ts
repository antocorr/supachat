import type { Repo } from '../db/repo';
import { chooseSpeaker } from './speaker';

export function parseCommand(input: string) {
  if (!input.startsWith('/')) return null;
  const [name, ...rest] = input.trim().split(/\s+/);
  return { name: name.slice(1), args: rest, rawArgs: input.trim().slice(name.length).trim() };
}

function findAgent(agents: any[], target: string) {
  const normalized = target.trim().toLowerCase();
  return agents.find(x => x.id === target || x.name.toLowerCase() === normalized) || null;
}

function parseAgentAndText(agents: any[], rawArgs: string) {
  const input = rawArgs.trim();
  if (!input) return { agent: null, text: '' };

  // Prefer exact id prefix.
  for (const agent of agents) {
    if (input === agent.id || input.startsWith(`${agent.id} `)) {
      return { agent, text: input.slice(agent.id.length).trim() };
    }
  }

  // Then longest case-insensitive name prefix, so names with spaces work.
  const byName = [...agents].sort((a, b) => b.name.length - a.name.length);
  const lower = input.toLowerCase();
  for (const agent of byName) {
    const name = agent.name.toLowerCase();
    if (lower === name || lower.startsWith(`${name} `)) {
      return { agent, text: input.slice(agent.name.length).trim() };
    }
  }

  return { agent: null, text: '' };
}

export async function runCommand(
  repo: Repo, cid: string, input: string,
  dirs?: {audioDir:string,imageDir:string},
  encryption?: { encryptIf: (pw: string, data: string) => Promise<string>; decryptIf: (pw: string, data: string) => Promise<string>; convoPassword: (cid: string) => string | null }
) {
  const c = parseCommand(input);
  if (!c) return null;

  switch (c.name) {
    case 'bye':
      return { command: 'bye', result: repo.patchConversation(cid, { status: 'archived' }) };
    case 'restore':
      return { command: 'restore', error: 'No legacy snapshot is configured or uploaded; restore did not mutate state' };
    case 'flush':
      return { command: 'flush', result: repo.flush(cid, dirs) };
    case 'next':
      return { command: 'next', result: chooseSpeaker(repo, cid) };
    case 'to': {
      const target = c.rawArgs.toLowerCase();
      const a = (repo.agents(cid) as any[]).find(x => x.id === c.rawArgs || x.name.toLowerCase() === target);
      if (!a) return { command: 'to', error: 'Agent not found' };
      return { command: 'to', result: repo.patchState(cid, { forced_next_agent_id: a.id }) };
    }
    case 'impersonate': {
      const agents = repo.agents(cid) as any[];
      const { agent, text } = parseAgentAndText(agents, c.rawArgs);
      if (!agent || !text) return { command: 'impersonate', error: 'Usage: /impersonate <agent id-or-name> <message>' };
      const pw = encryption?.convoPassword(cid);
      const storedContent = pw ? await encryption!.encryptIf(pw, text) : text;
      const message = repo.addMessage(cid, {
        kind: 'chat',
        role: 'assistant',
        speaker_type: 'agent',
        speaker_id: agent.id,
        speaker_name_snapshot: agent.name,
        content: storedContent
      });
      return { command: 'impersonate', result: { ...message, content: text, rendered_content: text } };
    }
    case 'auto': {
      const on = c.args[0] === 'on' || c.args[0] === 'true' || c.args[0] === '1';
      return { command: 'auto', result: repo.patchState(cid, { auto_mode: on }) };
    }
    case 'stop':
      return { command: 'stop', result: repo.patchState(cid, { auto_mode: false, forced_next_agent_id: null }) };
    case 'lschar':
      return { command: 'lschar', result: repo.agents(cid) };
    case 'achar': {
      const [name, ...intro] = c.args;
      if (!name) return { command: 'achar', error: 'Usage: /achar name introduction' };
      const introText = intro.join(' ');
      const pw = encryption?.convoPassword(cid);
      const ename = pw ? await encryption!.encryptIf(pw, name) : name;
      const eintro = pw ? await encryption!.encryptIf(pw, introText) : introText;
      const agent = repo.createAgent(cid, { name: ename, introduction: eintro }) as any;
      if (pw && agent) {
        agent.name = await encryption!.decryptIf(pw, agent.name);
        agent.introduction = await encryption!.decryptIf(pw, agent.introduction);
      }
      return { command: 'achar', result: agent };
    }
    case 'iam': {
      const [name, ...intro] = c.args;
      if (!name) return { command: 'iam', error: 'Usage: /iam name introduction' };
      const introText = intro.join(' ');
      const pw = encryption?.convoPassword(cid);
      const ename = pw ? await encryption!.encryptIf(pw, name) : name;
      const eintro = pw ? await encryption!.encryptIf(pw, introText) : introText;
      const p = repo.createProfile(cid, { name: ename, introduction: eintro }) as any;
      repo.patchState(cid, { active_profile_id: p.id });
      if (pw && p) {
        p.name = await encryption!.decryptIf(pw, p.name);
        p.introduction = await encryption!.decryptIf(pw, p.introduction);
      }
      return { command: 'iam', result: p };
    }
    case 'rchar': {
      const target = c.rawArgs.toLowerCase();
      const a = (repo.agents(cid) as any[]).find(x => x.id === c.rawArgs || x.name.toLowerCase() === target);
      if (!a) return { command: 'rchar', error: 'Agent not found' };
      return { command: 'rchar', result: repo.deleteAgent(cid, a.id) };
    }
    case 'allow-tool': {
      const toolName = c.args[0];
      if (!toolName) return { command: 'allow-tool', error: 'Usage: /allow-tool <toolName>' };
      const state = repo.state(cid) as any;
      const current: string[] = state?.allowed_tools || [];
      const next = current.includes(toolName) ? current : [...current, toolName];
      return { command: 'allow-tool', result: repo.patchState(cid, { allowed_tools: next }) };
    }
    default:
      return { command: c.name, error: 'Unknown command' };
  }
}
