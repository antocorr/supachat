import type { Repo } from '../db/repo';
import { PromptBuilder } from '../lib/PromptBuilder';
import { PromptTemplates } from '../lib/PromptTemplates';
import type { Actor } from '../lib/Actor';
import type { Conversation } from '../lib/Conversation';
import { createMcpToolResult } from '../lib/ToolResult';

export function chooseSpeaker(repo: Repo, cid: string) {
  const state = repo.state(cid) as any;
  const agents = repo.agents(cid) as any[];
  if (!agents.length) return null;

  if (state.forced_next_agent_id) {
    const a = agents.find(x => x.id === state.forced_next_agent_id);
    if (a) {
      repo.patchState(cid, { forced_next_agent_id: null, last_speaker_agent_id: a.id });
      return a;
    }
  }

  const q = state.queue as string[];
  if (q?.length) {
    const [next, ...rest] = q;
    const a = agents.find(x => x.id === next);
    repo.patchState(cid, { queue: rest, last_speaker_agent_id: a?.id ?? state.last_speaker_agent_id });
    if (a) return a;
  }

  const eligible = agents.filter(a => a.auto_select !== false);
  const pool = (eligible.length > 1)
    ? eligible.filter(a => a.id !== state.last_speaker_agent_id)
    : eligible.length ? eligible : agents;
  const a = pool[Math.floor(Math.random() * pool.length)];
  repo.patchState(cid, { last_speaker_agent_id: a.id });
  return a;
}

export function buildPrompt(active: any, profile: any, options: { tools?: string[]; requiredTools?: string[]; kokoroVoice?: string; kokoroLanguage?: string; storyEntries?: any[] } = {}): string {
  const actor: Actor = {
    id: active?.id,
    name: active?.name ?? 'Unknown',
    introduction: active?.introduction ?? '',
    appearance: active?.appearance,
    voice: active?.voice,
    language: active?.language,
    is_narrator: active?.is_narrator,
    response_length: active?.response_length,
    kokoro_voice: active?.kokoro_voice,
  };

  const conversation: Conversation = {
    profile: profile || null,
    tools: options.tools,
    requiredTools: options.requiredTools,
    kokoroVoice: options.kokoroVoice,
    kokoroLanguage: options.kokoroLanguage,
    storyEntries: options.storyEntries,
  };

  const builder = new PromptBuilder(PromptTemplates);
  return builder.createPrompt(actor, conversation);
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
};
export type CompactionState = { compactedCount: number; llmSummary: string; pendingCount?: number };
export type PreparedMessages = {
  messages: ChatMessage[];
  estimatedTokens: number;
  needsCompaction: boolean;
  compaction: null | { previousSummary: string; deterministicSummary: string; targetCount: number };
};

function normalizeCompaction(value: any): CompactionState {
  return {
    compactedCount: Math.max(0, Number(value && value.compactedCount ? value.compactedCount : 0)),
    llmSummary: value && typeof value.llmSummary === 'string' ? value.llmSummary : '',
    pendingCount: Math.max(0, Number(value && value.pendingCount ? value.pendingCount : 0))
  };
}

function chatHistory(messages: any[]): any[] {
  return messages.filter(m => (m.kind === 'chat' || m.kind === 'dice_roll' || m.kind === 'tool') && typeof m.content === 'string' && m.content.trim());
}

// Agents flagged isNarrator get a "(narrator)" suffix on their speaker name in the
// history, so every agent's system prompt can teach how to interpret it (see NARRATOR_FACT_RULES).
function narratorSuffix(m: any, agents: any[]): string {
  const agent = m.speaker_id ? agents.find(a => a.id === m.speaker_id) : null;
  return agent?.is_narrator ? ' (narrator)' : '';
}

function speakerName(m: any, agents: any[] = []): string {
  const base = m.speaker_name_snapshot || (m.role === 'user' ? 'User' : 'Other');
  return base + narratorSuffix(m, agents);
}

function diceToolResultContent(m: any): string | null {
  try {
    const diceData = JSON.parse(m.content);
    const toolCallId = String(diceData.toolCallId || '');
    delete diceData.toolCallId;
    return JSON.stringify(createMcpToolResult(toolCallId, diceData));
  } catch {
    return null;
  }
}

function deterministicSummary(messages: any[], agents: any[] = []): string {
  const lines: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const diceResult = m.kind === 'dice_roll' ? diceToolResultContent(m) : null;
    if (diceResult) lines.push(`[tool result]: ${diceResult}`);
    else lines.push(`[${speakerName(m, agents)}]: ${String(m.content).replace(/\s+/g, ' ').trim()}`);
  }
  return lines.join('\n');
}

function mapChatMessage(m: any, active: any, profile?: any, agents: any[] = []): ChatMessage {
  if (m.kind === 'tool') return { role: 'user', content: m.content };
  if (m.kind === 'dice_roll') {
    const result = diceToolResultContent(m);
    if (result) return { role: 'user', content: result };
  }

  const isActive =
    m.role === 'assistant' &&
    (m.speaker_id === active.id || m.speaker_name_snapshot === active.name);

  if (isActive) return { role: 'assistant', content: m.content };

  // Prefix every non-active message with the speaker's name so the model knows who said what
  const name = m.speaker_name_snapshot ?? (m.role === 'user' ? profile?.name ?? 'User' : 'Other');
  const content = `[${name}${narratorSuffix(m, agents)}]: ${m.content}`;

  return { role: 'user', content };
}

function estimateTokens(messages: ChatMessage[], charsPerToken: number): number {
  const safeCharsPerToken = charsPerToken > 0 ? charsPerToken : 4;
  return Math.ceil(JSON.stringify(messages).length / safeCharsPerToken);
}

function compactContextMessage(llmSummary: string, deterministic: string): ChatMessage | null {
  const parts: string[] = [];
  if (llmSummary.trim()) parts.push(`Conversation memory:\n${llmSummary.trim()}`);
  if (deterministic.trim()) parts.push(`Recent conversation lines:\n${deterministic.trim()}`);
  return parts.length ? { role: 'user', content: parts.join('\n\n') } : null;
}

function buildWithContext(instruction: string, chat: any[], active: any, coveredCount: number, llmSummary: string, deterministic: string, profile?: any, agents: any[] = []): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: instruction }];
  const context = compactContextMessage(llmSummary, deterministic);
  if (context) messages.push(context);
  for (let i = coveredCount; i < chat.length; i++) messages.push(mapChatMessage(chat[i], active, profile, agents));
  return messages;
}

/**
 * Build a proper multi-turn message array for Ollama chat.
 * - System prompt first
 * - Each message mapped to the right role:
 *   - assistant if it was spoken by `active` (matched by id OR name as fallback)
 *   - user otherwise; other agents' lines are prefixed with their name so the
 *     model knows who said what (same pattern as chatbot.mjs)
 */
export function buildMessages(messages: any[], active: any, profile: any, options: { tools?: string[]; requiredTools?: string[]; agents?: any[]; kokoroVoice?: string; kokoroLanguage?: string; storyEntries?: any[] } = {}): ChatMessage[] {
  return prepareMessages(messages, active, profile, options).messages;
}

export function prepareMessages(messages: any[], active: any, profile: any, options: { tools?: string[]; requiredTools?: string[]; compaction?: any; numCtx?: number; compactionThreshold?: number; compactionCharsPerToken?: number; agents?: any[]; kokoroVoice?: string; kokoroLanguage?: string; storyEntries?: any[] } = {}): PreparedMessages {
  const instruction = buildPrompt(active, profile, options);
  const chat = chatHistory(messages);
  const agents = options.agents || [];
  const compaction = normalizeCompaction(options.compaction);
  const compactedCount = Math.min(compaction.compactedCount, chat.length);
  const pendingCount = Math.min(Math.max(compaction.pendingCount || 0, compactedCount), chat.length);
  const pendingSummary = pendingCount > compactedCount ? deterministicSummary(chat.slice(compactedCount, pendingCount), agents) : '';
  const coveredCount = pendingCount > compactedCount ? pendingCount : compactedCount;
  const baseMessages = buildWithContext(instruction, chat, active, coveredCount, compaction.llmSummary, pendingSummary, profile, agents);
  const charsPerToken = options.compactionCharsPerToken || 4;
  const estimatedTokens = estimateTokens(baseMessages, charsPerToken);
  const numCtx = options.numCtx || 24000;
  const threshold = options.compactionThreshold || 0.4;

  if (estimatedTokens <= numCtx * threshold || pendingCount > compactedCount) {
    return { messages: baseMessages, estimatedTokens, needsCompaction: false, compaction: null };
  }

  const targetCount = Math.max(compactedCount, chat.length - 1);
  if (targetCount <= compactedCount) {
    return { messages: baseMessages, estimatedTokens, needsCompaction: true, compaction: null };
  }

  const gapSummary = deterministicSummary(chat.slice(0, targetCount), agents);
  const compactMessages = buildWithContext(instruction, chat, active, targetCount, compaction.llmSummary, gapSummary, profile, agents);

  return {
    messages: compactMessages,
    estimatedTokens: estimateTokens(compactMessages, charsPerToken),
    needsCompaction: true,
    compaction: { previousSummary: compaction.llmSummary, deterministicSummary: gapSummary, targetCount }
  };
}
