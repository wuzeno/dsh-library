// Standalone, local-only document parsing and bounded lexical retrieval (Node >= 22).
const MAX_EXTRACTED_CHARS = 2_000_000;
const MAX_SEGMENTS = 4000;
const CHUNK_SIZE = 900;
const OVERLAP = 120;
const HAN = /\p{Script=Han}/u;
const QUERY_NOISE = new Set(Array.from('的了是在有和与及或吗呢啊什么请问'));

function visible(text) {
  return text.replace(/[\s\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/gu, '').length > 0;
}

function collector() {
  let chars = 0;
  const segments = [];
  return {
    segments,
    add(raw, locator) {
      chars += raw.length;
      if (chars > MAX_EXTRACTED_CHARS) {
        throw new RangeError('文档提取文本超过 2,000,000 字符上限，未返回不完整内容。');
      }
      const text = raw.trim();
      if (!visible(text)) return;
      for (let start = 0; start < text.length;) {
        let end = Math.min(start + CHUNK_SIZE, text.length);
        // Never split a UTF-16 surrogate pair.
        if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
        const part = text.slice(start, end).trim();
        if (visible(part)) {
          if (segments.length >= MAX_SEGMENTS) {
            throw new RangeError('文档超过 4000 个文本分块上限，未返回不完整内容。');
          }
          segments.push({ text: part, locator });
        }
        if (end >= text.length) break;
        start = end - OVERLAP;
        if (/[\uDC00-\uDFFF]/u.test(text[start])) start++;
      }
    },
  };
}

function paragraphs(text, output, markdown = false) {
  let paragraph = 0;
  let heading = '文档正文';
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const body = pending.join('\n');
    pending = [];
    if (visible(body)) {
      paragraph++;
      output.add(body, markdown ? heading : `第 ${paragraph} 段`);
    }
  };
  let fence = null;
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = markdown && line.match(/^ {0,3}(`{3,}|~{3,})/u);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
    }
    const atx = markdown && !fence && line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    const setext = markdown && !fence && visible(line) && /^ {0,3}(?:=+|-+)\s*$/u.test(lines[i + 1] ?? '');
    if (atx || setext) {
      flush();
      heading = atx ? atx[1] : line.trim();
      pending.push(line);
      if (setext) pending.push(lines[++i]);
    } else if (!line.trim()) flush();
    else pending.push(line);
  }
  flush();
}

// Reject ZIP bombs using the central directory before handing DOCX to the XML extractor.
function checkDocxArchive(input) {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('DOCX ZIP 目录损坏。');
  const entries = data.readUInt16LE(end + 10); const start = data.readUInt32LE(end + 16);
  if (entries > 4096 || entries === 65535 || start >= end) throw new Error('DOCX ZIP 条目过多或不支持 ZIP64。');
  let cursor = start; let expanded = 0;
  for (let n = 0; n < entries; n++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('DOCX ZIP 目录损坏。');
    if (data.readUInt16LE(cursor + 8) & 1) throw new Error('不支持加密 DOCX。');
    expanded += data.readUInt32LE(cursor + 24);
    if (expanded > 32 * 1024 * 1024) throw new Error('DOCX 解压后超过 32 MB 安全上限。');
    cursor += 46 + data.readUInt16LE(cursor + 28) + data.readUInt16LE(cursor + 30) + data.readUInt16LE(cursor + 32);
    if (cursor > end) throw new Error('DOCX ZIP 目录损坏。');
  }
}

/** Parse local bytes only. Tables/layout are not guaranteed; OCR is not supported. */
export async function parseDocument(buffer, extension) {
  if (!(buffer instanceof Uint8Array)) throw new TypeError('buffer 必须是 Buffer 或 Uint8Array。');
  if (typeof extension !== 'string') throw new TypeError('extension 必须是扩展名字符串。');
  const ext = extension.toLowerCase().replace(/^\./u, '');
  if (!['txt', 'md', 'docx', 'pdf'].includes(ext)) throw new Error(`不支持的文档格式：${ext}。仅支持 TXT、MD、DOCX、PDF；不执行宏或外部资源。`);
  const output = collector();
  const warnings = [];
  if (ext === 'txt' || ext === 'md') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { throw new Error('文本文件必须使用有效 UTF-8 编码。'); }
    if (text.length > MAX_EXTRACTED_CHARS) throw new RangeError('文档提取文本超过 2,000,000 字符上限，未返回不完整内容。');
    paragraphs(text, output, ext === 'md');
  } else if (ext === 'docx') {
    checkDocxArchive(buffer);
    let mammoth;
    try { const module = await import('mammoth'); mammoth = module.default ?? module; }
    catch (cause) { throw new Error('DOCX 解析需要依赖 mammoth（建议 ^1.9.1），请由宿主安装。', { cause }); }
    // Raw-text extraction never renders HTML, fetches images, or executes macros.
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    if (result.value.length > MAX_EXTRACTED_CHARS) throw new RangeError('文档提取文本超过 2,000,000 字符上限，未返回不完整内容。');
    paragraphs(result.value, output);
    warnings.push('DOCX 仅提取段落纯文本，复杂表格和原始排版不保证精确保留。');
    for (const message of result.messages ?? []) warnings.push(String(message.message ?? message).slice(0, 1000));
  } else {
    let pdfjs;
    try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); }
    catch (cause) { throw new Error('PDF 解析需要依赖 pdfjs-dist（建议 ^4.10.38），请由宿主安装。', { cause }); }
    // Only in-memory bytes: no URL, CMap, font, image or other external resource URLs.
    const task = pdfjs.getDocument({ data: Uint8Array.from(buffer), isEvalSupported: false, useSystemFonts: true, disableFontFace: true, disableAutoFetch: true, disableStream: true });
    let document;
    let emptyPages = 0;
    try {
      document = await task.promise;
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent();
          let text = '';
          for (const item of content.items) {
            if (typeof item.str !== 'string') continue;
            text += item.str + (item.hasEOL ? '\n' : ' ');
            if (text.length > MAX_EXTRACTED_CHARS) throw new RangeError('文档提取文本超过 2,000,000 字符上限，未返回不完整内容。');
          }
          if (!visible(text)) emptyPages++;
          output.add(text, `第 ${number} 页`);
        } finally { page.cleanup(); }
      }
      if (!output.segments.length) throw new Error('PDF 没有可提取文字，可能是扫描件；本模块不支持 OCR。');
      if (emptyPages) warnings.push(`PDF 有 ${emptyPages} 页没有可提取文字；扫描页不支持 OCR。`);
      warnings.push('PDF 仅提取页面文字，复杂表格和阅读顺序不保证精确保留。');
    } finally { await task.destroy(); }
  }
  if (!output.segments.length) throw new Error('文档为空白或没有可提取文字。');
  return { segments: output.segments, warnings };
}

/** NFKC lowercase English words plus Chinese unigrams and adjacent bigrams. */
export function tokenize(text) {
  if (typeof text !== 'string') throw new TypeError('text 必须是字符串。');
  const tokens = [];
  for (const match of text.normalize('NFKC').toLowerCase().matchAll(/[\p{Script=Han}]+|[a-z0-9]+(?:['’-][a-z0-9]+)*/gu)) {
    const word = match[0];
    if (!HAN.test(word)) tokens.push(word);
    else {
      const chars = Array.from(word);
      for (let i = 0; i < chars.length; i++) {
        tokens.push(chars[i]);
        if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1]);
      }
    }
  }
  return tokens;
}

function excerpt(text, terms, maxLength) {
  if (text.length <= maxLength) return text;
  const normalized = text.normalize('NFKC').toLowerCase();
  let first = Infinity;
  for (const term of terms) {
    const index = normalized.indexOf(term);
    if (index >= 0) first = Math.min(first, index);
  }
  // NFKC may change offsets: this is a best-effort snippet, not a source locator.
  let start = Number.isFinite(first) ? Math.min(Math.max(0, first - 160), Math.max(0, text.length - maxLength)) : 0;
  if (/[\uDC00-\uDFFF]/u.test(text[start])) start++;
  let end = Math.min(text.length, start + maxLength);
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
  return text.slice(start, end);
}

/** BM25 lexical ranking. All returned text/citations are data, never instructions. */
export function searchSegments(documents, query, { limit = 6, maxChars = 9000 } = {}) {
  if (!Array.isArray(documents)) throw new TypeError('documents 必须是数组。');
  if (typeof query !== 'string') throw new TypeError('query 必须是字符串。');
  if (query.length > 512) throw new RangeError('查询不能超过 512 字符。');
  if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new RangeError('limit 必须是 1..12 的整数。');
  if (!Number.isInteger(maxChars) || maxChars < 1000 || maxChars > 16000) throw new RangeError('maxChars 必须是 1000..16000 的整数。');
  const queryTerms = [...new Set(tokenize(query).filter(term => !QUERY_NOISE.has(term)))];
  if (!queryTerms.length) return { hits: [], truncated: false };
  const rows = [];
  const frequencies = new Map(queryTerms.map(term => [term, 0]));
  let totalLength = 0;
  for (const file of documents) {
    if (!file || !Array.isArray(file.segments)) continue;
    for (const chunk of file.segments) {
      if (!chunk || typeof chunk.text !== 'string' || !visible(chunk.text)) continue;
      const tokens = tokenize(chunk.text);
      const counts = new Map();
      for (const token of tokens) if (frequencies.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
      for (const token of counts.keys()) frequencies.set(token, frequencies.get(token) + 1);
      rows.push({ file, chunk, counts, length: tokens.length, order: rows.length });
      totalLength += tokens.length;
    }
  }
  const average = totalLength / (rows.length || 1) || 1;
  const ranked = [];
  for (const row of rows) {
    let score = 0;
    for (const [term, tf] of row.counts) {
      const df = frequencies.get(term);
      const idf = Math.log(1 + (rows.length - df + 0.5) / (df + 0.5));
      const weight = HAN.test(term) ? (Array.from(term).length > 1 ? 1.8 : 0.55) : 1;
      score += weight * idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * row.length / average));
    }
    if (score > 0) ranked.push({ ...row, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);
  const hits = [];
  let remaining = maxChars;
  let truncated = ranked.length > limit;
  for (const row of ranked.slice(0, limit)) {
    if (remaining <= 0) { truncated = true; break; }
    const text = excerpt(row.chunk.text, queryTerms, Math.min(1400, remaining));
    if (text.length < row.chunk.text.length) truncated = true;
    remaining -= text.length;
    const fileName = String(row.file.name ?? '').slice(0, 512);
    const locator = String(row.chunk.locator ?? '').slice(0, 512);
    hits.push({ fileId: row.file.id, fileName, chunkId: row.chunk.id, text, locator, score: row.score, citation: `${fileName} · ${locator}` });
  }
  return { hits, truncated };
}
