import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { apply, inject } from '../index.js';
import { initialState, LibraryStore } from '../src/store.js';

const project = path.resolve(import.meta.dirname, '..');
const errorCode = expected => error => { assert.equal(error.code, expected); return true; };

// Contract harness: real store/registered handlers, mock public Host services; not a live DSH acceptance test.
async function fixture(run, { legacyConsent = false } = {}) {
  const directory = await mkdtemp(path.join(project, '.test-data-host-'));
  let state = initialState(); delete state.settings.maxFileMiB;
  if (legacyConsent) { state.settings.cloudConsent = true; delete state.settings.originalConsent; }
  let closed = false;
  const events = new Map(), tools = new Map(), sections = new Map(), contexts = new Map(), routes = [], cleanup = [], savedFiles = [], savedImages = [];
  const workspaces = [{ id: 'w1', title: '工作区', sessionIds: new Set(['s1']), path: directory }];
  const ctx = {
    storageDomain: { async open(options) {
      assert.equal(options.name, 'dsh_library');
      const schema = options.global.schema;
      return { global: { get: () => schema.parse(structuredClone(state)), set: value => { state = schema.parse(structuredClone(value)); } }, close: async () => { closed = true; } };
    } },
    workspaceRegistry: { list: () => workspaces },
    connection: { browserPeer: { id: 'browser' }, admit: () => ({ peer: { id: 'browser' } }), fetch: { register(value) { routes.push(value); return () => {}; } } },
    tools: { register(value) { tools.set(value.name, value); return () => tools.delete(value.name); } },
    systemPrompt: { section(value) { sections.set(value.name, value); return () => {}; }, context(value) { contexts.set(value.name, value); return () => {}; } },
    get(name) { return name === 'attachments' ? this.attachments : name === 'fs' ? this.fs : undefined; },
    fs: { processPathFromHostPath(hostPath) { return `/execution-world${hostPath}`; } },
    attachments: {
      fileHostPath(ref) {
        assert.ok(savedFiles.some(item => item.ref === ref));
        return `/native-attachment-store/${ref.attachmentId.slice('sha256:'.length)}`;
      },
      async saveFile(input) {
        assert.ok(input.data instanceof Uint8Array);
        assert.deepEqual(Object.keys(input).sort(), ['data', 'name']);
        // Shape verified against dsh-attachment-local saveFileVerbatim; render must pass it through unchanged.
        const ref = Object.freeze({ attachmentId: `sha256:${createHash('sha256').update(input.data).digest('hex')}`, name: input.name, bytes: input.data.byteLength });
        savedFiles.push({ input, ref }); return ref;
      },
      async saveImage(input) {
        assert.ok(input.data instanceof Uint8Array);
        assert.deepEqual(Object.keys(input).sort(), ['data', 'mediaType', 'name']);
        assert.ok(['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mediaType));
        // Contract mock only: the real service decodes/normalizes pixels; no native image codec is imported here.
        const ref = Object.freeze({ attachmentId: `sha256:${createHash('sha256').update(input.data).digest('hex')}`, mediaType: input.mediaType, width: 1, height: 1, bytes: input.data.byteLength, name: input.name });
        savedImages.push({ input, ref }); return ref;
      },
    },
    sessions: {}, logger: { warn() {} },
    on(name, callback) { events.set(name, callback); return () => events.delete(name); },
    effect(callback) { const dispose = callback(); if (typeof dispose === 'function') cleanup.push(dispose); return dispose; },
  };
  const api = async input => {
    const route = routes.find(route => route.path === '/api/dsh-library');
    const response = await route.fetch(new Request('http://localhost/api/dsh-library', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DSH-Library': '1' }, body: JSON.stringify(input) }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); return body.value;
  };
  const prepare = async ({ originalConsent = true, text = 'PrivateOriginalBody backup recovery', name = '证据.txt', bytes } = {}) => {
    await api({ action: 'configure', root: path.join(directory, 'root'), originalConsent });
    const library = await api({ action: 'create', workspaceId: 'w1' });
    const file = await api({ action: 'import', libraryId: library.id, name, base64: Buffer.from(bytes ?? text).toString('base64') });
    assert.equal(file.status, 'stored'); return { library, file };
  };
  const context = id => contexts.get('dsh-library.evidence').text({ scope: { id } });
  const call = (name, args = {}, id = 's1') => tools.get(name).execute(args, { agent: { id } });
  const step = async ({ id = 's1', turn = 1, decision = { kind: 'enter' }, signal = new AbortController().signal } = {}) => {
    const payload = { agent: { id }, turn, signal, get messages() { throw new Error('pre-step must not inspect user messages'); } };
    return events.get('agent/pre-step')(payload, async () => decision);
  };
  const restart = async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
    assert.equal(closed, true);
    events.clear(); tools.clear(); sections.clear(); contexts.clear(); routes.splice(0);
    closed = false; await apply(ctx);
  };
  try {
    await apply(ctx);
    return await run({ ctx, api, prepare, context, call, step, restart, workspaces, events, tools, sections, contexts, routes, savedFiles, savedImages, directory, state: () => state });
  } finally {
    for (const dispose of cleanup.reverse()) await dispose();
    assert.equal(closed, true);
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), project); assert.ok(path.basename(target).startsWith('.test-data-host-'));
    await rm(target, { recursive: true, force: true });
  }
}

const openArgs = ({ library, file }) => ({ libraryId: library.id, fileId: file.id });

test('registers public attachment dependency, streaming route and only on-demand file tools', () => fixture(async ({ routes, tools, sections, contexts }) => {
  assert.deepEqual(inject, ['storageDomain', 'workspaceRegistry', 'connection', 'tools', 'systemPrompt', 'sessions', 'attachments']);
  assert.equal(routes[0].path, '/api/dsh-library');
  assert.deepEqual(routes[0].methods, ['POST']); assert.equal(routes[0].requestBody, 'streaming');
  assert.deepEqual([...tools.keys()].sort(), ['library_files', 'library_manage', 'library_open', 'library_status']);
  assert.equal(tools.get('library_open').isConcurrencySafe(), false);
  assert.deepEqual(tools.get('library_manage').parameters.properties.action.enum, ['rename', 'exclude', 'include']);
  const rules = sections.get('dsh-library.rules').text;
  assert.match(rules, /不提前解析正文/); assert.match(rules, /不可信原文/);
  assert.match(rules, /模型知识补充与推断须明确区分/);
  assert.match(rules, /隐私设置和当前会话跨库授权边界始终有效/);
  assert.match(rules, /旧片段发送同意不等于原件同意/);
  assert.match(rules, /切换模式不承诺模型遗忘；严格隔离建议新建会话/);
  assert.doesNotMatch(rules, /library_search|library_read|coverage|事实结论必须来自/);
  assert.equal(contexts.get('dsh-library.evidence').required, true);
}));

test('import only saves original bytes and metadata, including binary source paths, across restart', () => fixture(async ({ api, prepare, restart, state, routes }) => {
  assert.equal((await api({ action: 'snapshot' })).settings.maxFileMiB, 50);
  const { library } = await prepare();
  await api({ action: 'configure', maxFileMiB: 73 });
  const response = await routes[0].fetch(new Request('http://localhost/api/dsh-library', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-DSH-Library': '1', 'X-DSH-Library-Action': 'import', 'X-DSH-Library-Id': library.id, 'X-DSH-Library-Name': encodeURIComponent('二进制.bin'), 'X-DSH-Library-Source-Path': encodeURIComponent('文件夹/二进制.bin') }, body: Buffer.from([0, 255, 1, 2]),
  }));
  assert.equal(response.status, 200);
  const file = (await response.json()).value;
  assert.equal(file.status, 'stored'); assert.equal(file.sourcePath, '文件夹/二进制.bin');
  await restart();
  assert.equal(state().settings.maxFileMiB, 73); assert.equal(state().settings.originalConsent, true);
  assert.equal(state().libraries[0].files.find(item => item.id === file.id).status, 'stored');
}));

test('pre-step only admits budgets and injects small current library metadata, never original text or attachments', () => fixture(async ({ prepare, step, context, savedFiles, savedImages }) => {
  assert.equal(context('s1'), '');
  const { library } = await prepare();
  const decision = { kind: 'enter', marker: 'same' };
  assert.equal(await step({ decision }), decision);
  assert.match(context('s1'), /资料库模式/); assert.match(context('s1'), new RegExp(library.id));
  assert.doesNotMatch(context('s1'), /PrivateOriginalBody|backup|证据\.txt|sha256|base64/);
  assert.equal(context('other'), '');
  assert.equal(savedFiles.length, 0); assert.equal(savedImages.length, 0);
}));

test('files finds only metadata and open returns the unchanged native file reference and source label', () => fixture(async ({ prepare, step, call, tools, savedFiles }) => {
  const item = await prepare(); await step();
  const listed = await call('library_files', { query: '证据', offset: 0 });
  assert.equal(listed.files[0].id, item.file.id); assert.equal(listed.files[0].libraryId, item.library.id);
  assert.doesNotMatch(JSON.stringify(listed), /PrivateOriginalBody|backup/);
  const result = await call('library_open', openArgs(item));
  assert.equal(savedFiles.length, 1);
  assert.equal(Buffer.from(savedFiles[0].input.data).toString(), 'PrivateOriginalBody backup recovery');
  assert.equal(result.attachment, savedFiles[0].ref);
  assert.equal(result.readPath, `/execution-world/native-attachment-store/${result.attachment.attachmentId.slice('sha256:'.length)}`);
  assert.match(result.readNotice, /PTC\/run_code/);
  const blocks = tools.get('library_open').output.render(openArgs(item), result);
  assert.equal(blocks[0].type, 'text'); assert.match(blocks[0].text, /证据\.txt/);
  assert.deepEqual(blocks[1], { type: 'file', attachment: savedFiles[0].ref });
  assert.doesNotMatch(JSON.stringify(result), /PrivateOriginalBody|base64|originals|root/);
}));

test('general only marks mode without library metadata and denies file list/open without saving attachments', () => fixture(async ({ prepare, api, step, context, call, savedFiles }) => {
  const item = await prepare(); await step();
  await call('library_open', openArgs(item)); assert.equal(savedFiles.length, 1);
  await api({ action: 'setSessionScope', sessionId: 's1', mode: 'general', libraryIds: [item.library.id] });
  const marker = '通用模式：本轮不使用项目资料库，也不将历史资料库附件作为本轮回答依据；用户主动提供的其他内容仍可正常处理。';
  assert.equal(context('s1'), marker);
  assert.doesNotMatch(context('s1'), new RegExp(`${item.library.id}|${item.file.id}|证据\\.txt|PrivateOriginalBody|工作区`));
  await step({ turn: 2 });
  assert.equal(context('s1'), marker);
  await assert.rejects(call('library_files', { query: '', offset: 0 }), errorCode('GENERAL_MODE'));
  await assert.rejects(call('library_open', openArgs(item)), errorCode('GENERAL_MODE'));
  assert.equal(savedFiles.length, 1, 'general must not hand off another copy of historical attachments');
  await api({ action: 'setSessionScope', sessionId: 's1', mode: 'library', libraryIds: [item.library.id] });
  assert.doesNotMatch(context('s1'), /PrivateOriginalBody|attachment|证据\.txt/);
  assert.equal(savedFiles.length, 1);
}));

test('legacy snippet consent never upgrades to original-file consent', () => fixture(async ({ api, prepare, step, call, context, state, savedFiles }) => {
  assert.equal(state().settings.originalConsent, false);
  const item = await prepare({ originalConsent: false });
  await api({ action: 'configure', cloudConsent: true }); await step();
  assert.match(context('s1'), /尚未同意/); assert.doesNotMatch(context('s1'), /证据\.txt|PrivateOriginalBody/);
  await assert.rejects(call('library_files', { query: '', offset: 0 }), errorCode('CONSENT_REQUIRED'));
  await assert.rejects(call('library_open', openArgs(item)), errorCode('CONSENT_REQUIRED'));
  assert.equal(savedFiles.length, 0);
  await api({ action: 'configure', originalConsent: true });
  await call('library_open', openArgs(item)); assert.equal(savedFiles.length, 1);
}, { legacyConsent: true }));

test('current scope excludes removed cross-library metadata and denies unauthorized originals', () => fixture(async ({ prepare, api, step, call, context, workspaces, savedFiles }) => {
  const item = await prepare();
  workspaces.push({ id: 'w2', title: 'Second', sessionIds: new Set(['s2']) });
  const extra = await api({ action: 'create', workspaceId: 'w2', name: 'ExtraPrivateLibrary' });
  const file = await api({ action: 'import', libraryId: extra.id, name: 'extra.bin', base64: Buffer.from('extra private bytes').toString('base64') });
  await api({ action: 'setSessionScope', sessionId: 's1', mode: 'library', libraryIds: [item.library.id, extra.id] });
  await step(); assert.match(context('s1'), /ExtraPrivateLibrary/);
  await api({ action: 'setSessionScope', sessionId: 's1', mode: 'library', libraryIds: [item.library.id] });
  assert.doesNotMatch(context('s1'), /ExtraPrivateLibrary/);
  await assert.rejects(call('library_open', { libraryId: extra.id, fileId: file.id }), errorCode('SCOPE_DENIED'));
  assert.equal(savedFiles.length, 0);
}));

test('open rechecks consent after native file storage, dropping revoked result', () => fixture(async ({ prepare, api, step, call, ctx }) => {
  const item = await prepare(); await step();
  const save = ctx.attachments.saveFile;
  ctx.attachments.saveFile = async input => {
    const ref = await save(input);
    await api({ action: 'configure', originalConsent: false }); return ref;
  };
  await assert.rejects(call('library_open', openArgs(item)), errorCode('SCOPE_CHANGED'));
}));

test('open rechecks authority after original read before saving any native attachment', () => fixture(async ({ prepare, api, step, call, savedFiles }) => {
  const item = await prepare(); await step();
  const original = LibraryStore.prototype.originalForSession;
  LibraryStore.prototype.originalForSession = async function (...args) {
    const value = await original.apply(this, args);
    await api({ action: 'configure', originalConsent: false }); return value;
  };
  try { await assert.rejects(call('library_open', openArgs(item)), errorCode('SCOPE_CHANGED')); }
  finally { LibraryStore.prototype.originalForSession = original; }
  assert.equal(savedFiles.length, 0);
}));

test('native image branch detects magic independently of suffix and keeps generic original ref', () => fixture(async ({ prepare, api, step, call, tools, savedFiles, savedImages }) => {
  const samples = [
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/jpeg', Buffer.from([255, 216, 255, 224])],
    ['image/gif', Buffer.from('GIF89a')],
    ['image/webp', Buffer.from('RIFF0000WEBP')],
  ];
  const item = await prepare({ name: 'not-image.png', text: 'fake image extension' }); await step();
  await call('library_open', openArgs(item)); assert.equal(savedImages.length, 0);
  for (const [mediaType, bytes] of samples) {
    const file = await api({ action: 'import', libraryId: item.library.id, name: `magic-${savedImages.length}.bin`, base64: bytes.toString('base64') });
    const result = await call('library_open', { libraryId: item.library.id, fileId: file.id });
    assert.equal(savedImages.at(-1).input.mediaType, mediaType);
    const blocks = tools.get('library_open').output.render({}, result);
    assert.equal(blocks[1].attachment, savedFiles.at(-1).ref);
    assert.deepEqual(blocks[2], { type: 'image', attachment: savedImages.at(-1).ref });
  }
}));

test('image admission failure or absent image service falls back honestly to generic original', () => fixture(async ({ prepare, step, call, ctx, tools, savedFiles }) => {
  const item = await prepare({ bytes: Buffer.from('GIF87a'), name: 'image.gif' }); await step();
  ctx.attachments.saveImage = async () => { throw new Error('private backend path must not leak'); };
  for (const missing of [false, true]) {
    if (missing) delete ctx.attachments.saveImage;
    const result = await call('library_open', openArgs(item));
    assert.equal(result.imageAttachment, undefined); assert.match(result.imageNote, /仅交付原文件|降级交付原文件/);
    assert.match(result.imageNote, /不代表已理解图像/); assert.doesNotMatch(result.imageNote, /private backend/);
    const blocks = tools.get('library_open').output.render({}, result);
    assert.equal(blocks[1].attachment, savedFiles.at(-1).ref); assert.equal(blocks.some(block => block.type === 'image'), false);
  }
}));

test('image save cannot return a block after scope revocation', () => fixture(async ({ prepare, api, step, call, ctx }) => {
  const item = await prepare({ bytes: Buffer.from('GIF89a'), name: 'image.gif' }); await step();
  const save = ctx.attachments.saveImage;
  ctx.attachments.saveImage = async input => { const ref = await save(input); await api({ action: 'configure', originalConsent: false }); return ref; };
  await assert.rejects(call('library_open', openArgs(item)), errorCode('SCOPE_CHANGED'));
}));

test('per-turn calls and original byte budgets survive loops and reset next turn', () => fixture(async ({ prepare, step, call, savedFiles }) => {
  const item = await prepare(); await step();
  for (let i = 0; i < 10; i++) await call('library_files', { query: '', offset: 0 });
  await step(); await assert.rejects(call('library_open', openArgs(item)), errorCode('ATTACHMENT_BUDGET'));
  await step({ turn: 2 });
  const original = LibraryStore.prototype.originalForSession;
  const bytes = new Uint8Array(110 * 1024 * 1024);
  LibraryStore.prototype.originalForSession = async () => ({ name: 'large.bin', bytes });
  try {
    await call('library_open', openArgs(item));
    await assert.rejects(call('library_open', openArgs(item)), errorCode('ATTACHMENT_BUDGET'));
  } finally { LibraryStore.prototype.originalForSession = original; }
  assert.equal(savedFiles.length, 1);
}));

test('arguments, no-turn, disposed agents and management cannot bypass tool authority', () => fixture(async ({ prepare, step, call, tools, events }) => {
  const item = await prepare();
  await assert.rejects(tools.get('library_status').execute({}, {}), errorCode('SESSION_REQUIRED'));
  await assert.rejects(call('library_status', null), errorCode('INVALID_ARGUMENTS'));
  for (const query of [123, 'x'.repeat(513)]) await assert.rejects(call('library_files', { query, offset: 0 }), errorCode('INVALID_QUERY'));
  await assert.rejects(call('library_files', { query: '', offset: -1 }), errorCode('INVALID_OFFSET'));
  await assert.rejects(call('library_open', openArgs(item)), errorCode('NO_TURN'));
  await step();
  for (const action of ['reindex', 'configure', 'trashFile', 'setSessionScope']) await assert.rejects(call('library_manage', { action, fileId: '', name: '' }), errorCode('INVALID_ACTION'));
  await call('library_manage', { action: 'exclude', fileId: item.file.id, name: '' });
  await assert.rejects(call('library_open', openArgs(item)));
  await call('library_manage', { action: 'include', fileId: item.file.id, name: '' });
  await call('library_open', openArgs(item));
  events.get('agent/disposed')({ agent: { id: 's1' } });
  await assert.rejects(call('library_open', openArgs(item)), errorCode('NO_TURN'));
}));

test('file exclusion or trash during attachment saving drops the returned file reference', () => fixture(async ({ prepare, api, step, call, ctx }) => {
  const item = await prepare(); await step();
  const save = ctx.attachments.saveFile;
  for (const action of ['exclude', 'trashFile']) {
    ctx.attachments.saveFile = async input => {
      const ref = await save(input);
      await api({ action, libraryId: item.library.id, fileId: item.file.id, excluded: true, confirmation: item.file.name });
      return ref;
    };
    await assert.rejects(call('library_open', openArgs(item)), errorCode('FILE_NOT_AVAILABLE'));
    await api({ action: action === 'exclude' ? 'exclude' : 'restoreFile', libraryId: item.library.id, fileId: item.file.id, excluded: false });
  }
}));

test('file exclusion during image admission also drops both native references', () => fixture(async ({ prepare, api, step, call, ctx }) => {
  const item = await prepare({ bytes: Buffer.from('GIF89a'), name: 'image.gif' }); await step();
  const save = ctx.attachments.saveImage;
  ctx.attachments.saveImage = async input => {
    const ref = await save(input);
    await api({ action: 'exclude', libraryId: item.library.id, fileId: item.file.id, excluded: true });
    return ref;
  };
  await assert.rejects(call('library_open', openArgs(item)), errorCode('FILE_NOT_AVAILABLE'));
}));

test('file version changes during attachment saving drop the returned reference', () => fixture(async ({ prepare, step, call, ctx }) => {
  const item = await prepare(); await step();
  const original = LibraryStore.prototype.originalForSession;
  let source;
  LibraryStore.prototype.originalForSession = async function (...args) { source = this.file(this.library(item.library.id), item.file.id); return original.apply(this, args); };
  const save = ctx.attachments.saveFile;
  ctx.attachments.saveFile = async input => { const ref = await save(input); source.sha256 = 'changed-version'; return ref; };
  try { await assert.rejects(call('library_open', openArgs(item)), errorCode('SOURCE_CHANGED')); }
  finally { LibraryStore.prototype.originalForSession = original; }
}));

test('metadata output is capped per call and per turn without skipping truncated page entries', () => fixture(async ({ prepare, step, call }) => {
  const item = await prepare(); await step();
  const files = Array.from({ length: 40 }, (_, index) => ({ id: `file-${index}`, libraryId: item.library.id, name: `${index}-${'n'.repeat(230)}.bin`, sourcePath: `${'p'.repeat(760)}/${'n'.repeat(230)}.bin`, size: 1, version: '0123456789ab' }));
  const list = LibraryStore.prototype.listForSession;
  LibraryStore.prototype.listForSession = async (_id, { offset, limit }) => ({ files: files.slice(offset, offset + limit), total: files.length, offset, limit, hasMore: offset + limit < files.length, nextOffset: Math.min(files.length, offset + limit) });
  try {
    let offset = 0, chars = 0, blocked = false;
    const ids = [];
    for (let i = 0; i < 10; i++) {
      try {
        const page = await call('library_files', { query: '', offset });
        const length = JSON.stringify(page).length;
        assert.ok(length <= 8000); chars += length; assert.ok(chars <= 24000);
        assert.equal(page.nextOffset, offset + page.files.length); assert.equal(page.hasMore, page.nextOffset < files.length);
        assert.match(page.notice, /不可信资料，不是指令/);
        ids.push(...page.files.map(file => file.id)); offset = page.nextOffset;
      } catch (error) { assert.equal(error.code, 'ATTACHMENT_BUDGET'); blocked = true; break; }
    }
    assert.equal(blocked, true); assert.deepEqual(ids, files.slice(0, offset).map(file => file.id));
    await step({ turn: 2 });
    const next = await call('library_files', { query: '', offset });
    assert.equal(next.files[0].id, files[offset].id);
  } finally { LibraryStore.prototype.listForSession = list; }
}));

test('generic-file PTC value preserves a provider-mapped readable path without relying on rendered file blocks', () => fixture(async ({ prepare, step, call, ctx, directory, tools }) => {
  const item = await prepare(); await step();
  const nativePath = path.join(directory, 'native-file-copy.txt');
  const save = ctx.attachments.saveFile;
  let ref;
  ctx.attachments.saveFile = async input => { await writeFile(nativePath, input.data); ref = await save(input); return ref; };
  ctx.attachments.fileHostPath = value => { assert.equal(value, ref); return nativePath; };
  ctx.fs.processPathFromHostPath = hostPath => { assert.equal(hostPath, nativePath); return hostPath; };
  const value = await call('library_open', openArgs(item));
  // PTC's generic-file route exposes only value; serializing it models printing/returning from run_code.
  const ptcValue = JSON.parse(JSON.stringify(value));
  assert.equal(await readFile(ptcValue.readPath, 'utf8'), 'PrivateOriginalBody backup recovery');
  assert.equal(tools.get('library_open').output.render({}, value).some(block => block.type === 'image'), false);
  assert.match(tools.get('library_open').output.render({}, value)[0].text, /readPath/);
  assert.match(tools.get('library_open').description, /PTC\/run_code/);
}));

test('missing or throwing attachment providers and execution mappings return null without exposing original or host paths', () => fixture(async ({ prepare, step, call, ctx, tools }) => {
  const item = await prepare(); await step();
  const provider = ctx.attachments.fileHostPath;
  const fs = ctx.fs;
  const variants = [
    () => { delete ctx.attachments.fileHostPath; },
    () => { ctx.attachments.fileHostPath = () => undefined; },
    () => { ctx.attachments.fileHostPath = () => { throw new Error('secret-library-originals-path'); }; },
    () => { ctx.attachments.fileHostPath = () => '/private-host-attachment-object'; delete ctx.fs; },
    () => { ctx.attachments.fileHostPath = () => '/private-host-attachment-object'; ctx.fs = { processPathFromHostPath: () => undefined }; },
    () => { ctx.attachments.fileHostPath = () => '/private-host-attachment-object'; ctx.fs = { processPathFromHostPath: () => { throw new Error('secret-execution-mapping'); } }; },
  ];
  for (const variant of variants) {
    ctx.attachments.fileHostPath = provider; ctx.fs = fs; variant();
    const value = await call('library_open', openArgs(item));
    assert.equal(value.readPath, null); assert.match(value.readNotice, /不能用文件工具读取/);
    const exposed = JSON.stringify({ value, content: tools.get('library_open').output.render({}, value) });
    assert.doesNotMatch(exposed, /secret-library|secret-execution|private-host|originals/);
  }
}));

test('readPath follows the current execution world and never replays a different world mapping', () => fixture(async ({ prepare, step, call, ctx }) => {
  const item = await prepare(); await step();
  for (const world of ['world-A', 'world-B']) {
    ctx.fs = { processPathFromHostPath: hostPath => `/${world}${hostPath}` };
    const value = await call('library_open', openArgs(item));
    assert.ok(value.readPath.startsWith(`/${world}/native-attachment-store/`));
    assert.equal(value.readPath.includes(world === 'world-A' ? 'world-B' : 'world-A'), false);
  }
  ctx.fs = { processPathFromHostPath: () => undefined };
  assert.equal((await call('library_open', openArgs(item))).readPath, null);
}));

test('full value is reauthorized after read-path mapping before it can escape', () => fixture(async ({ prepare, step, call, ctx }) => {
  const item = await prepare(); await step();
  const original = LibraryStore.prototype.originalForSession;
  let source;
  LibraryStore.prototype.originalForSession = async function (...args) { source = this.file(this.library(item.library.id), item.file.id); return original.apply(this, args); };
  ctx.fs.processPathFromHostPath = hostPath => { source.status = 'excluded'; return hostPath; };
  try { await assert.rejects(call('library_open', openArgs(item)), errorCode('FILE_NOT_AVAILABLE')); }
  finally { LibraryStore.prototype.originalForSession = original; }
}));

test('stop and aborted pre-step do not initialize a usable turn', () => fixture(async ({ prepare, step, call }) => {
  const item = await prepare();
  const stop = { kind: 'stop' }; assert.equal(await step({ decision: stop }), stop);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(step({ signal: controller.signal }), error => error.name === 'AbortError');
  await assert.rejects(call('library_open', openArgs(item)), errorCode('NO_TURN'));
}));
