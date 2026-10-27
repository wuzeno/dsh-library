// Synthetic child-process protocol fixture. Never imports document parsers or native addons.
// This file is harmless when discovered by `node --test` without runner arguments.
if (process.argv.length >= 4) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const mode = Buffer.concat(chunks).toString('utf8');
  const validValue = { segments: [{ text: 'synthetic fixture', locator: '第 1 段' }], warnings: [] };
  const reply = value => process.stdout.write(JSON.stringify(value));
  switch (mode) {
    case 'echo':
      reply({ ok: true, value: { segments: [{ text: `${process.argv[2]}:${process.argv[3]}`, locator: 'fixture arguments' }], warnings: [] } });
      break;
    case 'failure':
      reply({ ok: false, error: 'synthetic parser rejection' });
      break;
    case 'exit-nonzero':
      process.exit(23);
      break;
    case 'success-then-nonzero':
      process.stdout.write(JSON.stringify({ ok: true, value: validValue }), () => process.exit(23));
      break;
    case 'simulated-native-exit':
      // Simulated abnormal status only. No abort, invalid memory access or native code.
      process.exit(139);
      break;
    case 'timeout':
      setInterval(() => {}, 1000);
      break;
    case 'success-then-timeout':
      reply({ ok: true, value: validValue });
      setInterval(() => {}, 1000);
      break;
    case 'success-delayed-exit': {
      const exitNotBefore = Date.now() + 400;
      reply({ ok: true, value: { segments: [{ text: String(exitNotBefore), locator: 'earliest exit timestamp' }], warnings: [] } });
      setTimeout(() => process.exit(0), 400);
      break;
    }
    case 'stdout-overflow': {
      const megabyte = Buffer.alloc(1024 * 1024, 0x78);
      for (let count = 0; count < 17; count++) {
        if (!process.stdout.write(megabyte)) {
          await new Promise(resolve => process.stdout.once('drain', resolve));
        }
      }
      break;
    }
    case 'stderr-overflow':
      process.stderr.write('x'.repeat(32 * 1024), () => process.exit(23));
      break;
    case 'invalid-json':
      process.stdout.write('{not JSON');
      break;
    case 'trailing-json':
      process.stdout.write(JSON.stringify({ ok: true, value: validValue }) + '\n{"unexpected":true}');
      break;
    case 'empty-output':
      break;
    case 'null-shape':
      reply(null);
      break;
    case 'missing-value':
      reply({ ok: true });
      break;
    case 'wrong-segments':
      reply({ ok: true, value: { segments: 'not an array', warnings: [] } });
      break;
    case 'wrong-segment-text':
      reply({ ok: true, value: { segments: [{ text: 123, locator: 'fixture' }], warnings: [] } });
      break;
    case 'wrong-warnings':
      reply({ ok: true, value: { segments: validValue.segments, warnings: 'not an array' } });
      break;
    case 'wrong-error':
      reply({ ok: false, error: { secret: 'not a string' } });
      break;
    default:
      throw new Error('Unknown synthetic fixture mode');
  }
}
