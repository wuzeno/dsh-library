import { LibraryError, requireValue, normalizeSourcePath } from './store.js';
export const API_PATH = '/api/dsh-library';
export const BACKEND_VERSION = '1.0.0';
const USER_ACTIONS = new Set(['snapshot', 'configure', 'create', 'link', 'unlink', 'rename', 'archive', 'restoreLibrary', 'deleteLibrary', 'import', 'exclude', 'trashFile', 'trashAll', 'restoreFile', 'purgeFile', 'emptyTrash', 'sessionScope', 'setSessionScope']);

/** A single application operation shared by UI and safe agent tools. Authority-granting actions stay HTTP-user-only. */
export async function dispatch(store, input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input) && USER_ACTIONS.has(input.action), 'INVALID_REQUEST', '未知资料库操作。');
  switch (input.action) {
    case 'snapshot': {
      const snapshot = await store.snapshot();
      // Advertise the running handler's ability, not just the on-disk package/client.
      // A local-link reload can leave a different store/handler generation alive.
      return { ...snapshot, backendVersion: BACKEND_VERSION, capabilities: { ...snapshot.capabilities, trashAll: USER_ACTIONS.has('trashAll') && typeof store.trashAll === 'function', deleteLibrary: USER_ACTIONS.has('deleteLibrary') && typeof store.deleteLibrary === 'function' } };
    }
    case 'configure': return store.configure(input);
    case 'create': return store.create(input);
    case 'link': return store.link(input);
    case 'unlink': case 'rename': case 'archive': case 'restoreLibrary': return store.update(input);
    case 'import': return store.importFile(input);
    case 'exclude': case 'trashFile': case 'restoreFile': return store.fileAction(input);
    case 'trashAll':
      requireValue(typeof store.trashAll === 'function', 'BACKEND_UPDATE_REQUIRED', '批量回收后端尚未完整加载。请完整退出 DSH（包括托盘后台进程）后重新启动并刷新页面，不要删除资料目录。');
      return store.trashAll(input);
    case 'purgeFile': return store.purgeFile(input);
    case 'emptyTrash': return store.emptyTrash(input);
    case 'deleteLibrary':
      requireValue(typeof store.deleteLibrary === 'function', 'BACKEND_UPDATE_REQUIRED', '删除资料库后端尚未完整加载。请完整退出 DSH（包括托盘后台进程）后重新启动并刷新页面，不要手动删除资料目录。');
      return store.deleteLibrary(input);
    case 'sessionScope': return store.scope(input.sessionId);
    case 'setSessionScope': return store.setScope(input);
    default: throw new LibraryError('INVALID_REQUEST', '未知资料库操作。');
  }
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

/** Runs inside DSH's authenticated shared Fetch channel, never an unauthenticated custom server. */
export function createFetchHandler(store, connection) {
  return async request => {
    try {
      const admission = connection.admit({ headers: request.headers });
      if ('rejection' in admission) return json(admission.rejection, { ok: false, error: { code: 'UNAUTHENTICATED', message: '请从已登录的 DSH 界面使用资料库。' } });
      // API peers / model-side HTTP tools cannot grant themselves library access.
      if (admission.peer.id !== connection.browserPeer.id) return json(403, { ok: false, error: { code: 'USER_ONLY', message: '资料库管理和授权仅对已登录浏览器用户开放。' } });
      if (request.method !== 'POST') return json(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '仅接受 POST。' } });
      const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      const binary = contentType === 'application/octet-stream';
      requireValue(request.headers.get('X-DSH-Library') === '1' && (binary || contentType === 'application/json'), 'INVALID_REQUEST', '请求格式不正确。');
      let upload;
      if (binary) {
        const header = (key, max, required = true) => {
          const value = request.headers.get(key);
          requireValue((!required && value === null) || (typeof value === 'string' && value.length > 0 && value.length <= max), 'INVALID_HEADER', '上传请求头缺失或过长。');
          return value;
        };
        requireValue(header('X-DSH-Library-Action', 32) === 'import', 'INVALID_REQUEST', '二进制请求仅支持 import。');
        const libraryId = header('X-DSH-Library-Id', 160);
        requireValue(/^[a-zA-Z0-9_-]{1,160}$/.test(libraryId), 'INVALID_HEADER', '资料库标识不正确。');
        const decode = value => {
          try { return decodeURIComponent(value); }
          catch { throw new LibraryError('INVALID_HEADER', '上传请求头 URL 编码不正确。'); }
        };
        const name = decode(header('X-DSH-Library-Name', 2160));
        requireValue(name.length > 0 && name.length <= 240 && name === name.trim() && !/[\\/:\x00-\x1f\x7f-\x9f]/.test(name) && name !== '.' && name !== '..', 'INVALID_NAME', '文件名不正确。');
        const source = header('X-DSH-Library-Source-Path', 9216, false);
        upload = { libraryId, name, sourcePath: normalizeSourcePath(source === null ? undefined : decode(source), name) };
      }
      // No CORS headers; both encodings share authenticated browser-only admission.
      const limit = binary ? store.maxFileBytes() : 15 * 1024 * 1024;
      const length = Number(request.headers.get('Content-Length') || 0);
      requireValue(Number.isFinite(length) && length >= 0 && length <= limit, 'REQUEST_TOO_LARGE', '请求过大。');
      const reader = request.body?.getReader(); const chunks = []; let size = 0;
      if (reader) { try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; requireValue(size <= (binary ? Math.min(limit, store.maxFileBytes()) : limit), 'REQUEST_TOO_LARGE', '请求过大。'); chunks.push(part.value); } } finally { await reader.cancel().catch(() => {}); } }
      const bytes = Buffer.concat(chunks, size);
      let value;
      if (binary) value = await store.importBytes({ ...upload, bytes });
      else {
        const input = JSON.parse(bytes.toString('utf8'));
        requireValue(input?.action === 'import' || size <= 256 * 1024, 'REQUEST_TOO_LARGE', '管理请求过大。');
        if (input?.action === 'download') {
          const original = await store.original(input);
          return new Response(original.bytes, { status: 200, headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(original.name).replace(/['()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())}`,
            'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
          } });
        }
        value = await dispatch(store, input);
      }
      return json(200, { ok: true, value });
    } catch (error) {
      const known = error instanceof LibraryError || error instanceof SyntaxError;
      const code = error.code || 'INTERNAL_ERROR';
      return json(['REQUEST_TOO_LARGE', 'FILE_TOO_LARGE'].includes(code) ? 413 : known ? 400 : 500, { ok: false, error: { code, message: known ? error.message : '操作失败，可能是目录权限、文件占用或原件损坏。请检查本地目录后重试。' } });
    }
  };
}
