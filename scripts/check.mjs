import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'dsh-library');
assert.ok(manifest.engines.dsh && manifest.license === 'MIT');
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(manifest.dsh.client.platform, 'web');
assert.ok(!manifest.scripts.postinstall && !manifest.scripts.prepare, 'No installation-time scripts');
for (const filename of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'SECURITY.md', 'docs/releasing.md']) assert.ok((await stat(path.join(root, filename))).isFile(), filename);
for (const language of ['en', 'zh']) {
  const locale = JSON.parse(await readFile(path.join(root, 'locale', `${language}.json`), 'utf8'));
  assert.ok(locale.meta.title && locale.meta.description);
}
const icon = await readFile(path.join(root, 'icon.svg'), 'utf8');
assert.ok(icon.includes('<svg') && icon.includes('xmlns="http://www.w3.org/2000/svg"') && icon.trim().endsWith('</svg>'));
assert.ok(Buffer.byteLength(icon) < 262144 && !/<script|<foreignObject|href=/i.test(icon));
const patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8');
assert.ok(patch.includes('id: dsh-library') && patch.includes('name: dsh-library'));
const client = await readFile(path.join(root, 'client.js'), 'utf8');
// A temporary download anchor is allowed; the UI itself must remain in the host slot.
assert.ok(!client.includes('dangerouslySetInnerHTML') && !/createRoot\(document\.body|ReactDOM\.render\([^;]*document\.body/.test(client));
assert.ok(client.includes('anchor.remove()') && client.includes('URL.revokeObjectURL(url)'), 'Download anchors and object URLs must be released');
const files = ['index.js', 'client.js'];
for (const dir of ['src', 'test', 'scripts']) for (const entry of await readdir(path.join(root, dir))) if (/\.(mjs|js)$/.test(entry)) files.push(`${dir}/${entry}`);
for (const filename of files) {
  // Inherit stdio: compatible with Windows sandbox without child-process pipe capture.
  const result = spawnSync(process.execPath, ['--check', path.join(root, filename)], { stdio: 'inherit', cwd: root });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Syntax: ${filename}`);
}
console.log(`Checked ${files.length} JavaScript modules, bundle metadata, locales, and original SVG icon.`);

// The advertised backend version drifts the moment a release is cut; fail the check instead.
const http = await readFile(path.join(root, 'src', 'http.js'), 'utf8');
const advertised = http.match(/BACKEND_VERSION = '([^']+)'/)?.[1];
assert.equal(advertised, manifest.version, 'src/http.js BACKEND_VERSION must equal package.json version');
const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
assert.ok(changelog.includes(`## ${manifest.version} `), `CHANGELOG.md must have a section for ${manifest.version}`);
