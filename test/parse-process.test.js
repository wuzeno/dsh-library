import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIsolated, runParserProcess } from '../src/parse.js';

// Only synthetic UTF-8 bytes are used. Native/PDF modules are never imported here.
const runnerURL = new URL('./fixtures/parser-protocol.mjs', import.meta.url);
const fixture = (mode, options = {}) => runParserProcess(Buffer.from(mode), 'txt', {
  maxFileBytes: 1024,
  timeoutMs: 5000,
  runnerURL,
  ...options,
});
const deadline = { timeout: 15000 };

test('parseIsolated parses synthetic TXT through the production process boundary', deadline, async () => {
  const result = await parseIsolated(Buffer.from('合成测试第一段\n\nsynthetic second paragraph'), 'txt');
  assert.deepEqual(result, {
    segments: [
      { text: '合成测试第一段', locator: '第 1 段' },
      { text: 'synthetic second paragraph', locator: '第 2 段' },
    ],
    warnings: [],
  });
});

test('runner supplies extension and byte limit in child arguments', deadline, async () => {
  const result = await fixture('echo', { maxFileBytes: 777 });
  assert.equal(result.segments[0].text, 'txt:777');
  assert.deepEqual(result.warnings, []);
});

test('runner propagates an explicit parser error', deadline, async () => {
  await assert.rejects(fixture('failure'), /synthetic parser rejection/);
});

for (const mode of ['exit-nonzero', 'simulated-native-exit', 'success-then-nonzero']) {
  test(`runner rejects ${mode} without treating stdout as successful completion`, deadline, async () => {
    await assert.rejects(fixture(mode), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /23|139|退出|exit|结束|异常/i);
      return true;
    });
  });
}

for (const mode of ['timeout', 'success-then-timeout']) {
  test(`runner kills ${mode} instead of hanging or returning premature success`, deadline, async () => {
    const start = Date.now();
    await assert.rejects(fixture(mode, { timeoutMs: 500 }), /超时|超过|timeout|timed out/i);
    assert.ok(Date.now() - start < 10000, 'timeout must bound child lifetime');
  });
}

test('runner waits for child close even after receiving a complete success envelope', deadline, async () => {
  const result = await fixture('success-delayed-exit');
  const earliestExit = Number(result.segments[0].text);
  assert.ok(Number.isFinite(earliestExit));
  assert.ok(Date.now() >= earliestExit - 10, 'success resolved before the child was scheduled to exit');
});

test('runner rejects stdout beyond 16 MiB', deadline, async () => {
  await assert.rejects(fixture('stdout-overflow'), /输出|stdout|16|上限|超过|过大|limit/i);
});

test('runner bounds error diagnostics from excessive child stderr', deadline, async () => {
  await assert.rejects(fixture('stderr-overflow'), error => {
    assert.ok(error instanceof Error);
    assert.ok(error.message.length < 20 * 1024, 'stderr must not be returned without a bound');
    return true;
  });
});

for (const mode of [
  'invalid-json', 'trailing-json', 'empty-output', 'null-shape', 'missing-value',
  'wrong-segments', 'wrong-segment-text', 'wrong-warnings', 'wrong-error',
]) {
  test(`runner rejects malformed helper response: ${mode}`, deadline, async () => {
    await assert.rejects(fixture(mode));
  });
}

test('runner rejects oversized synthetic input before parsing', deadline, async () => {
  await assert.rejects(runParserProcess(Buffer.from('too large'), 'txt', {
    maxFileBytes: 1, timeoutMs: 1000, runnerURL,
  }));
});
