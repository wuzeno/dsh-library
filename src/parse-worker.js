// Compatibility shim for an already-loaded pre-0.1.2 caller until DSH restarts.
// Never import PDF.js/native parsing code into this thread: delegate to the OS helper too.
import { parentPort, workerData } from 'node:worker_threads';
import { parseIsolated } from './parse.js';
try { parentPort.postMessage({ ok: true, value: await parseIsolated(workerData.buffer, workerData.extension) }); }
catch (error) { parentPort.postMessage({ ok: false, error: String(error.message || error).slice(0, 600) }); }
