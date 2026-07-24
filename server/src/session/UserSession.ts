import { join } from 'node:path';
import { UserSessionBase } from './UserSessionBase';
import type { EventClient, EventName } from '../services/events';
import { defaults } from '../config';
import { passwordManager } from '../services/passwordManager';
import { publish, subscribeEvents, unsubscribeEvents } from '../services/events';
import { encryptIf, decryptIf, createVerifier, verifyPassword } from '../services/crypto';
import { encryptFile, decryptFile } from '../services/crypto';
import { str } from '../validation';
import { listOllamaModels } from '../ai/ollama';
import { probeDrawThings, listDrawThingsModels } from '../services/drawThings';
import { listVoices } from '../services/piper';
import { listKokoroVoices, isKokoroModelReady, downloadKokoroVoice } from '../services/kokoro';
import { chatOllama } from '../ai/ollama';
import { runCommand } from '../services/commands';
import {
  repo, cfg, settings, audioDir, taggedLog, readLogLines,
  RPC_CHANNEL, convoPassword, decryptPublishData, messageForEvent,
  generateAssistantMessage, generateAudioForAssistant,
  createMessageFromBody, runActionFromBody, invalidatePendingDiceRolls,
  aiNumCtx, nextSessionId,
  encryptConversationAttachments, decryptConversationAttachments,
  reEncryptConversationAttachments, normalizeAttachment,
  attachmentFilePath,
} from '../app';

export class UserSession extends UserSessionBase {
  readonly id: string;
  private eventClients = new Map<string, EventClient>();

  constructor(connection: any, role: string) {
    super({ connection, sockId: 'default', channel: RPC_CHANNEL, role, permissions: { '*': ['user'] } });
    this.id = `ws-${nextSessionId()}`;
  }

  getHealth() { return { ok: true, server: 'supachat-server', time: new Date().toISOString() }; }

  async getLogs() { return { lines: await readLogLines() }; }

  logEvent(tag: string, message: string, data: any = {}) {
    taggedLog(str(tag, 'tag', { required: true, max: 24 }), str(message, 'message', { required: true, max: 500 }), data);
    return { ok: true };
  }

  getSettings() { return settings(); }
  patchSettings(payload: any) { return repo.patchSettings(payload); }

  async getConversations() {
    const conversations = repo.listConversations() as any[];
    const results = [];
    for (const conv of conversations) {
      if (conv.encrypted) {
        const pw = convoPassword(conv.id);
        if (pw) { conv.title = await decryptIf(pw, conv.title); conv.encrypted = 1; delete conv.locked; }
        else { conv.title = '\u{1F512} Locked conversation'; conv.locked = true; conv.encrypted = 1; }
      }
      results.push(conv);
    }
    return results;
  }

  async createConversation(payload: any = {}) {
    const title = str(payload.title, 'title') || 'New conversation';
    const password = payload.password ? String(payload.password) : null;
    taggedLog('server', 'conversation_create', { title, encrypted: !!password });
    if (password && password.length < 4) throw new Error('Password must be at least 4 characters');
    const conversation = repo.createConversation(title);
    if (password) {
      const verifier = await createVerifier(password, conversation.id);
      repo.patchConversation(conversation.id, { title: await encryptIf(password, title), encrypted: 1, password_verifier: verifier });
      passwordManager.set(conversation.id, password);
      return await this.getConversation(conversation.id);
    }
    return conversation;
  }

  async duplicateConversation(id: string) {
    const src = repo.getConversation(id) as any;
    if (!src) throw new Error('Conversation not found');
    const pw = convoPassword(id);
    if (src.encrypted && !pw) throw new Error('Cannot duplicate a locked conversation.');
    let plainTitle = src.title || 'Untitled';
    if (pw) plainTitle = await decryptIf(pw, src.title) || 'Untitled';
    const newTitle = 'Copy of ' + plainTitle;
    const newConversation = repo.duplicateConversation(id, newTitle);
    if (pw) {
      const newVerifier = await createVerifier(pw, newConversation.id);
      repo.patchConversation(newConversation.id, { title: await encryptIf(pw, newTitle), password_verifier: newVerifier });
      passwordManager.set(newConversation.id, pw);
      publish(id, 'state_changed', await decryptPublishData(id, { reason: 'conversation_duplicated', conversation: await this.getConversation(newConversation.id), state: repo.state(newConversation.id) }));
      return await this.getConversation(newConversation.id);
    }
    publish(id, 'state_changed', { reason: 'conversation_duplicated', conversation: newConversation, state: repo.state(newConversation.id) });
    return newConversation;
  }

  async getConversation(id: string) {
    const conversation = repo.getConversation(id) as any;
    if (!conversation) return null;
    if (conversation.encrypted) {
      const pw = convoPassword(id);
      if (pw) { conversation.title = await decryptIf(pw, conversation.title); conversation.encrypted = 1; }
    }
    return conversation;
  }

  async patchConversation(id: string, payload: any) {
    const pw = convoPassword(id);
    let ep = { ...payload };
    if (pw && payload.title) ep.title = await encryptIf(pw, payload.title);
    const conversation = repo.patchConversation(id, ep);
    publish(id, 'state_changed', { reason: 'conversation_updated', conversation, state: repo.state(id) });
    return conversation;
  }

  deleteConversation(id: string) { this.unsubscribeConversation(id); passwordManager.remove(id); return repo.deleteConversation(id); }

  async lockConversation(id: string, password: string) {
    if (!password || password.length < 4) throw new Error('Password must be at least 4 characters');
    const conversation = repo.getConversation(id) as any;
    if (!conversation) throw new Error('Conversation not found');
    if (conversation.encrypted) throw new Error('Conversation is already encrypted');
    const verifier = await createVerifier(password, id);
    repo.patchConversation(id, { title: await encryptIf(password, conversation.title), encrypted: 1, password_verifier: verifier });
    passwordManager.set(id, password);
    for (const agent of repo.agents(id) as any[]) repo.patchAgent(id, agent.id, {
      name: await encryptIf(password, agent.name), introduction: await encryptIf(password, agent.introduction),
      appearance: agent.appearance ? await encryptIf(password, agent.appearance) : undefined
    });
    for (const profile of repo.profiles(id) as any[]) repo.patchProfile(id, profile.id, {
      name: await encryptIf(password, profile.name), introduction: await encryptIf(password, profile.introduction),
      appearance: profile.appearance ? await encryptIf(password, profile.appearance) : undefined
    });
    for (const message of repo.messages(id) as any[]) repo.updateMessageContent(message.id, await encryptIf(password, message.content));
    await encryptConversationAttachments(id, password);
    publish(id, 'state_changed', await decryptPublishData(id, { reason: 'conversation_locked', conversation: await this.getConversation(id), state: repo.state(id) }));
    return { locked: true, conversationId: id };
  }

  async unlockConversation(id: string, password: string) {
    const conversation = repo.getConversation(id) as any;
    if (!conversation) throw new Error('Conversation not found');
    if (!conversation.encrypted) throw new Error('Conversation is not encrypted');
    if (!conversation.password_verifier) throw new Error('No verifier found');
    if (!await verifyPassword(password, conversation.password_verifier, id)) throw new Error('Invalid password');
    passwordManager.set(id, password);
    const updated = await this.getConversation(id);
    publish(id, 'state_changed', { reason: 'conversation_unlocked', conversation: updated, state: repo.state(id) });
    return { unlocked: true, conversationId: id };
  }

  checkConversationLock(id: string) {
    const conversation = repo.getConversation(id) as any;
    if (!conversation) throw new Error('Conversation not found');
    return { encrypted: !!conversation.encrypted, unlocked: passwordManager.has(id), conversationId: id };
  }

  async changeConversationPassword(id: string, oldPassword: string, newPassword: string) {
    const conversation = repo.getConversation(id) as any;
    if (!conversation) throw new Error('Conversation not found');
    if (!conversation.encrypted) throw new Error('Conversation is not encrypted');
    const oldPw = convoPassword(id) || oldPassword;
    if (conversation.password_verifier && !(await verifyPassword(oldPassword, conversation.password_verifier, id)))
      throw new Error('Invalid current password');
    if (!newPassword) {
      repo.patchConversation(id, { title: await decryptIf(oldPw, conversation.title) || conversation.title, encrypted: 0, password_verifier: null });
      for (const agent of repo.agents(id) as any[]) {
        const patch: any = {};
        const n = await decryptIf(oldPw, agent.name); if (n !== agent.name) patch.name = n;
        const i = await decryptIf(oldPw, agent.introduction); if (i !== agent.introduction) patch.introduction = i;
        const a = await decryptIf(oldPw, agent.appearance); if (a !== agent.appearance) patch.appearance = a;
        if (Object.keys(patch).length) repo.patchAgent(id, agent.id, patch);
      }
      for (const message of repo.messages(id) as any[]) {
        const c = await decryptIf(oldPw, message.content);
        if (c !== message.content) repo.updateMessageContent(message.id, c);
      }
      await decryptConversationAttachments(id, oldPw);
      passwordManager.remove(id);
      return { changed: true, encrypted: false, conversationId: id };
    }
    if (newPassword.length < 4) throw new Error('New password must be at least 4 characters');
    const verifier = await createVerifier(newPassword, id);
    repo.patchConversation(id, { title: await encryptIf(newPassword, await decryptIf(oldPw, conversation.title) || conversation.title), password_verifier: verifier });
    for (const agent of repo.agents(id) as any[]) {
      repo.patchAgent(id, agent.id, {
        name: await encryptIf(newPassword, await decryptIf(oldPw, agent.name)),
        introduction: await encryptIf(newPassword, await decryptIf(oldPw, agent.introduction)),
        appearance: await encryptIf(newPassword, await decryptIf(oldPw, agent.appearance))
      });
    }
    for (const message of repo.messages(id) as any[]) {
      const c = await decryptIf(oldPw, message.content);
      if (c !== message.content) repo.updateMessageContent(message.id, await encryptIf(newPassword, c));
    }
    await reEncryptConversationAttachments(id, oldPw, newPassword);
    passwordManager.set(id, newPassword);
    return { changed: true, encrypted: true, conversationId: id };
  }

  async getMessages(id: string) {
    const messages = repo.messages(id) as any[];
    const pw = convoPassword(id);
    if (pw) for (const msg of messages) {
      msg.content = await decryptIf(pw, msg.content);
      if (msg.rendered_content) msg.rendered_content = await decryptIf(pw, msg.rendered_content);
      if (msg.speaker_name_snapshot) msg.speaker_name_snapshot = await decryptIf(pw, msg.speaker_name_snapshot);
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.metadata?.prompt) att.metadata.prompt = await decryptIf(pw, att.metadata.prompt);
          if (att.metadata?.originalPrompt) att.metadata.originalPrompt = await decryptIf(pw, att.metadata.originalPrompt);
        }
      }
    }
    return messages;
  }

  async addMessage(id: string, payload: any) { return createMessageFromBody(id, payload); }
  deleteMessage(id: string, messageId: string) {
    invalidatePendingDiceRolls(id, [messageId]);
    return repo.deleteMessage(id, messageId);
  }
  deleteMessagesFrom(id: string, messageId: string) {
    const messages = repo.messages(id) as any[];
    const target = messages.find(message => message.id === messageId);
    if (!target) return { deleted: 0 };
    const messageIds = messages
      .filter(message => message.sequence >= target.sequence && message.kind !== 'character_description')
      .map(message => message.id);
    invalidatePendingDiceRolls(id, messageIds);
    return repo.deleteMessagesFrom(id, messageId);
  }

  async updateMessage(id: string, messageId: string, content: string) {
    content = str(content, 'content', { required: true, max: 20000 });
    const pw = convoPassword(id);
    const storedContent = pw ? await encryptIf(pw, content) : content;
    const message = repo.updateMessageContent(messageId, storedContent) as any;
    if (!message) return null;
    publish(id, 'message_updated', { message_id: messageId, message: messageForEvent({ ...message, content, rendered_content: content }) });
    return messageForEvent({ ...message, content, rendered_content: content });
  }

  async regenerateMessage(id: string, messageId: string) {
    const messages = repo.messages(id) as any[];
    const target = messages.find(m => m.id === messageId);
    if (!target) return null;
    invalidatePendingDiceRolls(id, [messageId]);
    repo.deleteMessage(id, messageId);
    publish(id, 'message_deleted', { message_id: messageId });
    if (target.role === 'assistant' && target.speaker_id) {
      const conversation = repo.getConversation(id) as any;
      const profile = conversation?.state?.active_profile_id ? (repo.profiles(id) as any[]).find(p => p.id === conversation.state.active_profile_id) : null;
      const agent = (repo.agents(id) as any[]).find(a => a.id === target.speaker_id);
      if (agent) generateAssistantMessage(id, agent, profile).catch(e => publish(id, 'error', { message: e.message || String(e) }));
    }
    return { deleted: true };
  }

  runAction(id: string, action: string, payload: any = {}) { return runActionFromBody(id, action, payload); }

  async resolveDiceRoll(conversationId: string, toolCallId: string, value: number) {
    const { resolveDiceRoll } = await import('../app');
    return resolveDiceRoll(conversationId, toolCallId, value);
  }

  async getPendingDiceRoll(conversationId: string) {
    const { getPendingDiceRoll } = await import('../app');
    return getPendingDiceRoll(conversationId);
  }

  async getAgents(id: string) {
    const agents = repo.agents(id) as any[];
    const pw = convoPassword(id);
    if (pw) for (const agent of agents) {
      agent.name = await decryptIf(pw, agent.name);
      agent.introduction = await decryptIf(pw, agent.introduction);
      if (agent.appearance) agent.appearance = await decryptIf(pw, agent.appearance);
    }
    return agents;
  }

  async createAgent(id: string, payload: any) {
    const pw = convoPassword(id);
    let ep = { ...payload };
    if (pw) { ep.name = await encryptIf(pw, str(payload.name, 'name', { required: true, max: 100 })); ep.introduction = await encryptIf(pw, payload.introduction || ''); ep.appearance = await encryptIf(pw, payload.appearance || ''); }
    const agent = repo.createAgent(id, { ...ep, name: pw ? ep.name : str(payload.name, 'name', { required: true, max: 100 }) }) as any;
    if (pw && agent) { agent.name = await decryptIf(pw, agent.name); agent.introduction = await decryptIf(pw, agent.introduction); if (agent.appearance) agent.appearance = await decryptIf(pw, agent.appearance); }
    publish(id, 'state_changed', await decryptPublishData(id, { reason: 'agent_created', agent, agents: repo.agents(id), state: repo.state(id) }));
    return agent;
  }

  async patchAgent(id: string, agentId: string, payload: any) {
    const pw = convoPassword(id);
    let ep = { ...payload };
    if (pw) { if (payload.name) ep.name = await encryptIf(pw, payload.name); if (payload.introduction) ep.introduction = await encryptIf(pw, payload.introduction); if (payload.appearance) ep.appearance = await encryptIf(pw, payload.appearance); }
    const agent = repo.patchAgent(id, agentId, ep) as any;
    if (pw && agent) { agent.name = await decryptIf(pw, agent.name); agent.introduction = await decryptIf(pw, agent.introduction); if (agent.appearance) agent.appearance = await decryptIf(pw, agent.appearance); }
    publish(id, 'state_changed', await decryptPublishData(id, { reason: 'agent_updated', agent, agents: repo.agents(id), state: repo.state(id) }));
    return agent;
  }

  async deleteAgent(id: string, agentId: string) {
    const r = repo.deleteAgent(id, agentId);
    publish(id, 'state_changed', await decryptPublishData(id, { reason: 'agent_deleted', agentId, agents: repo.agents(id), state: repo.state(id) }));
    return r;
  }

  async getProfiles(id: string) {
    const profiles = repo.profiles(id) as any[];
    const pw = convoPassword(id);
    if (pw) for (const profile of profiles) {
      profile.name = await decryptIf(pw, profile.name); profile.introduction = await decryptIf(pw, profile.introduction);
      if (profile.appearance) profile.appearance = await decryptIf(pw, profile.appearance);
    }
    return profiles;
  }

  async createProfile(id: string, payload: any) {
    const pw = convoPassword(id);
    let ep = { ...payload };
    if (pw) { ep.name = await encryptIf(pw, str(payload.name, 'name', { required: true, max: 100 })); ep.introduction = await encryptIf(pw, payload.introduction || ''); ep.appearance = await encryptIf(pw, payload.appearance || ''); }
    const profile = repo.createProfile(id, { ...ep, name: pw ? ep.name : str(payload.name, 'name', { required: true, max: 100 }) }) as any;
    if (pw && profile) { profile.name = await decryptIf(pw, profile.name); profile.introduction = await decryptIf(pw, profile.introduction); if (profile.appearance) profile.appearance = await decryptIf(pw, profile.appearance); }
    publish(id, 'state_changed', await decryptPublishData(id, { reason: 'profile_created', profile, profiles: repo.profiles(id), state: repo.state(id) }));
    return profile;
  }

  async patchProfile(id: string, profileId: string, payload: any) {
    const pw = convoPassword(id);
    let ep = { ...payload };
    if (pw) { if (payload.name) ep.name = await encryptIf(pw, payload.name); if (payload.introduction) ep.introduction = await encryptIf(pw, payload.introduction); if (payload.appearance) ep.appearance = await encryptIf(pw, payload.appearance); }
    const profile = repo.patchProfile(id, profileId, ep) as any;
    if (pw && profile) { profile.name = await decryptIf(pw, profile.name); profile.introduction = await decryptIf(pw, profile.introduction); if (profile.appearance) profile.appearance = await decryptIf(pw, profile.appearance); }
    publish(id, 'state_changed', await decryptPublishData(id, { reason: 'profile_updated', profile, profiles: repo.profiles(id), state: repo.state(id) }));
    return profile;
  }

  async deleteProfile(id: string, profileId: string) {
    const r = repo.deleteProfile(id, profileId);
    publish(id, 'state_changed', await decryptPublishData(id, { reason: 'profile_deleted', profileId, profiles: repo.profiles(id), state: repo.state(id) }));
    return r;
  }

  async getStoryEntries(id: string) { return repo.storyEntries(id); }
  async createStoryEntry(id: string, payload: any) { const e = repo.createStoryEntry(id, payload); publish(id, 'state_changed', { storyEntries: repo.storyEntries(id) }); return e; }
  async patchStoryEntry(id: string, eid: string, payload: any) { const e = repo.patchStoryEntry(id, eid, payload); publish(id, 'state_changed', { storyEntries: repo.storyEntries(id) }); return e; }
  async deleteStoryEntry(id: string, eid: string) { const r = repo.deleteStoryEntry(id, eid); publish(id, 'state_changed', { storyEntries: repo.storyEntries(id) }); return r; }

  async getOllamaModels() { return await listOllamaModels((settings().ai || defaults.ai).ollamaBaseUrl || defaults.ai.ollamaBaseUrl); }
  getDrawThingsStatus() { const dt = settings().drawThings || defaults.drawThings; return { available: Boolean(dt.enabled), configured: Boolean(dt.enabled), message: dt.enabled ? 'Configured' : 'Unconfigured or disabled', settings: dt }; }

  async probeDrawThings(payload: any = {}) {
    const current = settings();
    const candidate = payload.drawThings || payload;
    const baseUrl = candidate.baseUrl || current.drawThings?.baseUrl || defaults.drawThings.baseUrl;
    const modelsDir = candidate.modelsDir || current.drawThings?.modelsDir || defaults.drawThings.modelsDir;
    try { const p = await probeDrawThings(baseUrl, modelsDir); const dt = { ...current.drawThings, ...candidate, baseUrl, modelsDir, enabled: true, lastProbe: p }; repo.patchSettings({ drawThings: dt }); return { available: true, configured: true, message: 'Draw Things API available', settings: dt, probe: p }; }
    catch (e: any) { return { available: false, configured: false, message: e.message || String(e), settings: { ...current.drawThings, ...candidate, baseUrl, modelsDir, enabled: false } }; }
  }

  getDrawThingsModels() { const dt = settings().drawThings || defaults.drawThings; return { modelsDir: dt.modelsDir || defaults.drawThings.modelsDir, models: listDrawThingsModels(dt.modelsDir || defaults.drawThings.modelsDir) }; }
  getVoices() { return listVoices(settings().piper); }
  getKokoroVoices() { return listKokoroVoices(settings().kokoro); }
  kokoroModelStatus() { return isKokoroModelReady(settings().kokoro); }
  async downloadKokoroVoice(voiceId: string) { return downloadKokoroVoice(settings().kokoro, str(voiceId, 'voiceId', { required: true })); }

  async generateText(payload: any = {}) {
    const prompt = str(payload.prompt, 'prompt', { required: true, max: 20000 });
    const ai = settings().ai || defaults.ai;
    const model = str(payload.model, 'model') || ai.model || defaults.ai.model;
    const r = await chatOllama([{ role: 'system', content: 'You are a creative writing assistant.' }, { role: 'user', content: prompt }], { baseUrl: ai.ollamaBaseUrl || defaults.ai.ollamaBaseUrl, model, think: payload.think === true, tools: [], numCtx: aiNumCtx(ai), temperature: ai.temperature ?? 0.8 });
    return { text: (r.message && r.message.content) || '' };
  }

  async runCommand(payload: any) {
    const cid = str(payload.conversationId, 'conversationId', { required: true });
    const r = await runCommand(repo, cid, str(payload.command, 'command', { required: true }), { audioDir: audioDir(settings()) || join(cfg.dataDir, 'audio'), imageDir: join(cfg.dataDir, 'images') }, { encryptIf, decryptIf, convoPassword });
    if (r && ['bye', 'to', 'auto', 'stop', 'achar', 'iam', 'rchar', 'allow-tool'].includes(r.command)) {
      const eventData = (r.command === 'achar' || r.command === 'iam')
        ? await decryptPublishData(cid, { reason: `command_${r.command}`, conversation: repo.getConversation(cid), state: repo.state(cid), agents: repo.agents(cid), profiles: repo.profiles(cid) })
        : { reason: `command_${r.command}`, conversation: repo.getConversation(cid), state: repo.state(cid), agents: repo.agents(cid), profiles: repo.profiles(cid) };
      publish(cid, 'state_changed', eventData);
    }
    return r;
  }

  subscribeConversation(cid: string, sinceEventId = '') {
    this.unsubscribeConversation(cid);
    const client = subscribeEvents(cid, (name: EventName, data: any) => { this.client[name](data); }, sinceEventId || undefined);
    this.eventClients.set(cid, client);
    return { subscribed: true, conversationId: cid };
  }

  unsubscribeConversation(cid: string) {
    const client = this.eventClients.get(cid);
    if (client) { unsubscribeEvents(client); this.eventClients.delete(cid); }
    return { subscribed: false, conversationId: cid };
  }

  close() {
    for (const c of this.eventClients.values()) unsubscribeEvents(c);
    this.eventClients.clear();
    super.close();
  }
}
