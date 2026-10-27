import { parseDocument } from './documents.js';

// PDF.js may emit non-protocol log messages. Keep stdout exclusively for one bounded JSON reply.
for (const method of ['log', 'info', 'warn', 'debug', 'error']) {
  console[method] = (...args) => { try { process.stderr.write(args.map(String).join(' ').slice(0, 2000) + '\n'); } catch (_) {} };
}
const max = Number(process.argv[3]);
const extension = process.argv[2];
try {
  if (!Number.isInteger(max) || max < 1 || max > 200 * 1024 * 1024 || !['txt', 'md', 'docx', 'pdf'].includes(String(extension).toLowerCase().replace(/^\./, ''))) throw new Error('解析进程参数无效。');
  const chunks = []; let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > max) throw new Error('文件超过当前解析大小上限。');
    chunks.push(chunk);
  }
  if (!size) throw new Error('文件为空。');
  const result = await parseDocument(Buffer.concat(chunks, size), extension);
  result.warnings = (result.warnings || []).slice(0, 256).map(item => String(item).slice(0, 1000));
  process.stdout.write(JSON.stringify({ ok: true, value: result }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error.message || error).slice(0, 600) }));
}
// Natural termination: the parent waits for close before starting the next queued document.
