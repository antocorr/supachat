import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { config, defaults, mergeSettings } from './config';
import { id, openDb } from './db/database';
import { Repo } from './db/repo';
import { chatOllama, listOllamaModels, setOllamaLogger, setLastPromptFile } from './ai/ollama';
import { runCommand, parseCommand } from './services/commands';
import { listDrawThingsModels, probeDrawThings, setDrawThingsLogger } from './services/drawThings';
import type { EventClient, EventName } from './services/events';
import { publish, setEventStore, stream, subscribeEvents, unsubscribeEvents } from './services/events';
import { chooseSpeaker, prepareMessages } from './services/speaker';
import { LastMessageBuilder } from './lib/LastMessageBuilder';
import { LastMessageTemplates } from './lib/LastMessageTemplates';
import { listVoices, synthesizePiper, splitSentences } from './services/piper';
import { downloadKokoroVoice, isKokoroModelReady, listKokoroVoices, synthesizeKokoro, synthesizeKokoroStream, KOKORO_VOICE_CATALOG } from './services/kokoro';
import { chunkForKokoro } from './services/text';
import { runTool, setRegistryLogger } from './tools/registry';
import { bool, fail, HttpError, json, ok, str } from './validation';
import { decodeRpcMessage } from '../../packages/rpcable/src/RpcAble';
import { encrypt, decrypt, encryptIf, decryptIf, createVerifier, verifyPassword, encryptFile, decryptFile } from './services/crypto';
import { passwordManager } from './services/passwordManager';
import { createMcpToolResult } from './lib/ToolResult';

// ---------------------------------------------------------------------------
// Config & singletons
// ---------------------------------------------------------------------------
export const cfg = config();
export const repo = new Repo(openDb(cfg.dbPath));
mkdirSync(cfg.dataDir, { recursive: true });
const logFile = join(cfg.dataDir, 'supachat.log');
const lastPromptFile = join(cfg.dataDir, 'last_prompt.json');

const _tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
function localTs() { return new Date().toLocaleString('sv-SE', { timeZone: _tz }); }

// Buffered log: batches writes to reduce I/O pressure on the event loop.
// Flushes every 200ms or every 20 lines, whichever comes first.
const logBuffer: string[] = [];
let logTimer: ReturnType<typeof setInterval> | null = null;

function flushLog() {
  if (logBuffer.length === 0) return;
  const lines = logBuffer.splice(0);
  appendFileSync(logFile, lines.join(''));
}

function ensureLogTimer() {
  if (logTimer) return;
  logTimer = setInterval(() => {
    flushLog();
    if (logBuffer.length === 0 && logTimer) {
      clearInterval(logTimer);
      logTimer = null;
    }
  }, 200);
}

// Pending user interactions (e.g. dice rolls awaiting user click)
const pendingInteractions = new Map<string, any>();
const pendingAudioGenerations = new Map<string, Promise<void>>();

export function taggedLog(tag: string, message: string, data?: unknown) {
  const safeTag = tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'app';
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
  logBuffer.push(`${localTs()} [${safeTag}] ${message}${suffix}\n`);
  if (logBuffer.length >= 20) flushLog();
  else ensureLogTimer();
}


function jsonReplacer(_key: string, value: unknown) {
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  return value;
}

export async function readLogLines() {
  try {
    const text = await Bun.file(logFile).text();
    return text.trim().split('\n').slice(-200);
  } catch {
    return [];
  }
}

setEventStore({
  save: (conversationId, name, data) => repo.addEvent(conversationId, name, data),
  load: (conversationId, since) => repo.eventsSince(conversationId, since) as any
});
setOllamaLogger(taggedLog);
setLastPromptFile(lastPromptFile);
setDrawThingsLogger(taggedLog);
setRegistryLogger(taggedLog);

const savedSettings = repo.settings();
repo.patchSettings({
  ...mergeSettings(savedSettings, defaults),
  dataDir: savedSettings.dataDir || cfg.dataDir
});

export function settings() {
  return { ...repo.settings(), dataDir: cfg.dataDir };
}

export function audioDir(current: ReturnType<typeof settings>) {
  return current.tts.engine === 'kokoro' ? current.kokoro.outputDir : current.piper.outputDir;
}

export function clearMessageAudio(conversationId: string, messageId: string) {
  const attachments = repo.deleteAudioAttachments(conversationId, messageId);
  const directory = audioDir(settings()) || join(cfg.dataDir, 'audio');
  for (const attachment of attachments) {
    try { unlinkSync(join(directory, attachment.filename)); } catch {}
  }
  taggedLog('audio', 'generation_replaced', { conversationId, messageId, deleted: attachments.length });
  return { deleted: attachments.length };
}

// Give WebSocket clients time to request a newly published WAV before the
// next CPU-heavy synthesis step monopolizes this Bun process.
const AUDIO_DELIVERY_GRACE_MS = 50;
async function allowAudioDelivery() {
  await Bun.sleep(AUDIO_DELIVERY_GRACE_MS);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export const RPC_CHANNEL = '-userSession';
export const clientDir = join(import.meta.dir, '../../client/dist');

export function resolveThinkingMode(...values: any[]) {
  for (const value of values) {
    if (value === 'active' || value === 'inactive') return value;
  }
  return 'inactive';
}

export function disableThinkingSource(conversationId: string, active: any, state: any, ai: any): boolean {
  if (active?.thinking_mode === 'active') {
    repo.patchState(conversationId, { selected_thinking_mode: 'inactive' });
    return true;
  }
  if (state?.selected_thinking_mode === 'active') {
    repo.patchState(conversationId, { selected_thinking_mode: 'inactive' });
    return true;
  }
  if (ai?.thinkingMode === 'active') {
    repo.patchSettings({ ai: { ...ai, thinkingMode: 'inactive' } });
    return true;
  }
  return false;
}

export function normalizeAttachment(attachment: any) {
  if (!attachment) return attachment;
  return {
    id: attachment.id,
    type: attachment.type,
    mime_type: attachment.mime_type,
    filename: attachment.filename,
    public_url: attachment.public_url,
    size_bytes: attachment.size_bytes,
    metadata: attachment.metadata || {},
    created_at: attachment.created_at
  };
}

export function nextGenerationTurnId(conversationId: string, messageId: string): number {
  const turnId = Date.now();
  taggedLog('server', 'generation_turn', { conversationId, messageId, turnId });
  return turnId;
}

export function messageForEvent(message: any) {
  if (!message) return message;
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sequence: message.sequence,
    kind: message.kind,
    role: message.role,
    speaker_type: message.speaker_type,
    speaker_id: message.speaker_id,
    speaker_name_snapshot: message.speaker_name_snapshot,
    content: message.content,
    rendered_content: message.rendered_content,
    attachments: (message.attachments || []).map(normalizeAttachment),
    created_at: message.created_at
  };
}

export function aiNumCtx(ai: any) {
  return typeof ai.numCtx === 'number' && ai.numCtx > 0 ? ai.numCtx : defaults.ai.numCtx;
}

export function compactionThreshold(ai: any) {
  return typeof ai.compactionThreshold === 'number' && ai.compactionThreshold > 0
    ? Math.min(ai.compactionThreshold, 1) : defaults.ai.compactionThreshold;
}

export function compactionCharsPerToken(ai: any) {
  return typeof ai.compactionCharsPerToken === 'number' && ai.compactionCharsPerToken > 0
    ? ai.compactionCharsPerToken : defaults.ai.compactionCharsPerToken;
}

function compactState(value: any) {
  if (!value) return { compactedCount: 0, llmSummary: '', pendingCount: 0 };
  return {
    compactedCount: value.compactedCount || 0,
    llmSummary: value.llmSummary || '',
    pendingCount: value.pendingCount || 0
  };
}

function compactionPrompt(previousSummary: string, deterministicSummary: string) {
  let prompt = 'Compress the following conversation into a concise summary that captures all key information, decisions, and context needed to continue seamlessly.';
  if (previousSummary) prompt += `\n\nPrevious summary (build upon this, don't repeat unnecessarily):\n${previousSummary}`;
  if (deterministicSummary) prompt += `\n\nAdditional context to preserve:\n${deterministicSummary}`;
  prompt += '\n\nConversation:\n';
  return prompt;
}

// ---------------------------------------------------------------------------
// Compaction
// ---------------------------------------------------------------------------
function scheduleCompaction(
  conversationId: string, model: string, ai: any,
  current: any, request: { previousSummary: string; deterministicSummary: string; targetCount: number }
) {
  queueMicrotask(async () => {
    try {
      await compactConversationMemory(conversationId, model, ai, request);
    } catch (error: any) {
      taggedLog('server', 'compaction_error', { conversationId, message: error.message || String(error) });
    }
  });
}

async function compactConversationMemory(
  conversationId: string, model: string, ai: any,
  request: { previousSummary: string; deterministicSummary: string; targetCount: number }
) {
  if (!request.targetCount) return;
  const rawMessages = repo.messages(conversationId) as any[];
  if (rawMessages.length <= request.targetCount) return;

  const systemMsg: any = { role: 'system', content: 'You are a summarization assistant.' };
  const chunks: any[][] = [];
  let current: any[] = [];

  for (const msg of rawMessages.slice(0, -request.targetCount)) {
    current.push(msg);
    if (current.length >= 10) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);

  if (!chunks.length) return;

  const prompt = compactionPrompt(request.previousSummary, request.deterministicSummary);
  for (const chunk of chunks) {
    const textChunk = chunk.map((m: any) => `${m.role}: ${m.content || ''}`).join('\n');
    try {
      const response = await chatOllama(
        [systemMsg, { role: 'user', content: prompt + textChunk }],
        { baseUrl: ai.ollamaBaseUrl || defaults.ai.ollamaBaseUrl, model, tools: [], numCtx: aiNumCtx(ai), maxTokens: 2048 }
      );
      request.previousSummary = (response.message && response.message.content) || '';
    } catch {
      // partial compaction is better than none
    }
  }

  // Delete compacted messages
  const compactCount = chunks.flat().length;
  const ids = rawMessages.slice(0, compactCount).map((m: any) => m.id);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    repo.db.query(`DELETE FROM attachments WHERE message_id IN (${ph})`).run(...ids);
    repo.db.query(`DELETE FROM messages WHERE id IN (${ph})`).run(...ids);
  }

  repo.patchState(conversationId, {
    compaction: { compactedCount: compactCount, llmSummary: request.previousSummary, pendingCount: 0 }
  });

  taggedLog('server', 'compaction_done', { conversationId, compactedCount: compactCount });
}

// ---------------------------------------------------------------------------
// Auto-continuation scheduler
// ---------------------------------------------------------------------------
const autoContinuations = new Set<string>();

function waitForNextTurn() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function scheduleAutoContinuation(conversationId: string) {
  if (autoContinuations.has(conversationId)) return;
  autoContinuations.add(conversationId);

  queueMicrotask(async () => {
    try {
      while (true) {
        await waitForNextTurn();
        const state = repo.state(conversationId) as any;
        if (!state?.auto_mode) return;

        const conversation = repo.getConversation(conversationId) as any;
        if (!conversation) return;

        const profileId = conversation.state?.active_profile_id;
        const profile = profileId ? (repo.profiles(conversationId) as any[]).find(item => item.id === profileId) : null;
        const next = chooseSpeaker(repo, conversationId) as any;
        if (!next) return;

        await generateAssistantMessage(conversationId, next, profile);
      }
    } catch (error: any) {
      taggedLog('server', 'auto_continuation_error', { conversationId, message: error.message || String(error) });
    } finally {
      autoContinuations.delete(conversationId);
    }
  });
}

// ---------------------------------------------------------------------------
// Message generation
// ---------------------------------------------------------------------------
export async function createMessageFromBody(conversationId: string, body: any, triggerGeneration = true) {
  const content = str(body.content, 'content', { required: true, max: 20000 });
  taggedLog('server', 'message_create', { conversationId });

  // Check if message is a command
  const cmd = parseCommand(String(content));
  if (cmd) {
    return await runCommand(repo, conversationId, String(content),
      { audioDir: audioDir(settings()) || join(cfg.dataDir, 'audio'), imageDir: join(cfg.dataDir, 'images') },
      { encryptIf, decryptIf, convoPassword });
  }

  const conversation = repo.getConversation(conversationId) as any;
  const profileId = conversation && conversation.state ? conversation.state.active_profile_id : null;
  const profile = profileId ? (repo.profiles(conversationId) as any[]).find((item: any) => item.id === profileId) : null;

  // Handle encryption: store encrypted, publish cleartext
  const pw = convoPassword(conversationId);
  let storedContent = content;
  let publishContent = content;

  if (pw) {
    const decrypted = await decryptIf(pw, content);
    if (decrypted !== content) {
      publishContent = decrypted;
      storedContent = content;
    } else {
      storedContent = await encryptIf(pw, content);
      publishContent = content;
    }
    if (profile) {
      profile.name = await decryptIf(pw, profile.name);
      profile.introduction = await decryptIf(pw, profile.introduction);
      profile.appearance = profile.appearance ? await decryptIf(pw, profile.appearance) : profile.appearance;
    }
  }

  const userMessage = repo.addMessage(conversationId, {
    role: 'user',
    speaker_type: 'profile',
    speaker_id: profile ? profile.id : null,
    speaker_name_snapshot: profile ? profile.name : 'User',
    content: storedContent
  }) as any;

  publish(conversationId, 'message_start', {
    message_id: userMessage.id, role: 'user',
    message: messageForEvent({ ...userMessage, content: publishContent })
  });
  publish(conversationId, 'message_done', {
    message_id: userMessage.id, content: publishContent,
    message: messageForEvent({ ...userMessage, content: publishContent })
  });

  if (triggerGeneration) {
    const next = chooseSpeaker(repo, conversationId) as any;
    if (next) {
      generateAssistantMessage(conversationId, next, profile).catch((error: any) => {
        publish(conversationId, 'error', { message: error.message || String(error) });
      });
    }
  }

  return messageForEvent({ ...userMessage, content: publishContent });
}

export async function generateAssistantMessage(conversationId: string, active: any, profile: any, retryCount = 0, toolContinuations: any[] = []) {
  const ai = settings().ai || defaults.ai;
  const conversation = repo.getConversation(conversationId) as any;
  const state = conversation && conversation.state ? conversation.state : {};
  const selectedModel = active.selected_model || state.selected_model || ai.model || defaults.ai.model;
  const selectedToolMode = state.selected_tool_mode || ai.toolMode || defaults.ai.toolMode;
  const selectedThinkingMode = resolveThinkingMode(active.thinking_mode, state.selected_thinking_mode, ai.thinkingMode || defaults.ai.thinkingMode);
  const numCtx = aiNumCtx(ai);

  const genPw = convoPassword(conversationId);

  if (genPw) {
    active.name = await decryptIf(genPw, active.name);
    active.introduction = await decryptIf(genPw, active.introduction);
    active.appearance = active.appearance ? await decryptIf(genPw, active.appearance) : active.appearance;
    if (profile) {
      profile.name = await decryptIf(genPw, profile.name);
      profile.introduction = await decryptIf(genPw, profile.introduction);
      profile.appearance = profile.appearance ? await decryptIf(genPw, profile.appearance) : profile.appearance;
    }
  }

  const agentTools: Record<string, boolean | string> = active.tools || { imagen: true, narrate: false };
  const allowedThisRound: string[] = state.allowed_tools || [];
  const activeTools = (Object.keys(agentTools).filter(t => agentTools[t]) as string[])
    .concat(allowedThisRound.filter(t => !agentTools[t]));
  const requiredTools = Object.keys(agentTools).filter(t => agentTools[t] === 'required') as string[];

  if (allowedThisRound.length) repo.patchState(conversationId, { allowed_tools: [] });

  taggedLog('server', 'assistant_generate', {
    conversationId, agent: active.name, model: selectedModel, toolMode: selectedToolMode,
    thinkingMode: selectedThinkingMode, activeTools, requiredTools
  });

  const rawMessages = repo.messages(conversationId) as any[];
  if (genPw) {
    await Promise.all(rawMessages.map(async (msg) => {
      msg.content = await decryptIf(genPw, msg.content);
      if (msg.rendered_content) msg.rendered_content = await decryptIf(genPw, msg.rendered_content);
      msg.speaker_name_snapshot = await decryptIf(genPw, msg.speaker_name_snapshot);
    }));
  }
  const storyEntries = repo.storyEntries(conversationId) as any[];

  const resolvedKokoroLang = settings().tts.engine === 'kokoro'
    ? (KOKORO_VOICE_CATALOG.find(v => v.id === (active.kokoro_voice || settings().kokoro.defaultVoice))?.language || undefined)
    : undefined;
  const resolvedLang = resolvedKokoroLang || active?.language || 'en';

  const prepared = prepareMessages(rawMessages, active, profile, {
    tools: activeTools as any,
    requiredTools,
    compaction: state.compaction,
    numCtx,
    compactionThreshold: compactionThreshold(ai),
    compactionCharsPerToken: compactionCharsPerToken(ai),
    agents: repo.agents(conversationId) as any[],
    kokoroVoice: settings().tts.engine === 'kokoro' ? (active.kokoro_voice || settings().kokoro.defaultVoice) : undefined,
    kokoroLanguage: resolvedLang,
    storyEntries
  });
  const messages = prepared.messages;
  if (prepared.compaction) scheduleCompaction(conversationId, selectedModel, ai, state.compaction, prepared.compaction);

  const lastMsgActor = {
    name: active?.name ?? 'Unknown',
    is_narrator: active?.is_narrator,
    language: active?.language,
  };
  const lastMsgBuilder = new LastMessageBuilder(LastMessageTemplates);
  if (toolContinuations.length && selectedToolMode === 'native') {
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: toolContinuations.map(tool => ({ function: { name: tool.name, arguments: tool.arguments } }))
    });
    toolContinuations.forEach(tool => {
      messages.push({ role: 'tool', tool_name: tool.name, content: JSON.stringify(tool.result) });
    });
  } else {
    messages.push({ role: 'user', content: lastMsgBuilder.buildMessage(lastMsgActor, { storyEntries, kokoroLanguage: resolvedLang }) });
  }

  taggedLog('ollama', 'full_prompt', { messages });

  const message = repo.addMessage(conversationId, {
    role: 'assistant',
    speaker_type: 'agent',
    speaker_id: active.id,
    speaker_name_snapshot: active.name,
    content: ''
  }) as any;

  publish(conversationId, 'message_start', {
    message_id: message.id,
    role: 'assistant',
    speaker_name_snapshot: active.name,
    message: messageForEvent({ ...message, attachments: [] })
  });

  let content = '';
  const chatOllamaObject = {
    baseUrl: ai.ollamaBaseUrl || defaults.ai.ollamaBaseUrl,
    model: selectedModel,
    toolMode: selectedToolMode,
    think: selectedThinkingMode === 'active',
    tools: activeTools as any,
    requiredTools,
    numCtx,
    temperature: ai.temperature ?? 0.8,
    publish: (data: any, chunk: any) => {
      if (data.type === 'token') {
        content += data.content;
        publish(conversationId, 'token', { content: data.content, message_id: message.id });
      }
      if (data.type === 'done') {
        publish(conversationId, 'message_done', {
          message_id: message.id,
          content: data.content || content,
          token_usage: data.token_usage,
          eval_duration: data.eval_duration
        });
      }
      if (data.type === 'tool_call') {
        publish(conversationId, 'tool_call', { ...data, message_id: message.id });
      }
      if (data.type === 'error') {
        publish(conversationId, 'error', { message: data.message, message_id: message.id });
      }
    },
    onTokenUsage: (usage: any) => {
      publish(conversationId, 'token_usage', { ...usage, message_id: message.id });
    }
  };

  try {
    const response = await chatOllama(messages, chatOllamaObject);

    if (response?.message?.content) {
      content = response.message.content;
    }

    const newMessageContent = genPw ? await encryptIf(genPw, content) : content;
    repo.updateMessageContent(message.id, newMessageContent);

    // Publish message_done so the client knows generation finished
    publish(conversationId, 'message_done', {
      message_id: message.id,
      content: content,
      token_usage: response ? {
        prompt_tokens: (response as any).promptTokens,
        completion_tokens: (response as any).completionTokens
      } : undefined
    });

    const turnId = nextGenerationTurnId(conversationId, message.id);

    // Generate audio if available and not a narrator.
    // Skip server-side generation when Kokoro runs in the browser.
    const s = settings();
    if (s.tts?.enabled && active.audio_enabled !== false) {
      if (s.tts.engine === 'kokoro' && s.kokoro?.mode === 'browser') {
        taggedLog('server', 'audio_skip_browser_mode', { conversationId, messageId: message.id });
      } else {
        taggedLog('audio', 'generation_queued', {
          conversationId,
          messageId: message.id,
          generationTurnId: turnId,
          engine: s.tts.engine,
          contentLength: content.length
        });
        generateAudioForAssistant(conversationId, message.id, content, active).catch(error => {
          taggedLog('server', 'audio_generate_error', { conversationId, messageId: message.id, error: error.message || String(error) });
        });
      }
    }

    // Run tools if any
    if (response?.message?.tool_calls?.length) {
      const completedToolContinuations: any[] = [];
      const pendingRollIds: string[] = [];
      for (let toolIndex = 0; toolIndex < response.message.tool_calls.length; toolIndex += 1) {
        const toolCall = response.message.tool_calls[toolIndex];
        const callerToolCallId = toolCall.id || `${turnId}-${toolIndex}-${toolCall.function.name}`;
        try {
          const result = await runTool(toolCall.function.name, toolCall.function.arguments, {
            conversationId,
            messageId: message.id,
            publish,
            taggedLog,
            repo,
            settings,
            audioDir,
            cfg,
            passwordManager,
            encryptIf,
            decryptIf,
            KOKORO_VOICE_CATALOG,
            synthesizeKokoro,
            synthesizePiper,
            splitSentences,
            isKokoroModelReady,
            chunkForKokoro,
            generateAudioForAssistant,
            id,
            defaults,
            RPC_CHANNEL,
            _isEncrypted: !!genPw,
            genPw,
            onAttachmentCreated: async (attachment: any) => {
              const imgPw = convoPassword(conversationId);
              if (imgPw && attachment?.filename) {
                try {
                  const imgPath = join(cfg.dataDir, 'images', attachment.filename);
                  const imgBuf = readFileSync(imgPath);
                  writeFileSync(imgPath, await encryptFile(imgBuf, imgPw));
                } catch (e: any) {
                  taggedLog('server', 'encrypt_image_error', { filename: attachment.filename, error: e.message });
                }
              }
            },
          });
          const isPending = result && typeof result === 'object' && result.status === 'pending_user_interaction';

          if (isPending) {
            // Persist both ids: the UI resolves with the roll id, while the model
            // must receive its original tool-call id when the roll is complete.
            const pendingResult = { ...result, callerToolCallId };
            repo.toolEvent(conversationId, {
              message_id: message.id,
              tool_call_id: callerToolCallId,
              tool_name: 'request_dice_roll',
              state: 'succeeded',
              arguments: {
                target: result.target,
                type: result.type,
                challengeValue: result.challengeValue,
                sign: result.sign,
                public_reason: result.publicReason,
                private_reason: result.privateReason
              },
              result: pendingResult
            });
            // Do NOT publish tool_result or continue generation yet.
            pendingRollIds.push(result.toolCallId);
            pendingInteractions.set(result.toolCallId, {
              conversationId,
              messageId: message.id,
              active,
              profile,
              retryCount,
              turnId,
              callerToolCallId,
              // Store all dice roll metadata from the result
              type: result.type,
              challengeValue: result.challengeValue,
              sign: result.sign,
              target: result.target,
              speakerName: result.speakerName,
              publicReason: result.publicReason,
              privateReason: result.privateReason
            });
          } else {
            const toolResult = createMcpToolResult(callerToolCallId, result);
            const toolResultContent = JSON.stringify(toolResult);
            repo.addMessage(conversationId, {
              kind: 'tool',
              role: 'tool',
              speaker_type: 'tool',
              speaker_name_snapshot: toolCall.function.name,
              content: toolResultContent
            });
            publish(conversationId, 'tool_result', { tool_call_id: callerToolCallId, content: toolResultContent, message_id: message.id });
            completedToolContinuations.push({ name: toolCall.function.name, arguments: toolCall.function.arguments, result: toolResult });
          }
        } catch (error: any) {
          const toolResult = createMcpToolResult(callerToolCallId, { error: error.message || String(error) }, true);
          const toolResultContent = JSON.stringify(toolResult);
          repo.addMessage(conversationId, {
            kind: 'tool',
            role: 'tool',
            speaker_type: 'tool',
            speaker_name_snapshot: toolCall.function.name,
            content: toolResultContent
          });
          publish(conversationId, 'tool_result', { tool_call_id: callerToolCallId, content: toolResultContent, message_id: message.id });
          completedToolContinuations.push({ name: toolCall.function.name, arguments: toolCall.function.arguments, result: toolResult });
        }
      }

      pendingRollIds.forEach(rollId => {
        const pending = pendingInteractions.get(rollId);
        if (pending) pending.priorToolContinuations = completedToolContinuations;
      });

      // Check if ANY tool is pending user interaction
      const hasPendingInteraction = Array.from(pendingInteractions.values()).some(p => p.conversationId === conversationId);
      if (hasPendingInteraction) {
        taggedLog('server', 'pending_user_interaction', { conversationId });
        return;
      }

      // Native tool calling follows Ollama's assistant-tool-call → tool-result loop.
      if (selectedToolMode === 'native' && completedToolContinuations.length) {
        void resumeToolGeneration(conversationId, active, profile, retryCount, completedToolContinuations);
        return;
      }

      // After running tools, only re-trigger if someone explicitly chose the next speaker
      const stateAfterTools = repo.state(conversationId) as any;
      if (stateAfterTools?.forced_next_agent_id) {
        const nextActive = (repo.agents(conversationId) as any[]).find(a => a.id === stateAfterTools.forced_next_agent_id) || active;
        generateAssistantMessage(conversationId, nextActive, profile, retryCount + 1).catch(error => {
          publish(conversationId, 'error', { message: error.message || String(error) });
        });
      } else if (stateAfterTools?.auto_mode) {
        scheduleAutoContinuation(conversationId);
      }
      return;
    }

    // After generation completes, check if auto-mode should continue
    const stateAfter = repo.state(conversationId) as any;
    if (stateAfter?.auto_mode) {
      scheduleAutoContinuation(conversationId);
    }
  } catch (error: any) {
    const errMsg = error.message || String(error);

    if (errMsg.includes('does not support thinking') && retryCount < 5) {
      disableThinkingSource(conversationId, active, state, ai);
      repo.updateMessageContent(message.id, '');
      repo.deleteMessage(conversationId, message.id);
      publish(conversationId, 'message_deleted', { message_id: message.id });
      await generateAssistantMessage(conversationId, active, profile, retryCount + 1);
      return;
    }

    publish(conversationId, 'error', { message: errMsg, message_id: message.id });

    // Re-encrypt if needed
    if (genPw && content) {
      repo.updateMessageContent(message.id, await encryptIf(genPw, content));
    }
  }
}

async function generateAudioForAssistantRun(conversationId: string, messageId: string, content: string, agent?: any) {
  const ttsSettings = settings().tts;
  if (!ttsSettings?.enabled) return;
  const engine = ttsSettings.engine || 'piper';
  const piperCfg = settings().piper;
  const kokoroCfg = settings().kokoro;
  const ad = audioDir(settings());

  if (engine === 'piper' && !agent) {
    taggedLog('server', 'audio_skip_no_agent', { conversationId, messageId });
    return;
  }

  const genPw = convoPassword(conversationId);
  const startedAt = Date.now();
  let chunksSent = 0;
  taggedLog('audio', 'generation_started', {
    conversationId,
    messageId,
    engine,
    contentLength: content.length
  });

  if (engine === 'piper') {
    const voice = agent?.voice || '';
    if (!voice) {
      if (piperCfg?.defaultVoice) {
        taggedLog('server', 'audio_fallback_default_voice', { conversationId, messageId, defaultVoice: piperCfg.defaultVoice });
      } else {
        taggedLog('server', 'audio_skip_no_voice', { conversationId, messageId });
        return;
      }
    }
    const blocks = splitSentences(content, agent?.speed || 1, agent?.language);
    const total = blocks.length;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]!;
      try {
        const audioData = await synthesizePiper(block.text, voice || piperCfg.defaultVoice, agent?.speed || 1, piperCfg);
        const filename = `${id()}.wav`;
        const absolutePath = join(ad, filename);
        writeFileSync(absolutePath, audioData);

        const attachment = repo.addAttachment(conversationId, {
          message_id: messageId,
          type: 'audio',
          mime_type: 'audio/wav',
          filename,
          public_url: `/assets/audio/${filename}`,
          size_bytes: audioData.length,
          metadata: { sequence: i, total, text: block.text, duration: block.duration }
        }) as any;

        let finalUrl = `/assets/audio/${filename}`;
        if (genPw) {
          const encryptedFile = await encryptFile(audioData, genPw);
          writeFileSync(absolutePath, encryptedFile);
        }

        publish(conversationId, 'audio_ready', {
          message_id: messageId,
          attachment: {
            ...normalizeAttachment(attachment),
            public_url: finalUrl,
            metadata: { sequence: i, total, text: block.text, duration: block.duration }
          },
          sequence: i,
          total
        });
        chunksSent++;
        taggedLog('audio', 'chunk_sent', { conversationId, messageId, engine, sequence: i, total });
        await allowAudioDelivery();
      } catch (error: any) {
        taggedLog('server', 'audio_chunk_error', { conversationId, messageId, index: i, error: error.message || String(error) });
      }
    }
  } else if (engine === 'kokoro') {
    if (!kokoroCfg || !isKokoroModelReady(kokoroCfg)) {
      taggedLog('server', 'audio_skip_kokoro_not_ready', { conversationId, messageId });
      return;
    }

    const outputMode = kokoroCfg.outputMode || 'full';
    const voice = agent?.kokoro_voice || kokoroCfg.defaultVoice;
    const speed = agent?.speed || 1;

    try {
      if (outputMode === 'stream') {
        // Kokoro-js native streaming — splits by sentence internally
        // Collect all chunks first so we know total, then publish
        const streamChunks: Array<{ result: any; fileSize: number }> = [];
        for await (const result of synthesizeKokoroStream(content, kokoroCfg, ad, voice, speed)) {
          const fileSize = statSync(join(ad, result.filename)).size;
          streamChunks.push({ result, fileSize });
        }
        const streamTotal = streamChunks.length;
        for (let i = 0; i < streamChunks.length; i++) {
          const { result, fileSize } = streamChunks[i];
          const metaData = { sequence: i, total: streamTotal, text: result.text };
          const attachment = repo.addAttachment(conversationId, {
            message_id: messageId,
            type: 'audio',
            mime_type: result.mime_type,
            filename: result.filename,
            public_url: result.public_url,
            size_bytes: fileSize,
            metadata: metaData
          }) as any;

          let finalUrl = result.public_url;
          if (genPw) {
            const fileBuf = readFileSync(join(ad, result.filename));
            const encryptedFile = await encryptFile(fileBuf, genPw);
            writeFileSync(join(ad, result.filename), encryptedFile);
          }

          // repo.addAttachment returns raw row (metadata_json as string, not parsed),
          // so reconstruct the attachment with parsed metadata for the event.
          publish(conversationId, 'audio_ready', {
            message_id: messageId,
            attachment: {
              ...normalizeAttachment(attachment),
              public_url: finalUrl,
              metadata: metaData
            },
            sequence: i,
            total: streamTotal
          });
          chunksSent++;
          taggedLog('audio', 'chunk_sent', { conversationId, messageId, engine, sequence: i, total: streamTotal });
          await allowAudioDelivery();
        }
      } else if (outputMode === 'chunk') {
        // Manual sentence-split chunking
        const maxChars = kokoroCfg.maxChunkChars || 400;
        const blocks = chunkForKokoro(content, maxChars);
        const total = blocks.length;

        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          const result = await synthesizeKokoro(block, kokoroCfg, ad, voice);
          if (!result) {
            taggedLog('server', 'audio_kokoro_empty_chunk', { conversationId, messageId, index: i });
            continue;
          }

          const chunkMeta = { sequence: i, total, text: block };
          const fileSize = statSync(join(ad, result.filename)).size;
          const attachment = repo.addAttachment(conversationId, {
            message_id: messageId,
            type: 'audio',
            mime_type: result.mime_type,
            filename: result.filename,
            public_url: result.public_url,
            size_bytes: fileSize,
            metadata: chunkMeta
          }) as any;

          let finalUrl = result.public_url;
          if (genPw) {
            const fileBuf = readFileSync(join(ad, result.filename));
            const encryptedFile = await encryptFile(fileBuf, genPw);
            writeFileSync(join(ad, result.filename), encryptedFile);
          }

          publish(conversationId, 'audio_ready', {
            message_id: messageId,
            attachment: {
              ...normalizeAttachment(attachment),
              public_url: finalUrl,
              metadata: chunkMeta
            },
            sequence: i,
            total
          });
          chunksSent++;
          taggedLog('audio', 'chunk_sent', { conversationId, messageId, engine, sequence: i, total });
          await allowAudioDelivery();
        }
      } else {
        // Default: 'full' — single shot, best quality.
        // Auto-fallback to chunked when text exceeds the ~510 IPA phoneme limit.
        // kokoro-js's tokenizer truncates silently past that, corrupting the audio.
        const MAX_FULL_CHARS = 200;
        if (content.length <= MAX_FULL_CHARS) {
          const result = await synthesizeKokoro(content, kokoroCfg, ad, voice);
          if (!result) {
            taggedLog('server', 'audio_empty_kokoro', { conversationId, messageId });
            return;
          }
          const fullMeta = { sequence: 0, total: 1 };
          const fileSize = statSync(join(ad, result.filename)).size;
          const attachment = repo.addAttachment(conversationId, {
            message_id: messageId,
            type: 'audio',
            mime_type: result.mime_type,
            filename: result.filename,
            public_url: result.public_url,
            size_bytes: fileSize,
            metadata: fullMeta
          }) as any;

          let finalUrl = result.public_url;
          if (genPw) {
            const fileBuf = readFileSync(join(ad, result.filename));
            const encryptedFile = await encryptFile(fileBuf, genPw);
            writeFileSync(join(ad, result.filename), encryptedFile);
          }

          publish(conversationId, 'audio_ready', {
            message_id: messageId,
            attachment: {
              ...normalizeAttachment(attachment),
              public_url: finalUrl,
              metadata: fullMeta
            },
            sequence: 0,
            total: 1
          });
          chunksSent++;
          taggedLog('audio', 'chunk_sent', { conversationId, messageId, engine, sequence: 0, total: 1 });
          await allowAudioDelivery();
        } else {
          // Long text: chunk to stay under kokoro-js's phoneme limit
          const maxChars = kokoroCfg.maxChunkChars || 160;
          const blocks = chunkForKokoro(content, maxChars);
          const total = blocks.length;

          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const result = await synthesizeKokoro(block!, kokoroCfg, ad, voice);
            if (!result) {
              taggedLog('server', 'audio_kokoro_empty_chunk', { conversationId, messageId, index: i });
              continue;
            }

            const chunkMeta = { sequence: i, total, text: block! };
            const fileSize = statSync(join(ad, result.filename)).size;
            const attachment = repo.addAttachment(conversationId, {
              message_id: messageId,
              type: 'audio',
              mime_type: result.mime_type,
              filename: result.filename,
              public_url: result.public_url,
              size_bytes: fileSize,
              metadata: chunkMeta
            }) as any;

            let finalUrl = result.public_url;
            if (genPw) {
              const fileBuf = readFileSync(join(ad, result.filename));
              const encryptedFile = await encryptFile(fileBuf, genPw);
              writeFileSync(join(ad, result.filename), encryptedFile);
            }

            publish(conversationId, 'audio_ready', {
              message_id: messageId,
              attachment: {
                ...normalizeAttachment(attachment),
                public_url: finalUrl,
                metadata: chunkMeta
              },
              sequence: i,
              total
            });
            chunksSent++;
            taggedLog('audio', 'chunk_sent', { conversationId, messageId, engine, sequence: i, total });
            await allowAudioDelivery();
          }
        }
      }
    } catch (error: any) {
      taggedLog('audio', 'generation_failed', { conversationId, messageId, engine, chunksSent, durationMs: Date.now() - startedAt, error: error.message || String(error) });
      taggedLog('server', 'audio_kokoro_error', { conversationId, messageId, error: error.message || String(error) });
      throw error;
    }
  }

  taggedLog('audio', 'generation_finished', { conversationId, messageId, engine, chunksSent, durationMs: Date.now() - startedAt });
}

export async function generateAudioForAssistant(conversationId: string, messageId: string, content: string, agent?: any) {
  const key = `${conversationId}:${messageId}`;
  const pending = pendingAudioGenerations.get(key);
  if (pending) {
    taggedLog('audio', 'generation_skipped_pending', { conversationId, messageId });
    return await pending;
  }

  clearMessageAudio(conversationId, messageId);
  const generation = generateAudioForAssistantRun(conversationId, messageId, content, agent);
  pendingAudioGenerations.set(key, generation);

  try {
    publish(conversationId, 'audio_pending', { message_id: messageId });
    await generation;
    publish(conversationId, 'audio_complete', { message_id: messageId });
  } catch (error: any) {
    publish(conversationId, 'audio_failed', { message_id: messageId, error: error.message || String(error) });
    throw error;
  } finally {
    pendingAudioGenerations.delete(key);
  }
}

export async function runActionFromBody(conversationId: string, action: string, body: any = {}) {
  taggedLog('server', 'action', { conversationId, action });

  if (action === 'flush') {
    invalidatePendingDiceRolls(conversationId);
    const result = repo.flush(conversationId, {
      audioDir: audioDir(settings()) || join(cfg.dataDir, 'audio'),
      imageDir: join(cfg.dataDir, 'images')
    });
    repo.patchState(conversationId, { compaction: { compactedCount: 0, llmSummary: '', pendingCount: 0 } });
    return result;
  }
  if (action === 'resetCompaction') {
    repo.patchState(conversationId, { compaction: { compactedCount: 0, llmSummary: '', pendingCount: 0 } });
    publish(conversationId, 'state_changed', { reason: 'compaction_reset', conversation: repo.getConversation(conversationId), state: repo.state(conversationId) });
    return { reset: true };
  }
  if (action === 'bye') {
    const conversation = repo.patchConversation(conversationId, { status: 'archived' });
    publish(conversationId, 'state_changed', { reason: 'conversation_updated', conversation, state: repo.state(conversationId) });
    return conversation;
  }
  if (action === 'auto') {
    const state = repo.patchState(conversationId, { auto_mode: bool(body.enabled) });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'stop') {
    const state = repo.patchState(conversationId, { auto_mode: false, forced_next_agent_id: null });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'audioAutoPlay') {
    const state = repo.patchState(conversationId, { audio_auto_play: bool(body.enabled) });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'model') {
    const model = str(body.model, 'model');
    const state = repo.patchState(conversationId, { selected_model: model || null });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'toolMode') {
    const state = repo.patchState(conversationId, { selected_tool_mode: str(body.toolMode, 'toolMode', { required: true }) });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'thinkingMode') {
    const state = repo.patchState(conversationId, { selected_thinking_mode: str(body.thinkingMode, 'thinkingMode', { required: true }) });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'next') {
    const conversation = repo.getConversation(conversationId) as any;
    const profileId = conversation && conversation.state ? conversation.state.active_profile_id : null;
    const profile = profileId ? (repo.profiles(conversationId) as any[]).find((item: any) => item.id === profileId) : null;
    const active = chooseSpeaker(repo, conversationId) as any;
    if (active) generateAssistantMessage(conversationId, active, profile).catch((error: any) => publish(conversationId, 'error', { message: error.message || String(error) }));
    return { queued: Boolean(active), agent: active };
  }
  if (action === 'to') {
    const state = repo.patchState(conversationId, { forced_next_agent_id: str(body.agentId, 'agentId', { required: true }) });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'iam') {
    const state = repo.patchState(conversationId, { active_profile_id: str(body.profileId, 'profileId', { required: true }) });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'drawThings') {
    const payload: any = {};
    if (body.promptPrepend != null) payload.promptPrepend = String(body.promptPrepend);
    if (body.promptAppend != null) payload.promptAppend = String(body.promptAppend);
    const state = repo.patchState(conversationId, { drawThings: payload });
    publish(conversationId, 'state_changed', { reason: 'state_updated', state });
    return state;
  }
  if (action === 'clearAudio') {
    return clearMessageAudio(conversationId, str(body.messageId, 'messageId', { required: true }));
  }
  if (action === 'tts' || action === 'audio') {
    const current = settings();
    const engine = current.tts.engine;
    const messages = repo.messages(conversationId) as any[];
    const message = messages.find((item: any) => item.id === body.messageId);
    let content = message ? message.content : '';
    const audioPw = convoPassword(conversationId);

    // Handle encryption: if this is an encrypted conversation, decrypt the content
    if (audioPw) {
      const decrypted = await decryptIf(audioPw, content);
      if (decrypted !== content) content = decrypted;
    }

    if (!content) throw new Error('Message not found');

    if (engine === 'kokoro') {
      try {
        // Get the agent's voice for this message
        const agent = message?.speaker_id ? (repo.agents(conversationId) as any[]).find((a: any) => a.id === message.speaker_id) : undefined;
        await generateAudioForAssistant(conversationId, body.messageId, content, agent);
        return { ok: true, messageId: body.messageId };
      } catch (error: any) {
        throw new Error('Audio generation failed: ' + (error.message || String(error)));
      }
    } else {
      // Piper — use from settings
      throw new Error('Piper audio generation not implemented via action');
    }
  }

  if (action === 'add-message') {
    return await createMessageFromBody(conversationId, body, false);
  }
  if (action === 'generate') {
    const conversation = repo.getConversation(conversationId) as any;
    if (!conversation) throw new Error('Conversation not found');
    const state = conversation.state || {};
    const profileId = state.active_profile_id;
    const profile = profileId ? (repo.profiles(conversationId) as any[]).find((p: any) => p.id === profileId) : null;
    const speakerId = body.speaker_id || state.last_speaker_agent_id || null;
    const active = speakerId
      ? (repo.agents(conversationId) as any[]).find((a: any) => a.id === speakerId)
      : chooseSpeaker(repo, conversationId) as any;
    if (!active) throw new Error('No speaker selected');
    generateAssistantMessage(conversationId, active, profile).catch((error: any) => publish(conversationId, 'error', { message: error.message || String(error) }));
    return { ok: true };
  }
  if (action === 'regenerate') {
    const messageId = str(body.message_id, 'message_id', { required: true });
    const msgs = repo.messages(conversationId) as any[];
    const target = msgs.find((m: any) => m.id === messageId);
    if (!target) throw new Error('Message not found');
    invalidatePendingDiceRolls(conversationId, [messageId]);
    repo.deleteMessage(conversationId, messageId);
    publish(conversationId, 'message_deleted', { message_id: messageId });
    if (target.role === 'assistant' && target.speaker_id) {
      const conv = repo.getConversation(conversationId) as any;
      const st = conv?.state || {};
      const pid = st.active_profile_id;
      const prof = pid ? (repo.profiles(conversationId) as any[]).find((p: any) => p.id === pid) : null;
      const agent = (repo.agents(conversationId) as any[]).find((a: any) => a.id === target.speaker_id);
      if (agent) generateAssistantMessage(conversationId, agent, prof).catch((e: any) => publish(conversationId, 'error', { message: e.message || String(e) }));
    }
    return { deleted: true };
  }
  if (action === 'approve-tool') {
    const toolCallId = str(body.tool_call_id, 'tool_call_id', { required: true });
    repo.db.query('UPDATE tool_events SET state=? WHERE conversation_id=? AND tool_call_id=?')
      .run('approved', conversationId, toolCallId);
    return { ok: true };
  }

  if (action === 'kokoroAudio') {
    const messageId = str(body.messageId, 'messageId', { required: true });
    const mimeType = str(body.mimeType, 'mimeType', { required: true });
    const audioBase64 = str(body.audioBase64, 'audioBase64', { required: true });
    const voice = str(body.voice, 'voice') || '';
    const sequence = typeof body.sequence === 'number' ? body.sequence : 0;
    const total = typeof body.total === 'number' ? body.total : 1;
    const generationTurnId = typeof body.generationTurnId === 'number' ? body.generationTurnId : undefined;

    const ad = audioDir(settings()) || join(cfg.dataDir, 'audio');
    mkdirSync(ad, { recursive: true });

    const filename = `${id()}.wav`;
    const absolutePath = join(ad, filename);
    const audioData = Buffer.from(audioBase64, 'base64');
    writeFileSync(absolutePath, audioData);

    const metaData: Record<string, unknown> = { voice, sequence, total };
    if (generationTurnId !== undefined) metaData.generationTurnId = generationTurnId;

    const attachment = repo.addAttachment(conversationId, {
      message_id: messageId,
      type: 'audio',
      mime_type: mimeType,
      filename,
      public_url: `/assets/audio/${filename}`,
      size_bytes: audioData.length,
      metadata: metaData
    }) as any;

    let finalUrl = `/assets/audio/${filename}`;
    const audioPw = convoPassword(conversationId);
    if (audioPw) {
      const encryptedFile = await encryptFile(audioData, audioPw);
      writeFileSync(absolutePath, encryptedFile);
    }

    publish(conversationId, 'audio_ready', {
      message_id: messageId,
      attachment: {
        ...normalizeAttachment(attachment),
        public_url: finalUrl,
        metadata: metaData
      },
      sequence,
      total
    });

    return { ...normalizeAttachment(attachment), public_url: finalUrl, metadata: metaData };
  }

  throw new Error(`Unknown action: ${action}`);
}

// ---------------------------------------------------------------------------
// Dice roll (user-interactive)
// ---------------------------------------------------------------------------
function diceSides(type: string) {
  return { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 }[type] || 0;
}

async function resumeToolGeneration(conversationId: string, active: any, profile: any, retryCount: number, toolContinuations: any[]) {
  try {
    await generateAssistantMessage(conversationId, active, profile, retryCount, toolContinuations);
  } catch (error: any) {
    publish(conversationId, 'error', { message: error.message || String(error) });
  }
}

function computeDiceOutcome(type: string, value: number, challengeValue: number, sign: string) {
  let success = false;
  switch (sign) {
    case '>':  success = value > challengeValue; break;
    case '<':  success = value < challengeValue; break;
    case '>=': success = value >= challengeValue; break;
    case '<=': success = value <= challengeValue; break;
    case '=':  success = value === challengeValue; break;
    default:   success = value >= challengeValue;
  }
  return { success, description: success ? 'Success' : 'Failure' };
}

/**
 * Called by the client after the user clicks/spins the dice.
 * Completes the pending dice roll: saves the message, publishes tool_result,
 * and continues the generation so the model gets the roll outcome.
 */
export async function getPendingDiceRoll(conversationId: string) {
  // Check in-memory first
  for (const interaction of pendingInteractions) {
    const toolCallId = interaction[0];
    const pending = interaction[1];
    if (pending.conversationId === conversationId) {
      return { toolCallId, type: pending.type, challengeValue: pending.challengeValue, sign: pending.sign, target: pending.target, speakerName: pending.speakerName, publicReason: pending.publicReason };
    }
  }
  // Fall back to tool_events DB (use message_id to match conversation context)
  const te = repo.db.query("SELECT tool_call_id, message_id, result_json FROM tool_events WHERE conversation_id=? AND tool_call_id != '' AND tool_name='request_dice_roll' AND state='succeeded' AND json_extract(result_json, '$.status')='pending_user_interaction' ORDER BY created_at DESC LIMIT 1").get(conversationId) as any;
  if (te) {
    try {
      const data = JSON.parse(te.result_json || '{}');
      if (data.status === 'pending_user_interaction') {
        return { toolCallId: data.toolCallId, type: data.type, challengeValue: data.challengeValue, sign: data.sign, target: data.target, speakerName: data.speakerName, publicReason: data.publicReason, messageId: te.message_id };
      }
    } catch {}
  }
  return null;
}

export function invalidatePendingDiceRolls(conversationId: string, messageIds?: string[]) {
  const invalidateAll = messageIds === undefined;
  if (!invalidateAll && !messageIds.length) return;
  const messageIdSet = new Set(messageIds || []);
  const cancelledRollIds = new Set<string>();

  for (const interaction of pendingInteractions) {
    const toolCallId = interaction[0];
    const pending = interaction[1];
    if (pending.conversationId === conversationId && (invalidateAll || messageIdSet.has(pending.messageId))) {
      pendingInteractions.delete(toolCallId);
      cancelledRollIds.add(toolCallId);
    }
  }

  const rows = invalidateAll
    ? repo.cancelAllPendingDiceRolls(conversationId)
    : repo.cancelPendingDiceRolls(conversationId, messageIds || []);
  for (let i = 0; i < rows.length; i += 1) {
    const data = JSON.parse(rows[i].result_json || '{}');
    if (data.toolCallId) cancelledRollIds.add(data.toolCallId);
  }

  for (const toolCallId of cancelledRollIds) {
    publish(conversationId, 'dice_cancelled', { toolCallId });
  }
}

export async function resolveDiceRoll(conversationId: string, toolCallId: string, value: number) {
  let pending = pendingInteractions.get(toolCallId);
  if (pending && pending.conversationId !== conversationId) {
    throw new Error(`Dice roll ${toolCallId} belongs to another conversation`);
  }
  if (!pending) {
    // Reconstruct only the unresolved interaction after a server restart.
    const te = repo.db.query("SELECT tool_call_id, message_id, result_json FROM tool_events WHERE conversation_id=? AND tool_name='request_dice_roll' AND state='succeeded' AND json_extract(result_json, '$.toolCallId')=?").get(conversationId, toolCallId) as any;
    if (!te) throw new Error(`No pending interaction found for ${toolCallId}`);
    const data = JSON.parse(te.result_json || '{}');
    if (data.status !== 'pending_user_interaction') {
      throw new Error(`Dice roll ${toolCallId} is already resolved`);
    }
    const conv = repo.getConversation(conversationId) as any;
    const state = conv?.state || {};
    const agents = repo.agents(conversationId) as any[];
    const lastSpeakerId = state.last_speaker_agent_id;
    const active = lastSpeakerId ? agents.find((a: any) => a.id === lastSpeakerId) : agents[0];
    const profileId = state.active_profile_id;
    const profile = profileId ? (repo.profiles(conversationId) as any[]).find((p: any) => p.id === profileId) : null;
    pending = {
      conversationId,
      type: data.type,
      challengeValue: data.challengeValue,
      sign: data.sign,
      target: data.target,
      speakerName: data.speakerName,
      publicReason: data.publicReason,
      privateReason: data.privateReason,
      messageId: te.message_id,
      callerToolCallId: te.tool_call_id,
      active,
      profile,
      retryCount: 0
    };
  }

  const { type, challengeValue, sign, target, speakerName, publicReason, privateReason, active, profile, retryCount, callerToolCallId } = pending;
  const speakerLabel = speakerName || 'Unknown';
  const sides = diceSides(type);
  if (!Number.isInteger(value) || value < 1 || value > sides) {
    throw new Error(`Invalid ${type} roll value: ${value}`);
  }
  const { success, description } = computeDiceOutcome(type, value, challengeValue, sign);
  const diceData = { target, type, value, challengeValue, sign, success };
  const resolvedDiceData = {
    ...diceData,
    public_reason: publicReason,
    private_reason: privateReason,
    description
  };
  const toolResult = createMcpToolResult(callerToolCallId, resolvedDiceData);
  const claimed = repo.claimPendingDiceRoll(conversationId, callerToolCallId, { ...resolvedDiceData, rollId: toolCallId, callerToolCallId });
  if (!claimed) throw new Error(`Dice roll ${toolCallId} is already resolved`);
  pendingInteractions.delete(toolCallId);

  // Save the result in history so the calling agent receives it on continuation.
  repo.addMessage(conversationId, {
    kind: 'dice_roll',
    role: 'system',
    speaker_type: 'system',
    speaker_name_snapshot: '🎲 Dice Roll',
    content: JSON.stringify({ ...resolvedDiceData, toolCallId: callerToolCallId })
  });

  // Publish dice_roll event for UI (final result)
  publish(conversationId, 'dice_roll', {
    ...diceData,
    toolCallId,
    publicReason,
    description,
    message_id: pending.messageId,
    label: target === 'user'
      ? `${speakerLabel} requested a roll for the user`
      : `${speakerLabel} rolled the dice`
  });

  // Return the result against the original tool call, not the UI roll id.
  const resultContent = JSON.stringify(toolResult);
  publish(conversationId, 'tool_result', {
    tool_call_id: callerToolCallId,
    content: resultContent,
    message_id: pending.messageId
  });

  taggedLog('server', 'dice_roll_resolved', { conversationId, toolCallId, value, success });

  const nextPending = await getPendingDiceRoll(conversationId);
  if (nextPending) {
    publish(conversationId, 'dice_challenge', {
      ...nextPending,
      label: nextPending.target === 'user'
        ? `${nextPending.speakerName} requested a roll — click the dice!`
        : `${nextPending.speakerName} must roll — click the dice!`
    });
    return { ok: true, ...diceData, description };
  }

  // Continue generation after every pending roll is resolved.
  const toolContinuations = [
    ...(pending.priorToolContinuations || []),
    {
      name: 'request_dice_roll',
      arguments: {
        target,
        type,
        challengeValue,
        sign,
        public_reason: publicReason,
        private_reason: privateReason
      },
      result: toolResult,
    }
  ];
  void resumeToolGeneration(conversationId, active, profile, retryCount, toolContinuations);

  return { ok: true, ...diceData, description };
}

// ---------------------------------------------------------------------------
// Crypto helpers (password, attachments)
// ---------------------------------------------------------------------------
export function convoPassword(cid: string): string | null {
  return passwordManager.get(cid);
}

export function requireConversationPassword(cid: string): string | null {
  const pw = convoPassword(cid);
  if (!pw && repo.getConversation(cid)?.encrypted) {
    throw new Error('Conversation is locked');
  }
  return pw;
}

export function attachmentFilePath(attachment: any) {
  const baseDir = attachment.type === 'audio' ? audioDir(settings()) : join(cfg.dataDir, 'images');
  return join(baseDir, attachment.filename);
}

export function isPlainAttachmentBuffer(buffer: Buffer, attachment: any): boolean {
  if (attachment.mime_type?.startsWith('image/')) {
    // JPEG: FF D8, PNG: 89 50 4E 47, WebP: 52 49 46 46
    return (buffer[0] === 0xFF && buffer[1] === 0xD8)
        || (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47);
  }
  if (attachment.mime_type?.startsWith('audio/')) return buffer[0] === 0x52 && buffer[1] === 0x49;
  return false;
}

export async function encryptAttachmentFile(attachment: any, password: string) {
  const filePath = attachmentFilePath(attachment);
  try {
    const data = readFileSync(filePath);
    const encrypted = await encryptFile(data, password);
    writeFileSync(filePath, encrypted);
    return true;
  } catch {
    return false;
  }
}

export async function decryptAttachmentFile(attachment: any, password: string) {
  const filePath = attachmentFilePath(attachment);
  try {
    const data = readFileSync(filePath);
    const decrypted = await decryptFile(data, password);
    writeFileSync(filePath, decrypted);
    return true;
  } catch {
    return false;
  }
}

export async function reEncryptAttachmentFile(attachment: any, oldPassword: string, newPassword: string) {
  const filePath = attachmentFilePath(attachment);
  try {
    const data = readFileSync(filePath);
    const decrypted = await decryptFile(data, oldPassword);
    const reEncrypted = await encryptFile(decrypted, newPassword);
    writeFileSync(filePath, reEncrypted);
    return true;
  } catch {
    return false;
  }
}

export async function encryptConversationAttachments(cid: string, password: string) {
  const attachments = repo.db.query(
    'SELECT * FROM attachments WHERE conversation_id=? AND type IN (?,?)'
  ).all(cid, 'image', 'audio') as any[];
  for (const att of attachments) await encryptAttachmentFile(att, password);
}

export async function decryptConversationAttachments(cid: string, password: string) {
  const attachments = repo.db.query(
    'SELECT * FROM attachments WHERE conversation_id=? AND type IN (?,?)'
  ).all(cid, 'image', 'audio') as any[];
  for (const att of attachments) await decryptAttachmentFile(att, password);
}

export async function reEncryptConversationAttachments(cid: string, oldPassword: string, newPassword: string) {
  const attachments = repo.db.query(
    'SELECT * FROM attachments WHERE conversation_id=? AND type IN (?,?)'
  ).all(cid, 'image', 'audio') as any[];
  for (const att of attachments) await reEncryptAttachmentFile(att, oldPassword, newPassword);
}

export async function decryptPublishData(cid: string, data: any): Promise<any> {
  const pw = convoPassword(cid);
  if (!pw) return data;
  const result = { ...data };
  if (result.agents) {
    result.agents = await Promise.all(result.agents.map(async (agent: any) => ({
      ...agent,
      name: await decryptIf(pw, agent.name),
      introduction: await decryptIf(pw, agent.introduction),
      appearance: agent.appearance ? await decryptIf(pw, agent.appearance) : agent.appearance
    })));
  }
  if (result.profiles) {
    result.profiles = await Promise.all(result.profiles.map(async (profile: any) => ({
      ...profile,
      name: await decryptIf(pw, profile.name),
      introduction: await decryptIf(pw, profile.introduction),
      appearance: profile.appearance ? await decryptIf(pw, profile.appearance) : profile.appearance
    })));
  }
  if (result.agent) {
    result.agent = {
      ...result.agent,
      name: await decryptIf(pw, result.agent.name),
      introduction: await decryptIf(pw, result.agent.introduction),
      appearance: result.agent.appearance ? await decryptIf(pw, result.agent.appearance) : result.agent.appearance
    };
  }
  if (result.profile) {
    result.profile = {
      ...result.profile,
      name: await decryptIf(pw, result.profile.name),
      introduction: await decryptIf(pw, result.profile.introduction),
      appearance: result.profile.appearance ? await decryptIf(pw, result.profile.appearance) : result.profile.appearance
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Session helpers (used by index.ts)
// ---------------------------------------------------------------------------
export type SessionSocket = Bun.ServerWebSocket<{ role: string }>;
export const sessions = new Map<SessionSocket, any>();
let _nextSessionId = 0;
export function nextSessionId() { return _nextSessionId++; }
