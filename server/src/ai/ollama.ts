import { writeFileSync } from 'node:fs';
import { Ollama } from 'ollama';
import dirtyJson from 'dirty-json';
import { KOKORO_VOICE_CATALOG } from '../services/kokoro';

export type OllamaToolName = 'imagen' | 'narrate' | 'add_agent' | 'append_to_my_intro' | 'append_to_intro' | 'request_dice_roll';
export type OllamaSettings = {
  baseUrl: string; model: string;
  toolMode?: 'native' | 'structured';
  think?: boolean;
  tools?: OllamaToolName[];
  requiredTools?: string[];
  numCtx?: number;
  temperature?: number;
  seed?: number;
  voices?: string[];
  kokoroEnabled?: boolean;
};

type Logger = (tag: string, msg: string, data?: unknown) => void;
let _log: Logger = () => {};
export function setOllamaLogger(fn: Logger) { _log = fn; }

let _lastPromptFile = '';
export function setLastPromptFile(path: string) { _lastPromptFile = path; }

export type OllamaToolCall = {
  id?: string;
  function?: {
    name: string;
    arguments: any;
  };
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
};

function makeClient(baseUrl: string) {
  return new Ollama({ host: baseUrl });
}

export async function listOllamaModels(baseUrl: string) {
  const client = makeClient(baseUrl);
  const result = await client.list();
  return result;
}

export async function* streamOllama(prompt: string, settings: OllamaSettings) {
  const client = makeClient(settings.baseUrl);
  const stream = await client.generate({ model: settings.model, prompt, stream: true, options: { num_ctx: settings.numCtx ?? 24000 } });
  for await (const chunk of stream) {
    if (chunk.response) yield chunk.response;
  }
}

/** Build options object with temperature, seed, num_ctx for any Ollama API call. */
function buildOptions(settings: { numCtx?: number; temperature?: number; seed?: number }): Record<string, any> {
  const opts: Record<string, any> = {
    num_ctx: settings.numCtx ?? 24000,
    temperature: settings.temperature ?? 0.8,
  };
  // Ollama defaults seed to 0 (deterministic). Pass -1 to let Ollama pick a
  // random seed, unless the user explicitly configured one.
  opts.seed = settings.seed !== undefined ? settings.seed : -1;
  return opts;
}

async function _chat(client: Ollama, request: any) {
  if (_lastPromptFile) {
    try { writeFileSync(_lastPromptFile, JSON.stringify({ chat_ollama_object: request }, null, 2) + '\n'); } catch { /* best-effort */ }
  }
  return await client.chat(request);
}

export async function chatOllama(messages: ChatMessage[], settings: OllamaSettings) {
  const client = makeClient(settings.baseUrl);

  const tools = ollamaTools(settings.tools, settings.voices, settings.kokoroEnabled);
  if (settings.toolMode === 'structured') {
    return chatStructured(client, messages, settings.model, settings.think, settings.tools, settings.requiredTools, settings.numCtx, settings.temperature, settings.seed, settings.voices, settings.kokoroEnabled);
  }

  const opts = buildOptions(settings);

  if (!tools.length) {
    _log('ollama', 'chat_request', { model: settings.model, messages, tools: [], ...opts });
    const response = await _chat(client, { model: settings.model, messages, stream: false, options: opts, think: settings.think });
    _log('ollama', 'chat_response', { model: settings.model, withTools: false, message: response.message });
    return {
      message: { content: response.message.content, tool_calls: undefined },
      promptTokens: response.prompt_eval_count ?? 0,
      completionTokens: response.eval_count ?? 0
    };
  }

  _log('ollama', 'chat_request', { model: settings.model, messages, tools, ...opts });

  // Try with tools first; models that don't support them return an error → retry bare.
  try {
    const response = await _chat(client, { model: settings.model, messages, stream: false, options: opts, tools, think: settings.think });
    const tool_calls = response.message.tool_calls?.map(tc => ({
      function: { name: tc.function.name, arguments: tc.function.arguments }
    })) as OllamaToolCall[] | undefined;
    _log('ollama', 'chat_response', { model: settings.model, withTools: true, message: response.message });
    return {
      message: { content: response.message.content, tool_calls },
      promptTokens: response.prompt_eval_count ?? 0,
      completionTokens: response.eval_count ?? 0
    };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (!msg.toLowerCase().includes('tool')) throw err;

    // Model doesn't support tools — retry without.
    _log('ollama', 'chat_retry_no_tools', { model: settings.model, reason: msg });
    const response = await _chat(client, { model: settings.model, messages, stream: false, options: opts, think: settings.think });
    _log('ollama', 'chat_response', { model: settings.model, withTools: false, message: response.message });
    return {
      message: { content: response.message.content, tool_calls: undefined },
      promptTokens: response.prompt_eval_count ?? 0,
      completionTokens: response.eval_count ?? 0
    };
  }
}

// Structured-output mode: for models that accept `tools` but don't reliably populate
// `tool_calls` (e.g. they write `{"action": ..., "action_input": ...}` into content instead).
// Instead we describe the tools in the system prompt and force a JSON-schema response
// shaped as `{ message, tool_call? }`, which works even on models without "tools" capability.
async function chatStructured(client: Ollama, messages: ChatMessage[], model: string, think?: boolean, toolNames?: OllamaToolName[], requiredTools?: string[], numCtx?: number, temperature?: number, seed?: number, voices?: string[], kokoroEnabled?: boolean) {
  const tools = ollamaTools(toolNames, voices, kokoroEnabled);
  const augmented = augmentForStructuredOutput(messages, toolNames, requiredTools, voices, kokoroEnabled);
  const format = structuredFormat(toolNames, requiredTools, voices, kokoroEnabled);
  const opts = buildOptions({ numCtx, temperature, seed });
  _log('ollama', 'chat_request', { model, messages: augmented, format, ...opts });

  const response = await _chat(client, {
    model,
    messages: augmented,
    stream: false,
    format,
    think,
    options: opts
  });
  _log('ollama', 'chat_response', { model, mode: 'structured', message: response.message });

  const parsed = parseStructuredMessage(response.message.content);
  return {
    ...parsed,
    promptTokens: response.prompt_eval_count ?? 0,
    completionTokens: response.eval_count ?? 0
  };
}

function augmentForStructuredOutput(messages: ChatMessage[], toolNames?: OllamaToolName[], requiredTools?: string[], voices?: string[], kokoroEnabled?: boolean): ChatMessage[] {
  const tools = ollamaTools(toolNames, voices, kokoroEnabled);
  const required = new Set(requiredTools || []);
  const instructions = tools.length ? [
    'Available tools (only if needed):',
    ...tools.map(t => {
      const params = t.function.parameters;
      return `- ${t.function.name}: ${t.function.description} Arguments: ${JSON.stringify(params.properties)}, required: ${JSON.stringify(params.required)}.`;
    }),
    'Respond with valid JSON only. No markdown. No extra text. No thinking text.',
    'Shape: {"message": "<what you say>", "tool_calls": [{"name": "<tool name>", "arguments": {...}}]}.',
    'If no tool is needed this turn, set "tool_calls" to an empty array []. You can call multiple tools in one turn.',
    'Every argument listed as required must be present, even if empty — use "" for an unused text field.',
    'For imagen, arguments must be exactly {"prompt":"<clean image prompt>"}. Use {appearance:me} for your appearance, {appearance:<name>} for others.',
    ...(kokoroEnabled ? ['For add_agent, "kokoro_voice" must be a catalog id (e.g. "af_heart") for the new character\'s Kokoro TTS voice, or "" to use the conversation\'s default Kokoro voice.'] : []),
    ...(required.size ? [`MUST call every turn: ${[...required].join(', ')}. Do not skip these tools under any circumstance.`] : []),
    'If your instructions require using a tool (e.g. generating an image), express it only via "tool_calls" — never describe the action or its result as text inside "message".'
  ].join('\n') : [
    'No tools are available for this turn.',
    'Respond with valid JSON only. No markdown. No extra text. No thinking text.',
    'Shape: {"message": "<what you say>"}.'
  ].join('\n');

  const [first, ...rest] = messages;
  if (first?.role === 'system') return [{ ...first, content: `${first.content}\n\n${instructions}` }, ...rest];
  return [{ role: 'system', content: instructions }, ...messages];
}

function parseStructuredMessage(content: string) {
  const parsed = parseJsonLenient(content);
  if (!parsed || typeof parsed !== 'object') {
    return { message: { content, tool_calls: undefined } };
  }

  // Support both "tool_calls" (array) and legacy "tool_call" (singleton).
  let calls: any[] = (parsed as any).tool_calls;
  if (!calls && (parsed as any).tool_call) {
    calls = [(parsed as any).tool_call];
  }
  const tool_calls = Array.isArray(calls) && calls.length
    ? calls.filter(c => c?.name).map(c => ({ function: { name: c.name, arguments: c.arguments ?? {} } })) as OllamaToolCall[]
    : undefined;
  return { message: { content: typeof (parsed as any).message === 'string' ? (parsed as any).message : '', tool_calls } };
}

function parseJsonLenient(content: string) {
  try {
    return JSON.parse(content);
  } catch (strictError: any) {
    try {
      const parsed = dirtyJson.parse(content);
      _log('ollama', 'dirty_json_parse', { ok: true });
      return parsed;
    } catch (dirtyError: any) {
      _log('ollama', 'dirty_json_parse', {
        ok: false,
        strictError: strictError.message || String(strictError),
        dirtyError: dirtyError.message || String(dirtyError),
        content
      });
      return null;
    }
  }
}

function structuredFormat(toolNames?: OllamaToolName[], requiredTools?: string[], voices?: string[], kokoroEnabled?: boolean) {
  const tools = ollamaTools(toolNames, voices, kokoroEnabled);

  if (!tools.length) {
    return {
      type: 'object',
      additionalProperties: false,
      properties: { message: { type: 'string' } },
      required: ['message']
    };
  }

  // Each tool gets its own arguments schema (MCP-style inputSchema), discriminated by `name`.
  const itemSchemas = tools.map(t => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { const: t.function.name },
      arguments: { ...t.function.parameters, additionalProperties: false }
    },
    required: ['name', 'arguments']
  }));

  const toolCalls: any = {
    type: 'array',
    items: itemSchemas.length === 1 ? itemSchemas[0] : { anyOf: itemSchemas }
  };

  // Required tools: force tool_calls to contain at least one call per required tool name.
  const required = (requiredTools || []).filter(name => tools.some(t => t.function.name === name));
  if (required.length) {
    toolCalls.minItems = required.length;
    const contains = required.map(name => ({ contains: { properties: { name: { const: name } }, required: ['name'] } }));
    if (contains.length === 1) Object.assign(toolCalls, contains[0]);
    else toolCalls.allOf = contains;
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties: { message: { type: 'string' }, tool_calls: toolCalls },
    required: ['message', 'tool_calls']
  };
}

function ollamaTools(allowed?: OllamaToolName[], voices?: string[], kokoroEnabled?: boolean) {
  const allow = allowed ? new Set(allowed) : null;
  type Prop = { type: string; enum?: string[] };
  const tool = (name: string, description: string, properties: Record<string, Prop>, required: string[]) => ({
    type: 'function' as const,
    function: { name, description, parameters: { type: 'object', properties, required } }
  });

  const voiceProp: Prop = voices && voices.length
    ? { type: 'string', enum: voices }
    : { type: 'string' };

  const addAgentProps: Record<string, Prop> = { name: { type: 'string' }, voice: voiceProp, introduction: { type: 'string' } };
  const addAgentRequired = ['name', 'voice', 'introduction'];
  if (kokoroEnabled) {
    addAgentProps.kokoro_voice = { type: 'string', enum: ['', ...KOKORO_VOICE_CATALOG.map(v => v.id)] };
    addAgentRequired.push('kokoro_voice');
  }

  return [
    tool('add_agent', 'Add a new character to the current conversation.', addAgentProps, addAgentRequired),
    tool('imagen', 'Generate an image prompt. THE PROMPT MUST BE IN ENGLISH — always, even if the conversation is in another language. Describe the scene completely so the model can render it without extra context: characters (gender, appearance, clothing, hair), setting, mood, lighting. Use {appearance:me} for your appearance, {appearance:<name>} for other characters. Include the number of people in the scene. If instructed to generate something specific, follow with creativity and surprises.', { prompt: { type: 'string' } }, ['prompt']),
    tool('narrate', 'Add brief third-person scene narration that is separate from the character spoken message.', { text: { type: 'string' } }, ['text']),
    tool('append_to_my_intro', 'Permanently append a short note to your own character introduction/background, to record a new fact about yourself that should persist (e.g. revealed backstory, a new trait, a relationship).', { text: { type: 'string' } }, ['text']),
    tool('append_to_intro', "Permanently append a short note to another character's introduction/background, to record a newly revealed fact about them (e.g. as the narrator, after revealing that a character is the murderer).", { agent: { type: 'string' }, text: { type: 'string' } }, ['agent', 'text']),
    tool('request_dice_roll', 'Request a dice roll for an RPG skill check or contest. public_reason is rendered as a quoted message from you to the human player: write a natural, in-character explanation of the immediate situation and requested action. Never write a log, a status, a meta-comment, or ask the player whether they want to attempt the action (for example, never start with "Do you want to..."). private_reason is context only and is never shown to the player. Both fields are required strings; use an empty string for either unused field, but at least one must contain a reason.', {
      target: { type: 'string', enum: ['user', 'agent'] },
      type: { type: 'string', enum: ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] },
      challengeValue: { type: 'number' },
      sign: { type: 'string', enum: ['>', '<', '>=', '<=', '='] },
      public_reason: { type: 'string' },
      private_reason: { type: 'string' }
    }, ['target', 'type', 'challengeValue', 'sign', 'public_reason', 'private_reason'])
  ].filter(t => !allow || allow.has(t.function.name as OllamaToolName));
}
