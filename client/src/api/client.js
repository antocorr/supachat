import { RpcAble } from '../../../packages/rpcable/src/RpcAble.ts';

const RPC_CHANNEL = '-userSession';
const eventStreams = new Map();

/**
 * Builds the WebSocket URL used by RpcAble.
 * @returns {string}
 */
function rpcUrl() {
  const configured = import.meta.env.VITE_RPC_WS_URL;
  if (configured) return configured;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Sends an inbound server event to the matching conversation stream.
 * @param {string} name
 * @param {any} event
 */
function deliverEvent(name, event) {
  const conversationId = event && event.conversation_id ? event.conversation_id : '';
  const stream = eventStreams.get(conversationId);
  if (!stream || stream.closed) return;
  stream.handlers.onEvent?.(name, event || {});
}

const inbound = {
  message_start(event) {
    if (event.prompt_json) {
      console.log('Generation prompt:', JSON.parse(event.prompt_json));
    }
    deliverEvent('message_start', event);
  },
  token(event) { deliverEvent('token', event); },
  message_done(event) { deliverEvent('message_done', event); },
  tool_call(event) { deliverEvent('tool_call', event); },
  tool_result(event) { deliverEvent('tool_result', event); },
  image_pending(event) { deliverEvent('image_pending', event); },
  image_ready(event) { deliverEvent('image_ready', event); },
  audio_pending(event) { deliverEvent('audio_pending', event); },
  audio_ready(event) { deliverEvent('audio_ready', event); },
  audio_complete(event) { deliverEvent('audio_complete', event); },
  audio_failed(event) { deliverEvent('audio_failed', event); },
  dice_challenge(event) { deliverEvent('dice_challenge', event); },
  dice_cancelled(event) { deliverEvent('dice_cancelled', event); },
  dice_roll(event) { deliverEvent('dice_roll', event); },
  state_changed(event) { deliverEvent('state_changed', event); },
  message_deleted(event) { deliverEvent('message_deleted', event); },
  message_updated(event) { deliverEvent('message_updated', event); },
  error(event) { deliverEvent('error', event); },
  token_usage(event) {
    console.log('Token usage:', {
      prompt_tokens: event.prompt_tokens,
      completion_tokens: event.completion_tokens,
      total_tokens: event.total_tokens,
      estimated_tokens: event.estimated_tokens,
      remaining_before_compaction: event.remaining_before_compaction,
      OLLAMA_NUM_CTX: event.num_ctx,
      COMPACTION_THRESHOLD: event.compaction_threshold
    });
    deliverEvent('token_usage', event);
  },
  compaction(event) {
    console.log('Compaction:', {
      status: event.status,
      message: event.message,
      target_count: event.target_count,
      prompt: event.prompt_json ? JSON.parse(event.prompt_json) : null,
      llm_summary: event.llm_summary || null
    });
    deliverEvent('compaction', event);
  }
};

export class ApiClient {
  constructor() {
    this.socket = new WebSocket(rpcUrl());
    this.remote = new RpcAble({
      target: inbound,
      transport: 'websocket',
      connection: this.socket,
      channel: RPC_CHANNEL,
      role: 'client',
      requestTimeoutMs: 120000
    });
  }

  getHealth() { return this.remote.getHealth(); }
  getSettings() { return this.remote.getSettings(); }
  patchSettings(settings) { return this.remote.patchSettings(settings); }
  getConversations() { return this.remote.getConversations(); }
  createConversation(payload = {}) { return this.remote.createConversation(payload); }
  duplicateConversation(id) { return this.remote.duplicateConversation(id); }
  getConversation(id) { return this.remote.getConversation(id); }
  patchConversation(id, payload) { return this.remote.patchConversation(id, payload); }
  deleteConversation(id) { return this.remote.deleteConversation(id); }
  getMessages(id) { return this.remote.getMessages(id); }
  addMessage(id, payload) { this.remote.addMessage(id, payload); }
  deleteMessage(id, messageId) { return this.remote.deleteMessage(id, messageId); }
  deleteMessagesFrom(id, messageId) { return this.remote.deleteMessagesFrom(id, messageId); }
  regenerateMessage(id, messageId) { return this.remote.regenerateMessage(id, messageId); }
  runAction(id, action, payload = {}) { return this.remote.runAction(id, action, payload); }
  resetCompaction(id) { return this.remote.runAction(id, 'resetCompaction'); }
  getAgents(id) { return this.remote.getAgents(id); }
  createAgent(id, payload) { return this.remote.createAgent(id, payload); }
  patchAgent(id, agentId, payload) { return this.remote.patchAgent(id, agentId, payload); }
  deleteAgent(id, agentId) { return this.remote.deleteAgent(id, agentId); }
  getProfiles(id) { return this.remote.getProfiles(id); }
  createProfile(id, payload) { return this.remote.createProfile(id, payload); }
  patchProfile(id, profileId, payload) { return this.remote.patchProfile(id, profileId, payload); }
  deleteProfile(id, profileId) { return this.remote.deleteProfile(id, profileId); }
  getStoryEntries(id) { return this.remote.getStoryEntries(id); }
  createStoryEntry(id, payload) { return this.remote.createStoryEntry(id, payload); }
  patchStoryEntry(id, entryId, payload) { return this.remote.patchStoryEntry(id, entryId, payload); }
  deleteStoryEntry(id, entryId) { return this.remote.deleteStoryEntry(id, entryId); }
  updateMessage(id, messageId, content) { return this.remote.updateMessage(id, messageId, content); }
  deleteMessage(id, messageId) { return this.remote.deleteMessage(id, messageId); }
  deleteMessagesFrom(id, messageId) { return this.remote.deleteMessagesFrom(id, messageId); }
  regenerateMessage(id, messageId) { return this.remote.regenerateMessage(id, messageId); }
  lockConversation(id, password) { return this.remote.lockConversation(id, password); }
  unlockConversation(id, password) { return this.remote.unlockConversation(id, password); }
  checkConversationLock(id) { return this.remote.checkConversationLock(id); }
  changeConversationPassword(id, oldPassword, newPassword) { return this.remote.changeConversationPassword(id, oldPassword, newPassword); }
  getOllamaModels() { return this.remote.getOllamaModels(); }
  getDrawThingsStatus() { return this.remote.getDrawThingsStatus(); }
  probeDrawThings(payload = {}) { return this.remote.probeDrawThings(payload); }
  getDrawThingsModels() { return this.remote.getDrawThingsModels(); }
  getVoices() { return this.remote.getVoices(); }
  getKokoroVoices() { return this.remote.getKokoroVoices(); }
  kokoroModelStatus() { return this.remote.kokoroModelStatus(); }
  downloadKokoroVoice(voiceId) { return this.remote.downloadKokoroVoice(voiceId); }
  runCommand(payload) { return this.remote.runCommand(payload); }
  logEvent(tag, message, data = {}) { this.remote.logEvent(tag, message, data); }
  generateText(payload) {
    return this.remote.generateText(payload);
  }
  subscribeConversation(conversationId, sinceEventId = '') { return this.remote.subscribeConversation(conversationId, sinceEventId); }
  unsubscribeConversation(conversationId) { return this.remote.unsubscribeConversation(conversationId); }
}

export const api = new ApiClient();

let _clientLogEnabled = true;
export function setClientLogEnabled(enabled) { _clientLogEnabled = enabled; }
export function clientLog(message, data = {}) {
  api.logEvent('client', message, data);
  if (_clientLogEnabled) console.log(`[client] ${message}`, data);
}

export function openConversationStream(conversationId, sinceEventId, handlers = {}) {
  if (!conversationId) return null;
  const stream = { closed: false, handlers };
  eventStreams.set(conversationId, stream);
  api.subscribeConversation(conversationId, sinceEventId || '')
    .then(() => {
      if (!stream.closed) handlers.onOpen?.({ type: 'rpcable-open' });
    })
    .catch((error) => {
      if (!stream.closed) handlers.onError?.(error);
    });

  return {
    close() {
      stream.closed = true;
      if (eventStreams.get(conversationId) === stream) eventStreams.delete(conversationId);
      api.unsubscribeConversation(conversationId).catch(() => {});
    }
  };
}
