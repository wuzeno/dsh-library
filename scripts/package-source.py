"""Create the public source archive and checksums from an explicit allow-list."""
from pathlib import Path
import hashlib
import json
import tarfile
import zipfile

root = Path(__file__).resolve().parent.parent
release = root / 'release'
release.mkdir(exist_ok=True)
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
package = release / f'dsh-library-{version}.tgz'
fixed = {'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.gitignore', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md'}
allowed = {'src': {'.js'}, 'test': {'.js', '.mjs'}, 'scripts': {'.mjs', '.py'}, 'docs': {'.md', '.jpg'}, 'locale': {'.json'}, '.github': {'.yml', '.yaml', '.md'}}
blocked = {'node_modules', '__pycache__', '.git', '.dsh', 'data', 'libraries', 'release', 'credentials', 'secrets'}

def safe(relative):
    return not any(part.lower() in blocked or part.lower().startswith(('.env', '.test-data-', '.host-test-')) for part in relative.parts)

files = set(fixed)
for folder, suffixes in allowed.items():
    for path in (root / folder).rglob('*'):
        relative = path.relative_to(root)
        if path.is_file() and safe(relative) and path.suffix.lower() in suffixes:
            assert not path.is_symlink() and path.resolve().is_relative_to(root)
            files.add(relative.as_posix())

with tarfile.open(package, 'r:gz') as archive:
    for member in archive.getmembers():
        relative = Path(member.name)
        assert relative.parts[0] == 'package' and '..' not in relative.parts and safe(relative), member.name
        assert member.isfile() or member.isdir(), member.name
        if member.isfile():
            assert Path(*relative.parts[1:]).as_posix() in files, member.name
    packed = json.load(archive.extractfile('package/package.json'))
    assert packed['version'] == version
    assert b'export const inject = ' in archive.extractfile('package/index.js').read()

source = release / f'dsh-library-{version}-source.zip'
with zipfile.ZipFile(source, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        assert (root / name).resolve().is_relative_to(root)
        archive.write(root / name, 'dsh-library/' + name)
checksums = release / f'dsh-library-{version}-SHA256SUMS.txt'
checksums.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in (package, source)), encoding='utf-8')
print(json.dumps({'version': version, 'source_files': len(files), 'artifacts': [p.name for p in (package, source, checksums)]}))
