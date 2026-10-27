import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, rmdir, unlink, readFile, writeFile, mkdir, symlink, readdir, lstat } from 'node:fs/promises';
import { LibraryStore, initialState, MAX_FILE_BYTES, assertPlainPath } from '../src/store.js';

const code = expected => error => { assert.equal(error.code, expected); return true; };
const encode = text => Buffer.from(text).toString('base64');
const project = path.resolve(import.meta.dirname, '..');
// Windows directory junctions use rmdir; Unix directory symlinks use unlink.
const removeDirectoryLink = target => process.platform === 'win32' ? rmdir(target) : unlink(target);
async function fixture(run) {
  const directory = await mkdtemp(path.join(project, '.test-data-'));
  const ws = [{ id: 'w1', title: '工作区一', path: path.join(directory, 'source'), sessionIds: new Set(['s1']) }, { id: 'w2', title: '工作区二', sessionIds: new Set(['s2']) }];
  let failPersist = false;
  const persisted = [];
  const store = new LibraryStore({ state: initialState(), workspaces: () => ws, persist: async state => { if (failPersist) throw new Error('persist deliberately failed'); persisted.push(structuredClone(state)); } });
  const root = path.join(directory, 'library-root');
  const configure = () => store.configure({ root, cloudConsent: true, originalConsent: true });
  const create = workspaceId => store.create({ workspaceId });
  const upload = (libraryId, text = '苹果 backup recovery', name = '资料.txt') => store.importFile({ libraryId, name, base64: encode(text) });
  try { return await run({ directory, root, ws, store, persisted, configure, create, upload, fail: value => { failPersist = value; } }); }
  finally {
    const target = path.resolve(directory);
    assert.ok(path.isAbsolute(target));
    assert.equal(path.dirname(target), project);
    assert.ok(path.basename(target).startsWith('.test-data-'));
    assert.ok(!path.relative(project, target).startsWith('..'));
    await rm(target, { recursive: true, force: true });
  }
}

test('old settings default to 50MiB and configuration validates and retains omitted values', () => fixture(async ({ store, configure, persisted }) => {
  const old = initialState(); delete old.settings.maxFileMiB;
  const restored = new LibraryStore({ state: old, persist: async () => {} });
  assert.equal(restored.maxFileBytes(), 50 * 1024 * 1024);
  assert.equal((await restored.snapshot()).settings.maxFileMiB, 50);
  assert.equal(old.settings.maxFileMiB, undefined, 'migration must not mutate caller state');
  await configure();
  for (const value of [0, -1, 201, 1.5, '50', null, true, NaN, Infinity]) {
    await assert.rejects(store.configure({ maxFileMiB: value }), code('INVALID_SETTINGS'));
    assert.equal(store.maxFileBytes(), MAX_FILE_BYTES);
  }
  for (const maxFileMiB of [1, 200, 24]) {
    await store.configure({ maxFileMiB });
    const snapshot = await store.snapshot();
    assert.equal(snapshot.settings.maxFileMiB, maxFileMiB);
    assert.equal(snapshot.capabilities.maxFileBytes, maxFileMiB * 1024 * 1024);
    assert.equal(snapshot.settings.cloudConsent, true);
  }
  await store.configure({ cloudConsent: false });
  assert.equal(store.state.settings.maxFileMiB, 24);
  assert.equal(persisted.at(-1).settings.maxFileMiB, 24);
  for (const value of [0, 201, null]) {
    const state = initialState(); state.settings.maxFileMiB = value;
    assert.throws(() => new LibraryStore({ state, persist: async () => {} }), code('INVALID_SETTINGS'));
  }
}));

test('sourcePath rejects absolute, traversal, malformed and mismatched metadata', () => fixture(async ({ store, configure, create }) => {
  await configure(); const lib = await create('w1');
  for (const sourcePath of ['', '/a.txt', 'C:/a.txt', 'C:a.txt', '\\\\server\\a.txt', '../a.txt', 'x/../a.txt', './a.txt', 'x//a.txt', 'x/a.txt/', 'x/b.txt', 'x/\u0000a.txt', 'x/\u007fa.txt', 'x'.repeat(1024) + '/a.txt', null]) {
    await assert.rejects(store.importBytes({ libraryId: lib.id, name: 'a.txt', bytes: Buffer.from('safe'), sourcePath }), code('INVALID_SOURCE_PATH'));
  }
  assert.equal(store.library(lib.id).files.length, 0);
}));

test('configure validates local absolute directory and explicit cloud consent', () => fixture(async ({ store, root, persisted }) => {
  await assert.rejects(store.configure({ root: 'relative', cloudConsent: true }), code('INVALID_PATH'));
  await assert.rejects(store.configure({ root: '\\\\server\\share', cloudConsent: true }), code('INVALID_PATH'));
  const result = await store.configure({ root, cloudConsent: 'yes' });
  assert.equal(path.resolve(result.root).toLowerCase(), path.resolve(root).toLowerCase());
  assert.equal(result.cloudConsent, false);
  assert.equal(persisted.length, 1);
  assert.deepEqual(await readdir(root), []);
}));

test('create requires configuration, is idempotent under concurrency, and keeps ownership marker', () => fixture(async ({ store, configure, create }) => {
  await assert.rejects(create('w1'), code('ROOT_REQUIRED'));
  await configure();
  const [a, b] = await Promise.all([create('w1'), create('w1')]);
  assert.equal(a.id, b.id);
  assert.equal(store.state.libraries.length, 1);
  const marker = JSON.parse(await readFile(path.join(a.path, '.dsh-library.json'), 'utf8'));
  assert.equal(marker.id, a.id);
  assert.equal(marker.kind, 'dsh-library');
  await assert.rejects(create('missing'), code('WORKSPACE_NOT_FOUND'));
}));

test('workspace rename updates association without changing library identity', () => fixture(async ({ store, ws, configure, create }) => {
  await configure(); const lib = await create('w1');
  ws[0].title = '重命名后的工作区';
  await store.reconcile({ startup: true });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.libraries[0].id, lib.id);
  assert.equal(snapshot.libraries[0].workspaceTitle, ws[0].title);
  assert.equal(snapshot.workspaces[0].libraryId, lib.id);
  await store.update({ libraryId: lib.id, action: 'rename', name: '资料新名' });
  assert.equal(store.scope('s1').libraryName, '资料新名');
}));

test('startup does not bulk-create old workspaces, live new workspace auto-creates', () => fixture(async ({ store, ws, configure }) => {
  await configure(); await store.reconcile({ startup: true });
  assert.equal(store.state.libraries.length, 0);
  assert.equal(store.state.pending.length, 2);
  ws.push({ id: 'w3', title: '新工作区', sessionIds: new Set(['s3']) });
  await store.reconcile();
  assert.deepEqual(store.state.libraries.map(lib => lib.workspaceId), ['w3']);
  assert.deepEqual(store.state.pending.map(item => item.workspaceId), ['w1', 'w2']);
}));

test('deleting workspace leaves orphan library and originals untouched', () => fixture(async ({ store, ws, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id);
  ws.splice(0, 1); await store.reconcile();
  const orphan = store.library(lib.id);
  assert.equal(orphan.workspaceId, null);
  assert.equal(orphan.archived, false);
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), '苹果 backup recovery');
  assert.deepEqual(store.scope('s1').libraryIds, []);
}));

test('import stores a copy and all actions leave source original untouched', () => fixture(async ({ store, directory, configure, create }) => {
  const source = path.join(directory, 'source-original.txt');
  await writeFile(source, 'source backup 苹果');
  await configure(); const lib = await create('w1');
  const imported = await store.importFile({ libraryId: lib.id, name: '原件.txt', base64: (await readFile(source)).toString('base64') });
  assert.equal(imported.status, 'stored');
  await store.fileAction({ libraryId: lib.id, fileId: imported.id, action: 'trashFile', confirmation: imported.name });
  await store.update({ libraryId: lib.id, action: 'archive' });
  assert.equal(await readFile(source, 'utf8'), 'source backup 苹果');
  assert.equal(await readFile(path.join(lib.path, 'originals', imported.id + imported.ext), 'utf8'), 'source backup 苹果');
}));

test('duplicate uploads are rejected even under a different filename or while excluded', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id);
  await assert.rejects(upload(lib.id, '苹果 backup recovery', '不同名字.md'), code('DUPLICATE_FILE'));
  await store.fileAction({ libraryId: lib.id, fileId: file.id, action: 'exclude', excluded: true });
  await assert.rejects(upload(lib.id), code('DUPLICATE_FILE'));
  assert.equal(store.library(lib.id).files.length, 1);
}));

test('import refuses directory names and malformed base64', () => fixture(async ({ store, configure, create }) => {
  await configure(); const lib = await create('w1');
  for (const name of ['../secret.txt', 'C:\\secret.txt', '/tmp/a.txt', 'foo/bar.txt', 'a\u0000.txt']) {
    await assert.rejects(store.importFile({ libraryId: lib.id, name, base64: encode('safe') }), code('INVALID_NAME'));
  }
  for (const base64 of ['', '%%%=', 'YQ', 'Y Q==', 'YQ===', 'YQ==\n']) await assert.rejects(store.importFile({ libraryId: lib.id, name: 'a.txt', base64 }), code('INVALID_UPLOAD'));
  assert.equal(store.library(lib.id).files.length, 0);
}));

test('default 50MiB legal upload accepted and oversized decoded or encoded uploads rejected', () => fixture(async ({ store, configure, create }) => {
  await configure(); const lib = await create('w1');
  const file = await store.importFile({ libraryId: lib.id, name: 'large.txt', base64: Buffer.alloc(MAX_FILE_BYTES, 65).toString('base64') });
  assert.equal(file.size, MAX_FILE_BYTES);
  await assert.rejects(store.importFile({ libraryId: lib.id, name: 'oversize.txt', base64: Buffer.alloc(MAX_FILE_BYTES + 1, 66).toString('base64') }), code('FILE_TOO_LARGE'));
  await assert.rejects(store.importFile({ libraryId: lib.id, name: 'larger.txt', base64: Buffer.alloc(MAX_FILE_BYTES + 3, 67).toString('base64') }), code('INVALID_UPLOAD'));
}));

test('archive retains originals, removes session authorization and supports restoration', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id);
  await store.update({ libraryId: lib.id, action: 'archive' });
  assert.deepEqual(store.scope('s1').libraryIds, []);
  await assert.rejects(store.originalForSession('s1', { libraryId: lib.id, fileId: file.id }), code('SCOPE_DENIED'));
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), '苹果 backup recovery');
  await store.update({ libraryId: lib.id, action: 'restoreLibrary' });
  assert.equal(store.library(lib.id).workspaceId, null);
  await store.link({ libraryId: lib.id, workspaceId: 'w1' });
  assert.equal((await store.listForSession('s1')).files.length, 1);
}));

test('library deletion requires deactivation plus the exact name and removes only its own directory', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const other = await create('w2');
  const doomed = await upload(lib.id); const kept = await upload(other.id);
  await assert.rejects(store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name }), code('LIBRARY_ACTIVE'));
  await assert.rejects(store.deleteLibrary({ libraryId: 'missing', confirmation: 'x' }), code('LIBRARY_NOT_FOUND'));
  await store.update({ libraryId: lib.id, action: 'archive' });
  await assert.rejects(store.deleteLibrary({ libraryId: lib.id, confirmation: '错误的名称' }), code('CONFIRMATION_REQUIRED'));
  assert.equal(store.state.libraries.length, 2);
  assert.equal(await readFile(path.join(lib.path, 'originals', doomed.id + doomed.ext), 'utf8'), '苹果 backup recovery');
  const result = await store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(result.complete, true);
  assert.equal(result.deletedFiles, 1);
  assert.deepEqual(result.failed, []);
  await assert.rejects(lstat(lib.path), error => error.code === 'ENOENT');
  assert.equal(store.state.libraries.some(item => item.id === lib.id), false);
  assert.deepEqual(Object.values(store.state.sessionScopes).flatMap(scope => scope.libraryIds || []), []);
  assert.equal(await readFile(path.join(other.path, 'originals', kept.id + kept.ext), 'utf8'), '苹果 backup recovery');
  assert.equal((await store.listForSession('s2')).files.length, 1);
}));

test('library deletion refuses a tampered ownership marker and keeps the directory', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); await upload(lib.id);
  await store.update({ libraryId: lib.id, action: 'archive' });
  await writeFile(path.join(lib.path, '.dsh-library.json'), JSON.stringify({ kind: 'dsh-library', version: 1, id: 'another-library' }));
  await assert.rejects(store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name }), code('UNSAFE_PATH'));
  assert.ok((await readdir(lib.path)).includes('originals'));
  assert.equal(store.state.libraries.some(item => item.id === lib.id), true);
}));

test('library deletion failure keeps pending metadata; a failed metadata commit blocks restore', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id);
  await store.update({ libraryId: lib.id, action: 'archive' });
  store.removeDirectory = async () => { throw Object.assign(new Error('synthetic busy'), { code: 'EBUSY' }); };
  const blocked = await store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(blocked.complete, false);
  assert.equal(blocked.failed[0].code, 'EBUSY');
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), '苹果 backup recovery');
  assert.equal(store.state.libraries.some(item => item.id === lib.id), true);
  store.removeDirectory = async (target, options) => rm(target, options);
  assert.equal(blocked.deletedFiles, null);
  assert.equal(store.library(lib.id).deletePending, true);
  const persist = store.persist; let writes = 0;
  store.persist = async state => { if (++writes === 2) throw new Error('synthetic commit failure'); await persist(state); };
  const partial = await store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(partial.complete, false);
  assert.equal(partial.failed[0].code, 'PERSIST_FAILED');
  await assert.rejects(lstat(lib.path), error => error.code === 'ENOENT');
  assert.equal(store.state.libraries.find(item => item.id === lib.id).deletePending, true);
  await assert.rejects(store.update({ libraryId: lib.id, action: 'restoreLibrary' }), code('DELETE_PENDING'));
  store.persist = persist;
  const retry = await store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(retry.complete, true);
  assert.equal(store.state.libraries.some(item => item.id === lib.id), false);
}));

test('partial recursive library deletion persists intent before I/O and retries without a marker after restart', () => fixture(async ({ store, configure, create, upload, persisted, ws }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id);
  await store.update({ libraryId: lib.id, action: 'archive' });
  store.removeDirectory = async target => {
    assert.equal(persisted.at(-1).libraries[0].deletePending, true);
    assert.ok(persisted.at(-1).libraries[0].deleteIdentity.ino);
    await unlink(path.join(target, '.dsh-library.json'));
    await unlink(path.join(target, 'originals', file.id + file.ext));
    throw Object.assign(new Error('partial rm'), { code: 'EBUSY' });
  };
  const result = await store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(result.complete, false); assert.equal(result.deletedFiles, null);
  assert.equal(result.failed[0].stage, 'delete'); assert.match(result.failed[0].message, /部分文件可能已删除/);
  await assert.rejects(readFile(path.join(lib.path, '.dsh-library.json')), error => error.code === 'ENOENT');
  await assert.rejects(readFile(path.join(lib.path, 'originals', file.id + file.ext)), error => error.code === 'ENOENT');
  await assert.rejects(store.update({ libraryId: lib.id, action: 'restoreLibrary' }), code('DELETE_PENDING'));
  const restarted = new LibraryStore({ state: persisted.at(-1), workspaces: () => ws, persist: async () => {} });
  await assert.rejects(restarted.update({ libraryId: lib.id, action: 'restoreLibrary' }), code('DELETE_PENDING'));
  assert.equal((await restarted.deleteLibrary({ libraryId: lib.id, confirmation: lib.name })).complete, true);
  await assert.rejects(lstat(lib.path), error => error.code === 'ENOENT');
}));

test('library deletion intent persistence failure never starts rm', () => fixture(async ({ store, configure, create, upload, fail }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id);
  await store.update({ libraryId: lib.id, action: 'archive' });
  let removals = 0; store.removeDirectory = async () => { removals++; };
  fail(true);
  const result = await store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(result.failed[0].stage, 'intent'); assert.equal(result.deletedFiles, 0); assert.equal(removals, 0);
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), '苹果 backup recovery');
  await assert.rejects(store.update({ libraryId: lib.id, action: 'restoreLibrary' }), code('DELETE_PENDING'));
}));

test('markerless retry refuses missing identity or a changed directory identity', () => fixture(async ({ store, configure, create }) => {
  await configure(); const lib = await create('w1'); await store.update({ libraryId: lib.id, action: 'archive' });
  store.removeDirectory = async target => { await unlink(path.join(target, '.dsh-library.json')); throw Object.assign(new Error('partial'), { code: 'EBUSY' }); };
  await store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name });
  const actual = store.library(lib.id); const identity = actual.deleteIdentity;
  delete actual.deleteIdentity;
  await assert.rejects(store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name }), code('UNSAFE_PATH'));
  actual.deleteIdentity = { ...identity, ino: `${identity.ino}1` };
  await assert.rejects(store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name }), code('UNSAFE_PATH'));
  assert.ok((await readdir(lib.path)).includes('manifest.json'));
}));

test('configure and create reject registered library roots and descendants, including archived records', () => fixture(async ({ store, configure, create, persisted }) => {
  await configure(); const lib = await create('w1'); await store.update({ libraryId: lib.id, action: 'archive' });
  const before = structuredClone(store.state); const writes = persisted.length;
  for (const root of [lib.path, path.join(lib.path, 'nested', 'missing')]) {
    await assert.rejects(store.configure({ root }), code('NESTED_LIBRARY_PATH'));
    assert.deepEqual(store.state, before); assert.equal(persisted.length, writes);
    store.state.settings.root = root;
    await assert.rejects(create('w2'), code('NESTED_LIBRARY_PATH'));
    store.state.settings.root = before.settings.root;
  }
  await assert.rejects(lstat(path.join(lib.path, 'nested')), error => error.code === 'ENOENT');
}));

test('library deletion protects equal, nested and missing registered paths before recording intent', () => fixture(async ({ store, configure, create, upload, persisted }) => {
  await configure(); const lib = await create('w1'); const other = await create('w2'); const file = await upload(lib.id);
  await store.update({ libraryId: lib.id, action: 'archive' });
  const actualOther = store.library(other.id); const originalPath = actualOther.path; const writes = persisted.length;
  let removals = 0; store.removeDirectory = async () => { removals++; };
  for (const nested of [lib.path, path.join(lib.path, other.id), path.join(lib.path, 'missing', other.id)]) {
    actualOther.path = nested;
    await assert.rejects(store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name }), code('NESTED_LIBRARY_PATH'));
    assert.equal(store.library(lib.id).deletePending, undefined); assert.equal(persisted.length, writes);
  }
  actualOther.path = originalPath;
  assert.equal(removals, 0);
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), '苹果 backup recovery');
}));

test('realpath aliases in legacy records cannot bypass root or recursive-delete separation', t => fixture(async ({ directory, store, configure, create }) => {
  await configure(); const lib = await create('w1'); const other = await create('w2');
  const alias = path.join(directory, 'legacy-alias');
  try { await symlink(lib.path, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`链接权限不足：${error.code}`); return; } throw error; }
  try {
    store.library(other.id).path = path.join(alias, 'missing', other.id);
    await store.update({ libraryId: lib.id, action: 'archive' });
    await assert.rejects(store.deleteLibrary({ libraryId: lib.id, confirmation: lib.name }), code('NESTED_LIBRARY_PATH'));
    store.library(other.id).path = alias;
    // Lexically distinct registered alias still resolves to this normal path.
    store.state.libraries = store.state.libraries.filter(item => item.id !== lib.id);
    await assert.rejects(store.configure({ root: lib.path }), code('NESTED_LIBRARY_PATH'));
    store.state.settings.root = lib.path;
    await assert.rejects(create('w1'), code('NESTED_LIBRARY_PATH'));
  } finally { assert.equal(path.dirname(alias), directory); await removeDirectoryLink(alias); }
}));

test('scope limit includes the automatic default library and counts unique grants', () => fixture(async ({ store, configure, create }) => {
  await configure(); const own = await create('w1');
  for (let i = 0; i < 8; i++) store.state.libraries.push({ id: `extra-${i}`, archived: false });
  const extras = Array.from({ length: 8 }, (_, i) => `extra-${i}`);
  await assert.rejects(store.setScope({ sessionId: 's1', mode: 'library', libraryIds: extras }), code('INVALID_SCOPE'));
  const allowed = await store.setScope({ sessionId: 's1', mode: 'library', libraryIds: [own.id, ...extras.slice(0, 7)] });
  assert.equal(allowed.libraryIds.length, 8);
  assert.equal((await store.setScope({ sessionId: 's1', mode: 'library', libraryIds: [own.id, own.id] })).libraryIds.length, 1);
}));

test('unlink revokes old default rather than promoting it to extras; explicit extras survive and new linked default is automatic', () => fixture(async ({ store, ws, configure, create, upload }) => {
  await configure(); const original = await create('w1'); const extra = await create('w2');
  const oldFile = await upload(original.id, 'old default backup'); await upload(extra.id, 'explicit extra backup');
  await store.setScope({ sessionId: 's1', mode: 'library', libraryIds: [original.id, extra.id] });
  assert.equal(store.state.sessionScopes.s1.defaultLibraryId, original.id);
  await store.update({ libraryId: original.id, action: 'unlink' });
  assert.equal(store.scope('s1').libraryId, null);
  assert.deepEqual(store.scope('s1').libraryIds, [extra.id]);
  assert.deepEqual((await store.listForSession('s1')).files.map(hit => hit.libraryId), [extra.id]);
  await assert.rejects(store.originalForSession('s1', { libraryId: original.id, fileId: oldFile.id }), code('SCOPE_DENIED'));
  ws.push({ id: 'w3', title: '用于创建新默认库', sessionIds: new Set() });
  const replacement = await create('w3'); await upload(replacement.id, 'replacement backup');
  await store.update({ libraryId: replacement.id, action: 'unlink' });
  await store.link({ libraryId: replacement.id, workspaceId: 'w1' });
  assert.equal(store.scope('s1').libraryId, replacement.id);
  assert.deepEqual(store.scope('s1').libraryIds, [replacement.id, extra.id]);
  assert.ok(!(await store.listForSession('s1')).files.some(hit => hit.libraryId === original.id));
  assert.deepEqual(new Set((await store.listForSession('s1')).files.map(hit => hit.libraryId)), new Set([replacement.id, extra.id]));
}));

test('fork does not inherit explicit grants; moved session invalidates grants; general mode blocks tools', () => fixture(async ({ store, ws, configure, create }) => {
  await configure(); const own = await create('w1'); const other = await create('w2');
  await store.setScope({ sessionId: 's1', mode: 'library', libraryIds: [own.id, other.id] });
  ws[0].sessionIds.add('fork');
  assert.deepEqual(store.scope('fork').libraryIds, [own.id]);
  ws[0].sessionIds.delete('s1'); ws[1].sessionIds.add('s1');
  assert.deepEqual(store.scope('s1').libraryIds, [other.id]);
  await store.setScope({ sessionId: 's1', mode: 'general', libraryIds: [other.id] });
  await assert.rejects(store.listForSession('s1'), code('GENERAL_MODE'));
  await assert.rejects(store.setScope({ sessionId: 'unowned', mode: 'library', libraryIds: [own.id] }), code('NO_WORKSPACE'));
}));

test('persist failure rolls metadata back and queue remains usable', () => fixture(async ({ store, configure, create, fail }) => {
  await configure(); const lib = await create('w1'); const before = structuredClone(store.state); const revision = store.revision;
  fail(true);
  await assert.rejects(store.update({ libraryId: lib.id, action: 'rename', name: '不应提交' }), /persist deliberately failed/);
  assert.deepEqual(store.state, before); assert.equal(store.revision, revision);
  fail(false);
  await store.update({ libraryId: lib.id, action: 'rename', name: '已提交' });
  assert.equal(store.library(lib.id).name, '已提交');
}));


test('every format saves original bytes without parsing, indexing or extraction dependencies', () => fixture(async ({ store, configure, create, ws }) => {
  await configure(); const lib = await create('w1');
  let parsed = 0; store.parse = () => { parsed++; throw new Error('must never parse'); };
  const names = ['text.txt', 'notes.md', 'word.docx', 'scan.pdf', 'sheet.xlsx', 'slides.pptx', 'photo.png', 'sound.mp3', 'movie.mp4', 'macro.docm', 'README', 'file.自定义', 'file.html', 'bad.zip'];
  for (const [i, name] of names.entries()) {
    const bytes = Buffer.from([0, i + 1, 255]);
    const file = await store.importBytes({ libraryId: lib.id, name, bytes });
    assert.equal(file.status, 'stored'); assert.equal(file.extractionStatus, 'not_requested');
    assert.equal(file.chunks, 0); assert.equal(file.error, null);
    assert.deepEqual(await store.original({ libraryId: lib.id, fileId: file.id }), { name, bytes });
    assert.deepEqual(await store.originalForSession('s1', { libraryId: lib.id, fileId: file.id }), { name, bytes });
  }
  assert.equal(parsed, 0);
  assert.deepEqual(new Set(await readdir(lib.path)), new Set(['originals', 'manifest.json', '.dsh-library.json']));
  const snapshot = await store.snapshot();
  assert.equal(snapshot.capabilities.acceptsAllFiles, true); assert.equal(snapshot.capabilities.automaticExtraction, false);
  assert.equal(snapshot.capabilities.onDemandOriginals, true);
  const restored = new LibraryStore({ state: store.state, workspaces: () => ws, persist: async () => {} });
  assert.equal((await restored.listForSession('s1')).files.length, names.length);
  for (const obsolete of ['indexFile', 'segments', 'search', 'preview', 'searchForSession', 'readForSession']) assert.equal(restored[obsolete], undefined);
  const moduleText = await readFile(path.join(project, 'src/store.js'), 'utf8');
  assert.doesNotMatch(moduleText, /from ['"].*\/(?:parse|documents)\.js['"]/);
}));

test('large binary import owns queued bytes, retains source metadata and disables reindex', () => fixture(async ({ store, configure, create, ws }) => {
  await configure(); const lib = await create('w1');
  const bytes = Buffer.alloc(11 * 1024 * 1024, 65);
  const pending = store.importBytes({ libraryId: lib.id, name: 'large.txt', bytes, sourcePath: 'folder\\sub\\large.txt' });
  bytes.fill(66); const file = await pending;
  assert.equal(file.sourcePath, 'folder/sub/large.txt'); assert.equal(file.size, 11 * 1024 * 1024);
  assert.equal((await store.original({ libraryId: lib.id, fileId: file.id })).bytes[0], 65);
  const restored = new LibraryStore({ state: store.state, workspaces: () => ws, persist: async () => {} });
  await restored.configure({ maxFileMiB: 1 });
  assert.equal((await restored.originalForSession('s1', { libraryId: lib.id, fileId: file.id })).bytes.length, file.size);
  await assert.rejects(restored.importBytes({ libraryId: lib.id, name: 'big.bin', bytes: Buffer.alloc(1024 * 1024 + 1) }), code('FILE_TOO_LARGE'));
  await assert.rejects(restored.fileAction({ libraryId: lib.id, fileId: file.id, action: 'reindex' }), code('REINDEX_UNSUPPORTED'));
}));

test('list is metadata-only, name/source filtered, paginated and bounded', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const own = await create('w1'); const other = await create('w2');
  const first = await store.importBytes({ libraryId: own.id, name: 'Alpha.TXT', sourcePath: 'Topic/Alpha.TXT', bytes: Buffer.from('body hidden keyword') });
  await upload(other.id, 'secret cross-library', 'Secret.txt');
  // Metadata catalog must work without touching a directory, original or old extracted index.
  store.directory = async () => { throw new Error('listing must not access filesystem'); };
  const result = await store.listForSession('s1'); assert.equal(result.total, 1);
  assert.deepEqual(result.files, [{ id: first.id, libraryId: own.id, name: first.name, sourcePath: first.sourcePath, size: first.size, version: first.sha256.slice(0, 12) }]);
  for (const query of ['alpha', 'ALPHA', 'topic']) assert.equal((await store.listForSession('s1', { query })).total, 1);
  for (const query of ['hidden keyword', own.path, 'Secret']) assert.equal((await store.listForSession('s1', { query })).total, 0);
  for (let i = 0; i < 54; i++) store.library(own.id).files.push({ ...first, id: `metadata-${i}`, name: `item-${i}` });
  const page1 = await store.listForSession('s1'); assert.equal(page1.files.length, 50); assert.equal(page1.total, 55); assert.equal(page1.hasMore, true); assert.equal(page1.nextOffset, 50);
  const page2 = await store.listForSession('s1', { offset: 50 }); assert.equal(page2.files.length, 5); assert.equal(page2.hasMore, false);
  assert.equal((await store.listForSession('s1', { offset: 100 })).files.length, 0);
  for (const limit of [0, 51, 1.5, '2']) await assert.rejects(store.listForSession('s1', { limit }), code('INVALID_BUDGET'));
  for (const offset of [-1, 0.5, '0', Infinity]) await assert.rejects(store.listForSession('s1', { offset }), code('INVALID_OFFSET'));
  for (const query of [null, 'x'.repeat(513)]) await assert.rejects(store.listForSession('s1', { query }), code('INVALID_QUERY'));
  await assert.rejects(store.listForSession('s1', { libraryId: other.id }), code('SCOPE_DENIED'));
  await assert.rejects(store.listForSession('s1', { libraryId: 'unknown' }), code('SCOPE_DENIED'));
}));

test('list/open enforce explicit grants, current consent and general mode before file access', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const own = await create('w1'); const other = await create('w2');
  await upload(own.id, 'own'); const remote = await upload(other.id, 'remote');
  const args = { libraryId: other.id, fileId: remote.id };
  await assert.rejects(store.originalForSession('s1', args), code('SCOPE_DENIED'));
  await assert.rejects(store.listForSession('unowned'), code('NO_LIBRARY'));
  await store.setScope({ sessionId: 's1', mode: 'library', libraryIds: [own.id, other.id] });
  assert.equal((await store.listForSession('s1')).total, 2);
  assert.deepEqual((await store.listForSession('s1', { libraryId: other.id })).files.map(f => f.id), [remote.id]);
  assert.equal((await store.originalForSession('s1', args)).bytes.toString(), 'remote');
  await store.configure({ originalConsent: false });
  await assert.rejects(store.listForSession('s1'), code('CONSENT_REQUIRED'));
  await assert.rejects(store.originalForSession('s1', args), code('SCOPE_DENIED'));
  await store.configure({ originalConsent: true });
  await store.setScope({ sessionId: 's1', mode: 'general', libraryIds: [other.id] });
  await assert.rejects(store.listForSession('s1'), code('GENERAL_MODE'));
  await assert.rejects(store.originalForSession('s1', args), code('SCOPE_DENIED'));
}));

test('legacy cloud snippet consent never silently authorizes full originals', () => fixture(async ({ store, configure, create, upload, ws }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id);
  const old = structuredClone(store.state); delete old.settings.originalConsent; old.settings.cloudConsent = true;
  const restored = new LibraryStore({ state: old, workspaces: () => ws, persist: async () => {} });
  assert.equal(restored.scope('s1').cloudConsent, false); assert.equal(restored.scope('s1').originalConsent, false);
  await assert.rejects(restored.listForSession('s1'), code('CONSENT_REQUIRED'));
  await assert.rejects(restored.originalForSession('s1', { libraryId: lib.id, fileId: file.id }), code('SCOPE_DENIED'));
  await restored.configure({ cloudConsent: true }); assert.equal(restored.scope('s1').originalConsent, false);
  await restored.configure({ originalConsent: 'yes' }); assert.equal(restored.scope('s1').originalConsent, false);
  await restored.configure({ originalConsent: true }); assert.equal((await restored.listForSession('s1')).total, 1);
  await restored.configure({ maxFileMiB: 2 }); assert.equal(restored.scope('s1').originalConsent, true);
}));

test('legacy ready/error/stored files work without migration; exclude and trash restore exact states', () => fixture(async ({ store, configure, create, upload, ws }) => {
  await configure(); const lib = await create('w1');
  for (const status of ['ready', 'error', 'stored']) {
    const file = await upload(lib.id, `legacy ${status}`, `${status}.pdf`);
    Object.assign(store.file(store.library(lib.id), file.id), { status, extractionStatus: status === 'ready' ? 'ready' : 'error', chunks: status === 'ready' ? 7 : 0 });
  }
  const old = structuredClone(store.state); const restored = new LibraryStore({ state: old, workspaces: () => ws, persist: async () => {} });
  assert.deepEqual(restored.state, old); assert.equal((await restored.listForSession('s1')).total, 3);
  for (const file of old.libraries[0].files) {
    const args = { libraryId: lib.id, fileId: file.id }; const action = input => restored.fileAction({ ...args, ...input });
    assert.equal((await restored.originalForSession('s1', args)).bytes.toString(), `legacy ${file.status}`);
    await action({ action: 'exclude', excluded: false }); assert.equal(restored.file(restored.library(lib.id), file.id).status, file.status);
    await action({ action: 'exclude', excluded: true }); await action({ action: 'exclude', excluded: true });
    await assert.rejects(restored.originalForSession('s1', args), code('FILE_NOT_AVAILABLE'));
    assert.ok(!(await restored.listForSession('s1')).files.some(f => f.id === file.id));
    assert.equal((await restored.original(args)).name, file.name, 'browser download remains independent of model exclusion');
    await assert.rejects(action({ action: 'trashFile', confirmation: 'wrong' }), code('CONFIRMATION_REQUIRED'));
    await action({ action: 'trashFile', confirmation: file.name });
    await assert.rejects(action({ action: 'exclude', excluded: false }), code('INVALID_STATE'));
    await assert.rejects(restored.original(args), code('INVALID_STATE'));
    await action({ action: 'restoreFile' }); assert.equal(restored.file(restored.library(lib.id), file.id).status, 'excluded');
    await action({ action: 'exclude', excluded: false }); assert.equal(restored.file(restored.library(lib.id), file.id).status, file.status);
    await action({ action: 'trashFile', confirmation: file.name }); await action({ action: 'restoreFile' });
    assert.equal(restored.file(restored.library(lib.id), file.id).status, file.status);
    await assert.rejects(action({ action: 'restoreFile' }), code('INVALID_STATE'));
  }
}));

test('original detects size/hash changes and ownership marker tampering', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'original');
  const args = { libraryId: lib.id, fileId: file.id }; const filename = path.join(lib.path, 'originals', file.id + file.ext);
  await writeFile(filename, 'tampered'); // Same length: exercises SHA-256, not only stat size.
  await assert.rejects(store.original(args), code('SOURCE_CHANGED'));
  await assert.rejects(store.originalForSession('s1', args), code('SOURCE_CHANGED'));
  await writeFile(filename, 'longer than original'); await assert.rejects(store.original(args), code('SOURCE_CHANGED'));
  await writeFile(filename, 'original');
  await writeFile(path.join(lib.path, '.dsh-library.json'), JSON.stringify({ id: 'not-owner', kind: 'dsh-library' }));
  await assert.rejects(store.original(args), code('UNSAFE_PATH'));
}));

test('symlink/junction paths refused for settings and original downloads', t => fixture(async ({ directory, store, configure, create, upload }) => {
  const target = path.join(directory, 'real-target'); const link = path.join(directory, 'linked'); await mkdir(target);
  try { await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`链接权限不足：${error.code}`); return; } throw error; }
  try {
    await assert.rejects(assertPlainPath(path.join(link, 'child')), code('UNSAFE_PATH'));
    await assert.rejects(store.configure({ root: link }), code('UNSAFE_PATH'));
    await configure(); const lib = await create('w1'); const file = await upload(lib.id);
    const original = path.join(lib.path, 'originals', file.id + file.ext); const victim = path.join(target, 'victim.txt');
    await writeFile(victim, 'external');
    try {
      assert.equal(path.dirname(original), path.join(lib.path, 'originals')); await unlink(original); await symlink(victim, original, 'file');
    } catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic(`已验证目录链接；文件链接权限不足：${error.code}`); return; } throw error; }
    try { await assert.rejects(store.originalForSession('s1', { libraryId: lib.id, fileId: file.id }), code('UNSAFE_PATH')); }
    finally { assert.equal(path.dirname(original), path.join(lib.path, 'originals')); await unlink(original); }
  } finally { assert.equal(path.dirname(path.resolve(link)), path.resolve(directory)); await removeDirectoryLink(link); }
}));

const recycle = (store, libraryId, file) => store.fileAction({ action: 'trashFile', libraryId, fileId: file.id, confirmation: file.name });
const noFile = filename => assert.rejects(readFile(filename), error => error.code === 'ENOENT');

test('permanent deletion requires exact confirmation, explicit safe IDs and trash state', () => fixture(async ({ store, configure, create, upload, persisted }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'keep');
  const args = { libraryId: lib.id, fileId: file.id, confirmation: file.name };
  await assert.rejects(store.purgeFile(args), code('INVALID_STATE'));
  await store.fileAction({ ...args, action: 'exclude', excluded: true });
  await assert.rejects(store.purgeFile(args), code('INVALID_STATE'));
  await recycle(store, lib.id, file);
  const writes = persisted.length;
  await assert.rejects(store.purgeFile({ ...args, confirmation: 'wrong' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(store.emptyTrash({ libraryId: lib.id, confirmation: 'wrong' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(store.purgeFile({ libraryId: lib.id, confirmation: lib.name }), code('INVALID_ID'));
  await assert.rejects(store.purgeFile({ ...args, fileId: '../outside' }), code('INVALID_ID'));
  assert.equal(persisted.length, writes);
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), 'keep');
  assert.equal(store.file(store.library(lib.id), file.id).purgePending, undefined);
  await store.update({ libraryId: lib.id, action: 'archive' });
  await assert.rejects(store.purgeFile(args), code('LIBRARY_NOT_FOUND'));
  await assert.rejects(store.emptyTrash({ libraryId: lib.id, confirmation: lib.name }), code('LIBRARY_NOT_FOUND'));
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), 'keep');
}));

test('single purge removes only original and legacy extracted copy, never source or other library', () => fixture(async ({ directory, store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const other = await create('w2');
  const source = path.join(directory, 'source-original.txt'); await writeFile(source, 'external source');
  const file = await upload(lib.id, 'library bytes'); const remote = await upload(other.id, 'other bytes');
  // Even tampered provenance metadata is not a deletion target.
  store.file(store.library(lib.id), file.id).sourcePath = source;
  await mkdir(path.join(lib.path, 'extracted'));
  const extracted = path.join(lib.path, 'extracted', file.id + '.json'); await writeFile(extracted, '{}');
  const unrelated = path.join(lib.path, 'extracted', 'unrelated.json'); await writeFile(unrelated, 'keep');
  await recycle(store, lib.id, file);
  const result = await store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name });
  assert.deepEqual(result, { libraryId: lib.id, requested: 1, deleted: 1, remaining: 0, complete: true, failed: [], warnings: [] });
  await noFile(path.join(lib.path, 'originals', file.id + file.ext)); await noFile(extracted);
  assert.equal(await readFile(unrelated, 'utf8'), 'keep'); assert.equal(await readFile(source, 'utf8'), 'external source');
  assert.equal((await store.original({ libraryId: other.id, fileId: remote.id })).bytes.toString(), 'other bytes');
  assert.equal(store.library(lib.id).files.length, 0);
  assert.equal(JSON.parse(await readFile(path.join(lib.path, 'manifest.json'), 'utf8')).files.length, 0);
}));

test('emptyTrash only deletes its own trash and remains idempotent when empty', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const other = await create('w2');
  const a = await upload(lib.id, 'a'); const b = await upload(lib.id, 'b'); const active = await upload(lib.id, 'active'); const excluded = await upload(lib.id, 'excluded'); const remote = await upload(other.id, 'remote');
  await recycle(store, lib.id, a); await recycle(store, lib.id, b); await recycle(store, other.id, remote);
  await store.fileAction({ libraryId: lib.id, fileId: excluded.id, action: 'exclude', excluded: true });
  const result = await store.emptyTrash({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(result.requested, 2); assert.equal(result.deleted, 2); assert.equal(result.complete, true);
  assert.deepEqual(store.library(lib.id).files.map(file => file.id), [active.id, excluded.id]);
  assert.equal(store.file(store.library(other.id), remote.id).status, 'trash');
  assert.equal(await readFile(path.join(other.path, 'originals', remote.id + remote.ext), 'utf8'), 'remote');
  assert.equal((await store.emptyTrash({ libraryId: lib.id, confirmation: lib.name })).requested, 0);
}));

test('purge preflight refuses malformed extensions, IDs, marker and changed library paths before any unlink', () => fixture(async ({ store, configure, create, upload, persisted }) => {
  await configure(); const lib = await create('w1'); const a = await upload(lib.id, 'a'); const b = await upload(lib.id, 'b');
  await recycle(store, lib.id, a); await recycle(store, lib.id, b);
  const actual = store.library(lib.id); const item = store.file(actual, b.id); const writes = persisted.length;
  for (const ext of ['../escape', '.x/../../outside', '.TXT', '.x:ads', '.toolongextension123', undefined, null]) {
    item.ext = ext;
    await assert.rejects(store.emptyTrash({ libraryId: lib.id, confirmation: lib.name }), code('UNSAFE_EXTENSION'));
  }
  item.ext = b.ext;
  item.id = '../escape'; await assert.rejects(store.emptyTrash({ libraryId: lib.id, confirmation: lib.name }), code('INVALID_ID')); item.id = b.id;
  item.id = a.id; await assert.rejects(store.emptyTrash({ libraryId: lib.id, confirmation: lib.name }), code('INVALID_ID')); item.id = b.id;
  actual.path = path.dirname(lib.path); await assert.rejects(store.emptyTrash({ libraryId: lib.id, confirmation: lib.name }), code('UNSAFE_PATH')); actual.path = lib.path;
  const marker = path.join(lib.path, '.dsh-library.json'); await writeFile(marker, JSON.stringify({ id: 'wrong', kind: 'dsh-library' }));
  await assert.rejects(store.emptyTrash({ libraryId: lib.id, confirmation: lib.name }), code('UNSAFE_PATH'));
  assert.equal(persisted.length, writes); assert.equal(item.purgePending, undefined);
  assert.equal(await readFile(path.join(lib.path, 'originals', a.id + a.ext), 'utf8'), 'a');
}));

test('purge refuses directories and junctions at either fixed deletion target', t => fixture(async ({ directory, store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'bytes'); await recycle(store, lib.id, file);
  const original = path.join(lib.path, 'originals', file.id + file.ext);
  assert.equal(path.dirname(original), path.join(lib.path, 'originals')); await unlink(original); await mkdir(original);
  await assert.rejects(store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name }), code('UNSAFE_PATH'));
  assert.equal(path.dirname(original), path.join(lib.path, 'originals')); await rmdir(original); await writeFile(original, 'bytes');
  await mkdir(path.join(lib.path, 'extracted')); const extracted = path.join(lib.path, 'extracted', file.id + '.json'); await mkdir(extracted);
  await assert.rejects(store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name }), code('UNSAFE_PATH'));
  assert.equal(path.dirname(extracted), path.join(lib.path, 'extracted')); await rmdir(extracted);
  const victim = path.join(directory, 'external-victim'); await mkdir(victim); await writeFile(path.join(victim, 'keep.txt'), 'source');
  try { await symlink(victim, extracted, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.diagnostic(`junction permission: ${error.code}`); return; } throw error; }
  try {
    await assert.rejects(store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name }), code('UNSAFE_PATH'));
    assert.equal(await readFile(path.join(victim, 'keep.txt'), 'utf8'), 'source'); assert.equal(await readFile(original, 'utf8'), 'bytes');
  } finally { assert.equal(path.dirname(extracted), path.join(lib.path, 'extracted')); await removeDirectoryLink(extracted); }
}));

test('purge refuses file symlinks without deleting the external target', t => fixture(async ({ directory, store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'bytes'); await recycle(store, lib.id, file);
  const original = path.join(lib.path, 'originals', file.id + file.ext); const victim = path.join(directory, 'external.txt'); await writeFile(victim, 'external');
  assert.equal(path.dirname(original), path.join(lib.path, 'originals')); await unlink(original);
  try { await symlink(victim, original, 'file'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip(`file symlink permission: ${error.code}`); return; } throw error; }
  try { await assert.rejects(store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name }), code('UNSAFE_PATH')); assert.equal(await readFile(victim, 'utf8'), 'external'); }
  finally { assert.equal(path.dirname(original), path.join(lib.path, 'originals')); await unlink(original); }
}));

test('unlink failure after partial deletion stays pending, blocks restore and recovers after restart', () => fixture(async ({ store, configure, create, upload, persisted, ws }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'bytes'); await recycle(store, lib.id, file);
  await mkdir(path.join(lib.path, 'extracted')); const extracted = path.join(lib.path, 'extracted', file.id + '.json'); await writeFile(extracted, '{}');
  store.removeFile = async filename => { if (filename === extracted) throw Object.assign(new Error('synthetic busy'), { code: 'EBUSY' }); await unlink(filename); };
  const result = await store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name });
  assert.equal(result.complete, false); assert.equal(result.failed[0].stage, 'delete'); assert.equal(result.failed[0].code, 'EBUSY');
  await noFile(path.join(lib.path, 'originals', file.id + file.ext)); assert.equal(await readFile(extracted, 'utf8'), '{}');
  assert.equal(store.file(store.library(lib.id), file.id).purgePending, true);
  await assert.rejects(store.fileAction({ action: 'restoreFile', libraryId: lib.id, fileId: file.id }), code('PURGE_PENDING'));
  const restored = new LibraryStore({ state: persisted.at(-1), workspaces: () => ws, persist: async () => {} });
  await assert.rejects(restored.fileAction({ action: 'restoreFile', libraryId: lib.id, fileId: file.id }), code('PURGE_PENDING'));
  assert.equal((await restored.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name })).complete, true); await noFile(extracted);
}));

test('intent persist failure never deletes bytes and can retry conservatively pending', () => fixture(async ({ store, configure, create, upload, fail }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'bytes'); await recycle(store, lib.id, file);
  fail(true); const result = await store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name });
  assert.equal(result.failed[0].stage, 'intent'); assert.equal(result.deleted, 0);
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), 'bytes');
  assert.equal(store.file(store.library(lib.id), file.id).purgePending, true);
  await assert.rejects(store.fileAction({ action: 'restoreFile', libraryId: lib.id, fileId: file.id }), code('PURGE_PENDING'));
  fail(false); assert.equal((await store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name })).complete, true);
}));

test('final metadata persist failure never rolls deleted bytes into restorable records', () => fixture(async ({ store, configure, create, upload, ws }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'bytes'); await recycle(store, lib.id, file);
  let writes = 0; let durable;
  store.persist = async state => { writes++; if (writes === 2) throw new Error('synthetic final commit failure'); durable = structuredClone(state); };
  const result = await store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name });
  assert.equal(result.failed[0].stage, 'commit'); assert.equal(result.complete, false);
  await noFile(path.join(lib.path, 'originals', file.id + file.ext)); assert.equal(store.file(store.library(lib.id), file.id).purgePending, true);
  await assert.rejects(store.fileAction({ action: 'restoreFile', libraryId: lib.id, fileId: file.id }), code('PURGE_PENDING'));
  const restored = new LibraryStore({ state: durable, workspaces: () => ws, persist: async () => {} });
  assert.equal(restored.file(restored.library(lib.id), file.id).purgePending, true);
  assert.equal((await restored.emptyTrash({ libraryId: lib.id, confirmation: lib.name })).complete, true); assert.equal(restored.library(lib.id).files.length, 0);
}));

test('trashAll requires exact confirmation and active libraries, with an idempotent empty batch', () => fixture(async ({ store, configure, create, upload, persisted }) => {
  await configure(); const lib = await create('w1'); const input = { libraryId: lib.id, confirmation: lib.name };
  const empty = { libraryId: lib.id, moved: 0, alreadyTrashed: 0, total: 0 };
  assert.deepEqual(await store.trashAll(input), empty); assert.deepEqual(await store.trashAll(input), empty);
  const file = await upload(lib.id, 'keep'); const before = structuredClone(store.state); const writes = persisted.length;
  for (const confirmation of [undefined, '', 'wrong', ` ${lib.name}`, `${lib.name} `]) await assert.rejects(store.trashAll({ ...input, confirmation }), code('CONFIRMATION_REQUIRED'));
  assert.deepEqual(store.state, before); assert.equal(persisted.length, writes);
  await store.update({ libraryId: lib.id, action: 'archive' });
  const archived = structuredClone(store.state); const count = persisted.length;
  await assert.rejects(store.trashAll(input), code('LIBRARY_NOT_FOUND'));
  assert.deepEqual(store.state, archived); assert.equal(persisted.length, count);
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), 'keep');
}));

test('trashAll batches legacy/excluded states once, preserves old trash and never touches originals or other libraries', () => fixture(async ({ directory, store, configure, create, upload, persisted }) => {
  await configure(); const lib = await create('w1'); const other = await create('w2'); const remote = await upload(other.id, 'other library');
  const source = path.join(directory, 'source-original.txt'); await writeFile(source, 'source bytes');
  const statuses = ['ready', 'error', 'stored', 'excluded']; const files = [];
  for (const [index, status] of statuses.entries()) {
    const file = await store.importBytes({ libraryId: lib.id, name: `file${index}.txt`, bytes: Buffer.from(`original ${index}`), sourcePath: `source/file${index}.txt` });
    const item = store.file(store.library(lib.id), file.id); item.status = status; item.previousStatus = 'obsolete';
    if (status === 'excluded') item.excludedPreviousStatus = 'error'; files.push(file);
  }
  const already = await upload(lib.id, 'already trash'); await recycle(store, lib.id, already);
  const pending = await upload(lib.id, 'pending trash'); await recycle(store, lib.id, pending); store.file(store.library(lib.id), pending.id).purgePending = true;
  const previousTrash = [already, pending].map(file => structuredClone(store.file(store.library(lib.id), file.id)));
  const otherBefore = structuredClone(store.library(other.id)); const writes = persisted.length; let mirrors = 0;
  const manifest = store.manifest.bind(store); store.manifest = async item => { mirrors++; return manifest(item); };
  store.removeFile = async () => { throw new Error('must not unlink'); }; store.filePath = async () => { throw new Error('must not read original paths'); };
  assert.deepEqual(await store.trashAll({ libraryId: lib.id, confirmation: lib.name }), { libraryId: lib.id, moved: 4, alreadyTrashed: 2, total: 6 });
  assert.equal(mirrors, 1); assert.equal(persisted.length, writes + 1);
  for (const [index, file] of files.entries()) {
    const item = store.file(store.library(lib.id), file.id); assert.equal(item.status, 'trash'); assert.equal(item.previousStatus, statuses[index]);
    assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), `original ${index}`);
  }
  for (const [index, file] of [already, pending].entries()) assert.deepEqual(store.file(store.library(lib.id), file.id), previousTrash[index]);
  assert.deepEqual(store.library(other.id), otherBefore); assert.equal(await readFile(path.join(other.path, 'originals', remote.id + remote.ext), 'utf8'), 'other library');
  assert.equal(await readFile(source, 'utf8'), 'source bytes');
  for (const [index, file] of files.entries()) { await store.fileAction({ action: 'restoreFile', libraryId: lib.id, fileId: file.id }); assert.equal(store.file(store.library(lib.id), file.id).status, statuses[index]); }
  assert.equal(store.file(store.library(lib.id), files[3].id).excludedPreviousStatus, 'error');
  await store.fileAction({ action: 'exclude', libraryId: lib.id, fileId: files[3].id, excluded: false }); assert.equal(store.file(store.library(lib.id), files[3].id).status, 'error');
}));

test('trashAll persist failure rolls memory back and the domain remains authoritative over an ahead mirror', () => fixture(async ({ store, configure, create, upload, persisted, fail, ws }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'safe bytes');
  const before = structuredClone(store.state); const durable = structuredClone(persisted.at(-1)); const writes = persisted.length;
  fail(true); await assert.rejects(store.trashAll({ libraryId: lib.id, confirmation: lib.name }), /persist deliberately failed/);
  assert.deepEqual(store.state, before); assert.equal(persisted.length, writes); assert.deepEqual(persisted.at(-1), durable);
  const mirror = JSON.parse(await readFile(path.join(lib.path, 'manifest.json'), 'utf8'));
  assert.equal(mirror.files[0].status, 'trash', 'mirror-first transactions are not cross-file atomic');
  const restarted = new LibraryStore({ state: durable, workspaces: () => ws, persist: async () => {} });
  assert.equal(restarted.file(restarted.library(lib.id), file.id).status, 'stored', 'restart must use domain, not mirror');
  assert.equal(await readFile(path.join(lib.path, 'originals', file.id + file.ext), 'utf8'), 'safe bytes');
  fail(false); assert.equal((await store.trashAll({ libraryId: lib.id, confirmation: lib.name })).moved, 1);
}));

test('concurrent trashAll calls serialize into one moved batch and a zero-move batch', () => fixture(async ({ store, configure, create, upload, persisted }) => {
  await configure(); const lib = await create('w1'); for (let i = 0; i < 3; i++) await upload(lib.id, `bytes ${i}`);
  const writes = persisted.length; const input = { libraryId: lib.id, confirmation: lib.name };
  assert.deepEqual(await Promise.all([store.trashAll(input), store.trashAll(input)]), [
    { libraryId: lib.id, moved: 3, alreadyTrashed: 0, total: 3 },
    { libraryId: lib.id, moved: 0, alreadyTrashed: 3, total: 3 },
  ]);
  assert.equal(persisted.length, writes + 2); assert.ok(store.library(lib.id).files.every(file => file.status === 'trash' && file.previousStatus === 'stored'));
}));

test('backup manifest failure after authoritative removal reports warning without resurrecting a file', () => fixture(async ({ store, configure, create, upload }) => {
  await configure(); const lib = await create('w1'); const file = await upload(lib.id, 'bytes'); await recycle(store, lib.id, file);
  const originalManifest = store.manifest.bind(store); let calls = 0;
  store.manifest = async library => { calls++; if (calls === 2) throw new Error('synthetic mirror failure'); return originalManifest(library); };
  const result = await store.purgeFile({ libraryId: lib.id, fileId: file.id, confirmation: file.name });
  assert.equal(result.complete, true); assert.equal(result.deleted, 1); assert.equal(result.warnings[0].code, 'MANIFEST_UPDATE_FAILED');
  assert.equal(store.library(lib.id).files.length, 0); await noFile(path.join(lib.path, 'originals', file.id + file.ext));
  await store.emptyTrash({ libraryId: lib.id, confirmation: lib.name });
  assert.equal(JSON.parse(await readFile(path.join(lib.path, 'manifest.json'), 'utf8')).files.length, 0);
}));
