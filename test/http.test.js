import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetchHandler, dispatch, API_PATH, BACKEND_VERSION } from '../src/http.js';
import { LibraryError } from '../src/store.js';

const URL = `https://dsh.example.test${API_PATH}`;
const headers = { 'Content-Type': 'application/json', 'X-DSH-Library': '1' };
const request = (body = '{"action":"snapshot"}', options = {}) => new Request(URL, { method: 'POST', headers, body, ...options });
function setup(admission = { peer: { id: 'browser' } }, store = { snapshot: async () => ({ safe: true }) }) {
  let admissions = 0;
  const connection = { browserPeer: { id: 'browser' }, admit(input) { admissions++; assert.ok(input.headers instanceof Headers); return admission; } };
  return { handler: createFetchHandler(store, connection), admissions: () => admissions };
}
async function result(handler, input) {
  const response = await handler(input);
  return { response, json: await response.json() };
}

const binaryHeaders = { 'Content-Type': 'application/octet-stream', 'X-DSH-Library': '1', 'X-DSH-Library-Action': 'import', 'X-DSH-Library-Id': 'lib-1', 'X-DSH-Library-Name': encodeURIComponent('资料.txt'), 'X-DSH-Library-Source-Path': encodeURIComponent('文件夹/资料.txt') };

test('binary upload shares browser authentication and imports raw bytes without CORS', async () => {
  let calls = 0;
  const store = { maxFileBytes: () => 1024, importBytes(input) { calls++; assert.equal(input.libraryId, 'lib-1'); assert.equal(input.name, '资料.txt'); assert.equal(input.sourcePath, '文件夹/资料.txt'); assert.deepEqual(input.bytes, Buffer.from('backup')); return { id: 'file' }; } };
  for (const [admission, status] of [[{ rejection: 401 }, 401], [{ peer: { id: 'api' } }, 403], [{ peer: { id: 'browser' } }, 200]]) {
    const { handler } = setup(admission, store);
    const { response, json } = await result(handler, request('backup', { headers: binaryHeaders }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    if (status === 200) assert.deepEqual(json.value, { id: 'file' });
  }
  assert.equal(calls, 1);
});

test('original download is browser-only attachment with untrusted bytes never rendered inline', async () => {
  let calls = 0;
  const store = { maxFileBytes: () => 1024, original(input) { calls++; assert.equal(input.fileId, 'file-1'); return { name: "报告'(.html", bytes: Buffer.from('<script>untrusted</script>') }; } };
  for (const [admission, status] of [[{ rejection: 401 }, 401], [{ peer: { id: 'api' } }, 403], [{ peer: { id: 'browser' } }, 200]]) {
    const { handler } = setup(admission, store);
    const response = await handler(request(JSON.stringify({ action: 'download', libraryId: 'lib-1', fileId: 'file-1' })));
    assert.equal(response.status, status);
    if (status === 200) {
      assert.equal(response.headers.get('Content-Type'), 'application/octet-stream');
      assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
      assert.match(response.headers.get('Content-Disposition'), /%27%28/);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
      assert.equal(await response.text(), '<script>untrusted</script>');
    }
  }
  assert.equal(calls, 1);
  await assert.rejects(dispatch(store, { action: 'download', fileId: 'file-1' }), /未知/);
});

test('snapshot capability describes the running route and store rather than trusting a stale store flag', async () => {
  for (const ready of [true, false]) {
    const store = { snapshot: async () => ({ libraries: [], capabilities: { onDemandOriginals: true, trashAll: !ready } }), ...(ready ? { trashAll() { throw new Error('snapshot must not recycle'); } } : {}) };
    const { handler } = setup(undefined, store);
    const { response, json } = await result(handler, request());
    assert.equal(response.status, 200);
    assert.equal(json.value.backendVersion, BACKEND_VERSION);
    assert.equal(json.value.capabilities.trashAll, ready);
    assert.equal(json.value.capabilities.deleteLibrary, false);
    assert.equal(json.value.capabilities.onDemandOriginals, true);
    assert.deepEqual(json.value.libraries, []);
    const blocked = setup({ peer: { id: 'api' } }, store);
    assert.equal((await blocked.handler(request())).status, 403);
  }
});

test('new handler with an old store rejects bulk recycle explicitly without mutation', async () => {
  let calls = 0;
  const { handler } = setup(undefined, { snapshot() { calls++; return {}; }, fileAction() { calls++; } });
  const { response, json } = await result(handler, request(JSON.stringify({ action: 'trashAll', libraryId: 'lib-1', confirmation: '项目资料库' })));
  assert.equal(response.status, 400);
  assert.equal(json.error.code, 'BACKEND_UPDATE_REQUIRED');
  assert.match(json.error.message, /完整退出 DSH/);
  assert.equal(calls, 0);
});

test('trashAll is browser-only and forwards the exact full-library confirmation', async () => {
  const input = { action: 'trashAll', libraryId: 'library-1', confirmation: '测试项目 资料库' };
  const outcome = { libraryId: 'library-1', moved: 4, alreadyTrashed: 2, total: 6 };
  let calls = 0;
  const store = { trashAll(payload) { calls++; assert.deepEqual(payload, input); return outcome; } };
  for (const [admission, status] of [[{ rejection: 401 }, 401], [{ peer: { id: 'model-api' } }, 403], [{ peer: { id: 'browser' } }, 200]]) {
    const { handler } = setup(admission, store);
    const output = await result(handler, request(JSON.stringify(input)));
    assert.equal(output.response.status, status);
    if (status === 200) assert.deepEqual(output.json.value, outcome);
  }
  assert.equal(calls, 1);
});

test('trashAll rejected confirmation and inactive library remain explicit client errors', async () => {
  for (const errorCode of ['CONFIRMATION_REQUIRED', 'LIBRARY_NOT_FOUND']) {
    const { handler } = setup(undefined, { trashAll() { throw new LibraryError(errorCode, '拒绝批量回收'); } });
    const output = await result(handler, request(JSON.stringify({ action: 'trashAll', libraryId: 'library-1', confirmation: 'wrong' })));
    assert.equal(output.response.status, 400); assert.equal(output.json.error.code, errorCode);
  }
});

test('deleteLibrary is browser-only, forwards the exact confirmation, and needs a loaded backend method', async () => {
  const input = { action: 'deleteLibrary', libraryId: 'library-1', confirmation: '停用项目' };
  const outcome = { libraryId: 'library-1', name: '停用项目', requested: 2, deletedFiles: 2, complete: true, failed: [] };
  let calls = 0;
  const store = { deleteLibrary(payload) { calls++; assert.deepEqual(payload, input); return outcome; } };
  for (const [admission, status] of [[{ rejection: 401 }, 401], [{ peer: { id: 'model-api' } }, 403], [{ peer: { id: 'browser' } }, 200]]) {
    const { handler } = setup(admission, store);
    const output = await result(handler, request(JSON.stringify(input)));
    assert.equal(output.response.status, status);
    if (status === 200) assert.deepEqual(output.json.value, outcome);
  }
  assert.equal(calls, 1);
  const stale = setup(undefined, { snapshot: async () => ({ libraries: [] }) });
  const blocked = await result(stale.handler, request(JSON.stringify(input)));
  assert.equal(blocked.response.status, 400);
  assert.equal(blocked.json.error.code, 'BACKEND_UPDATE_REQUIRED');
});

test('permanent purge actions retain browser-only admission and exact JSON confirmation payloads', async () => {
  for (const action of ['purgeFile', 'emptyTrash']) {
    let calls = 0;
    const input = { action, libraryId: 'library-1', confirmation: action === 'purgeFile' ? '报告.pdf' : '项目资料库', ...(action === 'purgeFile' ? { fileId: 'file-1' } : {}) };
    const outcome = { libraryId: 'library-1', requested: 1, deleted: 0, remaining: 1, complete: false, failed: [{ fileId: 'file-1', stage: 'delete', code: 'EBUSY', message: 'retry' }], warnings: [] };
    const store = { [action](payload) { calls++; assert.deepEqual(payload, input); return outcome; } };
    for (const [admission, expected] of [[{ rejection: 401 }, 401], [{ peer: { id: 'model-api' } }, 403], [{ peer: { id: 'browser' } }, 200]]) {
      const { handler } = setup(admission, store);
      const { response, json } = await result(handler, request(JSON.stringify(input)));
      assert.equal(response.status, expected);
      if (expected === 200) assert.deepEqual(json.value, outcome);
    }
    assert.equal(calls, 1);
  }
});

test('purge confirmation/state errors stay explicit client errors without invoking other actions', async () => {
  for (const errorCode of ['CONFIRMATION_REQUIRED', 'INVALID_STATE', 'UNSAFE_EXTENSION', 'UNSAFE_PATH', 'PURGE_PENDING']) {
    const { handler } = setup(undefined, { purgeFile() { throw new LibraryError(errorCode, '拒绝删除'); } });
    const { response, json } = await result(handler, request(JSON.stringify({ action: 'purgeFile', libraryId: 'library-1', fileId: 'file-1', confirmation: 'wrong' })));
    assert.equal(response.status, 400); assert.equal(json.error.code, errorCode);
  }
});

test('binary actual stream limit cancels early with missing or dishonest declared lengths', async () => {
  for (const declared of [undefined, '1']) {
    let emitted = 0, cancelled = false, imported = false;
    const store = { maxFileBytes: () => 1024, importBytes() { imported = true; } };
    const { handler } = setup(undefined, store);
    const body = new ReadableStream({ pull(c) { emitted++; c.enqueue(new Uint8Array(512)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const h = { ...binaryHeaders }; if (declared) h['Content-Length'] = declared;
    const { response, json } = await result(handler, { method: 'POST', headers: new Headers(h), body });
    assert.equal(response.status, 413); assert.equal(json.error.code, 'REQUEST_TOO_LARGE');
    assert.equal(emitted, 3); assert.equal(cancelled, true); assert.equal(imported, false);
  }
});

test('binary declared limit and changed active limits reject without importing', async () => {
  let current = 1024, imported = false;
  const { handler } = setup(undefined, { maxFileBytes: () => current, importBytes() { imported = true; } });
  let touched = false;
  assert.equal((await handler({ method: 'POST', headers: new Headers({ ...binaryHeaders, 'Content-Length': '1025' }), get body() { touched = true; throw new Error('must not read'); } })).status, 413);
  assert.equal(touched, false);
  let cancelled = false, emitted = 0;
  const body = new ReadableStream({ pull(c) { emitted++; current = 256; c.enqueue(new Uint8Array(512)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  assert.equal((await handler({ method: 'POST', headers: new Headers(binaryHeaders), body })).status, 413);
  assert.equal(emitted, 1); assert.equal(cancelled, true); assert.equal(imported, false);
});

test('binary headers reject lengths, decode errors and unsafe paths before body consumption', async () => {
  const { handler } = setup(undefined, { maxFileBytes: () => 1024 });
  const bad = [
    ['X-DSH-Library-Action', 'snapshot'], ['X-DSH-Library-Id', 'x'.repeat(161)],
    ['X-DSH-Library-Name', '%ZZ'], ['X-DSH-Library-Name', 'x'.repeat(2161)], ['X-DSH-Library-Name', encodeURIComponent('../a.txt')],
    ...['/资料.txt', 'C:/资料.txt', '../资料.txt', 'x//资料.txt', 'x/other.txt', 'x/\u0000资料.txt', 'x'.repeat(1025) + '/资料.txt', '%ZZ'].map(value => ['X-DSH-Library-Source-Path', value === '%ZZ' ? value : encodeURIComponent(value)]),
  ];
  for (const [key, value] of bad) {
    let consumed = false;
    const input = { method: 'POST', headers: new Headers({ ...binaryHeaders, [key]: value }), get body() { consumed = true; throw new Error('must not consume'); } };
    assert.equal((await handler(input)).status, 400, key + ':' + value);
    assert.equal(consumed, false);
  }
  for (const key of ['X-DSH-Library-Name', 'X-DSH-Library-Id', 'X-DSH-Library-Action']) {
    const h = { ...binaryHeaders }; delete h[key];
    assert.equal((await handler(request('backup', { headers: h }))).status, 400);
  }
});

test('non-upload management JSON has a smaller payload ceiling', async () => {
  const { handler } = setup();
  const { response } = await result(handler, request(JSON.stringify({ action: 'snapshot', padding: 'x'.repeat(256 * 1024) })));
  assert.equal(response.status, 413);
});

test('browser peer authenticated JSON POST succeeds with no-store, nosniff and no CORS', async () => {
  const { handler, admissions } = setup();
  const { response, json } = await result(handler, request());
  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true, value: { safe: true, backendVersion: BACKEND_VERSION, capabilities: { trashAll: false, deleteLibrary: false } } });
  assert.equal(admissions(), 1);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('admission 403 rejection short circuits before parsing or dispatch', async () => {
  let calls = 0;
  const { handler } = setup({ rejection: 403 }, { snapshot() { calls++; } });
  const { response, json } = await result(handler, request('invalid json'));
  assert.equal(response.status, 403); assert.equal(json.error.code, 'UNAUTHENTICATED'); assert.equal(calls, 0);
});

test('API/tool peers cannot use browser-only management or grant authority', async () => {
  let calls = 0;
  const { handler } = setup({ peer: { id: 'agent-api-peer' } }, { configure() { calls++; }, setScope() { calls++; } });
  for (const action of ['configure', 'setSessionScope', 'snapshot']) {
    const { response, json } = await result(handler, request(JSON.stringify({ action })));
    assert.equal(response.status, 403); assert.equal(json.error.code, 'USER_ONLY');
  }
  assert.equal(calls, 0);
});

test('GET is denied and POST requires custom header plus JSON content type', async () => {
  const { handler } = setup();
  const get = await result(handler, new Request(URL));
  assert.equal(get.response.status, 405); assert.equal(get.json.error.code, 'METHOD_NOT_ALLOWED');
  for (const badHeaders of [{ 'Content-Type': 'application/json' }, { ...headers, 'X-DSH-Library': '0' }, { 'X-DSH-Library': '1' }, { ...headers, 'Content-Type': 'text/plain' }]) {
    const { response, json } = await result(handler, request(undefined, { headers: badHeaders }));
    assert.equal(response.status, 400); assert.equal(json.error.code, 'INVALID_REQUEST');
  }
  assert.equal((await handler(request(undefined, { headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } }))).status, 200);
});

test('malformed JSON, array/null payload and unknown action never dispatch', async () => {
  const { handler } = setup();
  for (const body of ['{', '', 'null', '[]', '"snapshot"', '{"action":"constructor"}', '{"action":"__proto__"}', '{"action":"transact"}']) {
    const { response, json } = await result(handler, request(body));
    assert.equal(response.status, 400, body); assert.equal(json.ok, false);
  }
});

test('declared oversized body rejected before body consumption', async () => {
  const { handler } = setup();
  for (const value of [String(15 * 1024 * 1024 + 1), '-1', 'NaN', 'Infinity']) {
    let touched = false;
    const input = { method: 'POST', headers: new Headers({ ...headers, 'Content-Length': value }), get body() { touched = true; throw new Error('must not read body'); } };
    const { response, json } = await result(handler, input);
    assert.equal(response.status, 413); assert.equal(json.error.code, 'REQUEST_TOO_LARGE'); assert.equal(touched, false);
  }
});

test('streamed body enforces actual byte count despite missing or false Content-Length', async () => {
  for (const declared of [undefined, '1']) {
    const { handler } = setup(); let cancelled = false; let emitted = 0;
    const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); emitted++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    const input = { method: 'POST', headers: new Headers(declared ? { ...headers, 'Content-Length': declared } : headers), body };
    const { response, json } = await result(handler, input);
    assert.equal(response.status, 413); assert.equal(json.error.code, 'REQUEST_TOO_LARGE');
    assert.equal(cancelled, true); assert.equal(emitted, 16);
  }
});

test('known store failures are client errors; unexpected internal errors hide sensitive messages', async () => {
  let failure = new LibraryError('CONFIRMATION_REQUIRED', '请确认');
  const { handler } = setup(undefined, { snapshot() { throw failure; } });
  let output = await result(handler, request());
  assert.equal(output.response.status, 400); assert.equal(output.json.error.code, 'CONFIRMATION_REQUIRED');
  failure = new Error('C:\\secret\\password.txt contains sensitive data');
  output = await result(handler, request());
  assert.equal(output.response.status, 500);
  assert.equal(JSON.stringify(output.json).includes('password'), false);
  assert.equal(JSON.stringify(output.json).includes('sensitive'), false);
});

test('dispatch uses fixed whitelist and never invokes arbitrary property/method', async () => {
  let touched = 0;
  const store = new Proxy({}, { get() { touched++; throw new Error('arbitrary property invoked'); } });
  for (const action of ['constructor', '__proto__', 'toString', 'persist', 'transact', 'searchForSession', 'readForSession', 'originalForSession', 'listForSession', 'preview', 'search', 'reindex', 'destroy', 'workspaces']) {
    await assert.rejects(dispatch(store, { action }), error => error.code === 'INVALID_REQUEST');
  }
  assert.equal(touched, 0);
});

test('dispatch maps only project file management and explicit session scope actions', async () => {
  const calls = [];
  const methods = ['snapshot', 'configure', 'create', 'link', 'update', 'importFile', 'fileAction', 'trashAll', 'purgeFile', 'emptyTrash', 'scope', 'setScope'];
  const store = Object.fromEntries(methods.map(method => [method, (...args) => { calls.push({ method, args }); return method; }]));
  const actions = { snapshot: 'snapshot', configure: 'configure', create: 'create', link: 'link', unlink: 'update', rename: 'update', archive: 'update', restoreLibrary: 'update', import: 'importFile', exclude: 'fileAction', trashFile: 'fileAction', trashAll: 'trashAll', restoreFile: 'fileAction', purgeFile: 'purgeFile', emptyTrash: 'emptyTrash', sessionScope: 'scope', setSessionScope: 'setScope' };
  for (const [action, expected] of Object.entries(actions)) {
    await dispatch(store, { action, libraryId: 'authorized-browser-selection', libraryIds: ['unexpected-injection'], sessionId: 's1', query: 'backup' });
    assert.equal(calls.at(-1).method, expected);
    if (action === 'sessionScope') assert.deepEqual(calls.at(-1).args, ['s1']);
  }
});
