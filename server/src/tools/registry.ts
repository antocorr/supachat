import { generateImage } from '../services/drawThings';
import { publish } from '../services/events';

type Logger = (tag: string, msg: string, data?: unknown) => void;
let _log: Logger = () => {};
export function setRegistryLogger(fn: Logger) { _log = fn; }

export type ToolContext = {
  conversationId: string;
  messageId: string;
  publish: (name: string, data: any) => void;
  taggedLog: Logger;
  repo: any;
  settings: any;
  audioDir: (s: any) => string | null;
  cfg: any;
  passwordManager: any;
  encryptIf: (pw: string, data: string) => Promise<string>;
  decryptIf: (pw: string, data: string) => Promise<string>;
  KOKORO_VOICE_CATALOG: any[];
  synthesizeKokoro: any;
  synthesizePiper: any;
  splitSentences: any;
  isKokoroModelReady: any;
  chunkForKokoro: any;
  generateAudioForAssistant: any;
  id: () => string;
  defaults: any;
  RPC_CHANNEL: string;
  _isEncrypted: boolean;
  genPw: string | null;
  onAttachmentCreated?: (attachment: any) => Promise<void>;
};

function normalizeAttachment(attachment: any) {
  if (!attachment) return attachment;
  return { ...attachment, metadata: attachment.metadata || JSON.parse(attachment.metadata_json || '{}') };
}

function resolveAppearancePlaceholders(prompt: string, agents: any[], profiles: any[], activeAgentId?: string): string {
  return prompt.replace(/\{appearance:([^}]+)\}/g, (_match: string, ref: string) => {
    if (ref === 'me') {
      const agent = agents.find(a => a.id === activeAgentId);
      const appearance = agent?.imagen_appearance || agent?.appearance;
      if (appearance) return `${agent.name}: ${appearance}`;
      _log('registry', 'appearance_placeholder_warning', { ref, reason: 'active agent has no appearance' });
      return '';
    }
    const agent = agents.find(a => a.id === ref || a.name.toLowerCase() === ref.toLowerCase());
    if (agent) {
      const appearance = agent.imagen_appearance || agent.appearance;
      if (appearance) return `${agent.name}: ${appearance}`;
    }
    const profile = profiles.find(p => p.name.toLowerCase() === ref.toLowerCase());
    if (profile?.appearance) return `${profile.name}: ${profile.appearance}`;
    _log('registry', 'appearance_placeholder_warning', { ref, reason: 'no matching agent or profile with appearance' });
    return '';
  });
}

/**
 * Roll dice and return structured result.
 */
function rollDice(type: string, challengeValue: number, sign: string): { value: number; success: boolean; description: string } {
  const sidesMap: Record<string, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };
  const sides = sidesMap[type] || 20;
  const value = Math.floor(Math.random() * sides) + 1;

  let success = false;
  switch (sign) {
    case '>':  success = value > challengeValue; break;
    case '<':  success = value < challengeValue; break;
    case '>=': success = value >= challengeValue; break;
    case '<=': success = value <= challengeValue; break;
    case '=':  success = value === challengeValue; break;
    default:   success = value >= challengeValue;
  }

  const outcome = success ? 'Success' : 'Failure';
  const description = `${outcome}! Rolled ${value} on ${type}, needed ${sign} ${challengeValue}`;
  return { value, success, description };
}

/**
 * Run a named tool with the given arguments.
 * Called from app.ts as: runTool(name, args, ctx)
 */
export async function runTool(
  name: string,
  args: any,
  ctx: ToolContext
): Promise<any> {
  const { conversationId: cid, messageId, publish: pub, repo, settings, taggedLog } = ctx;

  if (name !== 'request_dice_roll') {
    repo.toolEvent(cid, {
      message_id: messageId ?? null,
      tool_call_id: '',
      tool_name: name,
      state: 'running',
      arguments: args
    });
    pub(cid, 'tool_call', { tool_call_id: '', tool_name: name, arguments: args });
  }

  try {
    let result: any;

    if (name === 'generateRandomNumber') {
      const min = Number(args.min ?? 1);
      const max = Number(args.max ?? 100);
      result = { value: Math.floor(Math.random() * (max - min + 1)) + min };
    }

    else if (name === 'narrate') {
      const originalText = String(args.text || '');
      const storedText = ctx.genPw ? await ctx.encryptIf(ctx.genPw, originalText) : originalText;
      result = repo.addMessage(cid, {
        kind: 'chat',
        role: 'assistant',
        speaker_type: 'agent',
        speaker_id: null,
        speaker_name_snapshot: 'Narrator',
        content: storedText
      });
      const narratorMsg = { ...result, content: originalText, attachments: [] };
      pub(cid, 'message_start', { message_id: result.id, role: 'assistant', speaker_name_snapshot: 'Narrator', message: narratorMsg });
      pub(cid, 'message_done', { message_id: result.id, content: originalText, message: narratorMsg });
      if (ctx.generateAudioForAssistant) {
        ctx.generateAudioForAssistant(result.id, originalText).catch(() => {});
      }
    }

    else if (name === 'append_to_my_intro') {
      const text = String(args.text || '').trim();
      const current = repo.agents(cid).find((a: any) => a.id === ctx.agentId);
      if (!current) throw new Error('append_to_my_intro: active agent not found');
      const introduction = [current.introduction, text].filter(Boolean).join('\n');
      result = repo.patchAgent(cid, current.id, { introduction });
      pub(cid, 'state_changed', { reason: 'agent_updated', agent: result, agents: repo.agents(cid), state: repo.state(cid) });
    }

    else if (name === 'append_to_intro') {
      const ref = String(args.agent || '').trim();
      const text = String(args.text || '').trim();
      const agents = repo.agents(cid) as any[];
      const target = agents.find((a: any) => a.id === ref || a.name.toLowerCase() === ref.toLowerCase());
      if (!target) throw new Error(`append_to_intro: agent "${ref}" not found`);
      const introduction = [target.introduction, text].filter(Boolean).join('\n');
      result = repo.patchAgent(cid, target.id, { introduction });
      pub(cid, 'state_changed', { reason: 'agent_updated', agent: result, agents: repo.agents(cid), state: repo.state(cid) });
    }

    else if (name === 'add_agent') {
      const voice = String(args.voice ?? '');
      const language = voice.match(/^([a-z]{2}_[A-Z]{2})-/)?.[1];
      result = repo.createAgent(cid, {
        name: String(args.name),
        voice,
        language,
        kokoro_voice: String(args.kokoro_voice ?? ''),
        introduction: String(args.introduction ?? '')
      });
      pub(cid, 'state_changed', { reason: 'agent_created', agent: result, agents: repo.agents(cid), state: repo.state(cid) });
    }

    else if (name === 'imagen') {
      const drawThings = { ...(settings().drawThings || {}), ...((repo.state(cid) as any)?.drawThings || {}) };
      if (!drawThings || !drawThings.enabled) throw new Error('Draw Things is disabled or unprobed');
      if (!messageId) throw new Error('imagen requires an owner message id');

      const rawPrompt = resolveAppearancePlaceholders(
        String(args.prompt),
        repo.agents(cid),
        repo.profiles(cid),
        ctx.agentId
      );
      const promptParts = [drawThings.promptPrepend, rawPrompt, drawThings.promptAppend].filter(Boolean);
      const prompt = promptParts.join('\n');
      pub(cid, 'image_pending', { message_id: messageId, tool_call_id: '', prompt });
      const image = await generateImage(drawThings.baseUrl, ctx.cfg.dataDir || 'server/data', {
        prompt,
        width: drawThings.width || 384,
        height: drawThings.height || 512,
        timeoutMs: drawThings.timeoutMs || 30000,
        model: drawThings.model || '',
        sampler: drawThings.sampler || '',
        steps: drawThings.steps,
        cfgScale: drawThings.cfgScale,
        textGuidance: drawThings.textGuidance ?? 1,
        negativePrompt: drawThings.negativePrompt || ''
      });
      const toolEvent = repo.toolEvent(cid, {
        message_id: messageId,
        tool_call_id: '',
        tool_name: name,
        state: 'running',
        arguments: args
      }) as any;
      const attResult = repo.addAttachment(cid, {
        message_id: messageId,
        tool_event_id: toolEvent.id,
        type: 'image',
        mime_type: image.mime_type,
        filename: image.filename,
        public_url: image.public_url,
        metadata: { prompt, originalPrompt: args.prompt, model: drawThings.model || '' }
      });

      // Encrypt prompt metadata in DB if conversation is encrypted
      if (ctx.genPw) {
        const encryptedMeta = JSON.stringify({
          prompt: await ctx.encryptIf(ctx.genPw, prompt),
          originalPrompt: await ctx.encryptIf(ctx.genPw, args.prompt || ''),
          model: drawThings.model || ''
        });
        ctx.repo.db.query('UPDATE attachments SET metadata_json=? WHERE id=?').run(encryptedMeta, attResult.id);
      }

      result = normalizeAttachment(attResult);
      if (ctx.onAttachmentCreated) {
        await ctx.onAttachmentCreated(result);
      }
      pub(cid, 'image_ready', { message_id: messageId, tool_call_id: '', attachment: result });
    }

    else if (name === 'add_story_entry') {
      const kind = String(args.kind || '');
      if (!['chapter', 'fact', 'setting'].includes(kind)) throw new Error('add_story_entry: kind must be chapter, fact, or setting');
      result = repo.createStoryEntry(cid, { kind, title: String(args.title || ''), content: String(args.content || '') });
      pub(cid, 'state_changed', { storyEntries: repo.storyEntries(cid) });
    }

    else if (name === 'update_story_entry') {
      const id = String(args.id || '');
      if (!id) throw new Error('update_story_entry: id is required');
      result = repo.patchStoryEntry(cid, id, {
        title: args.title != null ? String(args.title) : undefined,
        content: args.content != null ? String(args.content) : undefined,
      });
      pub(cid, 'state_changed', { storyEntries: repo.storyEntries(cid) });
    }

    else if (name === 'remove_story_entry') {
      const id = String(args.id || '');
      if (!id) throw new Error('remove_story_entry: id is required');
      result = repo.deleteStoryEntry(cid, id);
      pub(cid, 'state_changed', { storyEntries: repo.storyEntries(cid) });
    }

    // ── request_dice_roll (interactive: user clicks to roll) ──────────
    else if (name === 'request_dice_roll') {
      const target = String(args.target || 'agent');
      const type = String(args.type || 'd20');
      const challengeValue = Number(args.challengeValue ?? 10);
      const sign = String(args.sign || '>=');
      if (typeof args.public_reason !== 'string' || typeof args.private_reason !== 'string') {
        throw new Error('request_dice_roll requires string public_reason and private_reason arguments');
      }
      const publicReason = args.public_reason.trim();
      const privateReason = args.private_reason.trim();

      const validTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
      if (!validTypes.includes(type)) throw new Error(`Invalid dice type "${type}". Must be one of: ${validTypes.join(', ')}`);
      if (!['>', '<', '>=', '<=', '='].includes(sign)) throw new Error(`Invalid sign "${sign}". Must be one of: >, <, >=, <=, =`);
      if (!publicReason && !privateReason) throw new Error('request_dice_roll requires public_reason, private_reason, or both');

      // Resolve speaker name
      const msg = repo.messages(cid).find((m: any) => m.id === messageId);
      const speakerName = msg?.speaker_name_snapshot || 'System';

      // Generate a unique id for this pending roll
      const rollId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      // Publish dice_challenge event (no value yet — user must roll)
      pub(cid, 'dice_challenge', {
        toolCallId: rollId,
        type, challengeValue, sign, target,
        speakerName,
        publicReason,
        message_id: messageId,
        label: target === 'user'
          ? `${speakerName} requested a roll — click the dice!`
          : `${speakerName} must roll — click the dice!`
      });

      // Return pending status — caller will wait for user interaction
      result = {
        status: 'pending_user_interaction',
        toolCallId: rollId,
        type, challengeValue, sign, target, speakerName,
        publicReason, privateReason,
        message_id: messageId
      };
    }

    else {
      throw new Error(`Unknown tool ${name}`);
    }

    // request_dice_roll is persisted by app.ts with the model's original
    // tool-call id. Do not create a second pending row with an empty id.
    if (name !== 'request_dice_roll') {
      repo.toolEvent(cid, {
        message_id: messageId ?? null,
        tool_call_id: '',
        tool_name: name,
        state: 'succeeded',
        arguments: args,
        result
      });
    }
    return result;

  } catch (error: any) {
    if (name !== 'request_dice_roll') {
      repo.toolEvent(cid, {
        message_id: messageId ?? null,
        tool_call_id: '',
        tool_name: name,
        state: 'failed',
        arguments: args,
        error: error.message
      });
    }
    pub(cid, 'error', { tool_call_id: '', message_id: messageId ?? null, error: error.message });
    throw error;
  }
}
