/* DSH 资料库管理 UI · 中文首版。仅依赖浏览器与宿主提供的 React。 */
window.__ModuleLoader__.load({
  id: 'dsh-library',
  factory(require) {
    'use strict';
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;
    const TEXT = Object.freeze({ title: '资料库', subtitle: '保存项目原文件，供当前会话按需参考。', loading: '正在加载资料库…', refresh: '刷新', settings: '存储与隐私', empty: '还没有资料库', noMatch: '没有符合条件的资料库', error: '操作失败，请重试。' });
    const STATUS = { ready: '已保存', stored: '已保存', error: '已保存', excluded: '已排除', trash: '回收区' };
    const CSS = `
.dshlib{--lib-bg:var(--dsw-alias-bg-base);--lib-panel:var(--dsw-alias-bg-layer-1);--lib-hover:var(--dsw-alias-bg-layer-2);--lib-border:var(--dsw-alias-border-l1);--lib-strong-border:var(--dsw-alias-border-l2);--lib-brand:var(--dsw-alias-brand-primary);--lib-text:var(--dsw-alias-label-primary);--lib-muted:var(--dsw-alias-label-secondary);--lib-error:var(--dsw-alias-state-error-primary);--lib-success:var(--dsw-alias-state-success-primary);--lib-warn:var(--dsw-alias-state-warn-primary);font-family:inherit;font-size:14px;line-height:1.55;color:var(--lib-text);background:var(--lib-bg);height:100%;min-height:0;overflow:auto;box-sizing:border-box;isolation:isolate}
.dshlib *{box-sizing:border-box}.dshlib button,.dshlib input,.dshlib select,.dshlib textarea{font:inherit;color:inherit}.dshlib button{cursor:pointer}.dshlib button:disabled{cursor:not-allowed;opacity:.48}.dshlib :focus-visible{outline:2px solid var(--lib-brand);outline-offset:3px}.dshlib .lib-wrap{max-width:1440px;padding:32px clamp(16px,3vw,44px);margin:0 auto}.dshlib h1,.dshlib h2,.dshlib h3,.dshlib p{margin:0}.dshlib h1{font-size:26px;line-height:1.3;font-weight:650;letter-spacing:-.5px}.dshlib h2{font-size:18px;font-weight:620}.dshlib h3{font-size:15px;font-weight:600}.dshlib .lib-muted{color:var(--lib-muted)}.dshlib .lib-small{font-size:12px}.dshlib .lib-header,.dshlib .lib-row{display:flex;align-items:center;gap:12px}.dshlib .lib-header{justify-content:space-between;align-items:flex-start;flex-wrap:wrap;margin-bottom:24px}.dshlib .lib-header p{margin-top:8px}.dshlib .lib-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dshlib .lib-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:7px 12px;min-height:34px;border:1px solid var(--lib-strong-border);border-radius:7px;background:var(--lib-panel);white-space:nowrap;font-weight:500}.dshlib .lib-btn:hover:not(:disabled){background:var(--lib-hover)}.dshlib .lib-btn.primary{color:var(--lib-brand);border-color:var(--lib-brand);background:color-mix(in srgb,var(--lib-brand) 9%,var(--lib-panel))}.dshlib .lib-btn.danger{color:var(--lib-error);border-color:var(--lib-error)}.dshlib .lib-btn.quiet{background:transparent;border-color:transparent}.dshlib .lib-btn.small{padding:4px 9px;min-height:28px;font-size:12px}.dshlib .lib-input,.dshlib .lib-select{width:100%;min-height:36px;padding:7px 10px;border:1px solid var(--lib-strong-border);border-radius:7px;background:var(--lib-panel)}.dshlib .lib-input::placeholder{color:var(--lib-muted)}.dshlib .lib-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}.dshlib .lib-search{flex:1;min-width:180px;max-width:400px}.dshlib .lib-toolbar .lib-select{width:auto;max-width:220px}.dshlib .lib-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--lib-border);margin-bottom:20px}.dshlib .lib-tab{padding:9px 12px;background:transparent;border:0;border-bottom:2px solid transparent;color:var(--lib-muted)}.dshlib .lib-tab[aria-selected=true]{color:var(--lib-brand);border-bottom-color:var(--lib-brand);font-weight:600}.dshlib .lib-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:24px}.dshlib .lib-stat{padding:16px 18px;border:1px solid var(--lib-border);border-radius:9px;background:var(--lib-panel)}.dshlib .lib-stat strong{font-size:24px;font-weight:600;display:block;margin-top:4px}.dshlib .lib-layout{display:grid;grid-template-columns:minmax(250px,320px) minmax(0,1fr);gap:20px;align-items:start}.dshlib .lib-list{display:flex;flex-direction:column;gap:8px}.dshlib .lib-library{width:100%;text-align:left;background:var(--lib-panel);border:1px solid var(--lib-border);border-radius:9px;padding:15px;display:block}.dshlib .lib-library:hover{background:var(--lib-hover)}.dshlib .lib-library[aria-pressed=true]{border-color:var(--lib-brand);box-shadow:inset 3px 0 0 var(--lib-brand)}.dshlib .lib-library-title{font-weight:600;overflow-wrap:anywhere;display:block;margin-bottom:6px}.dshlib .lib-library-meta{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--lib-muted);margin-top:8px}.dshlib .lib-badge{display:inline-block;padding:1px 7px;border:1px solid var(--lib-border);border-radius:5px;font-size:11px;line-height:1.65;color:var(--lib-muted);white-space:nowrap}.dshlib .lib-badge.ready{color:var(--lib-success)}.dshlib .lib-badge.error{color:var(--lib-error)}.dshlib .lib-badge.excluded,.dshlib .lib-badge.trash{color:var(--lib-warn)}.dshlib .lib-panel{border:1px solid var(--lib-border);border-radius:10px;background:var(--lib-panel);min-width:0}.dshlib .lib-detail-head{padding:22px;border-bottom:1px solid var(--lib-border)}.dshlib .lib-detail-head h2{overflow-wrap:anywhere}.dshlib .lib-detail-body{padding:20px}.dshlib .lib-path{font-size:12px;color:var(--lib-muted);overflow-wrap:anywhere;margin-top:8px!important}.dshlib .lib-detail-head .lib-actions{margin-top:16px}.dshlib .lib-notice{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--lib-border);border-radius:8px;background:var(--lib-hover);margin-bottom:16px;overflow-wrap:anywhere}.dshlib .lib-notice.error{color:var(--lib-error);border-color:var(--lib-error)}.dshlib .lib-notice.success{color:var(--lib-success);border-color:var(--lib-success)}.dshlib .lib-notice.warning{color:var(--lib-warn);border-color:var(--lib-warn)}.dshlib .lib-empty{padding:48px 24px;text-align:center;color:var(--lib-muted)}.dshlib .lib-empty svg{margin-bottom:12px}.dshlib .lib-empty h3{color:var(--lib-text);margin-bottom:8px}.dshlib .lib-empty .lib-actions{justify-content:center;margin-top:18px}.dshlib .lib-table-scroll{overflow-x:auto}.dshlib table{width:100%;border-collapse:collapse;font-size:13px}.dshlib th{text-align:left;color:var(--lib-muted);font-weight:500;white-space:nowrap;border-bottom:1px solid var(--lib-border);padding:10px 8px}.dshlib td{padding:12px 8px;border-bottom:1px solid var(--lib-border);vertical-align:top}.dshlib tr:last-child td{border-bottom:0}.dshlib .lib-file-name{max-width:320px;overflow-wrap:anywhere;font-weight:500}.dshlib .lib-file-error{font-size:12px;color:var(--lib-error);max-width:360px;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}.dshlib .lib-file-actions{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}.dshlib .lib-section{margin-top:24px}.dshlib .lib-section h3{margin-bottom:10px}.dshlib .lib-result{padding:16px 0;border-bottom:1px solid var(--lib-border)}.dshlib .lib-result:last-child{border:0}.dshlib .lib-result p{white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}.dshlib .lib-citation{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere;color:var(--lib-muted)}.dshlib .lib-form{display:flex;flex-direction:column;gap:18px}.dshlib .lib-field{display:flex;flex-direction:column;gap:7px}.dshlib .lib-field label{font-weight:550}.dshlib .lib-check{display:flex;gap:10px;align-items:flex-start}.dshlib .lib-check input{margin-top:4px;accent-color:var(--lib-brand);flex:none}.dshlib .lib-check label{font-weight:400}.dshlib .lib-settings{max-width:760px}.dshlib .lib-settings .lib-panel{padding:24px}.dshlib .lib-dialog{color:var(--lib-text);background:var(--lib-panel);border:1px solid var(--lib-strong-border);border-radius:12px;padding:0;max-width:min(680px,calc(100vw - 32px));width:560px;max-height:calc(100dvh - 48px);box-shadow:0 18px 70px color-mix(in srgb,var(--lib-text) 18%,transparent)}.dshlib .lib-dialog::backdrop{background:color-mix(in srgb,var(--lib-bg) 65%,transparent);backdrop-filter:blur(3px)}.dshlib .lib-modal-head{padding:20px 24px 14px;display:flex;justify-content:space-between;align-items:center;gap:16px}.dshlib .lib-modal-body{padding:8px 24px 24px;overflow:auto;max-height:60dvh}.dshlib .lib-modal-foot{padding:16px 24px;border-top:1px solid var(--lib-border);display:flex;justify-content:flex-end;gap:8px}.dshlib .lib-segment{border:1px solid var(--lib-border);border-radius:7px;padding:14px;margin-top:12px}.dshlib .lib-segment pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0 0}.dshlib .lib-import-log{max-height:160px;overflow:auto;font-size:12px;margin:8px 0 0;padding-left:20px}.dshlib progress{width:100%;height:6px;accent-color:var(--lib-brand)}.dshlib .lib-link-text{overflow-wrap:anywhere}.dshlib .lib-pending{margin-bottom:20px}.dshlib .lib-pending p+p{margin-top:6px}.dshlib .lib-spinner{display:inline-block;width:14px;height:14px;border:2px solid var(--lib-border);border-top-color:var(--lib-brand);border-radius:50%;animation:dshlib-spin .8s linear infinite}.dshlib .lib-live{min-height:1px}.dshlib .lib-icon{vertical-align:middle;flex:none}
.dshlib .lib-directory-row{display:flex;gap:10px;align-items:center}.dshlib .lib-directory-row .lib-input{flex:1;min-width:0}.dshlib .lib-dropzone{border:2px dashed var(--lib-strong-border);border-radius:10px;padding:18px;text-align:center;margin-bottom:18px;background:var(--lib-panel)}.dshlib .lib-dropzone p{margin:6px 0 10px}.dshlib .lib-dropzone.dragging{border-color:var(--lib-brand);background:color-mix(in srgb,var(--lib-brand) 14%,var(--lib-panel))}.dshlib .lib-dropzone[aria-disabled=true]{opacity:.65}@media(max-width:540px){.dshlib .lib-directory-row{flex-wrap:wrap}.dshlib .lib-directory-row .lib-input{flex-basis:100%}}
.dshlib .lib-import-dialog{position:fixed;inset:0;margin:auto;width:min(720px,calc(100vw - 32px));max-width:none;max-height:calc(100dvh - 32px);padding:0;overflow:hidden;border:1px solid var(--lib-strong-border);border-radius:12px;color:var(--lib-text);background:var(--lib-panel);box-shadow:0 24px 80px #0005}.dshlib .lib-import-dialog[open]{display:flex;flex-direction:column}.dshlib .lib-import-dialog::backdrop{background:#0008;backdrop-filter:blur(3px)}.dshlib .lib-import-dialog .lib-modal-head,.dshlib .lib-import-dialog .lib-modal-foot{flex-shrink:0}.dshlib .lib-import-dialog .lib-modal-head h2{min-width:0;overflow-wrap:anywhere}.dshlib .lib-import-dialog .lib-modal-body{min-height:0;max-height:none;overflow:auto;overscroll-behavior:contain}.dshlib .lib-import-dialog .lib-import-log{max-height:none;overflow:visible;overflow-wrap:anywhere}.dshlib .lib-import-dialog .lib-modal-foot{display:flex;justify-content:flex-end;gap:8px}
@keyframes dshlib-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.dshlib .lib-spinner{animation:none}}@media(max-width:980px){.dshlib .lib-layout{grid-template-columns:1fr}.dshlib .lib-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.dshlib .lib-wrap{padding:20px 16px}.dshlib .lib-stats{gap:8px}.dshlib .lib-stat{padding:12px}.dshlib .lib-detail-body{padding:14px}}@media(max-width:540px){.dshlib .lib-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.dshlib .lib-header .lib-actions{width:100%}.dshlib .lib-toolbar .lib-search{max-width:none}.dshlib .lib-dialog{max-height:calc(100dvh - 24px)}.dshlib .lib-modal-body{max-height:55dvh}.dshlib .lib-detail-head{padding:16px}.dshlib .lib-tab{padding:8px}.dshlib .lib-file-actions{min-width:130px}}
`;
    function Icon({ size = 18 }) { return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className: 'lib-icon' }, h('path', { d: 'M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 1-2-2V5Zm0 12a2 2 0 0 1 2-2h13M8 7h7M8 10h5' })); }
    function bytes(value) { if (!value) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3); return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`; }
    function date(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    function Button({ children, tone = '', small, ...props }) { return h('button', { type: 'button', ...props, className: `lib-btn ${tone} ${small ? 'small' : ''} ${props.className || ''}` }, children); }
    function Badge({ status, children }) { return h('span', { className: `lib-badge ${status || ''}` }, children || STATUS[status] || status); }
    function Empty({ title, children, action }) { return h('div', { className: 'lib-empty' }, h(Icon, { size: 32 }), h('h3', null, title), h('p', null, children), action && h('div', { className: 'lib-actions' }, action)); }
    function Notice({ notice, close }) { return notice && h('div', { className: `lib-notice ${notice.type || ''}`, role: notice.type === 'error' ? 'alert' : 'status' }, h('span', null, notice.text), close && h(Button, { tone: 'quiet', small: true, 'aria-label': '关闭提示', onClick: close }, '×')); }
    const BULK_RESTART_NOTICE = '当前后端未声明批量回收能力，前后端可能未同步更新。请完整退出 DSH（含托盘后台进程）再重新启动并刷新，不是仅停用启用插件；勿删除资料目录。';
    const backendVersionLabel = snapshot => typeof snapshot?.backendVersion === 'string' && snapshot.backendVersion ? snapshot.backendVersion : '旧版/未声明';
    async function fetchLibrary(url, options) {
      let response;
      try { response = await fetch(url, options); }
      catch (cause) {
        if (cause.name === 'AbortError') throw cause;
        const error = new Error('无法连接资料库后端。请先确认 DSH 仍在运行；如曾异常退出，请重启后刷新确认已导入文件，避免重复提交。'); error.code = 'HOST_UNAVAILABLE'; throw error;
      }
      if ([502, 503, 504].includes(response.status)) {
        const error = new Error(`资料库后端暂时不可用（HTTP ${response.status}），可能正在启动、重启或连接已中断。请稍后刷新；不要删除资料目录。`); error.code = 'HOST_UNAVAILABLE'; throw error;
      }
      return response;
    }
    async function request(action, payload = {}, signal) {
      const response = await fetchLibrary(new URL('api/dsh-library', document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-DSH-Library': '1' }, body: JSON.stringify({ action, ...payload }), signal });
      let body; try { body = await response.json(); } catch (_) { throw new Error(`服务返回无法识别的响应（HTTP ${response.status}）。`); }
      if (!response.ok || !body || body.ok !== true) { const error = new Error(body && body.error && body.error.message || `请求失败（HTTP ${response.status}）。`); error.code = body && body.error && body.error.code; throw error; }
      return body.value;
    }
    async function uploadFile(libraryId, file, sourcePath, signal) {
      const response = await fetchLibrary(new URL('api/dsh-library', document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-DSH-Library': '1', 'X-DSH-Library-Action': 'import', 'X-DSH-Library-Id': libraryId, 'X-DSH-Library-Name': encodeURIComponent(file.name), 'X-DSH-Library-Source-Path': encodeURIComponent(sourcePath || file.name) }, body: await file.arrayBuffer(), signal });
      let body; try { body = await response.json(); } catch (_) { throw new Error(`服务返回无法识别的响应（HTTP ${response.status}）。`); }
      if (!response.ok || !body || body.ok !== true) throw new Error(body?.error?.message || `上传失败（HTTP ${response.status}）。`);
      return body.value;
    }
    async function downloadFile(libraryId, file, signal) {
      const response = await fetchLibrary(new URL('api/dsh-library', document.baseURI), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-DSH-Library': '1' }, body: JSON.stringify({ action: 'download', libraryId, fileId: file.id }), signal });
      if (!response.ok) {
        let body; try { body = await response.json(); } catch (_) { /* Non-JSON failures still get normal HTTP feedback. */ }
        throw new Error(body?.error?.message || `下载失败（HTTP ${response.status}）。`);
      }
      if ((response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/octet-stream' || !/^attachment(?:;|$)/i.test(response.headers.get('Content-Disposition') || '')) throw new Error('下载响应不是原文件附件，请刷新后重试。');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      let anchor;
      try {
        anchor = document.createElement('a');
        anchor.href = url; anchor.download = file.name.replace(/[\\/\u0000-\u001f]/g, '_') || 'download'; anchor.hidden = true;
        document.body.appendChild(anchor); anchor.click();
      } finally { try { if (anchor) anchor.remove(); } finally { URL.revokeObjectURL(url); } }
    }
    const IMPORT_LIMITS = Object.freeze({ files: 2000, entries: 10000, depth: 32, bytes: 5 * 1024 ** 3 });
    const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
    /** Snapshot drag handles inside the drop gesture; enumerate lazily, never read file bodies here. */
    async function collectImport(selection, { maxBytes, cancelled, progress }) {
      const files = []; const skipped = []; let visited = 0; let totalBytes = 0; let truncated = false;
      const skip = (name, message) => { if (skipped.length < 200) skipped.push({ name, message }); };
      const check = () => { if (cancelled()) throw new Error('已取消扫描，未导入任何文件。'); if (++visited > IMPORT_LIMITS.entries) { truncated = true; throw new Error('目录条目过多，请拆分文件夹后重试。'); } };
      const add = (file, relativePath) => {
        check();
        if (file.size > maxBytes || file.size === 0) { skip(relativePath, file.size === 0 ? '空文件' : `超过单文件 ${bytes(maxBytes)} 上限`); return; }
        if (files.length >= IMPORT_LIMITS.files || totalBytes + file.size > IMPORT_LIMITS.bytes) { truncated = true; throw new Error('达到本批次文件数量或总体积上限，请拆分文件夹后重试。'); }
        totalBytes += file.size; files.push({ file, sourcePath: relativePath }); progress(visited, files.length);
      };
      const walk = async (entry, prefix = '', depth = 0) => {
        check(); if (depth > IMPORT_LIMITS.depth) { skip(prefix + entry.name, '目录层级过深'); return; }
        const relativePath = prefix + entry.name;
        if (entry.isDirectory || entry.kind === 'directory') {
          if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) { skip(relativePath, '已跳过开发依赖或版本管理目录'); return; }
          if (entry.createReader) {
            const reader = entry.createReader();
            while (true) { if (cancelled()) throw new Error('已取消扫描，未导入任何文件。'); const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) break; for (const child of batch) await walk(child, relativePath + '/', depth + 1); }
          } else { for await (const child of entry.values()) await walk(child, relativePath + '/', depth + 1); }
        } else {
          try { const file = entry.file ? await new Promise((resolve, reject) => entry.file(resolve, reject)) : await entry.getFile(); add(file, relativePath); }
          catch (error) { if (cancelled() || truncated) throw error; skip(relativePath, `无法读取：${error.message || '权限不足'}`); }
        }
      };
      for (const item of selection) {
        if (cancelled()) throw new Error('已取消扫描，未导入任何文件。');
        if (item.entry || item.handle) { const entry = item.entry || await item.handle; if (!entry || entry.error) throw new Error(entry?.error?.message || '浏览器无法读取拖入的目录，请使用“选择文件夹”'); await walk(entry); }
        else {
          const relativePath = item.sourcePath || item.file.webkitRelativePath || item.file.name;
          if (relativePath.split('/').slice(0, -1).some(name => IGNORED_DIRECTORIES.has(name.toLowerCase()))) { check(); skip(relativePath, '已跳过开发依赖或版本管理目录'); continue; }
          if (relativePath.split('/').length > IMPORT_LIMITS.depth + 2) { check(); skip(relativePath, '目录层级过深'); continue; }
          add(item.file, relativePath);
        }
      }
      return { files, skipped, totalBytes, visited };
    }
    function Modal({ modal, snapshot, busy, onClose, onSubmit }) {
      const ref = useRef(null);
      const [name, setName] = useState(modal.library ? modal.library.name : '');
      const [workspaceId, setWorkspaceId] = useState('');
      const [libraryId, setLibraryId] = useState('');
      const [confirm, setConfirm] = useState('');
      const lib = modal.library;
      const titles = { create: '新建资料库', link: '关联工作区', rename: '重命名资料库', archive: '停用资料库', deleteLibrary: '删除资料库', unlink: '解除工作区关联', trash: '将文件移入回收区', purge: '永久删除文件', emptyTrash: '清空回收区', trashAll: '全部移入回收区' };
      useEffect(() => {
        const dialog = ref.current; const previous = document.activeElement;
        if (dialog && !dialog.open) dialog.showModal();
        return () => { if (dialog && dialog.open) dialog.close(); if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus(); };
      }, []);
      const availableWorkspaces = snapshot.workspaces.filter(w => !w.libraryId);
      const availableLibraries = snapshot.libraries.filter(l => !l.archived && !l.workspaceId);
      const noAvailable = modal.kind === 'create' || modal.kind === 'link' ? !availableWorkspaces.length : false;
      let fields;
      if (modal.kind === 'create' || modal.kind === 'link') {
        fields = h(React.Fragment, null,
          h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-workspace' }, '工作区'), h('select', { id: 'dshlib-workspace', className: 'lib-select', value: workspaceId, required: true, disabled: busy || noAvailable, onChange: e => setWorkspaceId(e.target.value) }, h('option', { value: '' }, noAvailable ? '没有可关联的工作区' : '选择未关联的工作区'), availableWorkspaces.map(w => h('option', { value: w.id, key: w.id }, w.title || w.path || w.id)))),
          modal.kind === 'create' ? h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-name' }, '资料库名称（可选）'), h('input', { id: 'dshlib-name', className: 'lib-input', maxLength: 120, value: name, disabled: busy, placeholder: '留空时使用工作区名称', onChange: e => setName(e.target.value) })) : h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-library' }, '资料库'), h('select', { id: 'dshlib-library', className: 'lib-select', required: true, value: lib ? lib.id : libraryId, disabled: busy || !!lib, onChange: e => setLibraryId(e.target.value) }, !lib && h('option', { value: '' }, '选择未关联的活动资料库'), (lib ? [lib] : availableLibraries).map(l => h('option', { key: l.id, value: l.id }, l.name)))),
          h('p', { className: 'lib-small lib-muted' }, '每个工作区只关联一个资料库。已有文件不会因关联操作而移动。'));
      } else if (modal.kind === 'rename') {
        fields = h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-name' }, '资料库名称'), h('input', { id: 'dshlib-name', className: 'lib-input', value: name, required: true, maxLength: 120, autoFocus: true, disabled: busy, onChange: e => setName(e.target.value) }));
      } else if (modal.kind === 'archive') {
        fields = h('div', null, h('p', null, `确定停用“${lib.name}”？`), h('p', { className: 'lib-muted', style: { marginTop: 12 } }, '停用只注销资料库、停止供 AI 参考，不删除本地文件。你可以在“停用”列表中恢复资料库。工作区关联的最终状态以服务端返回为准。'));
      } else if (modal.kind === 'unlink') {
        fields = h('div', null, h('p', null, `确定解除“${lib.name}”与工作区的关联？`), h('p', { className: 'lib-muted', style: { marginTop: 12 } }, '资料库和文件仍保留。解除后，该工作区不再通过此关联使用项目文件。'));
      } else if (modal.kind === 'trash') {
        fields = h(React.Fragment, null, h(Notice, { notice: { type: 'warning', text: '这是移入插件回收区，不是永久删除。文件将停止供 AI 参考，可在回收区恢复。' } }), h('p', { className: 'lib-link-text' }, `文件：${modal.file.name}`), h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-confirm' }, '再次确认：输入完整文件名'), h('input', { id: 'dshlib-confirm', className: 'lib-input', value: confirm, autoComplete: 'off', required: true, disabled: busy, onChange: e => setConfirm(e.target.value) })));
      } else if (modal.kind === 'trashAll') {
        fields = h(React.Fragment, null,
          snapshot.capabilities?.trashAll !== true && h(Notice, { notice: { type: 'warning', text: `${BULK_RESTART_NOTICE} 后端版本：${backendVersionLabel(snapshot)}` } }),
          h(Notice, { notice: { type: 'warning', text: '将本库全部未回收文件移入插件回收区，包括已排除文件。不受搜索或状态筛选影响；这不是永久删除，之后可逐个恢复。不会删除库内原件或来源文件，不影响其他资料库；已经交付的历史会话附件不能撤回。' } }),
          h('p', { className: 'lib-link-text' }, `资料库：${lib.name}；将移入 ${(lib.files || []).filter(f => f.status !== 'trash').length} 个文件。已经在回收区的文件保持原样。`),
          h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-confirm' }, '再次确认：输入完整资料库名称'), h('input', { id: 'dshlib-confirm', className: 'lib-input', value: confirm, autoComplete: 'off', required: true, disabled: busy, onChange: e => setConfirm(e.target.value) })));
      } else if (modal.kind === 'deleteLibrary') {
        const inside = [...modal.library.files];
        const recycled = inside.filter(f => f.status === 'trash').length;
        fields = h(React.Fragment, null,
          snapshot.capabilities?.deleteLibrary !== true && h(Notice, { notice: { type: 'warning', text: `${BULK_RESTART_NOTICE} 后端版本：${backendVersionLabel(snapshot)}` } }),
          h(Notice, { notice: { type: 'warning', text: '删除资料库不可恢复：将永久删除这个资料库记录，以及它本地目录中的全部文件（含回收区与已排除文件）。只删除本资料库自己的目录，不会动来源文件夹、其他资料库或已交付到历史会话的附件副本。' } }),
          h('p', { className: 'lib-link-text' }, `资料库：${lib.name}；本地目录：${lib.path}`),
          h('p', { className: 'lib-small lib-muted', style: { marginTop: 8 } }, `将删除 ${inside.length} 个文件${recycled ? `（其中回收区 ${recycled} 个）` : ''}。`),
          h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-confirm' }, '再次确认：输入完整资料库名称'), h('input', { id: 'dshlib-confirm', className: 'lib-input', value: confirm, autoComplete: 'off', required: true, disabled: busy, onChange: e => setConfirm(e.target.value) })));
      } else if (modal.kind === 'purge' || modal.kind === 'emptyTrash') {
        const single = modal.kind === 'purge';
        fields = h(React.Fragment, null,
          h(Notice, { notice: { type: 'warning', text: '永久删除不可恢复：只删除本资料库内的原文件副本和旧提取缓存，不删除来源文件或其他资料库。已经交付到历史会话的附件副本不会因此撤回。' } }),
          h('p', { className: 'lib-link-text' }, single ? `文件：${modal.file.name}` : `资料库：${lib.name}；将永久删除整个回收区中的 ${(lib.files || []).filter(f => f.status === 'trash').length} 个文件，不受搜索筛选影响。文件列表中尚未移入回收区的文件不会删除。`),
          h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-confirm' }, single ? '再次确认：输入完整文件名' : '再次确认：输入完整资料库名称'), h('input', { id: 'dshlib-confirm', className: 'lib-input', value: confirm, autoComplete: 'off', required: true, disabled: busy, onChange: e => setConfirm(e.target.value) })));
      }
      const invalid = noAvailable || ((modal.kind === 'create' || modal.kind === 'link') && !workspaceId) || (modal.kind === 'link' && !lib && !libraryId) || (modal.kind === 'rename' && !name.trim()) || (['trash', 'purge'].includes(modal.kind) && confirm !== modal.file.name) || (['emptyTrash', 'trashAll', 'deleteLibrary'].includes(modal.kind) && confirm !== lib.name) || (modal.kind === 'trashAll' && snapshot.capabilities?.trashAll !== true) || (modal.kind === 'deleteLibrary' && snapshot.capabilities?.deleteLibrary !== true);
      return h('dialog', { ref, className: 'lib-dialog', 'aria-labelledby': 'dshlib-modal-title', onCancel: e => { e.preventDefault(); if (!busy) onClose(); } },
        h('form', { onSubmit: e => { e.preventDefault(); if (!busy && !invalid) onSubmit({ name: name.trim(), workspaceId, libraryId: lib ? lib.id : libraryId, confirmation: confirm }); } },
          h('div', { className: 'lib-modal-head' }, h('h2', { id: 'dshlib-modal-title' }, titles[modal.kind]), h(Button, { tone: 'quiet', 'aria-label': '关闭对话框', disabled: busy, onClick: onClose }, '×')),
          h('div', { className: 'lib-modal-body lib-form' }, fields, modal.error && h(Notice, { notice: { type: 'error', text: modal.error } })),
          h('div', { className: 'lib-modal-foot' }, h(Button, { onClick: onClose, disabled: busy }, '取消'), h(Button, { type: 'submit', tone: ['trash', 'archive', 'purge', 'emptyTrash', 'trashAll', 'deleteLibrary'].includes(modal.kind) ? 'danger' : 'primary', disabled: busy || invalid }, busy ? '正在处理…' : modal.kind === 'trashAll' ? '确认全部移入回收区' : modal.kind === 'deleteLibrary' ? '确认删除资料库及文件' : modal.kind === 'purge' ? '确认永久删除' : modal.kind === 'emptyTrash' ? '确认清空回收区' : modal.kind === 'trash' ? '确认移入回收区' : modal.kind === 'archive' ? '确认停用' : '确认'))));
    }
    function ImportPreview({ queue, busy, invalid, onClose, onConfirm }) {
      const ref = useRef(null);
      useEffect(() => {
        const dialog = ref.current; const previous = document.activeElement;
        if (dialog && !dialog.open) dialog.showModal();
        return () => { if (dialog && dialog.open) dialog.close(); if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true }); };
      }, []);
      const close = () => { if (!busy) onClose(); };
      return h('dialog', { ref, className: 'lib-dialog lib-import-dialog', 'aria-labelledby': 'dshlib-import-title', 'aria-describedby': 'dshlib-import-summary', onCancel: event => { event.preventDefault(); close(); } },
        h('div', { className: 'lib-modal-head' }, h('h2', { id: 'dshlib-import-title' }, `导入到“${queue.libraryName}”`), h(Button, { tone: 'quiet', disabled: busy, 'aria-label': '关闭导入确认', onClick: close }, '×')),
        h('div', { className: 'lib-modal-body lib-form' },
          h('p', { id: 'dshlib-import-summary' }, `将导入 ${queue.files.length} 个文件，共 ${bytes(queue.totalBytes)}；已记录 ${queue.skipped.length} 条跳过原因（最多展示 200 条）。`),
          h('p', { className: 'lib-small lib-muted' }, '复制任意格式文件，不改动来源文件夹。导入仅保存原文件，不预先解析。同名文件不会相互覆盖；保留来源相对路径作记录，不在资料库存储中重建目录。'),
          !queue.files.length && h(Notice, { notice: { type: 'warning', text: '没有可导入的文件，请查看跳过原因并重新选择。' } }),
          h('ul', { className: 'lib-import-log' }, queue.files.slice(0, 100).map((item, i) => h('li', { key: i }, `${item.sourcePath} · ${bytes(item.file.size)}`)), queue.files.length > 100 && h('li', null, '仅预览前 100 个文件。'), queue.skipped.map((item, i) => h('li', { key: `skip-${i}`, className: 'lib-muted' }, `${item.name}：${item.message}`)))),
        h('div', { className: 'lib-modal-foot' }, h(Button, { autoFocus: true, disabled: busy, onClick: close }, '取消导入'), h(Button, { tone: 'primary', disabled: busy || invalid || !queue.files.length, onClick: () => { if (!busy && !invalid && queue.files.length) return onConfirm(); } }, '确认导入')));
    }
    function Settings({ snapshot, busy, onSave, onBack, onPickDirectory }) {
      const [root, setRoot] = useState(snapshot.settings.root || '');
      const [consent, setConsent] = useState(!!snapshot.settings.originalConsent);
      const [acknowledge, setAcknowledge] = useState(false);
      const [picking, setPicking] = useState(false);
      const [pickerError, setPickerError] = useState(null);
      const [maxFileMiB, setMaxFileMiB] = useState(snapshot.settings.maxFileMiB ?? 50);
      const validLimit = Number.isInteger(Number(maxFileMiB)) && Number(maxFileMiB) >= 1 && Number(maxFileMiB) <= 200;
      const pickerLock = useRef(false);
      const alive = useRef(true);
      useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
      const chooseDirectory = async () => {
        if (busy || pickerLock.current) return;
        pickerLock.current = true; setPicking(true); setPickerError(null);
        try {
          const directory = await onPickDirectory();
          if (alive.current && typeof directory === 'string' && directory && directory !== root) { setRoot(directory); setAcknowledge(false); }
        } catch (error) {
          if (alive.current) setPickerError(`无法选择文件夹：${error.message || '请稍后重试'}。你仍可手动输入目录。`);
        } finally { pickerLock.current = false; if (alive.current) setPicking(false); }
      };
      const initial = !snapshot.settings.root;
      const changedRoot = root.trim() !== (snapshot.settings.root || '');
      const needsAcknowledge = initial || changedRoot || (consent && !snapshot.settings.originalConsent);
      return h('section', { className: 'lib-settings' }, h('div', { className: 'lib-toolbar' }, h(Button, { onClick: onBack, disabled: busy }, '← 返回资料库')), h('div', { className: 'lib-panel' },
        h('h2', null, TEXT.settings), h('p', { className: 'lib-muted', style: { marginTop: 8, marginBottom: 24 } }, '明确资料存放位置，以及项目文件内容的模型使用范围。'),
        h('form', { className: 'lib-form', onSubmit: e => { e.preventDefault(); if (busy || pickerLock.current || !root.trim() || !validLimit || (needsAcknowledge && !acknowledge)) return; onSave({ root: root.trim(), originalConsent: consent, maxFileMiB: Number(maxFileMiB) }); } },
          h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-root' }, '本地存储根目录'), h('div', { className: 'lib-directory-row' }, h('input', { id: 'dshlib-root', className: 'lib-input', value: root, required: true, disabled: busy || picking, placeholder: '例如 D:\\资料库', onChange: e => { setRoot(e.target.value); setAcknowledge(false); } }), h(Button, { disabled: busy || picking, onClick: chooseDirectory }, picking ? '正在选择…' : '选择文件夹')), h('p', { className: 'lib-small lib-muted' }, '选择服务器所在电脑上的文件夹，也可手动输入绝对路径。原文件及回收区保存在此目录中。选择后仍需保存设置。'), pickerError && h(Notice, { notice: { type: 'error', text: pickerError } })),
          h('div', { className: 'lib-field' }, h('label', { htmlFor: 'dshlib-max-file' }, '单文件大小上限（MiB）'), h('input', { id: 'dshlib-max-file', className: 'lib-input', type: 'number', min: 1, max: 200, step: 1, required: true, value: maxFileMiB, disabled: busy || picking, onChange: event => setMaxFileMiB(event.target.value) }), h('p', { className: 'lib-small lib-muted' }, '默认 50 MiB，可设置 1–200 MiB。更大的文件会增加内存占用和读取耗时；文件使用时仍受宿主工具能力和安全限制。'), !validLimit && h(Notice, { notice: { type: 'error', text: '请输入 1 至 200 的整数。' } })),
          changedRoot && !initial && h(Notice, { notice: { type: 'warning', text: '更改根目录只影响之后创建的新资料库，不会移动旧资料库。旧库继续使用各自原来的存储路径。' } }),
          h('div', { className: 'lib-check' }, h('input', { id: 'dshlib-cloud', type: 'checkbox', checked: consent, disabled: busy, onChange: e => { setConsent(e.target.checked); setAcknowledge(false); } }), h('label', { htmlFor: 'dshlib-cloud' }, h('strong', null, '允许会话模型按需使用获授权库的原文件'), h('p', { className: 'lib-muted lib-small', style: { marginTop: 4 } }, '文件默认只在本地保存，不预先解析。启用后，获授权项目文件可能按需交由模型提供方或宿主工具处理；使用云端服务时，文件或内容可能离开本机，不等于上传整个资料库。关闭后不再以此授权使用原文件，但不能撤回历史已使用文件。旧版文字片段同意不代表原文件同意，需在此单独确认。'))),
          needsAcknowledge && h('div', { className: 'lib-check' }, h('input', { id: 'dshlib-ack', type: 'checkbox', checked: acknowledge, disabled: busy, onChange: e => setAcknowledge(e.target.checked) }), h('label', { htmlFor: 'dshlib-ack' }, '我已了解本地存储方式、根目录变更的影响，以及上述模型文件内容发送设置。')),
          h('div', { className: 'lib-actions' }, h(Button, { type: 'submit', tone: 'primary', disabled: busy || picking || !root.trim() || !validLimit || (needsAcknowledge && !acknowledge) }, busy ? '保存中…' : initial ? '确认并完成设置' : '保存设置')))));
    }
    function App({ onPickDirectory }) {
      const [snapshot, setSnapshot] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState(null);
      const [page, setPage] = useState('libraries');
      const [filter, setFilter] = useState('all');
      const [query, setQuery] = useState('');
      const [sort, setSort] = useState('updated');
      const [selectedId, setSelectedId] = useState(null);
      const [fileFilter, setFileFilter] = useState('all');
      const [fileQuery, setFileQuery] = useState('');
      const [detailTab, setDetailTab] = useState('files');
      const [modal, setModal] = useState(null);
      const [importState, setImportState] = useState(null);
      const [dragging, setDragging] = useState(false);
      const [pendingImport, setPendingImport] = useState(null);
      const [scanning, setScanning] = useState(null);
      const folderInputRef = useRef(null);
      const stopImport = useRef(false);
      const dragDepth = useRef(0);
      const inputRef = useRef(null);
      const mounted = useRef(true);
      const lock = useRef(false);
      const controllers = useRef(new Set());
      const currentSnapshot = useRef(snapshot);
      currentSnapshot.current = snapshot;
      const api = useCallback(async (action, payload) => {
        const controller = new AbortController(); controllers.current.add(controller);
        try { return await request(action, payload, controller.signal); } finally { controllers.current.delete(controller); }
      }, []);
      const refresh = useCallback(async () => {
        const data = await api('snapshot');
        if (!data || !data.settings || !Array.isArray(data.libraries) || !Array.isArray(data.workspaces)) throw new Error('资料库数据结构不完整，请检查插件后端版本。');
        if (mounted.current) { currentSnapshot.current = data; setSnapshot({ ...data, pending: data.pending || [] }); setSelectedId(previous => previous && data.libraries.some(l => l.id === previous) ? previous : null); }
        return data;
      }, [api]);
      useEffect(() => {
        mounted.current = true;
        refresh().catch(error => { if (mounted.current && error.name !== 'AbortError') setNotice({ type: 'error', text: error.message }); }).finally(() => { if (mounted.current) setLoading(false); });
        return () => { mounted.current = false; controllers.current.forEach(c => c.abort()); controllers.current.clear(); };
      }, [refresh]);
      const update = async (action, payload, message, closeModal = false) => {
        if (action === 'restoreLibrary') {
          const latest = currentSnapshot.current?.libraries.find(lib => lib.id === payload.libraryId);
          if (!latest || latest.deletePending) {
            setNotice({ type: 'error', text: '资料库已开始永久删除，文件可能残缺，不能恢复；请重试删除资料库。' });
            return false;
          }
        }
        if (lock.current) return false;
        lock.current = true; setBusy(true); setNotice(null);
        let committed = false; let refreshed;
        const permanent = action === 'purgeFile' || action === 'emptyTrash' || action === 'deleteLibrary';
        try {
          const result = await api(action, payload);
          if (permanent && result?.complete === false) throw new Error(action === 'deleteLibrary' ? `删除资料库未完成：${result.failed?.[0]?.message || '请检查目录占用或权限后重试。'}` : `永久删除未全部完成：已删除 ${result.deleted} 个，剩余 ${result.remaining} 个。${result.failed?.[0]?.message || '请检查文件占用或权限后重试。'}`);
          committed = true;
          refreshed = await refresh();
          const successMessage = action === 'deleteLibrary' && Number.isSafeInteger(result?.deletedFiles) ? `资料库“${result.name}”及其中 ${result.deletedFiles} 个文件已永久删除。` : action === 'trashAll' && Number.isSafeInteger(result?.moved) ? `已将 ${result.moved} 个文件移入回收区，可逐个恢复；未永久删除文件。` : message;
          if (mounted.current) { setNotice(permanent && result?.warnings?.length ? { type: 'warning', text: `${successMessage} ${result.warnings[0].message}` } : { type: 'success', text: successMessage }); if (closeModal) setModal(null); }
          return true;
        } catch (error) {
          const bulkMismatch = !committed && action === 'trashAll' && error.code === 'INVALID_REQUEST' && error.message === '未知资料库操作。';
          if ((permanent && !committed) || bulkMismatch) { try { refreshed = await refresh(); } catch {} }
          if (mounted.current && error.name !== 'AbortError') {
            const text = bulkMismatch ? `前后端版本不一致：当前后端未识别“全部移入回收区”。请完整退出 DSH（含托盘后台进程）再重新启动并刷新，不是仅停用启用插件；勿删除资料目录。后端版本：${backendVersionLabel(refreshed || snapshot)}。没有自动重发操作或降级为逐文件回收。` : committed ? `操作已提交，但刷新失败：${error.message}。请先刷新确认状态，避免重复提交。` : error.message;
            setNotice({ type: 'error', text });
            if (closeModal) { if (committed) setModal(null); else setModal(previous => previous ? { ...previous, library: refreshed?.libraries.find(lib => lib.id === previous.library?.id) || previous.library, error: text } : null); }
          }
          return false;
        } finally { lock.current = false; if (mounted.current) setBusy(false); }
      };
      const manualRefresh = async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true);
        try { await refresh(); setNotice(null); } catch (error) { if (mounted.current) setNotice({ type: 'error', text: error.message }); } finally { lock.current = false; if (mounted.current) setBusy(false); }
      };
      const libraries = snapshot ? snapshot.libraries : [];
      const filtered = libraries.filter(lib => (filter === 'all' || (filter === 'linked' && !lib.archived && !!lib.workspaceId) || (filter === 'unlinked' && !lib.archived && !lib.workspaceId) || (filter === 'archived' && lib.archived)) && `${lib.name} ${lib.workspaceTitle || ''} ${lib.path || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : sort === 'files' ? (b.files || []).filter(f => f.status !== 'trash').length - (a.files || []).filter(f => f.status !== 'trash').length : String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      const selected = filtered.find(l => l.id === selectedId) || filtered[0] || null;
      const activeId = selected ? selected.id : null;
      useEffect(() => { setPendingImport(null); dragDepth.current = 0; setDragging(false); setFileFilter('all'); setFileQuery(''); setDetailTab('files'); }, [activeId]);
      const openModal = (kind, lib, file) => { if (!busy) setModal({ kind, library: lib, file, nonce: Date.now() }); };
      const closeModal = () => { if (!busy) { setModal(null); } };
      const saveOriginal = async (lib, file) => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setNotice(null);
        const controller = new AbortController(); controllers.current.add(controller);
        try {
          await downloadFile(lib.id, file, controller.signal);
          if (mounted.current) setNotice({ type: 'success', text: '已发起原文件下载；不会打开或执行文件。' });
        } catch (error) { if (mounted.current && error.name !== 'AbortError') setNotice({ type: 'error', text: error.message }); }
        finally { controllers.current.delete(controller); lock.current = false; if (mounted.current) setBusy(false); }
      };
      const submitModal = async values => {
        if (modal.kind === 'trashAll' && snapshot.capabilities?.trashAll !== true) {
          setModal(previous => previous ? { ...previous, error: `${BULK_RESTART_NOTICE} 后端版本：${backendVersionLabel(snapshot)}` } : null);
          return;
        }
        const lib = modal.library;
        const cases = {
          create: ['create', { workspaceId: values.workspaceId, ...(values.name ? { name: values.name } : {}) }, '资料库已创建。'],
          link: ['link', { workspaceId: values.workspaceId, libraryId: values.libraryId }, '工作区关联已更新。'],
          rename: ['rename', { libraryId: lib && lib.id, name: values.name }, '资料库已重命名。'],
          archive: ['archive', { libraryId: lib && lib.id }, '资料库已停用，本地文件仍保留。'],
          unlink: ['unlink', { libraryId: lib && lib.id }, '已解除工作区关联，资料库仍保留。'],
          trash: ['trashFile', { libraryId: lib && lib.id, fileId: modal.file && modal.file.id, confirmation: values.confirmation }, '文件已移入插件回收区，可随时恢复。'],
          purge: ['purgeFile', { libraryId: lib && lib.id, fileId: modal.file && modal.file.id, confirmation: values.confirmation }, '库内文件副本已永久删除，来源文件未改动。'],
          emptyTrash: ['emptyTrash', { libraryId: lib && lib.id, confirmation: values.confirmation }, '此资料库回收区已清空，来源文件未改动。'],
          trashAll: ['trashAll', { libraryId: lib && lib.id, confirmation: values.confirmation }, '整库回收操作已提交，请核对文件列表；未永久删除文件。'],
          deleteLibrary: ['deleteLibrary', { libraryId: lib && lib.id, confirmation: values.confirmation }, '资料库及其本地文件已删除。']
        };
        const operation = cases[modal.kind]; if (operation) await update(...operation, true);
      };
      const importFiles = async (fileList, expectedLibraryId) => {
        const files = Array.from(fileList || []).map(item => item.file ? item : { file: item, sourcePath: item.webkitRelativePath || item.name });
        if (!files.length || !selected || selected.archived || !snapshot.settings.root || busy || lock.current || (expectedLibraryId && selected.id !== expectedLibraryId)) return;
        if (files.length > IMPORT_LIMITS.files || files.reduce((sum, item) => sum + item.file.size, 0) > IMPORT_LIMITS.bytes) { setNotice({ type: 'error', text: '本批次超过 2000 个文件或 5 GiB，请分批导入。' }); return; }
        const lib = selected; const caps = snapshot.capabilities || {}; const max = caps.maxFileBytes || 50 * 1024 ** 2;
        lock.current = true; stopImport.current = false; setBusy(true); setNotice(null); setPendingImport(null);
        const results = []; let succeeded = 0; let done = 0;
        setImportState({ done, total: files.length, current: '', results: [] });
        try {
          for (const { file, sourcePath } of files) {
            if (!mounted.current || stopImport.current) break;
            setImportState({ done, total: files.length, current: sourcePath, results: [...results] });
            try {
              if (file.size > max) throw new Error(`文件超过 ${bytes(max)} 上限。`);
              const controller = new AbortController(); controllers.current.add(controller);
              try { await uploadFile(lib.id, file, sourcePath, controller.signal); } finally { controllers.current.delete(controller); }
              succeeded += 1; results.push({ name: sourcePath, ok: true, message: '已保存' });
            } catch (error) { if (error.name === 'AbortError') break; results.push({ name: sourcePath, ok: false, message: error.message }); if (error.code === 'HOST_UNAVAILABLE') stopImport.current = true; }
            done += 1;
            if (mounted.current) setImportState({ done, total: files.length, current: '', results: [...results] });
          }
          try { await refresh(); } catch (error) { results.push({ name: '文件列表', ok: false, message: `刷新失败：${error.message}。请刷新确认，避免重复提交。` }); }
          if (mounted.current) { setImportState({ done, total: files.length, current: '', results: [...results] }); setNotice({ type: stopImport.current || results.some(r => !r.ok) ? 'warning' : 'success', text: `${stopImport.current ? '已停止后续导入' : '导入结束'}：${succeeded}/${files.length} 个文件已保存。已导入文件保留，供会话按需使用原文件。` }); }
        } finally { lock.current = false; if (mounted.current) setBusy(false); }
      };
      const prepareFolder = async selection => {
        if (!selected || selected.archived || !snapshot.settings.root || busy || lock.current || pendingImport) return;
        const libraryId = selected.id; lock.current = true; stopImport.current = false; setBusy(true); setNotice(null); setScanning({ visited: 0, count: 0 });
        try {
          const caps = snapshot.capabilities || {};
          const queue = await collectImport(selection, { maxBytes: caps.maxFileBytes || 50 * 1024 ** 2, cancelled: () => stopImport.current || !mounted.current, progress: (visited, count) => { if (mounted.current) setScanning({ visited, count }); } });
          if (mounted.current) setPendingImport({ ...queue, libraryId, libraryName: selected.name });
        } catch (error) { if (mounted.current) setNotice({ type: 'warning', text: `${error.message} 未开始上传。` }); }
        finally { lock.current = false; if (mounted.current) { setBusy(false); setScanning(null); } }
      };
      const hasFiles = transfer => !!transfer && (Array.from(transfer.types || []).includes('Files') || !!(transfer.files && transfer.files.length));
      const canImport = !!selected && !selected.archived && !!snapshot.settings.root && !busy && !modal && !pendingImport;
      const resetDrag = () => { dragDepth.current = 0; setDragging(false); };
      const dragOver = event => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = canImport && !lock.current ? 'copy' : 'none';
      };
      const dropFiles = async event => {
        if (!hasFiles(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation(); resetDrag();
        if (!canImport || lock.current) return;
        const items = Array.from(event.dataTransfer.items || []);
        const selection = items.filter(item => item.kind === 'file').map(item => {
          const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
          if (entry) return { entry };
          if (typeof item.getAsFileSystemHandle === 'function') return { handle: item.getAsFileSystemHandle().catch(error => ({ error })) };
          return { file: typeof item.getAsFile === 'function' ? item.getAsFile() : null };
        });
        if (selection.some(item => item.entry?.isDirectory || item.handle)) return prepareFolder(selection.filter(item => item.entry || item.handle || item.file));
        const files = Array.from(event.dataTransfer.files || []);
        if (!files.length && selection.length) { setNotice({ type: 'warning', text: '浏览器无法读取拖入内容，请使用“选择文件”或“选择文件夹”。未导入任何文件。' }); return; }
        await importFiles(files);
      };
      function renderDetail(lib) {
        const files = lib.files || [];
        const visibleFiles = files.filter(f => (detailTab === 'trash' ? f.status === 'trash' : f.status !== 'trash' && (fileFilter === 'all' || (fileFilter === 'stored' ? ['stored', 'ready', 'error'].includes(f.status) : f.status === fileFilter))) && `${f.name} ${f.sourcePath || ''}`.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase()));
        const trashCount = files.filter(f => f.status === 'trash').length;
        const activeCount = files.length - trashCount;
        const bulkSupported = snapshot.capabilities?.trashAll === true;
        const disabled = busy || lib.archived;
        return h('section', { className: 'lib-panel', 'aria-label': `${lib.name}详情` },
          h('div', { className: 'lib-detail-head' }, h('div', { className: 'lib-row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } }, h('h2', null, lib.name), h(Badge, { status: lib.archived ? 'excluded' : lib.workspaceId ? 'ready' : '' }, lib.archived ? '已停用' : lib.workspaceId ? '已关联' : '未关联')),
            h('p', { className: 'lib-muted lib-small', style: { marginTop: 8 } }, lib.workspaceId ? `工作区：${lib.workspaceTitle || lib.workspaceId}` : '未关联工作区'), h('p', { className: 'lib-path' }, lib.path), h('p', { className: 'lib-small lib-muted', style: { marginTop: 4 } }, `创建于 ${date(lib.createdAt)} · 更新于 ${date(lib.updatedAt)}`),
            h('div', { className: 'lib-actions', 'aria-label': '资料库操作' }, lib.archived ? h(Button, { tone: 'primary', disabled: busy || !!lib.deletePending, onClick: () => update('restoreLibrary', { libraryId: lib.id }, '资料库已恢复，请检查工作区关联状态。') }, '恢复资料库') : h(Button, { tone: 'primary', disabled: disabled || !snapshot.settings.root, onClick: () => inputRef.current && inputRef.current.click() }, '导入文件'),
              !lib.archived && (lib.workspaceId ? h(Button, { disabled: busy, onClick: () => openModal('unlink', lib) }, '解除关联') : h(Button, { disabled: busy || !snapshot.workspaces.some(w => !w.libraryId), onClick: () => openModal('link', lib) }, '关联工作区')),
              h(Button, { disabled: busy, onClick: () => openModal('rename', lib) }, '重命名'), !lib.archived && h(Button, { tone: 'quiet', disabled: busy, onClick: () => openModal('archive', lib) }, '停用'), lib.archived && h(Button, { tone: 'quiet', disabled: busy, onClick: () => openModal('deleteLibrary', lib) }, '删除资料库'))),
          h('div', { className: 'lib-detail-body' }, lib.archived && h(Notice, { notice: { type: 'warning', text: lib.deletePending ? '此资料库已开始永久删除，文件可能残缺，不能恢复或供 AI 参考；请点击“删除资料库”重试，继续清理剩余目录与记录。' : '此资料库已停用，不供 AI 参考。本地文件保留，恢复后可继续管理；不再需要时可删除资料库，将连同本地文件一起永久删除。' } }),
            detailTab === 'files' && h('div', { className: `lib-dropzone${dragging && canImport ? ' dragging' : ''}`, role: 'group', 'aria-label': '文件拖放导入', 'aria-disabled': !canImport, onDragOver: dragOver, onDragEnter: event => { if (!hasFiles(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); dragDepth.current += 1; if (canImport && !lock.current) setDragging(true); }, onDragLeave: event => { event.stopPropagation(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }, onDrop: dropFiles }, h('strong', null, lib.deletePending ? '资料库待续删，文件可能残缺且不能恢复' : lib.archived ? '资料库已停用，恢复后可导入文件' : busy ? '正在处理，请稍候再导入' : dragging ? `松开以导入“${lib.name}”` : '拖动文件或文件夹到这里导入'), h('p', { className: 'lib-small lib-muted' }, `任意格式文件均可保存；多文件和文件夹递归扫描后确认。单个不超过 ${bytes(snapshot.capabilities?.maxFileBytes || 50 * 1024 ** 2)}。每批最多 2000 个文件 / 5 GiB；跳过 .git、node_modules 等目录。`), h('div', { className: 'lib-row', style: { justifyContent: 'center' } }, h(Button, { small: true, disabled: !canImport, onClick: () => inputRef.current && inputRef.current.click() }, '选择文件'), h(Button, { small: true, disabled: !canImport, onClick: () => folderInputRef.current && folderInputRef.current.click() }, '选择文件夹'))),
            h('p', { className: 'lib-small lib-muted', style: { marginBottom: 12 } }, '导入仅保存原文件。PDF、Word、表格、图片可由宿主工具按需读取，实际能力取决于宿主；音视频暂无专门理解能力。保存不代表已理解文件内容。'),
            h('div', { className: 'lib-tabs', role: 'tablist', 'aria-label': '资料库详情视图' }, [['files', `文件 ${files.filter(f => f.status !== 'trash').length}`], ['trash', `回收区 ${trashCount}`]].map(([id, label]) => h('button', { key: id, type: 'button', role: 'tab', id: `dshlib-tab-${id}`, 'aria-selected': detailTab === id, 'aria-controls': 'dshlib-detail-panel', className: 'lib-tab', onClick: () => setDetailTab(id) }, label))),
            h('div', { id: 'dshlib-detail-panel', role: 'tabpanel', 'aria-labelledby': `dshlib-tab-${detailTab}` },
              h(React.Fragment, null,
                detailTab === 'files' && !bulkSupported && h(Notice, { notice: { type: 'warning', text: `${BULK_RESTART_NOTICE} 后端版本：${backendVersionLabel(snapshot)}` } }),
                detailTab === 'trash' && h('p', { className: 'lib-small lib-muted', style: { marginBottom: 12 } }, '此处是插件回收区，文件不供 AI 参考。恢复不等于重新上传；恢复后可再次供授权会话按需使用。'),
                h('div', { className: 'lib-toolbar' }, h('input', { className: 'lib-input lib-search', 'aria-label': '筛选文件名称', placeholder: '搜索文件名或来源相对路径', value: fileQuery, onChange: e => setFileQuery(e.target.value) }), detailTab === 'files' && h('select', { className: 'lib-select', 'aria-label': '文件状态筛选', value: fileFilter, onChange: e => setFileFilter(e.target.value) }, [['all', '全部状态'], ['stored', '已保存'], ['excluded', '已排除']].map(([id, label]) => h('option', { key: id, value: id }, label))), detailTab === 'files' && h(Button, { tone: 'danger', disabled: disabled || !activeCount || !bulkSupported, onClick: () => { if (!disabled && activeCount && bulkSupported) openModal('trashAll', lib); } }, '全部移入回收区'), detailTab === 'trash' && h(Button, { tone: 'danger', disabled: disabled || !trashCount, onClick: () => { if (!disabled && trashCount) openModal('emptyTrash', lib); } }, '清空回收区')),
                visibleFiles.length ? h('div', { className: 'lib-table-scroll' }, h('table', null, h('thead', null, h('tr', null, h('th', { scope: 'col' }, '文件'), h('th', { scope: 'col' }, '状态 / 大小'), h('th', { scope: 'col', style: { textAlign: 'right' } }, '操作'))), h('tbody', null, visibleFiles.map(file => h('tr', { key: file.id }, h('td', null, h('div', { className: 'lib-file-name' }, file.name), file.sourcePath && file.sourcePath !== file.name && h('div', { className: 'lib-small lib-muted lib-link-text' }, `来源：${file.sourcePath}`), h('div', { className: 'lib-small lib-muted' }, `更新于 ${date(file.updatedAt)}`)), h('td', null, h(Badge, { status: ['ready', 'error'].includes(file.status) ? 'stored' : file.status }), h('div', { className: 'lib-small lib-muted', style: { marginTop: 5 } }, bytes(file.size))), h('td', null, h('div', { className: 'lib-file-actions' }, file.status === 'trash' ? h(React.Fragment, null,
                    file.purgePending && h('span', { className: 'lib-small lib-muted' }, '删除待完成，不能恢复；请重试永久删除。'),
                    h(Button, { small: true, disabled: disabled || !!file.purgePending, onClick: () => { if (!disabled && !file.purgePending) update('restoreFile', { libraryId: lib.id, fileId: file.id }, `“${file.name}”已恢复。`); } }, '恢复'),
                    h(Button, { small: true, tone: 'danger', disabled, onClick: () => { if (!disabled) openModal('purge', lib, file); } }, file.purgePending ? '重试永久删除' : '永久删除')) : h(React.Fragment, null,
                   h(Button, { small: true, disabled: busy, onClick: () => saveOriginal(lib, file) }, '下载原文件'),
                  h(Button, { small: true, disabled, onClick: () => update('exclude', { libraryId: lib.id, fileId: file.id, excluded: file.status !== 'excluded' }, file.status === 'excluded' ? '文件已重新纳入 AI 参考。' : '文件已排除，不再供 AI 参考。') }, file.status === 'excluded' ? '纳入 AI 参考' : '排除 AI 参考'),
                  h(Button, { small: true, tone: 'quiet', disabled, onClick: () => openModal('trash', lib, file) }, '移入回收区'))))))))) : h(Empty, { title: detailTab === 'trash' ? '回收区为空' : files.some(f => f.status !== 'trash') ? '没有符合条件的文件' : '导入第一份资料', action: detailTab === 'files' && !files.some(f => f.status !== 'trash') && !lib.archived ? h(Button, { tone: 'primary', disabled: disabled || !snapshot.settings.root, onClick: () => inputRef.current && inputRef.current.click() }, '选择文件') : null }, detailTab === 'trash' ? '移入回收区的文件会在这里保留，供你恢复。' : '任意格式文件均可上传保存，使用时由宿主工具按需读取原文件。')))));
      }
      const allFiles = libraries.flatMap(l => l.files || []);
      return h('div', { className: 'dshlib', 'aria-busy': busy || loading }, h('style', null, CSS), h('main', { className: 'lib-wrap' },
        h('header', { className: 'lib-header' }, h('div', null, h('h1', null, TEXT.title), h('p', { className: 'lib-muted' }, TEXT.subtitle)), h('div', { className: 'lib-actions' }, h(Button, { disabled: busy || loading, onClick: manualRefresh }, busy && h('span', { className: 'lib-spinner', 'aria-hidden': true }), TEXT.refresh), h(Button, { disabled: busy || !snapshot, onClick: () => setPage(page === 'settings' ? 'libraries' : 'settings') }, page === 'settings' ? '返回资料库' : TEXT.settings), h(Button, { tone: 'primary', disabled: busy || !snapshot || !snapshot.settings.root || !snapshot.workspaces.some(w => !w.libraryId), onClick: () => openModal('create') }, '新建资料库'))),
        h('div', { className: 'lib-live', 'aria-live': 'polite' }, h(Notice, { notice, close: () => setNotice(null) })),
        loading ? h(Empty, { title: TEXT.loading }, '正在读取本地资料与工作区关联。') : !snapshot ? h(Empty, { title: '暂时无法读取资料库', action: h(Button, { tone: 'primary', disabled: busy, onClick: manualRefresh }, '重新加载') }, '请确认资料库后端已启用，然后重新加载。') : page === 'settings' ? h(Settings, { key: `${snapshot.settings.root}-${snapshot.settings.originalConsent}`, snapshot, busy, onPickDirectory, onBack: () => setPage('libraries'), onSave: async values => { if (await update('configure', values, '存储与隐私设置已保存。')) setPage('libraries'); } }) : h(React.Fragment, null,
          !snapshot.settings.root && h('div', { className: 'lib-notice warning' }, h('span', null, '首次使用：请先确认本地存储目录与模型文件内容发送设置，再创建资料库。'), h(Button, { tone: 'primary', small: true, onClick: () => setPage('settings') }, '前往设置')),
          snapshot.pending.length > 0 && h('div', { className: 'lib-notice warning lib-pending' }, h('div', null, h('strong', null, '部分工作区的资料库尚未就绪'), snapshot.pending.map((p, i) => h('p', { className: 'lib-small', key: p.workspaceId || i }, `${p.title || p.workspaceId}：${p.error || '等待创建或关联资料库'}`))), h(Button, { small: true, disabled: busy, onClick: manualRefresh }, '重新检查')),
          h('div', { className: 'lib-stats', 'aria-label': '资料库总览' }, [['活动资料库', libraries.filter(l => !l.archived).length], ['已关联工作区', libraries.filter(l => !l.archived && l.workspaceId).length], ['已保存文件', libraries.filter(l => !l.archived).flatMap(l => l.files || []).filter(f => f.status !== 'trash').length], ['本地文件体积', bytes(allFiles.reduce((sum, f) => sum + (f.size || 0), 0))]].map(([label, value]) => h('div', { className: 'lib-stat', key: label }, h('span', { className: 'lib-small lib-muted' }, label), h('strong', null, value)))),
          h('div', { className: 'lib-toolbar' }, h('input', { className: 'lib-input lib-search', value: query, 'aria-label': '搜索资料库、工作区或路径', placeholder: '搜索资料库、工作区或路径', onChange: e => setQuery(e.target.value) }), h('select', { className: 'lib-select', value: sort, 'aria-label': '资料库排序', onChange: e => setSort(e.target.value) }, h('option', { value: 'updated' }, '最近更新'), h('option', { value: 'name' }, '名称排序'), h('option', { value: 'files' }, '文件数量')), h('span', { className: 'lib-small lib-muted' }, `共 ${filtered.length} 个资料库`)),
          h('div', { className: 'lib-tabs', role: 'tablist', 'aria-label': '资料库分类' }, [['all', '全部'], ['linked', '已关联'], ['unlinked', '未关联'], ['archived', '停用']].map(([id, label]) => h('button', { key: id, type: 'button', className: 'lib-tab', role: 'tab', id: `dshlib-filter-${id}`, 'aria-controls': 'dshlib-libraries', 'aria-selected': filter === id, onClick: () => setFilter(id) }, label))),
          h('div', { id: 'dshlib-libraries', role: 'tabpanel', 'aria-labelledby': `dshlib-filter-${filter}` }, filtered.length ? h('div', { className: 'lib-layout' }, h('nav', { className: 'lib-list', 'aria-label': '资料库列表' }, filtered.map(lib => h('button', { type: 'button', key: lib.id, className: 'lib-library', 'aria-pressed': activeId === lib.id, disabled: busy, onClick: () => setSelectedId(lib.id) }, h('span', { className: 'lib-library-title' }, lib.name), h('span', { className: 'lib-small lib-muted lib-link-text' }, lib.deletePending ? '待续删 · 文件可能残缺，不可恢复' : lib.archived ? '已停用 · 保留本地文件' : lib.workspaceTitle || (lib.workspaceId ? lib.workspaceId : '未关联工作区')), h('span', { className: 'lib-library-meta' }, h('span', null, `${(lib.files || []).filter(f => f.status !== 'trash').length} 个文件`), h('span', null, date(lib.updatedAt)))))), selected && renderDetail(selected)) : h(Empty, { title: libraries.length ? TEXT.noMatch : TEXT.empty, action: !libraries.length && snapshot.settings.root && snapshot.workspaces.some(w => !w.libraryId) ? h(Button, { tone: 'primary', disabled: busy, onClick: () => openModal('create') }, '新建资料库') : libraries.length ? h(Button, { onClick: () => { setFilter('all'); setQuery(''); } }, '清除筛选') : null }, libraries.length ? '尝试调整搜索词或切换分类。' : snapshot.settings.root ? snapshot.workspaces.length ? '为未关联的工作区创建资料库，然后导入你的文档。' : '尚无工作区。请先在 DSH 创建工作区，再回到这里刷新。' : '先完成存储与隐私设置，资料将保存在你指定的本地目录。')),
          h('p', { className: 'lib-small lib-muted', style: { marginTop: 20 } }, `文件体积统计包含停用库和回收区。模型文件内容发送：${snapshot.settings.originalConsent ? '已授权' : '未授权'}；可在存储与隐私中修改。`)),
        scanning && h('section', { className: 'lib-panel', style: { padding: 16, marginTop: 20 }, 'aria-label': '扫描文件夹' }, h('h3', null, '正在扫描文件夹'), h('p', { role: 'status' }, `已检查 ${scanning.visited} 个条目，找到 ${scanning.count} 个可导入文件。尚未上传。`), h(Button, { small: true, onClick: () => { stopImport.current = true; } }, '取消扫描')),
        pendingImport && h(ImportPreview, { queue: pendingImport, busy, invalid: selected?.id !== pendingImport.libraryId || !!selected?.archived, onClose: () => setPendingImport(null), onConfirm: () => importFiles(pendingImport.files, pendingImport.libraryId) }),
        importState && h('section', { className: 'lib-panel', style: { padding: 16, marginTop: 20 }, 'aria-label': '导入结果' }, h('div', { className: 'lib-row', style: { justifyContent: 'space-between' } }, h('h3', null, `文件导入 ${importState.done}/${importState.total}`), busy && !scanning ? h(Button, { small: true, tone: 'quiet', onClick: () => { stopImport.current = true; setNotice({ type: 'info', text: '将在当前文件处理结束后停止。已导入文件不会删除。' }); } }, '停止后续导入') : !busy && h(Button, { small: true, tone: 'quiet', onClick: () => setImportState(null) }, '关闭')), h('progress', { value: importState.done, max: importState.total, 'aria-label': '导入进度' }), importState.current && h('p', { className: 'lib-small lib-muted' }, `正在处理：${importState.current}`), h('ul', { className: 'lib-import-log' }, importState.results.map((r, i) => h('li', { key: i, style: { color: r.ok ? 'var(--lib-muted)' : 'var(--lib-error)' } }, `${r.name}：${r.message}`)))),
        h('input', { ref: inputRef, type: 'file', multiple: true, hidden: true, disabled: !canImport, onChange: event => { const files = Array.from(event.target.files || []); event.target.value = ''; return importFiles(files); } }),
        h('input', { ref: folderInputRef, type: 'file', multiple: true, webkitdirectory: '', directory: '', hidden: true, disabled: !canImport, onChange: event => { const files = Array.from(event.target.files || []); event.target.value = ''; return prepareFolder(files.map(file => ({ file, sourcePath: file.webkitRelativePath || file.name }))); } }),
        snapshot && modal && h(Modal, { key: modal.nonce, modal, snapshot, busy, onClose: closeModal, onSubmit: submitModal })));
    }
    function ScopeDialog({ scope, snapshot, busy, error, onClose, onSave }) {
      const ref = useRef(null);
      const [mode, setMode] = useState(scope.mode || 'library');
      const [extraIds, setExtraIds] = useState((scope.libraryIds || []).filter(id => id !== scope.libraryId && snapshot.libraries.some(lib => lib.id === id && !lib.archived)));
      const [acknowledge, setAcknowledge] = useState(false);
      useEffect(() => {
        const dialog = ref.current; const previous = document.activeElement;
        if (dialog && !dialog.open) dialog.showModal();
        return () => { if (dialog && dialog.open) dialog.close(); if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus(); };
      }, []);
      const extras = snapshot.libraries.filter(lib => !lib.archived && lib.id !== scope.libraryId);
      const choose = (id, checked) => { setExtraIds(previous => checked ? [...previous, id] : previous.filter(value => value !== id)); setAcknowledge(false); };
      const invalid = (mode === 'library' && !scope.libraryId && !extraIds.length) || (extraIds.length > 0 && !acknowledge);
      return h('dialog', { ref, className: 'lib-dialog', 'aria-labelledby': 'dshlib-scope-title', onCancel: event => { event.preventDefault(); if (!busy) onClose(); } },
        h('form', { onSubmit: event => { event.preventDefault(); if (!busy && !invalid) return onSave({ mode, libraryIds: [scope.libraryId, ...extraIds].filter(Boolean) }); } },
          h('div', { className: 'lib-modal-head' }, h('h2', { id: 'dshlib-scope-title' }, '本会话资料范围'), h(Button, { tone: 'quiet', disabled: busy, 'aria-label': '关闭资料范围', onClick: onClose }, '×')),
          h('div', { className: 'lib-modal-body lib-form' },
            h('p', { className: 'lib-muted lib-small' }, '此设置仅作用于当前会话，不会跳转或修改其他会话。跨库文件使用需要在这里明确授权。'),
            h('fieldset', { style: { border: 0, padding: 0, margin: 0 }, disabled: busy }, h('legend', { style: { fontWeight: 600, marginBottom: 10 } }, '资料使用模式'),
              h('div', { className: 'lib-check', style: { marginBottom: 12 } }, h('input', { id: 'dshlib-mode-library', type: 'radio', name: 'dshlib-scope-mode', value: 'library', checked: mode === 'library', onChange: () => setMode('library') }), h('label', { htmlFor: 'dshlib-mode-library' }, '资料库模式', h('p', { className: 'lib-small lib-muted' }, '按需参考授权项目文件；缺少资料时可使用模型知识正常回答，并区分资料依据与模型知识。'))),
              h('div', { className: 'lib-check' }, h('input', { id: 'dshlib-mode-general', type: 'radio', name: 'dshlib-scope-mode', value: 'general', checked: mode === 'general', onChange: () => setMode('general') }), h('label', { htmlFor: 'dshlib-mode-general' }, '通用模式', h('p', { className: 'lib-small lib-muted' }, '不使用资料库；保留选库设置，供之后切回使用。')))),
            mode === 'general' && h('p', { className: 'lib-small lib-muted' }, '通用模式当前不使用资料库。以下范围会被保存，切回资料库模式时生效，仍需确认跨库授权。切换不会删除此前的会话附件或保证模型遗忘；若需严格隔离旧资料，请另开会话并选通用模式。'),
            h(React.Fragment, null,
              h('div', { className: 'lib-field' }, h('strong', null, '当前工作区资料库'), h('p', { className: 'lib-muted' }, scope.libraryId ? scope.libraryName || scope.libraryId : '当前工作区未关联资料库。请先关联，或显式选择其他资料库。')),
              h('fieldset', { style: { border: 0, padding: 0, margin: 0 }, disabled: busy }, h('legend', { style: { fontWeight: 600, marginBottom: 10 } }, '额外授权的跨库范围'), extras.length ? extras.map(lib => h('div', { key: lib.id, className: 'lib-check', style: { marginBottom: 10 } }, h('input', { id: `dshlib-extra-${lib.id}`, type: 'checkbox', checked: extraIds.includes(lib.id), onChange: event => choose(lib.id, event.target.checked) }), h('label', { htmlFor: `dshlib-extra-${lib.id}`, className: 'lib-link-text' }, lib.name, h('span', { className: 'lib-small lib-muted', style: { display: 'block' } }, lib.workspaceTitle ? `属于工作区：${lib.workspaceTitle}` : '未关联工作区')))) : h('p', { className: 'lib-small lib-muted' }, '没有其他可授权的活动资料库。')),
              extraIds.length > 0 && h('div', { className: 'lib-check' }, h('input', { id: 'dshlib-scope-ack', type: 'checkbox', checked: acknowledge, disabled: busy, onChange: event => setAcknowledge(event.target.checked) }), h('label', { htmlFor: 'dshlib-scope-ack' }, '我明确授权本会话使用上述跨库项目文件；在已允许模型文件内容发送时，按需读取的内容可能发送给当前模型服务。')),
              !scope.cloudConsent && h(Notice, { notice: { type: 'warning', text: '尚未授权向模型发送文件内容。保存范围不会代替隐私同意；模型不会通过此授权获得项目文件内容。请到资料库的“存储与隐私”中检查设置。' } })),
            error && h(Notice, { notice: { type: 'error', text: error } })),
          h('div', { className: 'lib-modal-foot' }, h(Button, { disabled: busy, onClick: onClose }, '取消'), h(Button, { type: 'submit', tone: 'primary', disabled: busy || invalid }, busy ? '保存中…' : '确认本会话范围'))));
    }
    function ScopeControl({ sessionId }) {
      const [scope, setScope] = useState(null);
      const [snapshot, setSnapshot] = useState(null);
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [feedback, setFeedback] = useState('');
      const alive = useRef(true);
      const sequence = useRef(0);
      const lock = useRef(false);
      const controllers = useRef(new Set());
      const api = useCallback(async (action, payload) => {
        const controller = new AbortController(); controllers.current.add(controller);
        try { return await request(action, payload, controller.signal); } finally { controllers.current.delete(controller); }
      }, []);
      useEffect(() => {
        alive.current = true; const serial = ++sequence.current; lock.current = false; setBusy(false); setOpen(false); setScope(null); setError(null); setFeedback('');
        if (sessionId) api('sessionScope', { sessionId }).then(value => { if (alive.current && sequence.current === serial) setScope(value); }).catch(reason => { if (alive.current && sequence.current === serial && reason.name !== 'AbortError') setError(reason.message); });
        return () => { alive.current = false; sequence.current += 1; controllers.current.forEach(c => c.abort()); controllers.current.clear(); };
      }, [sessionId, api]);
      const show = async () => {
        if (lock.current || !sessionId) return;
        const serial = sequence.current; lock.current = true; setBusy(true); setError(null); setFeedback('');
        try {
          const [value, data] = await Promise.all([api('sessionScope', { sessionId }), api('snapshot')]);
          if (alive.current && serial === sequence.current) { setScope(value); setSnapshot(data); setOpen(true); }
        } catch (reason) { if (alive.current && serial === sequence.current && reason.name !== 'AbortError') setError(reason.message); }
        finally { if (alive.current && serial === sequence.current) { lock.current = false; setBusy(false); } }
      };
      const save = async values => {
        if (lock.current) return;
        const serial = sequence.current; lock.current = true; setBusy(true); setError(null);
        let committed = false;
        try {
          await api('setSessionScope', { sessionId, ...values }); committed = true;
          const value = await api('sessionScope', { sessionId });
          if (alive.current && serial === sequence.current) { setScope(value); setOpen(false); setFeedback('本会话资料范围已保存。'); }
        } catch (reason) { if (alive.current && serial === sequence.current && reason.name !== 'AbortError') { setError(committed ? `范围已保存，但读取状态失败：${reason.message}。请关闭后重新打开确认。` : reason.message); if (committed) setOpen(false); } }
        finally { if (alive.current && serial === sequence.current) { lock.current = false; setBusy(false); } }
      };
      if (!sessionId) return null;
      const extraCount = scope ? (scope.libraryIds || []).filter(id => id !== scope.libraryId).length : 0;
      const label = busy ? '读取资料范围…' : !scope ? error ? '资料范围 · 重试' : '资料范围…' : scope.mode === 'general' ? '通用模式' : `${scope.libraryName || '资料库模式'}${extraCount ? ` +${extraCount}` : ''}`;
      return h('div', { className: 'dshlib', style: { height: 'auto', overflow: 'visible', background: 'transparent', display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' } }, h('style', null, CSS),
        h(Button, { small: true, tone: 'quiet', disabled: busy, onClick: show, title: scope ? `本会话：${scope.mode === 'general' ? '不使用资料库' : '按需参考项目文件'}。点击管理授权范围。` : '点击查看本会话资料范围', 'aria-haspopup': 'dialog', 'aria-label': `资料范围：${label}`, style: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' } }, h(Icon, { size: 15 }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label)),
        !open && error && h('span', { role: 'alert', className: 'lib-small', style: { color: 'var(--lib-error)', maxWidth: 240, overflowWrap: 'anywhere' } }, error),
        feedback && h('span', { role: 'status', className: 'lib-small lib-muted' }, feedback),
        open && scope && snapshot && h(ScopeDialog, { scope, snapshot, busy, error, onClose: () => { if (!busy) { setOpen(false); setError(null); } }, onSave: save }));
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        const onPickDirectory = async () => {
          const workspace = ctx.get('uiWorkspace');
          if (!workspace || typeof workspace.pickDirectory !== 'function') throw new Error('当前宿主未提供文件夹选择器');
          return workspace.pickDirectory();
        };
        function LibraryApp() { return h(App, { onPickDirectory }); }
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-library', order: 20, label: '资料库' }, Icon));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-library' }, LibraryApp));
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'dsh-library-scope', order: 80 }, ScopeControl));
      },
    };
  },
});
