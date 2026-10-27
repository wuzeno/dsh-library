import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, lstat, realpath, open, unlink, rm } from 'node:fs/promises';

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // Default; use store.maxFileBytes() for the active limit.
const validMaxFileMiB = value => Number.isInteger(value) && value >= 1 && value <= 200;
export function normalizeSourcePath(sourcePath, name) {
  if (sourcePath === undefined) return undefined;
  requireValue(typeof sourcePath === 'string' && sourcePath.length > 0 && sourcePath.length <= 1024 && !/[\x00-\x1f\x7f-\x9f]/.test(sourcePath), 'INVALID_SOURCE_PATH', '来源相对路径为空、过长或含控制字符。');
  const normalized = sourcePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  requireValue(!normalized.includes(':') && parts.every(part => part && part !== '.' && part !== '..') && parts.at(-1) === name, 'INVALID_SOURCE_PATH', '来源路径必须为相对路径且末尾与文件名一致。');
  return normalized;
}
export const FORMATS = ['.txt', '.md', '.docx', '.pdf'];
export class LibraryError extends Error {
  constructor(code, message) { super(message); this.name = 'LibraryError'; this.code = code; }
}
export function requireValue(test, code, message) { if (!test) throw new LibraryError(code, message); }
export const initialState = () => ({ version: 1, settings: { root: null, cloudConsent: false, originalConsent: false, maxFileMiB: 50 }, libraries: [], knownWorkspaces: [], pending: [], sessionScopes: {} });
const stamp = () => new Date().toISOString();
const clone = value => structuredClone(value);
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
const trimName = (name, max = 120) => {
  requireValue(typeof name === 'string' && name.trim().length > 0 && name.length <= max && !/[\x00-\x1f]/.test(name), 'INVALID_NAME', '名称不能为空、过长或含控制字符。');
  return name.trim();
};

/** Refuse symbolic links / junctions on every existing ancestor, before any write. */
export async function assertPlainPath(target) {
  requireValue(path.isAbsolute(target) && !target.startsWith('\\\\') && !target.startsWith('\\\\?'), 'INVALID_PATH', '请选择本机磁盘上的绝对目录，不支持网络路径。');
  const normalized = path.resolve(target);
  let cursor = path.parse(normalized).root;
  for (const part of normalized.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      const info = await lstat(cursor);
      const actual = path.resolve(await realpath(cursor));
      const expected = path.resolve(cursor);
      const same = process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
      requireValue(!info.isSymbolicLink() && same, 'UNSAFE_PATH', '路径含符号链接或目录联接，拒绝访问。');
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; break; }
  }
  return normalized;
}
export async function atomicJson(filename, value) {
  await assertPlainPath(filename);
  const tmp = `${filename}.${randomUUID()}.tmp`;
  try {
    const handle = await open(tmp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2), 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(tmp, filename);
  } catch (error) { await unlink(tmp).catch(() => {}); throw error; }
}

// Resolve existing ancestors as well as missing tails, including aliases in legacy records.
async function canonicalPath(target) {
  let cursor = path.resolve(target); const missing = [];
  for (;;) {
    try { return path.resolve(await realpath(cursor), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(cursor) === cursor) throw error;
      missing.unshift(path.basename(cursor)); cursor = path.dirname(cursor);
    }
  }
}
const containsPath = (parent, child) => {
  if (process.platform === 'win32') { parent = parent.toLowerCase(); child = child.toLowerCase(); }
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
async function pathForms(target) { return [path.resolve(target), await canonicalPath(target)]; }
const containsAny = (parents, children) => parents.some(parent => children.some(child => containsPath(parent, child)));

/** All mutation operations share one queue; failed persistence rolls in-memory metadata back. */
export class LibraryStore {
  constructor({ state = initialState(), persist, workspaces = () => [], removeFile = unlink, removeDirectory = (target, options) => rm(target, options) }) {
    requireValue(state?.version === 1 && Array.isArray(state.libraries) && Array.isArray(state.knownWorkspaces) && Array.isArray(state.pending) && state.settings && state.sessionScopes && typeof state.sessionScopes === 'object', 'INVALID_STATE', '资料库元数据格式不正确，拒绝覆盖。');
    this.state = clone(state);
    this.state.settings.originalConsent = this.state.settings.originalConsent === true;
    if (this.state.settings.maxFileMiB === undefined) this.state.settings.maxFileMiB = 50;
    requireValue(validMaxFileMiB(this.state.settings.maxFileMiB), 'INVALID_SETTINGS', 'maxFileMiB 必须为 1 至 200 的整数。');
    this.persist = persist; this.workspaces = workspaces;
    // Trusted filesystem boundary permits deterministic unlink-failure testing; never supplied by HTTP.
    this.removeFile = removeFile;
    this.removeDirectory = removeDirectory;
    this.tail = Promise.resolve(); this.revision = 0;
  }
  transact(operation) {
    const task = this.tail.then(async () => {
      const before = clone(this.state);
      try { const result = await operation(); await this.persist(clone(this.state)); this.revision++; return result; }
      catch (error) { this.state = before; throw error; }
    });
    this.tail = task.catch(() => {}); return task;
  }
  library(id, active = false) {
    requireValue(safeId(id), 'INVALID_ID', '资料库标识不正确。');
    const item = this.state.libraries.find(x => x.id === id);
    requireValue(item && (!active || !item.archived), 'LIBRARY_NOT_FOUND', '资料库不存在或已停用。'); return item;
  }
  file(lib, id) {
    requireValue(safeId(id), 'INVALID_ID', '文件标识不正确。');
    const item = lib.files.find(x => x.id === id); requireValue(item, 'FILE_NOT_FOUND', '文件不存在。'); return item;
  }
  workspace(id) { const item = this.workspaces().find(x => String(x.id) === id); requireValue(item, 'WORKSPACE_NOT_FOUND', '工作区不存在，请刷新。'); return item; }
  async directory(lib, create = false) {
    const target = await assertPlainPath(lib.path);
    requireValue(path.basename(target) === lib.id, 'UNSAFE_PATH', '资料库目录与标识不一致。');
    if (create) await mkdir(target, { recursive: false });
    const canonical = await realpath(target);
    requireValue(path.resolve(canonical).toLowerCase() === target.toLowerCase(), 'UNSAFE_PATH', '资料库路径发生变化。');
    if (!create) {
      const markerPath = path.join(target, '.dsh-library.json'); await assertPlainPath(markerPath);
      const marker = JSON.parse(await readFile(markerPath, 'utf8'));
      requireValue(marker.id === lib.id && marker.kind === 'dsh-library', 'UNSAFE_PATH', '资料库所有权标记不匹配。');
    }
    return target;
  }
  async filePath(lib, kind, file) {
    const base = await this.directory(lib);
    const target = path.join(base, kind, kind === 'originals' ? `${file.id}${file.ext}` : `${file.id}.json`);
    await assertPlainPath(target); return target;
  }
  async assertLibrarySeparation(target, { root = false, deleting } = {}) {
    const candidate = await pathForms(target);
    for (const lib of this.state.libraries) {
      if (lib === deleting) continue;
      const registered = await pathForms(lib.path);
      const conflict = deleting ? containsAny(candidate, registered)
        : containsAny(registered, candidate) || (!root && containsAny(candidate, registered));
      requireValue(!conflict, 'NESTED_LIBRARY_PATH', '路径与已登记资料库重叠，拒绝嵌套建库或删除包含其他资料库的目录。');
    }
  }
  async createInternal(workspaceId, name) {
    const ws = this.workspace(workspaceId);
    const existing = this.state.libraries.find(x => !x.archived && x.workspaceId === workspaceId);
    if (existing) return clone(existing);
    requireValue(this.state.settings.root, 'ROOT_REQUIRED', '请先在存储设置中选择资料库根目录。');
    const root = await assertPlainPath(this.state.settings.root);
    await this.assertLibrarySeparation(root, { root: true });
    await mkdir(root, { recursive: true });
    const id = randomUUID(); const now = stamp();
    const lib = { id, name: trimName(name || `${ws.title} 资料库`), workspaceId, workspaceTitle: ws.title, path: path.join(root, id), createdAt: now, updatedAt: now, archived: false, files: [] };
    await this.assertLibrarySeparation(lib.path);
    await this.directory(lib, true);
    await atomicJson(path.join(lib.path, '.dsh-library.json'), { kind: 'dsh-library', version: 1, id, createdAt: now });
    await mkdir(path.join(lib.path, 'originals'));
    await atomicJson(path.join(lib.path, 'manifest.json'), { version: 1, ...lib });
    this.state.libraries.push(lib); this.state.pending = this.state.pending.filter(x => x.workspaceId !== workspaceId);
    if (!this.state.knownWorkspaces.includes(workspaceId)) this.state.knownWorkspaces.push(workspaceId);
    return clone(lib);
  }
  async manifest(lib) {
    lib.updatedAt = stamp(); await this.directory(lib);
    await atomicJson(path.join(lib.path, 'manifest.json'), { version: 1, ...lib });
  }
  /** Startup observes unknown workspaces but does not silently import old ones. Live events auto-create. */
  async reconcile({ startup = false } = {}) {
    return this.transact(async () => {
      const all = this.workspaces(); const ids = new Set(all.map(x => String(x.id)));
      for (const lib of this.state.libraries) {
        if (lib.workspaceId && !ids.has(lib.workspaceId)) { lib.workspaceId = null; lib.workspaceTitle = null; }
        else if (lib.workspaceId) lib.workspaceTitle = this.workspace(lib.workspaceId).title;
      }
      for (const ws of all) {
        const id = String(ws.id);
        if (this.state.knownWorkspaces.includes(id)) continue;
        this.state.knownWorkspaces.push(id);
        if (!startup && this.state.settings.root) {
          try { await this.createInternal(id); }
          catch (error) { this.state.pending.push({ workspaceId: id, title: ws.title, error: error.message, automatic: true }); }
        } else this.state.pending.push({ workspaceId: id, title: ws.title, error: '已有工作区，请手动创建或关联资料库。' });
      }
      this.state.pending = this.state.pending.filter(x => ids.has(x.workspaceId));
      if (!startup && this.state.settings.root) {
        for (const item of [...this.state.pending].filter(x => x.automatic)) {
          try { await this.createInternal(item.workspaceId); } catch (error) { item.error = error.message; }
        }
      }
      return true;
    });
  }
  async snapshot() {
    await this.tail;
    const libraries = clone(this.state.libraries);
    const workspaces = this.workspaces().map(ws => ({ id: String(ws.id), title: ws.title, path: ws.path, libraryId: libraries.find(x => !x.archived && x.workspaceId === String(ws.id))?.id || null }));
    for (const lib of libraries) lib.workspaceTitle = workspaces.find(x => x.id === lib.workspaceId)?.title || null;
    return { settings: clone(this.state.settings), workspaces, libraries, pending: clone(this.state.pending), capabilities: { acceptsAllFiles: true, onDemandOriginals: true, automaticExtraction: false, maxFileBytes: this.maxFileBytes() } };
  }
  maxFileBytes() { return this.state.settings.maxFileMiB * 1024 * 1024; }
  async configure({ root, cloudConsent, originalConsent, maxFileMiB }) {
    return this.transact(async () => {
      const limit = maxFileMiB === undefined ? this.state.settings.maxFileMiB : maxFileMiB;
      requireValue(validMaxFileMiB(limit), 'INVALID_SETTINGS', 'maxFileMiB 必须为 1 至 200 的整数。');
      const normalized = await assertPlainPath(root === undefined ? this.state.settings.root : root);
      await this.assertLibrarySeparation(normalized, { root: true });
      await mkdir(normalized, { recursive: true });
      const info = await lstat(normalized); requireValue(info.isDirectory(), 'INVALID_PATH', '存储位置不是目录。');
      const probe = path.join(normalized, `.dsh-write-test-${randomUUID()}`);
      const handle = await open(probe, 'wx', 0o600); await handle.close(); await unlink(probe);
      this.state.settings = { root: await realpath(normalized), cloudConsent: cloudConsent === undefined ? this.state.settings.cloudConsent : cloudConsent === true, originalConsent: originalConsent === undefined ? this.state.settings.originalConsent : originalConsent === true, maxFileMiB: limit };
      return clone(this.state.settings);
    });
  }
  create({ workspaceId, name }) { return this.transact(() => this.createInternal(workspaceId, name)); }
  link({ workspaceId, libraryId }) {
    return this.transact(async () => {
      const ws = this.workspace(workspaceId); const lib = this.library(libraryId, true);
      requireValue(!lib.workspaceId || lib.workspaceId === workspaceId, 'ALREADY_LINKED', '资料库已关联其他工作区，请先解除关联。');
      requireValue(!this.state.libraries.some(x => !x.archived && x.workspaceId === workspaceId && x.id !== libraryId), 'ALREADY_LINKED', '该工作区已有资料库，请先解除原关联。');
      lib.workspaceId = workspaceId; lib.workspaceTitle = ws.title; await this.manifest(lib);
      this.state.pending = this.state.pending.filter(x => x.workspaceId !== workspaceId); return clone(lib);
    });
  }
  update({ libraryId, action, name }) {
    return this.transact(async () => {
      const lib = this.library(libraryId);
      if (action === 'rename') lib.name = trimName(name);
      else if (action === 'unlink') { lib.workspaceId = null; lib.workspaceTitle = null; }
      else if (action === 'archive') { lib.archived = true; lib.workspaceId = null; lib.workspaceTitle = null; }
      else if (action === 'restoreLibrary') {
        requireValue(!lib.deletePending, 'DELETE_PENDING', '此资料库已开始永久删除，部分文件可能已移除，不能恢复；请重试删除资料库。');
        lib.archived = false;
      }
      else throw new LibraryError('UNKNOWN_ACTION', '未知操作。');
      await this.manifest(lib); return clone(lib);
    });
  }
  async importFile({ libraryId, name, base64, sourcePath }) {
    requireValue(typeof base64 === 'string' && base64.length > 0 && base64.length <= Math.ceil(this.maxFileBytes() / 3) * 4 && base64.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(base64), 'INVALID_UPLOAD', '文件过大或上传编码不正确。');
    const bytes = Buffer.from(base64, 'base64');
    requireValue(bytes.toString('base64') === base64, 'INVALID_UPLOAD', '文件编码不是标准 Base64。');
    return this.importBytes({ libraryId, name, bytes, sourcePath });
  }
  async importBytes({ libraryId, name, bytes, sourcePath }) {
    requireValue(bytes instanceof Uint8Array, 'INVALID_UPLOAD', '上传内容必须为文件字节。');
    requireValue(bytes.byteLength > 0 && bytes.byteLength <= this.maxFileBytes(), 'FILE_TOO_LARGE', '文件为空或超过当前单文件大小上限。');
    // Own a bounded copy so caller mutation cannot change the bytes while queued.
    const buffer = Buffer.from(bytes);
    return this.transact(async () => {
      const lib = this.library(libraryId, true); const cleanName = trimName(name, 240);
      requireValue(!/[\\/:\x00-\x1f\x7f-\x9f]/.test(cleanName) && cleanName !== '.' && cleanName !== '..', 'INVALID_NAME', '文件名不能含目录、控制字符或磁盘路径。');
      // Original names are metadata only. A bounded ASCII suffix keeps UUID disk names safe.
      const originalExtension = path.extname(cleanName).toLowerCase();
      const ext = /^\.[a-z0-9]{1,16}$/.test(originalExtension) ? originalExtension : '';
      const relativeSource = normalizeSourcePath(sourcePath, cleanName);
      requireValue(buffer.length <= this.maxFileBytes(), 'FILE_TOO_LARGE', '文件超过当前单文件大小上限。');
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const duplicate = lib.files.find(x => x.sha256 === sha256 && x.status !== 'trash');
      requireValue(!duplicate, 'DUPLICATE_FILE', `相同内容已存在：${duplicate?.name || ''}`);
      requireValue(lib.files.length < 2000, 'LIBRARY_LIMIT', '首版每库最多 2000 个文件，请另建资料库或清理。');
      const file = { id: randomUUID(), name: cleanName, ext, size: buffer.length, sha256, status: 'stored', extractionStatus: 'not_requested', error: null, chunks: 0, updatedAt: stamp() };
      if (relativeSource !== undefined) file.sourcePath = relativeSource;
      const target = await this.filePath(lib, 'originals', file);
      await writeFile(target, buffer, { flag: 'wx', mode: 0o600 });
      lib.files.push(file); await this.manifest(lib); return clone(file);
    });
  }
  fileAction({ action, libraryId, fileId, excluded, confirmation }) {
    return this.transact(async () => {
      const lib = this.library(libraryId, true); const file = this.file(lib, fileId);
      if (action === 'trashFile') {
        requireValue(confirmation === file.name, 'CONFIRMATION_REQUIRED', '请再次确认文件名，原件副本将移入插件逻辑回收区。');
        if (file.status !== 'trash') { file.previousStatus = file.status; file.status = 'trash'; }
      } else if (action === 'restoreFile') {
        requireValue(file.status === 'trash', 'INVALID_STATE', '文件不在回收区。');
        requireValue(!file.purgePending, 'PURGE_PENDING', '文件已开始永久删除，可能已移除部分字节；请重试永久删除，不能恢复。');
        file.status = file.previousStatus || 'error'; delete file.previousStatus;
      } else if (action === 'exclude') {
        requireValue(file.status !== 'trash', 'INVALID_STATE', '请先恢复回收区文件。');
        requireValue(typeof excluded === 'boolean', 'INVALID_ACTION', '请明确指定是否排除文件。');
        if (excluded && file.status !== 'excluded') {
          file.excludedPreviousStatus = file.status; file.status = 'excluded';
        } else if (!excluded && file.status === 'excluded') {
          file.status = file.excludedPreviousStatus || 'ready'; delete file.excludedPreviousStatus;
        }
      } else if (action === 'reindex') {
        throw new LibraryError('REINDEX_UNSUPPORTED', '资料库仅保存原件，不再支持预解析或重建索引。');
      } else throw new LibraryError('UNKNOWN_ACTION', '未知文件操作。');
      file.updatedAt = stamp(); await this.manifest(lib); return clone(file);
    });
  }
  /** One queued metadata-only batch. Originals and source paths are never read or moved. */
  trashAll({ libraryId, confirmation }) {
    return this.transact(async () => {
      const lib = this.library(libraryId, true);
      requireValue(confirmation === lib.name, 'CONFIRMATION_REQUIRED', '全部移入回收区必须输入完整资料库名。');
      const total = lib.files.length;
      let moved = 0;
      const updatedAt = stamp();
      for (const file of lib.files) {
        // Preserve existing trash verbatim, including irreversible deletion intents.
        if (file.status === 'trash') continue;
        file.previousStatus = file.status;
        file.status = 'trash';
        file.updatedAt = updatedAt;
        moved++;
      }
      // The domain is authoritative. As with other transact operations, a failed
      // domain persist rolls memory back but may leave this on-disk mirror ahead.
      // This is not a cross-file transaction; no original bytes change either way.
      await this.manifest(lib);
      return { libraryId: lib.id, moved, alreadyTrashed: total - moved, total };
    });
  }
  /** Only UUID-derived regular files in this library may be unlinked. Never inspect sourcePath. */
  async purgeTargets(lib, file) {
    requireValue(safeId(lib.id) && safeId(file.id), 'INVALID_ID', '永久删除目标标识不正确。');
    requireValue(typeof file.ext === 'string' && /^(?:|\.[a-z0-9]{1,16})$/.test(file.ext), 'UNSAFE_EXTENSION', '原件扩展名不安全，拒绝永久删除。');
    requireValue(lib.files.filter(item => item.id === file.id).length === 1, 'INVALID_ID', '文件标识重复，拒绝永久删除。');
    const base = await this.directory(lib);
    const targets = [path.join(base, 'originals', `${file.id}${file.ext}`), path.join(base, 'extracted', `${file.id}.json`)];
    for (const [index, target] of targets.entries()) {
      const expectedParent = path.join(base, index === 0 ? 'originals' : 'extracted');
      requireValue(path.dirname(target) === expectedParent && path.basename(target) === `${file.id}${index === 0 ? file.ext : '.json'}`, 'UNSAFE_PATH', '永久删除路径不在库内固定位置。');
      await assertPlainPath(target);
      try {
        const info = await lstat(target);
        requireValue(info.isFile() && !info.isSymbolicLink(), 'UNSAFE_PATH', '永久删除只允许普通文件，不允许目录或链接。');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return targets;
  }
  async purgeFile({ libraryId, fileId, confirmation }) {
    requireValue(safeId(fileId), 'INVALID_ID', '永久删除文件标识不正确。');
    return this.purgeTrash({ libraryId, fileId, confirmation });
  }
  emptyTrash({ libraryId, confirmation }) {
    return this.purgeTrash({ libraryId, confirmation });
  }
  /** Irreversible I/O must not use transact's pre-operation rollback. */
  purgeTrash({ libraryId, fileId, confirmation }) {
    const task = this.tail.then(async () => {
      const lib = this.library(libraryId, true);
      const single = fileId !== undefined;
      const selected = single ? [this.file(lib, fileId)] : lib.files.filter(file => file.status === 'trash');
      requireValue(confirmation === (single ? selected[0].name : lib.name), 'CONFIRMATION_REQUIRED', single ? '永久删除必须输入完整文件名。' : '清空回收区必须输入完整资料库名。');
      requireValue(selected.every(file => file.status === 'trash'), 'INVALID_STATE', '仅回收区文件可以永久删除。');
      // Preflight the complete batch before recording intent or deleting any member.
      await this.directory(lib);
      for (const file of selected) await this.purgeTargets(lib, file);
      const result = { libraryId, requested: selected.length, deleted: 0, remaining: selected.length, complete: false, failed: [], warnings: [] };
      const failure = (file, stage, error) => {
        const code = typeof error?.code === 'string' ? error.code : 'PURGE_FAILED';
        const message = '永久删除未完成；文件保留在回收区待重试，不能恢复，部分库内字节可能已经删除。';
        if (file) file.purgeError = message;
        result.failed.push({ fileId: file?.id || null, stage, code, message });
      };
      if (!selected.length) {
        await this.manifest(lib);
        return { ...result, complete: true };
      }
      for (const file of selected) { file.purgePending = true; file.purgeError = null; file.updatedAt = stamp(); }
      // Domain intent is authoritative. If either intent write fails, do not touch bytes.
      try { await this.persist(clone(this.state)); this.revision++; await this.manifest(lib); }
      catch (error) {
        failure(null, 'intent', error);
        for (const file of selected) file.purgeError = '永久删除意图尚未完成保存；未开始删除字节，请重试。';
        return result;
      }
      for (const file of selected) {
        try {
          // Revalidate ownership, both fixed targets and file types immediately before each unlink.
          const targets = await this.purgeTargets(lib, file);
          for (const target of targets) {
            const currentTargets = await this.purgeTargets(lib, file);
            requireValue(currentTargets.includes(target), 'UNSAFE_PATH', '永久删除目标发生变化。');
            try { await this.removeFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
        } catch (error) {
          failure(file, 'delete', error);
          // The already-durable pending intent remains valid even if this diagnostic update fails.
          try { await this.persist(clone(this.state)); this.revision++; await this.manifest(lib); } catch { /* retry keeps pending */ }
          break;
        }
        const pendingState = clone(this.state);
        lib.files = lib.files.filter(item => item.id !== file.id);
        try { await this.persist(clone(this.state)); this.revision++; }
        catch (error) {
          // Bytes are gone: retain pending metadata rather than reviving a restorable file.
          this.state = pendingState;
          failure(this.file(this.library(libraryId), file.id), 'commit', error);
          break;
        }
        result.deleted++;
        try { await this.manifest(lib); }
        catch {
          // Domain removal succeeded; do not resurrect metadata because its backup mirror failed.
          result.warnings.push({ fileId: file.id, code: 'MANIFEST_UPDATE_FAILED', message: '文件已永久删除，但备份清单更新失败；请刷新，后续清空操作可重写清单。' });
        }
      }
      result.remaining = selected.length - result.deleted;
      result.complete = result.remaining === 0;
      return result;
    });
    this.tail = task.catch(() => {});
    return task;
  }
  /**
   * Permanent removal of a deactivated library, including every original inside its own directory.
   * Only an archived library is eligible: activation itself is the user's first confirmation.
   * Ownership marker, fixed directory basename and the absence of links are revalidated first, and
   * nothing outside `<library.path>` is ever touched. Irreversible I/O stays off transact rollback.
   */
  deleteLibrary({ libraryId, confirmation }) {
    const task = this.tail.then(async () => {
      const lib = this.library(libraryId);
      requireValue(lib.archived === true, 'LIBRARY_ACTIVE', '请先停用资料库，再删除资料库。');
      requireValue(confirmation === lib.name, 'CONFIRMATION_REQUIRED', '删除资料库必须输入完整资料库名。');
      const base = await assertPlainPath(lib.path);
      requireValue(path.basename(base) === lib.id, 'UNSAFE_PATH', '资料库目录与标识不一致。');
      await this.assertLibrarySeparation(base, { deleting: lib });
      const result = { libraryId: lib.id, name: lib.name, requested: lib.files.length, deletedFiles: lib.deletePending ? null : 0, complete: false, failed: [] };
      let info;
      try {
        info = await lstat(base, { bigint: true });
        requireValue(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_PATH', '资料库路径不是普通目录，拒绝删除。');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const identity = info && { path: base, dev: String(info.dev), ino: String(info.ino) };
      if (info) {
        if (lib.deleteIdentity) requireValue(identity.path === lib.deleteIdentity.path && identity.dev === lib.deleteIdentity.dev && identity.ino === lib.deleteIdentity.ino, 'UNSAFE_PATH', '待删除资料库目录身份发生变化，拒绝续删。');
        try { await this.directory(lib); }
        catch (error) {
          // Recursive rm may remove the marker before failing. Only a durable intent
          // bound to this exact directory identity permits a marker-less retry.
          requireValue(error.code === 'ENOENT' && lib.deletePending && lib.deleteIdentity && identity.ino !== '0', 'UNSAFE_PATH', '资料库所有权标记缺失或无效，且无法验证待删除目录身份。');
        }
      }
      lib.deletePending = true;
      if (identity) lib.deleteIdentity = identity;
      lib.deleteError = null;
      // Never touch bytes until the authoritative domain durably records intent.
      try { await this.persist(clone(this.state)); this.revision++; }
      catch {
        result.failed.push({ stage: 'intent', code: 'PERSIST_FAILED', message: '删除意图未能保存，本次未开始删除文件；请重试。' });
        return result;
      }
      if (info) {
        result.deletedFiles = null; // Recursive failure cannot provide an exact count.
        try {
          await assertPlainPath(base);
          await this.assertLibrarySeparation(base, { deleting: lib });
          const current = await lstat(base, { bigint: true });
          requireValue(String(current.dev) === identity.dev && String(current.ino) === identity.ino && current.isDirectory() && !current.isSymbolicLink(), 'UNSAFE_PATH', '待删除资料库目录身份发生变化。');
          await this.removeDirectory(base, { recursive: true, force: false });
        } catch (error) {
          const message = '资料库删除未完成，部分文件可能已删除，无法确定已删数量；记录保留待重试，不能恢复。';
          lib.deleteError = message;
          result.failed.push({ stage: 'delete', code: typeof error.code === 'string' ? error.code : 'DELETE_FAILED', message });
          try { await this.persist(clone(this.state)); this.revision++; } catch { /* durable intent remains */ }
          return result;
        }
      }
      result.deletedFiles = result.requested;
      const before = clone(this.state);
      this.state.libraries = this.state.libraries.filter(item => item.id !== lib.id);
      for (const scope of Object.values(this.state.sessionScopes)) {
        if (!scope || typeof scope !== 'object') continue;
        if (Array.isArray(scope.libraryIds)) scope.libraryIds = scope.libraryIds.filter(id => id !== lib.id);
        if (scope.defaultLibraryId === lib.id) scope.defaultLibraryId = null;
      }
      try { await this.persist(clone(this.state)); this.revision++; }
      catch {
        this.state = before;
        const retained = this.state.libraries.find(item => item.id === lib.id);
        if (retained) retained.deletePending = true;
        try { await this.persist(clone(this.state)); this.revision++; } catch { /* retry keeps the pending record */ }
        result.failed.push({ stage: 'commit', code: 'PERSIST_FAILED', message: '资料库目录与文件已删除，但元数据未能保存；请刷新后重试删除，以清理这条记录。' });
        return result;
      }
      result.complete = true;
      return result;
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async original({ libraryId, fileId }) {
    await this.tail; const lib = this.library(libraryId, true); const file = this.file(lib, fileId);
    requireValue(file.status !== 'trash', 'INVALID_STATE', '请先恢复回收区文件。');
    const filename = await this.filePath(lib, 'originals', file);
    const info = await lstat(filename);
    requireValue(info.isFile() && info.size === file.size && info.size <= 200 * 1024 * 1024, 'SOURCE_CHANGED', '原文件大小或类型发生变化，拒绝下载。');
    const bytes = await readFile(filename);
    requireValue(createHash('sha256').update(bytes).digest('hex') === file.sha256, 'SOURCE_CHANGED', '库内原件被外部改动，拒绝下载。');
    return { name: file.name, bytes };
  }
  workspaceForSession(sessionId) { return this.workspaces().find(ws => [...ws.sessionIds].some(id => String(id) === sessionId)); }
  scope(sessionId) {
    requireValue(typeof sessionId === 'string' && sessionId.length <= 200, 'INVALID_SESSION', '会话标识不正确。');
    const ws = this.workspaceForSession(sessionId); const lib = ws && this.state.libraries.find(x => !x.archived && x.workspaceId === String(ws.id));
    const selected = this.state.sessionScopes[sessionId];
    // Explicit grants are tied to the current workspace identity; a changed membership invalidates them.
    const valid = selected?.workspaceId === String(ws?.id || '');
    const extras = valid ? selected.libraryIds.filter(id => id !== selected.defaultLibraryId && this.state.libraries.some(x => x.id === id && !x.archived)) : [];
    const libraryIds = [...new Set([...(lib ? [lib.id] : []), ...extras])];
    return { workspaceId: ws ? String(ws.id) : null, libraryId: lib?.id || null, libraryName: lib?.name || null, mode: valid ? selected.mode : 'library', libraryIds, cloudConsent: this.state.settings.originalConsent === true, originalConsent: this.state.settings.originalConsent === true };
  }
  setScope({ sessionId, mode, libraryIds }) {
    return this.transact(async () => {
      const scope = this.scope(sessionId);
      requireValue(scope.workspaceId, 'NO_WORKSPACE', '此会话尚未归属工作区，不能授权资料库。');
      requireValue(['library', 'general'].includes(mode) && Array.isArray(libraryIds) && libraryIds.length <= 8, 'INVALID_SCOPE', '资料模式或范围不正确。');
      for (const id of libraryIds) this.library(id, true);
      requireValue(new Set([...(scope.libraryId ? [scope.libraryId] : []), ...libraryIds]).size <= 8, 'INVALID_SCOPE', '包含默认库后，每个会话最多授权 8 个资料库。');
      this.state.sessionScopes[sessionId] = { workspaceId: scope.workspaceId, defaultLibraryId: scope.libraryId, mode, libraryIds: [...new Set(libraryIds)] };
      return this.scope(sessionId);
    });
  }
  async listForSession(sessionId, { query = '', libraryId, offset = 0, limit = 50 } = {}) {
    await this.tail;
    const scope = this.scope(sessionId);
    requireValue(scope.mode === 'library', 'GENERAL_MODE', '此会话处于通用模式，请由用户切换到资料库参考模式。');
    requireValue(scope.originalConsent, 'CONSENT_REQUIRED', '尚未同意将原文件按需提供给会话模型，请在资料库存储设置中确认。');
    requireValue(scope.libraryIds.length, 'NO_LIBRARY', '此会话未关联可用资料库，请先创建或关联。');
    requireValue(libraryId === undefined || scope.libraryIds.includes(libraryId), 'SCOPE_DENIED', '该资料库不在用户授权的当前会话范围内。');
    requireValue(typeof query === 'string' && query.length <= 512, 'INVALID_QUERY', '名称或来源筛选最多 512 字符。');
    requireValue(Number.isSafeInteger(offset) && offset >= 0, 'INVALID_OFFSET', '列表位置不正确。');
    requireValue(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'INVALID_BUDGET', '每次最多列出 50 个文件。');
    const needle = query.trim().toLowerCase();
    const files = [];
    for (const id of libraryId === undefined ? scope.libraryIds : [libraryId]) {
      const lib = this.library(id, true);
      for (const file of lib.files) {
        if (['trash', 'excluded'].includes(file.status)) continue;
        if (needle && !file.name.toLowerCase().includes(needle) && !(file.sourcePath || '').toLowerCase().includes(needle)) continue;
        const item = { id: file.id, libraryId: lib.id, name: file.name, size: file.size, version: file.sha256.slice(0, 12) };
        if (file.sourcePath !== undefined) item.sourcePath = file.sourcePath;
        files.push(item);
      }
    }
    const batch = files.slice(offset, offset + limit);
    return { files: batch, total: files.length, offset, limit, hasMore: offset + batch.length < files.length, nextOffset: offset + batch.length };
  }
  async originalForSession(sessionId, { libraryId, fileId }) {
    await this.tail;
    const authorize = () => {
      const scope = this.scope(sessionId);
      requireValue(scope.mode === 'library' && scope.originalConsent && scope.libraryIds.includes(libraryId), 'SCOPE_DENIED', '该资料库不在用户授权的当前会话范围内。');
      const file = this.file(this.library(libraryId, true), fileId);
      requireValue(!['excluded', 'trash'].includes(file.status), 'FILE_NOT_AVAILABLE', '文件已排除或移入回收区。');
    };
    authorize();
    const result = await this.original({ libraryId, fileId });
    // Do not release bytes if consent/scope changed during disk access.
    await this.tail; authorize();
    return result;
  }
}
