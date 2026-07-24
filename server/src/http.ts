import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { cfg, repo, settings, audioDir, taggedLog, isPlainAttachmentBuffer, clientDir, runActionFromBody } from './app';
import { passwordManager } from './services/passwordManager';
import { decryptFile, encryptFile } from './services/crypto';

function serveIndex() {
  const indexPath = join(clientDir, 'index.html');
  try {
    const content = readFileSync(indexPath);
    return new Response(content, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch { return new Response('Not found', { status: 404 }); }
}

async function asset(path: string) {
  const rel = path.replace('/assets/', '');
  const isFlat = /^(images|audio)\/[A-Za-z0-9._-]+$/.test(rel);
  const isKokoro = /^kokoro\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(rel);
  if (!isFlat && !isKokoro) return new Response(JSON.stringify({ error: 'Invalid asset path' }), { status: 400, headers: { 'content-type': 'application/json' } });
  let baseDir: string, relPath: string, filename = '';
  if (rel.startsWith('audio/')) { baseDir = audioDir(settings()) || join(cfg.dataDir, 'audio'); relPath = rel.slice('audio/'.length); filename = relPath; }
  else if (rel.startsWith('kokoro/')) { baseDir = settings().kokoro.modelDir; relPath = rel.slice('kokoro/'.length); }
  else { baseDir = cfg.dataDir; relPath = rel; filename = rel.replace('images/', ''); }
  const file = normalize(join(baseDir, relPath));
  if (!file.startsWith(normalize(baseDir))) return new Response(JSON.stringify({ error: 'Invalid asset path' }), { status: 400, headers: { 'content-type': 'application/json' } });
  try { statSync(file); } catch { return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } }); }
  if (filename && (rel.startsWith('images/') || rel.startsWith('audio/'))) {
    const att = repo.attachmentByFilename(filename) as any;
    if (att?.conversation_id) {
      const conv = repo.getConversation(att.conversation_id) as any;
      if (conv?.encrypted) {
        const pw = passwordManager.get(att.conversation_id);
        if (!pw) return new Response(JSON.stringify({ error: 'Conversation is locked' }), { status: 423, headers: { 'content-type': 'application/json' } });
        const buf = readFileSync(file) as Buffer;
        const dec = await decryptFile(buf, pw);
        if (dec) return new Response(dec, { headers: { 'Content-Type': att.mime_type || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } });
        if (isPlainAttachmentBuffer(buf, att)) { writeFileSync(file, await encryptFile(buf, pw)); return new Response(buf, { headers: { 'Content-Type': att.mime_type || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } }); }
        return new Response(JSON.stringify({ error: 'Encrypted asset could not be decrypted' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
    }
  }
  return new Response(Bun.file(file), { headers: isFlat ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {} });
}

async function handle(req: Request) {
  try {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/api/health') return new Response(JSON.stringify({ ok: true, server: 'supachat-server', time: new Date().toISOString() }), { headers: { 'content-type': 'application/json' } });
    if (path.startsWith('/assets/')) return asset(path);

    // Generic action route: POST /api/conversations/:id/actions/:action
    const actionMatch = path.match(/^\/api\/conversations\/([^/]+)\/actions\/([^/]+)$/);
    if (actionMatch && req.method === 'POST') {
      const cid = actionMatch[1];
      const action = actionMatch[2];
      const body = await req.json();
      const result = await runActionFromBody(cid, action, body);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  } catch (error: any) {
    taggedLog('server', 'api_error', { path: new URL(req.url).pathname, message: error.message || String(error) });
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

async function serve(req: Request, server: Bun.Server) {
  const url = new URL(req.url);
  if (url.pathname === '/ws') { if (server.upgrade(req, { data: { role: 'user' } })) return; return new Response('WebSocket upgrade failed', { status: 500 }); }
  const result = await handle(req);
  if (result.status === 404 && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/assets/')) return serveIndex();
  return result;
}

export { handle, serve };
