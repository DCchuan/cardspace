"""Build a portable, explicit-allowlist source distribution. Never package user data."""
from pathlib import Path
import io
import zipfile
import sys
import os

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = (
    'LICENSE', 'README.md', 'README.en.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
    'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'requirements.txt',
    'requirements.lock.txt', 'pyproject.toml', '.env.example', '.gitignore',
    '启动 CardSpace.command',
)
CODE_DIRECTORIES = ('apps', 'packages', 'migrations', 'scripts', 'tests', '.github')
SUFFIXES = {'.py', '.ts', '.tsx', '.css', '.html', '.json', '.sql', '.md', '.mjs', '.sh', '.yml', '.yaml', '.toml'}
EXCLUDE_PARTS = {'node_modules', '.venv', 'dist', '__pycache__', '.git', 'output', '.pytest_cache'}
# Original pasted planning notes are not automatically published as project source.
PUBLIC_DOCS = ('MINIMAL_INTERACTION_PROPOSAL.md', 'ARCHITECTURE.md', 'DATA_MODEL.md', 'API_SPEC.md', 'SECURITY.md', 'IMPLEMENTATION.md', 'ACCEPTANCE.md', 'ADAPTERS.md', 'DESIGN.md', 'RELEASE.md', 'ADR/001-local-modular-monolith.md')


def source_files(root=ROOT):
    root = Path(root).resolve()
    data_dir=Path(os.environ['CARDSPACE_DATA_DIR']).expanduser().resolve() if os.getenv('CARDSPACE_DATA_DIR') else None
    candidates = [root / name for name in ROOT_FILES]
    for directory in CODE_DIRECTORIES:
        folder = root / directory
        if folder.is_dir():
            candidates.extend(p for p in folder.rglob('*') if p.suffix in SUFFIXES)
    candidates.extend(root / 'docs' / name for name in PUBLIC_DOCS)
    for path in sorted(set(candidates)):
        relative = path.relative_to(root)
        if data_dir and path.resolve().is_relative_to(data_dir):
            continue
        if relative.parts[0]=='apps' and path.suffix=='.json' and path.name not in {'package.json','package-lock.json','tsconfig.json','tsconfig.node.json','tsconfig.app.json'}:
            continue
        if any(part in EXCLUDE_PARTS for part in relative.parts):
            continue
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            continue
        # Even a symlinked parent must not pull unrelated workspace contents in.
        if any(parent.is_symlink() for parent in path.parents if parent != root):
            continue
        yield path, relative.as_posix()


def build_source_archive(root=ROOT):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, relative in source_files(root):
            archive.write(path, 'cardspace/' + relative)
    return output.getvalue()


if __name__ == '__main__':
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'output/cardspace-source.zip'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(build_source_archive())
    print(target)
