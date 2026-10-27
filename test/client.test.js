import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Contract/handler tests only: this deliberately does not assert browser layout,
// native dialog behavior, real React reconciliation, or visual integration.
const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const fixture = () => ({
  settings: { root: 'D:/资料', cloudConsent: false, originalConsent: false },
  workspaces: [{ id: 'w1', title: '写作', libraryId: 'l1' }, { id: 'w2', title: '空闲工作区', libraryId: null }],
  libraries: [
    { id: 'l1', name: '研究资料', workspaceId: 'w1', workspaceTitle: '写作', path: 'D:/资料/l1', archived: false, files: [
      { id: 'f1', name: '正常.md', status: 'ready', size: 1234, chunks: 2 },
      { id: 'f2', name: '失败.pdf', status: 'error', error: '无法提取扫描件文字', size: 200, chunks: 0 },
      { id: 'f3', name: '回收.txt', status: 'trash', size: 30, chunks: 1 },
      { id: 'f4', name: '排除.txt', status: 'excluded', size: 50, chunks: 1 },
    ] },
    { id: 'l2', name: '独立库', workspaceId: null, path: 'D:/资料/l2', archived: false, files: [] },
    { id: 'l3', name: '停用库', archived: true, files: [] },
  ],
  pending: [],
  backendVersion: '1.0.0',
  capabilities: { acceptsAllFiles: true, trashAll: true, deleteLibrary: true, formats: ['.txt', '.md', '.docx', '.pdf'], maxFileBytes: 10485760 },
});
// Size is independent of payload length so cap tests never allocate large buffers.
class MockFile {
  constructor(name, size = 3, contents = '测试', webkitRelativePath = '') {
    Object.assign(this, { name, size, contents, webkitRelativePath });
  }
  async arrayBuffer() {
    const bytes = Buffer.from(this.contents);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
}
const file = (name, size, contents, relativePath) => new MockFile(name, size, contents, relativePath);
const scopeFixture = { mode: 'library', libraryId: 'l1', libraryName: '研究资料', libraryIds: ['l1', 'l2'], cloudConsent: false };
const event = { preventDefault() {} };

function harness(seed = {}, replies = {}, services = {}) {
  const snapshot = fixture();
  const state = { App: { 0: snapshot, 1: false }, ...seed };
  const refs = {};
  const calls = [];
  const registrations = [];
  const downloads = [];
  const objectURLs = [];
  class BrowserURL extends URL {
    static createObjectURL(blob) { objectURLs.push(['create', blob]); return 'blob:test-download'; }
    static revokeObjectURL(url) { objectURLs.push(['revoke', url]); }
  }
  let frame;
  let plugin;
  const React = {
    Fragment: 'fragment',
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) }; },
    useState(initial) {
      const index = frame.stateIndex++;
      const values = state[frame.name] ||= {};
      if (!Object.hasOwn(values, index)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useRef(initial) { const values = refs[frame.name] ||= {}; const index = frame.refIndex++; return values[index] ||= { current: initial }; },
    useEffect() {},
    useCallback(fn) { return fn; },
  };
  const context = {
    window: { __ModuleLoader__: { load(definition) {
      assert.equal(definition.id, 'dsh-library');
      plugin = definition.factory(name => { assert.equal(name, 'react'); return React; });
    } } },
    AbortController, URL: BrowserURL, console,
    document: { baseURI: 'https://dsh.example.test/', activeElement: null,
      body: { appendChild(anchor) { anchor.appended = true; } },
      createElement(tag) { assert.equal(tag, 'a'); return { click() { assert(this.appended); downloads.push({ href: this.href, download: this.download }); if (services.clickError) throw services.clickError; }, remove() { downloads.push({ removed: true }); } }; },
    },
    File: MockFile, ArrayBuffer, Uint8Array,
    async fetch(url, options) {
      const headers = Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value]));
      let body;
      if (headers['content-type'] === 'application/octet-stream') {
        assert.equal(headers['x-dsh-library-action'], 'import');
        assert(options.body instanceof ArrayBuffer, 'binary uploads must send the ArrayBuffer returned by File.arrayBuffer()');
        body = {
          action: 'import', libraryId: headers['x-dsh-library-id'],
          name: decodeURIComponent(headers['x-dsh-library-name']),
          ...(headers['x-dsh-library-source-path'] === undefined ? {} : { sourcePath: decodeURIComponent(headers['x-dsh-library-source-path']) }),
          bytes: new Uint8Array(options.body),
        };
      } else {
        assert.equal(headers['content-type'], 'application/json');
        body = JSON.parse(options.body);
        assert.notEqual(body.action, 'import', 'imports must not use the JSON/base64 transport');
      }
      calls.push(body);
      assert.equal(url.pathname, '/api/dsh-library');
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'same-origin');
      assert.equal(headers['x-dsh-library'], '1');
      const reply = body.action in replies ? replies[body.action] : body.action === 'snapshot' ? snapshot : body.action === 'sessionScope' ? scopeFixture : null;
      const value = await (typeof reply === 'function' ? reply(body) : reply);
      if (value instanceof Error) throw value;
      if (body.action === 'download' && value && value.rawResponse) return value.rawResponse;
      if (value && value.apiError) return { ok: false, status: 400, json: async () => ({ ok: false, error: value.apiError }) };
      if (value && value.httpStatus) return { ok: false, status: value.httpStatus, json: async () => { throw new SyntaxError('HTML error page'); } };
      return { ok: true, status: 200, json: async () => ({ ok: true, value }) };
    },
  };
  vm.runInNewContext(source, context, { filename: 'client.js' });
  plugin.apply({ get(name) { return services[name]; }, slots: { inject(name, install) { install(); }, register(options, component) { registrations.push({ options, component }); } } });
  function expand(node) {
    if (node == null || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const previous = frame;
      frame = { name: node.type.name, stateIndex: 0, refIndex: 0 };
      const result = node.type({ ...node.props, children: node.children.length === 0 ? undefined : node.children.length === 1 ? node.children[0] : node.children });
      frame = previous;
      return expand(result);
    }
    return { ...node, children: node.children.map(expand) };
  }
  const render = (slot = 'main', props = {}) => expand({ type: registrations.find(r => r.options.name === slot).component, props, children: [] });
  return { state, calls, registrations, snapshot, render, downloads, objectURLs };
}
function nodes(root) { return root && typeof root === 'object' ? [root, ...root.children.flatMap(nodes)] : []; }
function text(root) { return typeof root === 'string' || typeof root === 'number' ? String(root) : root && typeof root === 'object' ? root.children.map(text).join(' ') : ''; }
function button(root, label) { return nodes(root).find(node => node.type === 'button' && text(node) === label); }
function field(root, id) { return nodes(root).find(node => node.props.id === id); }
function dialogForm(root) { return nodes(nodes(root).find(node => node.type === 'dialog')).find(node => node.type === 'form'); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function settingsHarness(services = {}) {
  const app = harness({}, {}, services);
  app.state.App[4] = 'settings';
  return app;
}
function pickerButton(tree) { return nodes(tree).find(n => n.type === 'button' && /选择文件夹|正在选择/.test(text(n))); }
function dropZone(app) { return nodes(app.render()).find(n => n.props['aria-label'] === '文件拖放导入'); }
function dropEvent(files = [], items = []) {
  return {
    prevented: 0, stopped: 0,
    preventDefault() { this.prevented++; },
    stopPropagation() { this.stopped++; },
    dataTransfer: { files, items, types: files.length || items.length ? ['Files'] : ['text/plain'] },
  };
}
function legacyFile(value) {
  return { name: value.name, isFile: true, isDirectory: false, file: resolve => resolve(value) };
}
function legacyDirectory(name, batches) {
  const directory = { name, isDirectory: true, isFile: false, reads: 0 };
  directory.createReader = () => {
    let index = 0;
    return { readEntries(resolve) { directory.reads++; resolve(batches[index++] || []); } };
  };
  return directory;
}
function entryItem(entry) { return { kind: 'file', webkitGetAsEntry: () => entry }; }
function modernFile(value) { return { kind: 'file', name: value.name, getFile: async () => value }; }
function modernDirectory(name, children) {
  return {
    kind: 'directory', name,
    async *values() { yield* children; },
    async *entries() { for (const child of children) yield [child.name, child]; },
  };
}
function modernItem(handle) { return { kind: 'file', getAsFileSystemHandle: async () => handle }; }
function imports(app) { return app.calls.filter(call => call.action === 'import'); }
function folderInput(app) { return nodes(app.render()).find(n => n.type === 'input' && n.props.type === 'file' && ('webkitdirectory' in n.props || 'webkitDirectory' in n.props)); }
function scopeHarness(dialogState = {}) {
  return harness({ ScopeControl: { 0: scopeFixture, 1: fixture(), 2: true }, ScopeDialog: dialogState });
}

test('registers only the approved slots and uses sidebar owner size', () => {
  const app = harness();
  assert.equal(app.registrations.length, 3);
  assert.equal(app.registrations[0].options.order, 20);
  assert.equal(app.registrations[0].options.label, '资料库');
  assert.equal(app.registrations[1].options.key, 'dsh-library');
  assert.equal(app.registrations[2].options.id, 'dsh-library-scope');
  assert.equal(app.registrations[2].options.order, 80);
  const icon = app.render('sidebar.panellist', { size: 27 });
  assert.equal(icon.props.width, 27);
});

test('legacy parsing status is saved and old errors are not current failures', async () => {
  const app = harness();
  const tree = app.render();
  assert.doesNotMatch(text(tree), /无法提取扫描件文字|待解析|可检索|分段/);
  assert.doesNotMatch(text(tree), /回收.txt/);
  const row = nodes(tree).find(n => n.type === 'tr' && text(n).includes('失败.pdf'));
  assert.match(text(row), /已保存/);
  assert.equal(button(row, '排除 AI 参考').props.disabled, false);
  await button(row, '排除 AI 参考').props.onClick();
  assert.deepEqual(app.calls[0], { action: 'exclude', libraryId: 'l1', fileId: 'f2', excluded: true });
  assert.equal(app.calls.at(-1).action, 'snapshot');
});

test('trash, archived, and filter empty states are real snapshot projections', () => {
  const app = harness();
  app.state.App[11] = 'trash';
  let tree = app.render();
  assert.match(text(tree), /回收.txt/);
  assert.doesNotMatch(text(tree), /正常.md/);
  assert(button(tree, '恢复'));
  app.state.App[5] = 'archived';
  tree = app.render();
  assert(button(tree, '恢复资料库'));
  app.state.App[6] = '不会存在的查询';
  assert.match(text(app.render()), /没有符合条件的资料库/);
});

test('project file UI offers local metadata filtering, not text search or extraction actions', () => {
  const app = harness();
  app.snapshot.libraries[0].files[0].sourcePath = '项目/参考/正常.md';
  let tree = app.render();
  assert.doesNotMatch(text(tree), /检索测试|提取文本|重建索引|重试解析|可检索|分段/);
  const filter = nodes(tree).find(n => n.props['aria-label'] === '筛选文件名称');
  filter.props.onChange({ target: { value: '参考' } });
  tree = app.render();
  assert.match(text(tree), /正常.md/);
  assert.doesNotMatch(text(tree), /失败.pdf/);
  assert.equal(app.calls.length, 0);
});

test('saved filter includes stored and legacy ready/error without requiring chunks', () => {
  const app = harness();
  app.snapshot.libraries[0].files.push({ id: 'image', name: '图片.png', status: 'stored', chunks: 0, size: 30 });
  app.state.App[9] = 'stored';
  const tree = app.render();
  for (const name of ['正常.md', '失败.pdf', '图片.png']) assert(text(tree).includes(name));
  assert.doesNotMatch(text(tree), /排除.txt|回收.txt/);
});

test('settings submit handler independently enforces local-storage acknowledgement', async () => {
  const app = harness();
  app.state.App[4] = 'settings';
  app.state.Settings = { 0: 'E:/新资料', 1: true, 2: false };
  let tree = app.render();
  assert.match(text(tree), /不会移动旧资料库/);
  assert.equal(button(tree, '保存设置').props.disabled, true);
  await nodes(tree).find(n => n.type === 'form').props.onSubmit(event);
  assert.equal(app.calls.length, 0);
  app.state.Settings[2] = true;
  tree = app.render();
  await nodes(tree).find(n => n.type === 'form').props.onSubmit(event);
  assert.deepEqual(app.calls[0], { action: 'configure', root: 'E:/新资料', originalConsent: true, maxFileMiB: 50 });
});

test('settings empty path guard blocks programmatic submits too', async () => {
  const app = harness(); app.state.App[4] = 'settings'; app.state.Settings = { 0: '  ', 1: false, 2: true };
  await nodes(app.render()).find(n => n.type === 'form').props.onSubmit(event);
  assert.equal(app.calls.length, 0);
});

test('settings max-file input uses snapshot value with a 50 MiB fallback', () => {
  for (const configured of [undefined, 75]) {
    const app = settingsHarness();
    if (configured !== undefined) app.snapshot.settings.maxFileMiB = configured;
    const input = field(app.render(), 'dshlib-max-file');
    assert(input, 'the settings cap must be an accessible numeric input');
    assert.equal(input.props.type, 'number');
    assert.equal(Number(input.props.value), configured ?? 50);
    assert.equal(Number(input.props.min), 1);
    assert.equal(Number(input.props.max), 200);
    assert.equal(Number(input.props.step), 1);
  }
});

for (const value of ['', '0', '-1', '201', '1.5', 'abc', 'Infinity']) {
  test(`settings cap rejects ${JSON.stringify(value)} even on programmatic submit`, async () => {
    const app = settingsHarness();
    app.render();
    app.state.Settings[2] = true;
    field(app.render(), 'dshlib-max-file').props.onChange({ target: { value } });
    const tree = app.render();
    assert.equal(button(tree, '保存设置').props.disabled, true);
    await nodes(tree).find(n => n.type === 'form').props.onSubmit(event);
    assert.equal(app.calls.length, 0);
  });
}

for (const value of [1, 200]) {
  test(`settings cap accepts integer boundary ${value} and preserves JSON management`, async () => {
    const app = settingsHarness();
    app.render();
    app.state.Settings[2] = true;
    field(app.render(), 'dshlib-max-file').props.onChange({ target: { value: String(value) } });
    await nodes(app.render()).find(n => n.type === 'form').props.onSubmit(event);
    assert.deepEqual(app.calls[0], { action: 'configure', root: app.snapshot.settings.root, originalConsent: false, maxFileMiB: value });
  });
}

test('trash requires exact filename and explicitly preserves recoverability', async () => {
  const app = harness();
  app.state.App[12] = { kind: 'trash', library: app.snapshot.libraries[0], file: app.snapshot.libraries[0].files[0], nonce: 1 };
  let tree = app.render();
  assert.match(text(tree), /不是永久删除/);
  assert.equal(button(tree, '确认移入回收区').props.disabled, true);
  await dialogForm(tree).props.onSubmit(event);
  assert.equal(app.calls.length, 0);
  field(tree, 'dshlib-confirm').props.onChange({ target: { value: '正常.md' } });
  tree = app.render();
  await dialogForm(tree).props.onSubmit(event);
  assert.deepEqual(app.calls[0], { action: 'trashFile', libraryId: 'l1', fileId: 'f1', confirmation: '正常.md' });
});

test('batch import accepts arbitrary formats but rejects oversized files and refreshes', async () => {
  const app = harness();
  const input = nodes(app.render()).find(n => n.type === 'input' && n.props.type === 'file');
  const target = { value: 'local-files', files: [file('无效.exe', 2), file('过大.pdf', 10485761), file('新文件.md', 20, '正文')] };
  await input.props.onChange({ target });
  assert.equal(target.value, '');
  const imports = app.calls.filter(call => call.action === 'import');
  assert.equal(imports.length, 2);
  assert.equal(imports[0].name, '无效.exe');
  assert.equal(imports[1].name, '新文件.md');
  assert.deepEqual(imports[1].bytes, new Uint8Array(Buffer.from('正文')));
  assert.equal(app.calls.at(-1).action, 'snapshot');
  assert.doesNotMatch(text(app.render()), /不支持此格式/);
  assert.match(text(app.render()), /超过/);
});

test('directory picker updates the editable root and clears acknowledgement only for a changed directory', async () => {
  let selected = 'E:/新资料';
  const app = settingsHarness({ uiWorkspace: { pickDirectory: async () => selected } });
  let tree = app.render();
  app.state.Settings[2] = true;
  await pickerButton(tree).props.onClick();
  tree = app.render();
  assert.equal(app.state.Settings[0], selected);
  assert.equal(app.state.Settings[2], false);
  const root = nodes(tree).find(n => n.type === 'input' && n.props.value === selected);
  assert(root, 'the selected path must remain a normal editable input');
  app.state.Settings[2] = true;
  await pickerButton(tree).props.onClick();
  assert.equal(app.state.Settings[2], true, 'selecting the unchanged path must not revoke acknowledgement');
  root.props.onChange({ target: { value: 'F:/手工输入' } });
  assert.equal(app.state.Settings[0], 'F:/手工输入');
  assert.equal(app.state.Settings[2], false);
  assert.equal(app.calls.length, 0, 'choosing a directory is not a settings save');
});

test('cancelled directory picker preserves typed path and acknowledgement', async () => {
  const app = settingsHarness({ uiWorkspace: { pickDirectory: async () => null } });
  app.render();
  app.state.Settings[0] = 'F:/已有手输';
  app.state.Settings[2] = true;
  await pickerButton(app.render()).props.onClick();
  assert.equal(app.state.Settings[0], 'F:/已有手输');
  assert.equal(app.state.Settings[2], true);
  assert.equal(app.calls.length, 0);
});

test('picker failures are visible and do not discard the typed path', async () => {
  const app = settingsHarness({ uiWorkspace: { pickDirectory: async () => { throw new Error('目录选择失败测试'); } } });
  app.render();
  app.state.Settings[2] = true;
  await pickerButton(app.render()).props.onClick();
  assert.match(text(app.render()), /目录选择失败测试/);
  assert.equal(app.state.Settings[0], app.snapshot.settings.root);
  assert.equal(app.state.Settings[2], true);
  assert.equal(pickerButton(app.render()).props.disabled, false);
});

test('missing optional directory service is a visible recoverable error', async () => {
  const app = settingsHarness();
  await pickerButton(app.render()).props.onClick();
  assert.match(text(app.render()), /文件夹|目录/);
  assert(nodes(app.render()).some(n => n.props.role === 'alert'), 'missing service must render an error alert');
  assert.equal(app.state.Settings[0], app.snapshot.settings.root);
  assert.equal(pickerButton(app.render()).props.disabled, false);
});

test('directory picker guards duplicate stale-handler calls and disables its button until completion', async () => {
  const pending = deferred();
  let picks = 0;
  const app = settingsHarness({ uiWorkspace: { pickDirectory() { picks++; return pending.promise; } } });
  const pick = pickerButton(app.render()).props.onClick;
  const first = pick();
  try {
    const pendingTree = app.render();
    assert.equal(pickerButton(pendingTree).props.disabled, true);
    assert.equal(field(pendingTree, 'dshlib-root').props.disabled, true);
    assert.equal(button(pendingTree, '保存设置').props.disabled, true);
    await nodes(pendingTree).find(n => n.type === 'form').props.onSubmit(event);
    assert.equal(app.calls.length, 0, 'settings cannot save while the native picker is pending');
    await pick();
    assert.equal(picks, 1);
  } finally {
    pending.resolve('E:/选择完成');
    await first;
  }
  assert.equal(pickerButton(app.render()).props.disabled, false);
  assert.equal(app.state.Settings[0], 'E:/选择完成');
});

test('settings picker is disabled and guarded during an existing app operation', async () => {
  let picks = 0;
  const app = settingsHarness({ uiWorkspace: { pickDirectory: async () => { picks++; return 'E:/不应选择'; } } });
  app.state.App[2] = true;
  const pick = pickerButton(app.render());
  assert.equal(pick.props.disabled, true);
  await pick.props.onClick();
  assert.equal(picks, 0);
  assert.equal(app.state.Settings[0], app.snapshot.settings.root);
});

test('drag import uses file contents in order and prevents browser navigation', async () => {
  const app = harness();
  const zone = dropZone(app);
  assert(zone, 'the import drop target must have its accessible label');
  const drag = dropEvent([file('第一.md', 3)]);
  zone.props.onDragOver(drag);
  assert(drag.prevented > 0, 'dragover must allow a file drop instead of browser navigation');
  const drop = dropEvent([
    file('第一.md', 3, '一'),
    file('第二.txt', 3, '二'),
  ]);
  await zone.props.onDrop(drop);
  assert(drop.prevented > 0, 'dropping a file must not open it in the browser');
  assert.deepEqual(app.calls.filter(c => c.action === 'import').map(c => [c.name, c.bytes]), [
    ['第一.md', new Uint8Array(Buffer.from('一'))],
    ['第二.txt', new Uint8Array(Buffer.from('二'))],
  ]);
  assert.equal(app.calls.at(-1).action, 'snapshot');
});

test('drag import accepts arbitrary formats and shares input size validation', async () => {
  const app = harness();
  await dropZone(app).props.onDrop(dropEvent([
    file('无效.exe', 2),
    file('过大.pdf', app.snapshot.capabilities.maxFileBytes + 1),
    file('有效.md', 4, '正文'),
  ]));
  assert.deepEqual(app.calls.filter(c => c.action === 'import').map(c => c.name), ['无效.exe', '有效.md']);
  assert.doesNotMatch(text(app.render()), /不支持此格式/);
  assert.match(text(app.render()), /超过/);
});

test('drag uploads are serial and busy guards reject another drop and input change', async () => {
  const firstUpload = deferred();
  const started = deferred();
  const app = harness({}, { import: body => {
    if (body.name !== '第一.md') return null;
    started.resolve();
    return firstUpload.promise;
  } });
  const zone = dropZone(app);
  const input = nodes(app.render()).find(n => n.type === 'input' && n.props.type === 'file');
  const running = zone.props.onDrop(dropEvent([
    file('第一.md', 1), file('第二.md', 1),
  ]));
  await started.promise;
  try {
    assert.deepEqual(app.calls.filter(c => c.action === 'import').map(c => c.name), ['第一.md']);
    assert.equal(nodes(app.render()).find(n => n.type === 'input' && n.props.type === 'file').props.disabled, true);
    const extra = dropEvent([file('重复.md', 1)]);
    await zone.props.onDrop(extra);
    assert(extra.prevented > 0);
    await input.props.onChange({ target: { value: 'extra', files: [file('重复.txt', 1)] } });
    assert.deepEqual(app.calls.filter(c => c.action === 'import').map(c => c.name), ['第一.md']);
  } finally {
    firstUpload.resolve(null);
    await running;
  }
  assert.deepEqual(app.calls.filter(c => c.action === 'import').map(c => c.name), ['第一.md', '第二.md']);
});

for (const blocked of ['archived', 'unconfigured']) {
  test(`${blocked} libraries block both file drop and file-input handlers`, async () => {
    const app = harness();
    if (blocked === 'archived') app.snapshot.libraries[0].archived = true;
    else app.snapshot.settings.root = '';
    const zone = dropZone(app);
    const input = nodes(app.render()).find(n => n.type === 'input' && n.props.type === 'file');
    assert.equal(input.props.disabled, true);
    const drop = dropEvent([file('阻止.md', 1)]);
    await zone.props.onDrop(drop);
    assert(drop.prevented > 0);
    await input.props.onChange({ target: { value: 'blocked', files: [file('阻止.txt', 1)] } });
    assert.equal(app.calls.length, 0);
  });
}

for (const mixed of [false, true]) {
  test(`${mixed ? 'mixed file/directory' : 'directory-only'} drops collect every legacy batch and nested path before confirmation`, async () => {
    const app = harness();
    const nested = legacyDirectory('子目录', [[legacyFile(file('同名.md', 2, '子'))], []]);
    const root = legacyDirectory('资料 目录', [
      [legacyFile(file('同名.md', 2, '根'))],
      [nested, legacyFile(file('不支持.exe', 2))], [],
    ]);
    const items = [entryItem(root), ...(mixed ? [entryItem(legacyFile(file('普通.md', 1, '外')))] : [])];
    const drop = dropEvent(mixed ? [file('普通.md', 1, '外')] : [], items);
    await dropZone(app).props.onDrop(drop);
    assert(drop.prevented > 0);
    assert.equal(root.reads, 3, 'readEntries must continue through multiple nonempty batches to the empty batch');
    assert.equal(nested.reads, 2);
    assert.equal(app.calls.length, 0, 'collection and preview must not upload or refresh');
    const preview = text(app.render());
    assert.match(preview, /资料 目录\/同名.md/);
    assert.match(preview, /资料 目录\/子目录\/同名.md/);
    assert.match(preview, /不支持.exe/);
    assert.doesNotMatch(preview, /不支持的格式/);
    await button(app.render(), '确认导入').props.onClick();
    assert.deepEqual(imports(app).map(c => [c.libraryId, c.name, c.sourcePath, Buffer.from(c.bytes).toString()]), [
      ['l1', '同名.md', '资料 目录/同名.md', '根'],
      ['l1', '同名.md', '资料 目录/子目录/同名.md', '子'],
      ['l1', '不支持.exe', '资料 目录/不支持.exe', '测试'],
      ...(mixed ? [['l1', '普通.md', '普通.md', '外']] : []),
    ]);
    assert.equal(app.calls.at(-1).action, 'snapshot');
  });
}

test('folder picker preserves webkitRelativePath and accepts arbitrary formats and reports empty, oversized, and ignored files', async () => {
  const app = harness();
  const input = folderInput(app);
  assert(input, 'folder selection must use a webkitdirectory file input');
  const target = { value: 'folder', files: [
    file('同名.md', 2, '甲', '资料/甲/同名.md'),
    file('同名.md', 2, '乙', '资料/乙/同名.md'),
    file('工具.exe', 2, '', '资料/工具.exe'),
    file('空.txt', 0, '', '资料/空.txt'),
    file('过大.pdf', app.snapshot.capabilities.maxFileBytes + 1, '', '资料/过大.pdf'),
    file('依赖.md', 2, '', '资料/node_modules/依赖.md'),
  ] };
  await input.props.onChange({ target });
  assert.equal(target.value, '');
  assert.equal(app.calls.length, 0);
  const preview = text(app.render());
  assert.doesNotMatch(preview, /不支持的格式/);
  assert.match(preview, /空文件/);
  assert.match(preview, /超过单文件/);
  assert.match(preview, /已跳过开发依赖或版本管理目录/);
  await button(app.render(), '确认导入').props.onClick();
  assert.deepEqual(imports(app).map(c => c.sourcePath), ['资料/甲/同名.md', '资料/乙/同名.md', '资料/工具.exe']);
});

test('over-deep directory subtrees are skipped with a visible report while shallow files remain importable', async () => {
  const app = harness();
  let deep = legacyFile(file('过深.md', 1));
  for (let i = 34; i >= 0; i--) deep = legacyDirectory(`层${i}`, [[deep], []]);
  const root = legacyDirectory('根目录', [[legacyFile(file('正常.md', 1, '正文')), deep], []]);
  await dropZone(app).props.onDrop(dropEvent([], [entryItem(root)]));
  assert.equal(app.calls.length, 0);
  assert.match(text(app.render()), /目录层级过深/);
  await button(app.render(), '确认导入').props.onClick();
  assert.deepEqual(imports(app).map(c => c.sourcePath), ['根目录/正常.md']);
});

test('modern FileSystemHandle fallback recursively previews before binary upload', async () => {
  const app = harness();
  const root = modernDirectory('现代目录', [modernFile(file('根.md', 2, '根')), modernDirectory('嵌套', [modernFile(file('内.txt', 2, '内'))])]);
  await dropZone(app).props.onDrop(dropEvent([], [modernItem(root)]));
  assert.equal(app.calls.length, 0);
  assert.match(text(app.render()), /现代目录\/嵌套\/内.txt/);
  await button(app.render(), '确认导入').props.onClick();
  assert.deepEqual(imports(app).map(c => c.sourcePath), ['现代目录/根.md', '现代目录/嵌套/内.txt']);
});

test('cancelling the preview uploads nothing and permits another folder selection', async () => {
  const app = harness();
  const choose = () => folderInput(app).props.onChange({ target: { value: 'folder', files: [file('取消.md', 2, '正文', '资料/取消.md')] } });
  await choose();
  await button(app.render(), '取消导入').props.onClick();
  assert.equal(app.calls.length, 0);
  assert.equal(button(app.render(), '确认导入'), undefined);
  assert.equal(folderInput(app).props.disabled, false);
  await choose();
  assert(button(app.render(), '确认导入'));
});

test('folder preview is a labelled modal with a scroll body and persistent action footer', async () => {
  const app = harness();
  await folderInput(app).props.onChange({ target: { value: 'folder', files: [file('确认.txt', 2, '正文', '资料/确认.txt')] } });
  const tree = app.render();
  const dialog = nodes(tree).find(n => n.type === 'dialog');
  assert(dialog);
  assert.match(dialog.props.className, /lib-import-dialog/);
  assert.equal(dialog.props['aria-labelledby'], 'dshlib-import-title');
  assert.equal(dialog.props['aria-describedby'], 'dshlib-import-summary');
  assert.match(text(field(dialog, 'dshlib-import-title')), /研究资料/);
  assert.match(text(field(dialog, 'dshlib-import-summary')), /将导入 1 个文件/);
  const body = nodes(dialog).find(n => n.props.className === 'lib-modal-body lib-form');
  assert.match(text(body), /资料\/确认.txt/);
  const footer = nodes(dialog).find(n => n.props.className === 'lib-modal-foot');
  assert(button(footer, '确认导入'));
  assert.equal(button(footer, '取消导入').props.autoFocus, true);
  assert.equal(app.calls.length, 0);
  let prevented = false;
  dialog.props.onCancel({ preventDefault() { prevented = true; } });
  assert(prevented);
  assert.equal(nodes(app.render()).some(n => n.type === 'dialog'), false);
  assert.equal(imports(app).length, 0);
  assert.equal(folderInput(app).props.disabled, false);
});

test('preview close button discards the queue without uploading', async () => {
  const app = harness();
  await folderInput(app).props.onChange({ target: { value: 'folder', files: [file('关闭.txt', 2)] } });
  const close = nodes(app.render()).find(n => n.props['aria-label'] === '关闭导入确认');
  close.props.onClick();
  assert.equal(nodes(app.render()).some(n => n.type === 'dialog'), false);
  assert.equal(app.calls.length, 0);
});

test('preview disables confirmation for an empty queue and shows skip reasons', async () => {
  const app = harness();
  await folderInput(app).props.onChange({ target: { value: 'folder', files: [file('空.txt', 0)] } });
  const tree = app.render();
  assert.match(text(tree), /没有可导入的文件/);
  assert.match(text(tree), /空文件/);
  assert.equal(button(tree, '确认导入').props.disabled, true);
  await button(tree, '确认导入').props.onClick();
  assert.equal(app.calls.length, 0);
});

test('cancelling asynchronous directory scanning discards its queue without uploading', async () => {
  const app = harness();
  const entered = deferred();
  let deliver;
  const root = { name: '慢目录', isDirectory: true, createReader: () => ({ readEntries(resolve) { deliver = resolve; entered.resolve(); } }) };
  const scanning = dropZone(app).props.onDrop(dropEvent([], [entryItem(root)]));
  await entered.promise;
  assert.equal(folderInput(app).props.disabled, true);
  await button(app.render(), '取消扫描').props.onClick();
  deliver([legacyFile(file('不应上传.md', 2))]);
  await scanning;
  assert.equal(app.calls.length, 0);
  assert.equal(button(app.render(), '确认导入'), undefined);
  assert.match(text(app.render()), /已取消扫描/);
  assert.equal(folderInput(app).props.disabled, false);
});

for (const blocked of ['archived', 'unconfigured', 'busy']) {
  test(`folder collection is guarded for ${blocked} state including direct handlers`, async () => {
    const app = harness();
    if (blocked === 'archived') app.snapshot.libraries[0].archived = true;
    if (blocked === 'unconfigured') app.snapshot.settings.root = '';
    if (blocked === 'busy') app.state.App[2] = true;
    const root = legacyDirectory('不可读目录', [[legacyFile(file('阻止.md', 2))], []]);
    const input = folderInput(app);
    assert.equal(input.props.disabled, true);
    await input.props.onChange({ target: { value: 'folder', files: [file('阻止.md', 2, '', '目录/阻止.md')] } });
    await dropZone(app).props.onDrop(dropEvent([], [entryItem(root)]));
    assert.equal(root.reads, 0);
    assert.equal(app.calls.length, 0);
    assert.equal(button(app.render(), '确认导入'), undefined);
  });
}

for (const blocked of ['archived', 'unconfigured', 'busy', 'changed-library']) {
  test(`confirming a prepared folder rechecks ${blocked} protection`, async () => {
    const app = harness();
    await folderInput(app).props.onChange({ target: { value: 'folder', files: [file('保护.md', 2, '正文', '目录/保护.md')] } });
    if (blocked === 'archived') app.snapshot.libraries[0].archived = true;
    if (blocked === 'unconfigured') app.snapshot.settings.root = '';
    if (blocked === 'busy') app.state.App[2] = true;
    if (blocked === 'changed-library') {
      const other = nodes(app.render()).find(n => n.type === 'button' && 'aria-pressed' in n.props && text(n).includes('独立库'));
      await other.props.onClick();
    }
    await button(app.render(), '确认导入').props.onClick();
    assert.equal(app.calls.length, 0, 'invalid confirmation must never reach fetch');
  });
}

for (const limit of ['files', 'bytes', 'entries']) {
  test(`folder ${limit} budget failure discards the whole batch with no partial upload`, async () => {
    const app = harness();
    app.snapshot.capabilities.maxFileBytes = 200 * 1024 ** 2;
    let selection;
    if (limit === 'files') selection = Array.from({ length: 2001 }, (_, i) => file(`${i}.md`, 1, 'x', `目录/${i}.md`));
    if (limit === 'bytes') selection = Array.from({ length: 26 }, (_, i) => file(`${i}.pdf`, 200 * 1024 ** 2, 'x', `目录/${i}.pdf`));
    if (limit === 'entries') selection = [entryItem(legacyDirectory('大量条目', [Array.from({ length: 10001 }, () => legacyDirectory('.git', [])), []]))];
    if (limit === 'entries') await dropZone(app).props.onDrop(dropEvent([], selection));
    else await folderInput(app).props.onChange({ target: { value: 'folder', files: selection } });
    assert.equal(app.calls.length, 0);
    assert.equal(button(app.render(), '确认导入'), undefined);
    assert.match(text(app.render()), /上限|条目过多/);
    assert.match(text(app.render()), /未开始上传/);
    assert.equal(folderInput(app).props.disabled, false);
  });
}

test('files above the former 10 MiB cap upload when the configured capability allows them without allocating their mock size', async () => {
  const app = harness();
  app.snapshot.settings.maxFileMiB = 50;
  app.snapshot.capabilities.maxFileBytes = 50 * 1024 ** 2;
  await dropZone(app).props.onDrop(dropEvent([file('大文件.pdf', 11 * 1024 ** 2, '小内容')]));
  assert.equal(imports(app).length, 1);
  assert.deepEqual(imports(app)[0].bytes, new Uint8Array(Buffer.from('小内容')));
});

test('stopping serial folder import preserves the completed current file and never starts later files', async () => {
  const started = deferred(), first = deferred();
  const app = harness({}, { import: () => { started.resolve(); return first.promise; } });
  await folderInput(app).props.onChange({ target: { value: 'folder', files: [
    file('第一.md', 1, '一', '目录/第一.md'), file('第二.md', 1, '二', '目录/第二.md'),
  ] } });
  const running = button(app.render(), '确认导入').props.onClick();
  await started.promise;
  try {
    assert.deepEqual(imports(app).map(c => c.name), ['第一.md']);
    await button(app.render(), '停止后续导入').props.onClick();
    assert.match(text(app.render()), /将在当前文件处理结束后停止/);
  } finally { first.resolve(null); await running; }
  assert.deepEqual(imports(app).map(c => c.name), ['第一.md']);
  assert.equal(app.calls.at(-1).action, 'snapshot');
  assert.match(text(app.render()), /已停止后续导入/);
  assert.match(text(app.render()), /已导入文件保留/);
});

test('text-only drags and drops are ignored without importing URL text as a file', async () => {
  const app = harness();
  const drop = dropEvent();
  drop.dataTransfer.getData = () => { assert.fail('text drag data must not be read'); };
  dropZone(app).props.onDragOver(drop);
  await dropZone(app).props.onDrop(drop);
  assert.equal(app.calls.length, 0);
  assert.equal(drop.prevented, 0);
  assert.equal(drop.stopped, 0);
});

for (const mode of ['library', 'general']) {
  test(`cross-library authorization cannot be bypassed in ${mode} mode`, async () => {
    const app = scopeHarness({ 0: mode, 1: ['l2'], 2: false });
    let tree = app.render('conversation.input.left', { sessionId: 's1' });
    assert.equal(button(tree, '确认本会话范围').props.disabled, true);
    assert(field(tree, 'dshlib-scope-ack'));
    await dialogForm(tree).props.onSubmit(event);
    assert.equal(app.calls.length, 0);
    field(tree, 'dshlib-scope-ack').props.onChange({ target: { checked: true } });
    tree = app.render('conversation.input.left', { sessionId: 's1' });
    await dialogForm(tree).props.onSubmit(event);
    assert.deepEqual(app.calls[0], { action: 'setSessionScope', sessionId: 's1', mode, libraryIds: ['l1', 'l2'] });
    assert.equal(app.calls[1].action, 'sessionScope');
  });
}

test('HTTP 503 produces actionable feedback and stops remaining batch imports', async () => {
  const app = harness({}, { import: { httpStatus: 503 } });
  const input = nodes(app.render()).find(node => node.type === 'input' && node.props.type === 'file');
  await input.props.onChange({ target: { value: 'selected', files: [file('one.txt', 4, 'one'), file('two.txt', 4, 'two')] } });
  assert.equal(app.calls.filter(call => call.action === 'import').length, 1);
  assert.match(text(app.render()), /后端暂时不可用/);
  assert.match(text(app.render()), /已停止后续导入/);
  assert.doesNotMatch(text(app.render()), /无法识别的响应/);
});

test('network loss stops remaining batch imports without a retry storm', async () => {
  const app = harness({}, { import: new TypeError('Failed to fetch') });
  const input = nodes(app.render()).find(node => node.type === 'input' && node.props.type === 'file');
  await input.props.onChange({ target: { value: 'selected', files: [file('one.txt', 4, 'one'), file('two.txt', 4, 'two')] } });
  assert.equal(app.calls.filter(call => call.action === 'import').length, 1);
  assert.match(text(app.render()), /无法连接资料库后端/);
  assert.match(text(app.render()), /避免重复提交/);
});

test('file inputs accept every format and explain on-demand host capabilities', () => {
  const app = harness();
  const tree = app.render();
  for (const input of nodes(tree).filter(n => n.type === 'input' && n.props.type === 'file')) assert.equal(Object.hasOwn(input.props, 'accept'), false);
  assert.match(text(tree), /任意格式文件均可保存/);
  assert.doesNotMatch(text(tree), /可自动提取|可检索/);
  assert.match(text(tree), /PDF、Word、表格、图片可由宿主工具按需读取/);
  assert.match(text(tree), /音视频暂无专门理解能力/);
});

for (const status of ['stored', 'ready', 'error', 'excluded']) {
  test(`${status} originals support reference exclusion independently of parsing`, async () => {
    const app = harness();
    app.snapshot.libraries[0].files[1].status = status;
    const row = nodes(app.render()).find(n => n.type === 'tr' && text(n).includes('失败.pdf'));
    assert.equal(button(row, '下载原文件').props.disabled, false);
    assert.equal(button(row, '提取文本'), undefined);
    assert.equal(button(row, '重试解析'), undefined);
    const label = status === 'excluded' ? '纳入 AI 参考' : '排除 AI 参考';
    assert.equal(button(row, label).props.disabled, false);
    await button(row, label).props.onClick();
    assert.deepEqual(app.calls[0], { action: 'exclude', libraryId: 'l1', fileId: 'f2', excluded: status !== 'excluded' });
  });
}

function downloadResponse(overrides = {}) {
  return { rawResponse: {
    ok: true, status: 200,
    headers: { get(name) { return name === 'Content-Type' ? 'application/octet-stream' : 'attachment; filename="original.exe"'; } },
    blob: async () => ({ binary: true }),
    ...overrides,
  } };
}

for (const status of ['ready', 'stored', 'error']) {
  test(`downloads ${status} original with authenticated POST, blob attachment and URL cleanup`, async () => {
    const app = harness({}, { download: downloadResponse() });
    const saved = app.snapshot.libraries[0].files[1];
    saved.status = status; saved.name = '原文件.exe';
    const row = nodes(app.render()).find(n => n.type === 'tr' && text(n).includes(saved.name));
    await button(row, '下载原文件').props.onClick();
    assert.deepEqual(app.calls, [{ action: 'download', libraryId: 'l1', fileId: 'f2' }]);
    assert.deepEqual(app.downloads, [{ href: 'blob:test-download', download: '原文件.exe' }, { removed: true }]);
    assert.equal(app.objectURLs[0][0], 'create');
    assert.deepEqual(app.objectURLs[1], ['revoke', 'blob:test-download']);
    assert.match(text(app.render()), /不会打开或执行文件/);
  });
}

for (const failure of ['http', 'json', 'network', 'wrong-type', 'blob', 'click']) {
  test(`download ${failure} failure is recoverable and does not leak object URLs`, async () => {
    let response = downloadResponse();
    const services = {};
    if (failure === 'http') response = downloadResponse({ ok: false, status: 404, json: async () => { throw new SyntaxError(); } });
    if (failure === 'json') response = downloadResponse({ ok: false, status: 403, json: async () => ({ error: { message: '下载权限不足' } }) });
    if (failure === 'network') response = new TypeError('offline');
    if (failure === 'wrong-type') response = downloadResponse({ headers: { get: () => 'application/json' } });
    if (failure === 'blob') response = downloadResponse({ blob: async () => { throw new Error('文件读取失败'); } });
    if (failure === 'click') services.clickError = new Error('无法下载');
    const app = harness({}, { download: response }, services);
    const row = nodes(app.render()).find(n => n.type === 'tr' && text(n).includes('失败.pdf'));
    await button(row, '下载原文件').props.onClick();
    assert(nodes(app.render()).some(n => n.props.role === 'alert'));
    assert.equal(app.state.App[2], false);
    if (failure === 'click') assert.deepEqual(app.objectURLs.at(-1), ['revoke', 'blob:test-download']);
    else assert.equal(app.objectURLs.length, 0);
  });
}

test('download stale handlers cannot start duplicate requests while busy', async () => {
  const pending = deferred();
  const app = harness({}, { download: () => pending.promise });
  const row = nodes(app.render()).find(n => n.type === 'tr' && text(n).includes('失败.pdf'));
  const click = button(row, '下载原文件').props.onClick;
  const running = click();
  try { await click(); assert.equal(app.calls.length, 1); }
  finally { pending.resolve(downloadResponse()); await running; }
});

test('import saves original files without parsing or interpreting legacy extraction outcomes', async () => {
  const outcomes = [{ status: 'stored' }, { status: 'ready', chunks: 2 }, { status: 'error', error: '旧版解析失败' }];
  const app = harness({}, { import: () => outcomes.shift() });
  await dropZone(app).props.onDrop(dropEvent(['a.pdf', 'b.png', 'c.mp4'].map(name => file(name, 1))));
  const report = text(app.render());
  assert.match(report, /3\/3 个文件已保存/);
  assert.doesNotMatch(report, /可检索|重试解析|旧版解析失败|自动提取/);
  assert.equal(app.calls.filter(c => ['search', 'preview', 'reindex'].includes(c.action)).length, 0);
  assert.equal(imports(app).length, 3);
});

test('scope mode wording allows model knowledge without changing session scope or privacy', () => {
  const app = scopeHarness();
  const content = text(app.render('conversation.input.left', { sessionId: 's1' }));
  assert.match(content, /按需参考授权项目文件；缺少资料时可使用模型知识正常回答/);
  assert.match(content, /不使用资料库/);
  assert.match(content, /仅作用于当前会话/);
  assert.match(content, /跨库文件使用需要在这里明确授权/);
  assert.match(content, /保存范围不会代替隐私同意/);
});

test('scope control never invents or redirects a missing session', () => {
  const app = harness();
  assert.equal(app.render('conversation.input.left'), null);
  assert.equal(app.calls.length, 0);
});


test('legacy text consent does not authorize original files and new consent needs explicit acknowledgement', async () => {
  const app = settingsHarness();
  app.snapshot.settings.cloudConsent = true;
  delete app.snapshot.settings.originalConsent;
  let tree = app.render();
  assert.equal(field(tree, 'dshlib-cloud').props.checked, false);
  assert.match(text(tree), /允许会话模型按需使用获授权库的原文件/);
  assert.match(text(tree), /模型提供方或宿主工具处理/);
  assert.match(text(tree), /不能撤回历史已使用文件/);
  field(tree, 'dshlib-cloud').props.onChange({ target: { checked: true } });
  tree = app.render();
  assert.equal(button(tree, '保存设置').props.disabled, true);
  await nodes(tree).find(n => n.type === 'form').props.onSubmit(event);
  assert.equal(app.calls.length, 0);
  field(tree, 'dshlib-ack').props.onChange({ target: { checked: true } });
  await nodes(app.render()).find(n => n.type === 'form').props.onSubmit(event);
  assert.deepEqual(app.calls[0], { action: 'configure', root: app.snapshot.settings.root, originalConsent: true, maxFileMiB: 50 });
  assert.equal(Object.hasOwn(app.calls[0], 'cloudConsent'), false);
});

test('legacy consent is shown as unauthorized in library overview until original consent is granted', () => {
  const app = harness();
  app.snapshot.settings.cloudConsent = true;
  delete app.snapshot.settings.originalConsent;
  assert.match(text(app.render()), /模型文件内容发送：未授权/);
  app.snapshot.settings.originalConsent = true;
  assert.match(text(app.render()), /模型文件内容发送：已授权/);
});

// Permanent-deletion checks are VM handler contracts, not destructive filesystem tests.
function trashHarness(seed = {}, replies = {}) {
  const app = harness(seed, replies);
  app.state.App[11] = 'trash';
  return app;
}
function trashRow(tree, name = '回收.txt') {
  return nodes(tree).find(node => node.type === 'tr' && text(node).includes(name));
}
function purgeCalls(app) { return app.calls.filter(call => ['purgeFile', 'emptyTrash'].includes(call.action)); }
// React callbacks need not return their asynchronous update promise.
// Drain mocked fetch/update/refresh work before asserting the settled UI state.
async function submitDeletion(tree) {
  await dialogForm(tree).props.onSubmit(event);
  await new Promise(resolve => setImmediate(resolve));
}
function submitButton(tree) {
  return nodes(dialogForm(tree)).find(node => node.type === 'button' && node.props.type === 'submit');
}
function confirmDeletion(app, value) {
  field(app.render(), 'dshlib-confirm').props.onChange({ target: { value } });
  return app.render();
}

test('trash rows expose permanent deletion alongside restore, without exposing deletion on live files', () => {
  const app = trashHarness();
  const row = trashRow(app.render());
  assert(button(row, '恢复'));
  assert.equal(button(row, '永久删除').props.disabled, false);
  app.state.App[11] = 'files';
  const liveTree = app.render();
  assert.equal(button(liveTree, '永久删除'), undefined);
  assert.equal(button(liveTree, '清空回收区'), undefined);
  assert.equal(purgeCalls(app).length, 0);
});

test('purge requires the exact full filename and cannot bypass confirmation through form submission', async () => {
  const app = trashHarness();
  button(trashRow(app.render()), '永久删除').props.onClick();
  assert.equal(app.state.App[12].kind, 'purge');
  const target = app.snapshot.libraries[0].files.find(file => file.id === 'f3');
  for (const confirmation of ['', '回收', '回收.txt ', ' 回收.txt', '其他.txt']) {
    const tree = confirmDeletion(app, confirmation);
    assert.equal(submitButton(tree).props.disabled, true, JSON.stringify(confirmation));
    await dialogForm(tree).props.onSubmit(event);
    assert.equal(purgeCalls(app).length, 0, 'programmatic submit must not bypass exact confirmation');
  }
  let tree = confirmDeletion(app, target.name);
  assert.equal(submitButton(tree).props.disabled, false);
  assert.match(text(tree), /不可恢复/);
  assert.match(text(tree), /本资料库内.*副本/);
  assert.match(text(tree), /不删除来源文件/);
  assert.match(text(tree), /历史会话.*附件副本.*不会.*撤回/);
  await submitDeletion(tree);
  assert.deepEqual(purgeCalls(app), [{ action: 'purgeFile', libraryId: 'l1', fileId: 'f3', confirmation: target.name }]);
  assert.equal(app.calls.at(-1).action, 'snapshot');
  assert.equal(app.state.App[12], null);
});

for (const kind of ['purge', 'emptyTrash']) {
  test(`${kind} cancellation never sends a destructive action even after exact confirmation`, async () => {
    const app = trashHarness();
    const file = app.snapshot.libraries[0].files.find(file => file.id === 'f3');
    app.state.App[12] = { kind, library: app.snapshot.libraries[0], file, nonce: 1 };
    const tree = confirmDeletion(app, kind === 'purge' ? file.name : app.snapshot.libraries[0].name);
    assert.equal(submitButton(tree).props.disabled, false);
    button(tree, '取消').props.onClick();
    assert.equal(app.state.App[12], null);
    assert.equal(purgeCalls(app).length, 0);
  });

  test(`${kind} busy form submissions never send destructive actions`, async () => {
    const app = trashHarness();
    const file = app.snapshot.libraries[0].files.find(file => file.id === 'f3');
    app.state.App[12] = { kind, library: app.snapshot.libraries[0], file, nonce: 1 };
    confirmDeletion(app, kind === 'purge' ? file.name : app.snapshot.libraries[0].name);
    app.state.App[2] = true;
    const tree = app.render();
    assert.equal(submitButton(tree).props.disabled, true);
    await dialogForm(tree).props.onSubmit(event);
    assert.equal(purgeCalls(app).length, 0);
  });

  test(`${kind} failure preserves its modal and confirmation so the user can retry`, async () => {
    let attempts = 0;
    const action = kind === 'purge' ? 'purgeFile' : 'emptyTrash';
    const message = `合成${action}失败，请重试`;
    const app = trashHarness({}, { [action]: () => ++attempts === 1 ? { apiError: { code: 'PURGE_FAILED', message } } : { removed: 1 } });
    const file = app.snapshot.libraries[0].files.find(file => file.id === 'f3');
    app.state.App[12] = { kind, library: app.snapshot.libraries[0], file, nonce: 1 };
    let tree = confirmDeletion(app, kind === 'purge' ? file.name : app.snapshot.libraries[0].name);
    await submitDeletion(tree);
    assert.equal(attempts, 1);
    assert.equal(app.state.App[12].kind, kind);
    tree = app.render();
    assert.match(text(tree), new RegExp(message));
    assert.equal(field(tree, 'dshlib-confirm').props.value, kind === 'purge' ? file.name : app.snapshot.libraries[0].name);
    assert.equal(submitButton(tree).props.disabled, false);
    await submitDeletion(tree);
    assert.equal(attempts, 2);
    assert.equal(purgeCalls(app).length, 2);
    assert.equal(app.state.App[12], null);
  });
}

for (const kind of ['purge', 'emptyTrash']) {
  test(`${kind} partial deletion refreshes metadata but keeps an error modal and offers retry without success toast`, async () => {
    const action = kind === 'purge' ? 'purgeFile' : 'emptyTrash';
    const deleted = kind === 'purge' ? 0 : 1;
    let attempts = 0;
    let refreshed;
    const app = trashHarness({}, {
      [action]: () => ++attempts === 1
        ? { complete: false, deleted, remaining: 1, failed: [{ fileId: 'f5', message: '合成文件占用' }] }
        : { complete: true, deleted: 1, remaining: 0, failed: [] },
      snapshot: () => refreshed,
    });
    const lib = app.snapshot.libraries[0];
    const target = lib.files.find(file => file.id === 'f3');
    lib.files.push({ id: 'f5', name: '仍被占用.pdf', status: 'trash', size: 10 });
    refreshed = structuredClone(app.snapshot);
    const refreshedLib = refreshed.libraries[0];
    if (kind === 'emptyTrash') refreshedLib.files = refreshedLib.files.filter(file => file.id !== target.id);
    refreshedLib.files.find(file => file.id === (kind === 'purge' ? target.id : 'f5')).purgePending = true;
    app.state.App[12] = { kind, library: lib, file: target, nonce: 1 };
    let tree = confirmDeletion(app, kind === 'purge' ? target.name : lib.name);
    await submitDeletion(tree);
    assert.equal(attempts, 1);
    assert.equal(app.calls.at(-1).action, 'snapshot');
    assert.equal(app.state.App[3].type, 'error', 'partial success must never be announced as total success');
    assert.equal(app.state.App[12].kind, kind);
    assert.equal(app.state.App[12].library, refreshedLib, 'retry modal must use refreshed library metadata');
    tree = app.render();
    assert.match(text(tree), /永久删除未全部完成/);
    assert.match(text(tree), new RegExp(`已删除 ${deleted} 个，剩余 1 个`));
    assert.match(text(tree), /合成文件占用/);
    assert.equal(nodes(tree).some(node => node.props.className === 'lib-notice success'), false);
    assert.equal(submitButton(tree).props.disabled, false);
    assert.equal(field(tree, 'dshlib-confirm').props.value, kind === 'purge' ? target.name : lib.name);
    await submitDeletion(tree);
    assert.equal(attempts, 2);
    assert.equal(app.state.App[12], null);
    assert.equal(app.state.App[3].type, 'success');
  });
}

test('completed permanent deletion closes the modal but shows backend warnings instead of a success toast', async () => {
  for (const kind of ['purge', 'emptyTrash']) {
    const action = kind === 'purge' ? 'purgeFile' : 'emptyTrash';
    const message = '合成元数据警告：请核对资料清单';
    const app = trashHarness({}, { [action]: { complete: true, deleted: 1, remaining: 0, warnings: [{ code: 'MANIFEST_WARNING', message }] } });
    const lib = app.snapshot.libraries[0];
    const file = lib.files.find(file => file.id === 'f3');
    app.state.App[12] = { kind, library: lib, file, nonce: 1 };
    const tree = confirmDeletion(app, kind === 'purge' ? file.name : lib.name);
    await submitDeletion(tree);
    assert.equal(app.calls.at(-1).action, 'snapshot');
    assert.equal(purgeCalls(app).length, 1);
    assert.equal(app.state.App[12], null, 'completed deletion must close the modal even when accompanied by warnings');
    assert.equal(app.state.App[3].type, 'warning');
    assert.match(app.state.App[3].text, new RegExp(message));
    const settled = app.render();
    assert(nodes(settled).some(node => node.props.className === 'lib-notice warning'));
    assert.equal(nodes(settled).some(node => node.props.className === 'lib-notice success'), false);
  }
});

test('purgePending trash files forbid restore but offer a retry of permanent deletion', async () => {
  const app = trashHarness();
  const file = app.snapshot.libraries[0].files.find(file => file.id === 'f3');
  file.purgePending = true;
  const row = trashRow(app.render());
  const restore = button(row, '恢复');
  assert(restore === undefined || restore.props.disabled === true, 'a partial purge must never offer usable restore');
  if (restore) await restore.props.onClick();
  assert.equal(app.calls.some(call => call.action === 'restoreFile'), false, 'a programmatic restore must also reject purgePending files');
  const retry = button(row, '重试永久删除');
  assert(retry);
  assert.equal(retry.props.disabled, false);
  retry.props.onClick();
  assert.equal(app.state.App[12].kind, 'purge');
  const tree = confirmDeletion(app, file.name);
  await submitDeletion(tree);
  assert.deepEqual(purgeCalls(app)[0], { action: 'purgeFile', libraryId: 'l1', fileId: file.id, confirmation: file.name });
  assert.equal(app.calls.some(call => call.action === 'restoreFile'), false);
});

for (const condition of ['busy', 'archived', 'empty']) {
  test(`empty-trash toolbar is disabled for ${condition}`, () => {
    const app = trashHarness();
    if (condition === 'busy') app.state.App[2] = true;
    if (condition === 'archived') app.snapshot.libraries[0].archived = true;
    if (condition === 'empty') app.snapshot.libraries[0].files = app.snapshot.libraries[0].files.filter(file => file.status !== 'trash');
    const clear = button(app.render(), '清空回收区');
    assert(clear, 'trash toolbar must retain an explicit bulk-delete entry');
    assert.equal(clear.props.disabled, true);
    assert.equal(purgeCalls(app).length, 0);
  });
}

test('empty trash targets the whole library recycle bin despite a filename filter', async () => {
  const app = trashHarness();
  const lib = app.snapshot.libraries[0];
  lib.files.push({ id: 'f5', name: '隐藏的回收文件.pdf', status: 'trash', size: 10, purgePending: true });
  let tree = app.render();
  nodes(tree).find(node => node.props['aria-label'] === '筛选文件名称').props.onChange({ target: { value: '完全没有的文件名' } });
  tree = app.render();
  assert.equal(trashRow(tree), undefined);
  const clear = button(tree, '清空回收区');
  assert.equal(clear.props.disabled, false, 'search results must not decide whether the whole recycle bin can be emptied');
  clear.props.onClick();
  assert.equal(app.state.App[12].kind, 'emptyTrash');
  tree = app.render();
  assert.match(text(tree), /整个回收区/);
  assert.match(text(tree), /2 个文件/);
  assert.match(text(tree), /不受搜索筛选影响/);
  assert.match(text(tree), /尚未移入回收区的文件不会删除/);
  assert.match(text(tree), /不可恢复/);
  assert.match(text(tree), /不删除来源文件/);
  assert.match(text(tree), /历史会话.*附件副本.*不会.*撤回/);
  for (const value of ['', '研究', '研究资料 ', '其他库']) {
    tree = confirmDeletion(app, value);
    assert.equal(submitButton(tree).props.disabled, true);
    await dialogForm(tree).props.onSubmit(event);
    assert.equal(purgeCalls(app).length, 0);
  }
  tree = confirmDeletion(app, lib.name);
  assert.equal(submitButton(tree).props.disabled, false);
  await submitDeletion(tree);
  assert.deepEqual(purgeCalls(app), [{ action: 'emptyTrash', libraryId: lib.id, confirmation: lib.name }]);
  assert.equal(Object.hasOwn(purgeCalls(app)[0], 'fileId'), false);
  assert.equal(Object.hasOwn(purgeCalls(app)[0], 'query'), false);
  assert.equal(app.calls.at(-1).action, 'snapshot');
});

for (const legacy of ['missing-capabilities', 'missing-flag', 'false', 'string']) {
  test(`bulk recycle requires an explicit true capability: ${legacy}`, async () => {
    const app = harness();
    if (legacy === 'missing-capabilities') delete app.snapshot.capabilities;
    else if (legacy === 'missing-flag') delete app.snapshot.capabilities.trashAll;
    else app.snapshot.capabilities.trashAll = legacy === 'false' ? false : 'true';
    const tree = app.render();
    const trigger = button(tree, '全部移入回收区');
    assert.equal(trigger.props.disabled, true);
    await trigger.props.onClick();
    assert.equal(app.state.App[12], null);
    assert.equal(app.calls.length, 0);
    assert.match(text(tree), /当前后端未声明批量回收能力/);
    assert.match(text(tree), /完整退出 DSH/);
    assert.match(text(tree), /后端版本：\d+\.\d+\.\d+/);
    assert.match(text(tree), /勿删除资料目录/);
    assert.equal(button(tree, '移入回收区').props.disabled, false, 'single-file management stays available');
  });
}

test('revoked backend capability blocks the open modal and a stale programmatic form submit', async () => {
  const app = harness();
  openTrashAll(app);
  const stale = confirmDeletion(app, app.snapshot.libraries[0].name);
  assert.equal(submitButton(stale).props.disabled, false);
  app.snapshot.capabilities.trashAll = false;
  await submitDeletion(stale);
  assert.equal(app.calls.length, 0, 'App must recheck capability even if an old form was enabled');
  const tree = app.render();
  assert.equal(submitButton(tree).props.disabled, true);
  assert.match(text(tree), /当前后端未声明批量回收能力/);
  await submitDeletion(tree);
  assert.equal(app.calls.length, 0);
});

test('old-handler unknown bulk action becomes an explicit mismatch without retry or per-file fallback', async () => {
  const old = fixture(); delete old.capabilities.trashAll; delete old.backendVersion;
  const app = harness({}, { trashAll: { apiError: { code: 'INVALID_REQUEST', message: '未知资料库操作。' } }, snapshot: old });
  openTrashAll(app);
  await submitDeletion(confirmDeletion(app, app.snapshot.libraries[0].name));
  assert.deepEqual(app.calls.map(call => call.action), ['trashAll', 'snapshot']);
  assert.equal(app.state.App[12].kind, 'trashAll');
  assert.match(app.state.App[3].text, /前后端版本不一致/);
  assert.match(app.state.App[3].text, /完整退出 DSH/);
  assert.match(app.state.App[3].text, /旧版\/未声明/);
  assert.match(app.state.App[3].text, /没有自动重发操作或降级/);
  const tree = app.render();
  assert.equal(button(tree, '全部移入回收区').props.disabled, true);
  assert.equal(submitButton(tree).props.disabled, true);
  assert.equal(field(tree, 'dshlib-confirm').props.value, app.snapshot.libraries[0].name);
});

for (const error of [
  { code: 'INVALID_REQUEST', message: '其他请求错误' },
  { code: 'CONFIRMATION_REQUIRED', message: '未知资料库操作。' },
  { code: 'USER_ONLY', message: '禁止访问' },
]) {
  test(`bulk mismatch mapping does not swallow unrelated ${error.code} errors`, async () => {
    const app = harness({}, { trashAll: { apiError: error } });
    openTrashAll(app);
    await submitDeletion(confirmDeletion(app, app.snapshot.libraries[0].name));
    assert.equal(app.state.App[3].text, error.message);
    assert.deepEqual(app.calls.map(call => call.action), ['trashAll']);
    assert.equal(app.state.App[12].kind, 'trashAll');
  });
}

// Bulk recycle remains a reversible management action; these are UI contracts only.
function trashAllCalls(app) { return app.calls.filter(call => call.action === 'trashAll'); }
function openTrashAll(app) {
  const trigger = button(app.render(), '全部移入回收区');
  assert(trigger, 'files toolbar must expose an explicit whole-library recycle action');
  trigger.props.onClick();
  return app.render();
}

test('files toolbar exposes bulk recycle without confusing it with permanent deletion', () => {
  const app = harness();
  const trigger = button(app.render(), '全部移入回收区');
  assert(trigger);
  assert.equal(trigger.props.disabled, false);
  app.state.App[11] = 'trash';
  assert.equal(button(app.render(), '全部移入回收区'), undefined, 'bulk recycle belongs only to the files tab');
  assert.equal(trashAllCalls(app).length, 0);
});

for (const condition of ['busy', 'archived', 'all-trash', 'empty']) {
  test(`bulk-recycle toolbar and direct click handler reject ${condition}`, async () => {
    const app = harness();
    const lib = app.snapshot.libraries[0];
    if (condition === 'busy') app.state.App[2] = true;
    if (condition === 'archived') lib.archived = true;
    if (condition === 'all-trash') lib.files.forEach(file => { file.status = 'trash'; });
    if (condition === 'empty') lib.files = [];
    const trigger = button(app.render(), '全部移入回收区');
    assert(trigger, 'the disabled bulk-recycle entry should remain understandable');
    assert.equal(trigger.props.disabled, true);
    await trigger.props.onClick();
    assert.equal(app.state.App[12], null, 'direct calls to a disabled handler must not open a confirmation modal');
    assert.equal(trashAllCalls(app).length, 0);
  });
}

test('bulk recycle requires the exact complete library name even for programmatic form submission', async () => {
  const app = harness({}, { trashAll: { libraryId: 'l1', moved: 3, alreadyTrashed: 1, total: 4 } });
  let tree = openTrashAll(app);
  const lib = app.snapshot.libraries[0];
  assert.equal(app.state.App[12].kind, 'trashAll');
  assert(nodes(tree).some(node => node.type === 'h2' && text(node) === '全部移入回收区'));
  for (const confirmation of ['', '研究', `${lib.name} `, ` ${lib.name}`, '其他资料库']) {
    tree = confirmDeletion(app, confirmation);
    assert.equal(submitButton(tree).props.disabled, true, JSON.stringify(confirmation));
    await submitDeletion(tree);
    assert.equal(trashAllCalls(app).length, 0, 'programmatic submits must not bypass exact-name confirmation');
  }
  tree = confirmDeletion(app, lib.name);
  const submit = submitButton(tree);
  assert.equal(text(submit), '确认全部移入回收区');
  assert.match(submit.props.className, /\bdanger\b/);
  assert.equal(submit.props.disabled, false);
  await submitDeletion(tree);
  assert.deepEqual(trashAllCalls(app), [{ action: 'trashAll', libraryId: lib.id, confirmation: lib.name }]);
  assert.equal(app.calls.at(-1).action, 'snapshot');
  assert.equal(app.state.App[12], null);
});

test('bulk recycle includes excluded files and the complete untrashed count despite query and status filters', async () => {
  const app = harness({}, { trashAll: { libraryId: 'l1', moved: 3, alreadyTrashed: 1, total: 4 } });
  const lib = app.snapshot.libraries[0];
  app.state.App[9] = 'excluded';
  let tree = app.render();
  const filter = nodes(tree).find(node => node.props['aria-label'] === '筛选文件名称');
  filter.props.onChange({ target: { value: '完全没有的文件名' } });
  tree = app.render();
  assert.equal(nodes(tree).some(node => node.type === 'tr' && text(node).includes('排除.txt')), false);
  const trigger = button(tree, '全部移入回收区');
  assert.equal(trigger.props.disabled, false, 'an empty filtered view must not hide available whole-library targets');
  trigger.props.onClick();
  tree = app.render();
  assert.match(text(tree), /3 个文件/, '3 non-trash files include the excluded record and do not include the existing trash');
  assert.match(text(tree), /不受.*筛选影响/);
  assert.match(text(tree), /包括.*已排除/);
  assert.match(text(tree), /可.*恢复/);
  assert.match(text(tree), /非永久删除|不是永久删除|不会永久删除/);
  assert.match(text(tree), /来源.*不.*动|不.*来源文件/);
  assert.match(text(tree), /历史会话|旧会话/);
  assert.match(text(tree), /不能.*撤回|不会.*撤回|无法.*撤回/);
  tree = confirmDeletion(app, lib.name);
  await submitDeletion(tree);
  assert.deepEqual(trashAllCalls(app)[0], { action: 'trashAll', libraryId: lib.id, confirmation: lib.name });
  assert.equal(Object.hasOwn(trashAllCalls(app)[0], 'query'), false);
  assert.equal(Object.hasOwn(trashAllCalls(app)[0], 'fileFilter'), false);
  assert.equal(Object.hasOwn(trashAllCalls(app)[0], 'fileIds'), false, 'do not encode a filtered set as the whole-library operation');
});

test('bulk recycle cancellation never sends an action after exact confirmation', async () => {
  const app = harness();
  openTrashAll(app);
  const tree = confirmDeletion(app, app.snapshot.libraries[0].name);
  assert.equal(submitButton(tree).props.disabled, false);
  button(tree, '取消').props.onClick();
  assert.equal(app.state.App[12], null);
  assert.equal(trashAllCalls(app).length, 0);
});

test('bulk recycle busy form submissions cannot bypass disabled confirmation', async () => {
  const app = harness();
  openTrashAll(app);
  confirmDeletion(app, app.snapshot.libraries[0].name);
  app.state.App[2] = true;
  const tree = app.render();
  assert.equal(submitButton(tree).props.disabled, true);
  await submitDeletion(tree);
  assert.equal(trashAllCalls(app).length, 0);
  assert.equal(app.state.App[12].kind, 'trashAll');
});

test('bulk recycle failure keeps the modal and exact confirmation for an explicit retry', async () => {
  let attempts = 0;
  const message = '合成全部回收失败，请重试';
  const app = harness({}, { trashAll: () => ++attempts === 1
    ? { apiError: { code: 'RECYCLE_FAILED', message } }
    : { libraryId: 'l1', moved: 2, alreadyTrashed: 2, total: 4 } });
  openTrashAll(app);
  const lib = app.snapshot.libraries[0];
  await submitDeletion(confirmDeletion(app, lib.name));
  assert.equal(attempts, 1);
  assert.equal(app.state.App[12].kind, 'trashAll');
  assert.equal(app.state.App[3].type, 'error');
  let tree = app.render();
  assert.match(text(tree), new RegExp(message));
  assert.equal(field(tree, 'dshlib-confirm').props.value, lib.name);
  assert.equal(submitButton(tree).props.disabled, false);
  await submitDeletion(tree);
  assert.equal(attempts, 2);
  assert.equal(trashAllCalls(app).length, 2);
  assert.equal(app.calls.at(-1).action, 'snapshot');
  assert.equal(app.state.App[12], null);
});

function openDeleteLibrary(app) {
  const lib = app.snapshot.libraries.find(item => item.id === 'l3');
  lib.archived = true;
  lib.path = 'D:/资料/l3';
  app.state.App[5] = 'archived';
  const trigger = button(app.render(), '删除资料库');
  assert(trigger, 'an archived library must expose library deletion');
  trigger.props.onClick();
  return app.render();
}
const deleteLibraryCalls = app => app.calls.filter(call => call.action === 'deleteLibrary');

test('library deletion is offered only for deactivated libraries, never for active ones', () => {
  const app = harness();
  assert.equal(button(app.render(), '删除资料库'), undefined, 'an active library must not expose deletion');
  const lib = app.snapshot.libraries[0];
  lib.archived = true;
  assert(button(app.render(), '删除资料库'), 'the same library is deletable once deactivated');
  assert.equal(deleteLibraryCalls(app).length, 0);
});

test('library deletion states permanence, file count and path, and needs the exact name', async () => {
  const app = harness({}, { deleteLibrary: { libraryId: 'l3', name: '停用库', requested: 3, deletedFiles: 3, complete: true, failed: [] } });
  const lib = app.snapshot.libraries.find(item => item.id === 'l3');
  lib.files = [{ id: 't1', name: '保留.txt', status: 'trash', size: 10 }, { id: 't2', name: 'A.md', status: 'stored', size: 10 }];
  let tree = openDeleteLibrary(app);
  assert.equal(app.state.App[12].kind, 'deleteLibrary');
  assert(nodes(tree).some(node => node.type === 'h2' && text(node) === '删除资料库'));
  assert.match(text(tree), /不可恢复|永久删除/);
  assert.match(text(tree), /2 个文件/);
  assert.match(text(tree), /回收区 1 个/);
  assert.match(text(tree), /D:\/资料\/l3/);
  assert.match(text(tree), /不会动来源文件夹|来源文件夹/);
  for (const confirmation of ['', '停用', '停用库 ']) {
    tree = confirmDeletion(app, confirmation);
    assert.equal(submitButton(tree).props.disabled, true, JSON.stringify(confirmation));
    await submitDeletion(tree);
    assert.equal(deleteLibraryCalls(app).length, 0, 'programmatic submits must not bypass the exact name');
  }
  tree = confirmDeletion(app, lib.name);
  const submit = submitButton(tree);
  assert.equal(text(submit), '确认删除资料库及文件');
  assert.match(submit.props.className, /\bdanger\b/);
  assert.equal(submit.props.disabled, false);
  await submitDeletion(tree);
  assert.deepEqual(deleteLibraryCalls(app), [{ action: 'deleteLibrary', libraryId: 'l3', confirmation: '停用库' }]);
  assert.equal(app.calls.at(-1).action, 'snapshot');
  assert.equal(app.state.App[12], null);
  assert.equal(app.state.App[3].type, 'success');
  assert.match(app.state.App[3].text, /3 个文件/);
});

test('library deletion requires the running backend and keeps the dialog open on failure', async () => {
  const stale = harness();
  delete stale.snapshot.capabilities.deleteLibrary;
  let tree = openDeleteLibrary(stale);
  assert.match(text(tree), /后端版本|完整退出 DSH/);
  tree = confirmDeletion(stale, '停用库');
  assert.equal(submitButton(tree).props.disabled, true, 'an old backend must not advertise deletion');
  await submitDeletion(tree);
  assert.equal(deleteLibraryCalls(stale).length, 0);
  const app = harness({}, { deleteLibrary: { libraryId: 'l3', name: '停用库', requested: 1, deletedFiles: 1, complete: false, failed: [{ stage: 'delete', code: 'EBUSY', message: '目录被占用，可重试' }] } });
  openDeleteLibrary(app);
  await submitDeletion(confirmDeletion(app, '停用库'));
  assert.equal(deleteLibraryCalls(app).length, 1);
  assert.equal(app.state.App[12].kind, 'deleteLibrary', 'a partial failure keeps the confirmation dialog for retry');
  assert.equal(app.state.App[3].type, 'error');
  assert.match(app.state.App[3].text, /目录被占用/);
  assert.equal(field(app.render(), 'dshlib-confirm').props.value, '停用库');
});

test('pending library deletion disables restore including programmatic clicks and offers deletion retry', async () => {
  const app = harness();
  const lib = app.snapshot.libraries.find(item => item.id === 'l3');
  lib.deletePending = true;
  app.state.App[5] = 'archived';
  let tree = app.render();
  const restore = button(tree, '恢复资料库');
  assert.equal(restore.props.disabled, true);
  assert.match(text(tree), /待续删/);
  assert.match(text(tree), /文件可能残缺/);
  assert.match(text(tree), /不能恢复|不可恢复/);
  assert.doesNotMatch(text(tree), /本地文件保留，恢复后可继续管理|已停用 · 保留本地文件|恢复后可导入文件/);
  await restore.props.onClick();
  assert.equal(app.calls.some(call => call.action === 'restoreLibrary'), false);
  assert.equal(app.state.App[3].type, 'error');
  tree = app.render();
  const retry = button(tree, '删除资料库');
  assert.equal(retry.props.disabled, false);
  retry.props.onClick();
  assert.equal(app.state.App[12].kind, 'deleteLibrary');
});

test('a stale restore handler checks the latest refreshed snapshot before sending an action', async () => {
  const pending = fixture();
  pending.libraries.find(lib => lib.id === 'l3').deletePending = true;
  const app = harness({}, { snapshot: pending });
  app.state.App[5] = 'archived';
  const tree = app.render();
  const staleRestore = button(tree, '恢复资料库');
  assert.equal(staleRestore.props.disabled, false);
  await nodes(tree).find(node => node.type === 'button' && text(node).trim() === '刷新').props.onClick();
  // Deliberately do not render: refresh must invalidate the old handler immediately.
  await staleRestore.props.onClick();
  assert.equal(app.calls.some(call => call.action === 'restoreLibrary'), false);
  assert.match(app.state.App[3].text, /不能恢复/);
  assert.equal(button(app.render(), '恢复资料库').props.disabled, true);
});

test('unknown partial library deletion count uses the backend error verbatim and remains retryable', async () => {
  const message = '资料库删除未完成，部分文件可能已删除，无法确定已删数量；记录保留待重试，不能恢复。';
  const app = harness({}, { deleteLibrary: () => {
    app.snapshot.libraries.find(lib => lib.id === 'l3').deletePending = true;
    return { libraryId: 'l3', requested: 3, deletedFiles: null, complete: false, failed: [{ stage: 'delete', code: 'EBUSY', message }] };
  } });
  openDeleteLibrary(app);
  await submitDeletion(confirmDeletion(app, '停用库'));
  assert.equal(app.state.App[3].type, 'error');
  assert.equal(app.state.App[3].text, `删除资料库未完成：${message}`);
  assert.doesNotMatch(app.state.App[3].text, /已删除 0|0 个文件已永久删除|文件都保留/);
  assert.equal(app.state.App[12].kind, 'deleteLibrary');
  let tree = app.render();
  assert.equal(submitButton(tree).props.disabled, false);
  assert.match(text(tree), /无法确定已删数量/);
  button(tree, '取消').props.onClick();
  tree = app.render();
  assert.equal(button(tree, '恢复资料库').props.disabled, true);
  assert.equal(button(tree, '删除资料库').props.disabled, false);
});

for (const moved of [0, 1]) {
  test(`bulk recycle success reports the actual response moved count ${moved}, not the preview count`, async () => {
    const app = harness({}, { trashAll: { libraryId: 'l1', moved, alreadyTrashed: 4 - moved, total: 4 } });
    openTrashAll(app);
    let tree = app.render();
    assert.match(text(tree), /3 个文件/, 'the current preview intentionally differs from the concurrent result');
    tree = confirmDeletion(app, app.snapshot.libraries[0].name);
    await submitDeletion(tree);
    assert.equal(app.state.App[3].type, 'success');
    assert.match(app.state.App[3].text, new RegExp(`${moved} 个`));
    assert.doesNotMatch(app.state.App[3].text, /3 个/, 'must not announce the stale preview count as moved');
    assert.equal(app.calls.at(-1).action, 'snapshot');
    assert.equal(app.state.App[12], null);
  });
}
