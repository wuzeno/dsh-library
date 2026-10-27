import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ABSOLUTE_MAX_BYTES = 200 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const CHILD_URL = new URL('./parse-child.js', import.meta.url);
function validateInput(buffer, maxFileBytes) {
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > ABSOLUTE_MAX_BYTES) throw new Error('解析大小上限无效，绝对上限为 200 MiB。');
  if (!(buffer instanceof Uint8Array) || !buffer.byteLength || buffer.byteLength > maxFileBytes) throw new Error('解析输入为空或超过文件大小上限（绝对上限 200 MiB）。');
}
function childEnvironment() {
  // No DSH session/auth secrets or inherited NODE_OPTIONS are needed to parse document bytes.
  const env = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG', 'LC_ALL']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  // Desktop's executable is Electron, whose Node mode is also used by the DSH Host launcher.
  // This flag is harmless for a standalone Node executable and prevents opening a second GUI.
  env.ELECTRON_RUN_AS_NODE = '1';
  env.DISABLE_SYSTEM_FONTS_LOAD = '1';
  return env;
}
/** Trusted-code test seam; never exposed as a tool or an HTTP argument. */
export async function runParserProcess(buffer, extension, { maxFileBytes = ABSOLUTE_MAX_BYTES, timeoutMs = 30000, runnerURL = CHILD_URL } = {}) {
  validateInput(buffer, maxFileBytes);
  if (typeof extension !== 'string' || !['txt', 'md', 'docx', 'pdf'].includes(extension.toLowerCase().replace(/^\./, ''))) throw new Error('不支持的解析文件格式。');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('解析超时设置无效。');
  const runner = fileURLToPath(runnerURL);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=192', runner, extension, String(maxFileBytes)], {
      env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    const output = []; let outputBytes = 0; let errorBytes = 0; let failure;
    const fail = error => { if (!failure) failure = error; child.kill(); };
    const timer = setTimeout(() => fail(new Error(`文档解析超过 ${timeoutMs / 1000} 秒上限，已终止独立解析进程。请拆分文档后重试。`)), timeoutMs);
    child.once('error', error => { failure ||= new Error(`无法启动独立解析进程：${error.message}`); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') fail(new Error('向解析进程传送文件失败。')); });
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) { fail(new Error('独立解析进程输出超过安全上限。')); return; }
      output.push(chunk);
    });
    child.stderr.on('data', chunk => {
      // Always drain the pipe. Do not include document diagnostics/text or credentials in model errors.
      errorBytes = Math.min(16384, errorBytes + chunk.length);
    });
    // Resolve ONLY after actual process exit and pipe closure, never upon receiving a success message.
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) { reject(failure); return; }
      if (code !== 0 || signal) { reject(new Error(`独立文档解析进程异常退出（退出码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）。该文件未完成解析，已停止使用其结果；请保留文件并重试或反馈。`)); return; }
      try {
        const message = JSON.parse(Buffer.concat(output, outputBytes).toString('utf8'));
        if (message?.ok === false && typeof message.error === 'string') throw new Error(message.error.slice(0, 600));
        const value = message?.value;
        if (message?.ok !== true || !value || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > 4000 || !Array.isArray(value.warnings) || value.warnings.length > 256 || value.warnings.some(x => typeof x !== 'string' || x.length > 1000) || value.segments.some(x => !x || typeof x.text !== 'string' || x.text.length > 2000000 || typeof x.locator !== 'string' || x.locator.length > 1024)) throw new Error('独立解析进程返回的数据不正确。');
        resolve(value);
      } catch (error) { reject(error instanceof SyntaxError ? new Error('独立解析进程返回了无法识别的结果。') : error); }
    });
    child.stdin.end(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  });
}
/** An OS helper process contains native parser faults; a Worker thread cannot provide that boundary. */
export async function parseIsolated(buffer, extension, maxFileBytes = ABSOLUTE_MAX_BYTES) {
  validateInput(buffer, maxFileBytes);
  const timeoutMs = Math.min(120000, Math.max(30000, Math.ceil(buffer.byteLength / (1024 * 1024)) * 1000));
  return runParserProcess(buffer, extension, { maxFileBytes, timeoutMs });
}
