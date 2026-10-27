// Local-only diagnostic: never prints extracted text or changes the source document.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseIsolated } from '../src/parse.js';
const filename = process.argv[2];
if (!filename) throw new Error('Supply one local document path explicitly.');
const info = await stat(filename);
if (!info.isFile() || info.size > 200 * 1024 * 1024) throw new Error('Expected one file within the absolute 200 MiB input limit.');
const start = Date.now();
try {
  const result = await parseIsolated(await readFile(filename), path.extname(filename).toLowerCase());
  console.log(JSON.stringify({ ok: true, bytes: info.size, segments: result.segments.length, warningCount: result.warnings.length, elapsedMs: Date.now() - start }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, bytes: info.size, message: error.message, elapsedMs: Date.now() - start }));
  process.exitCode = 1;
}
