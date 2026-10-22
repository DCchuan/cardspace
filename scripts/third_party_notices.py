"""Rebuild acknowledgements from the installed dependency metadata and license files."""
from pathlib import Path
import importlib.metadata
import json
import re

ROOT = Path(__file__).resolve().parents[1]
sections = ['# Third-party notices\n\nCardSpace 本身采用 MIT；依赖保留各自的许可证和版权。以下归属由已安装依赖生成。源码包不包含依赖实现，生产构建分发时应一并保留此文件。\n']
node_modules = ROOT / 'apps/web/node_modules'
seen = set()
for path in sorted(node_modules.rglob('package.json')):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        continue
    name, version = data.get('name'), data.get('version')
    if not name or not version or (name, version) in seen:
        continue
    seen.add((name, version))
    license_name = data.get('license', 'See package license')
    texts = []
    for license_file in sorted(path.parent.iterdir()):
        if license_file.is_file() and re.match(r'(?i)^(license|licence|copying|notice)(\..*)?$', license_file.name):
            texts.append(license_file.read_text(errors='replace'))
    sections.append(f'\n## npm: {name} {version}\n\nLicense: {license_name}\n')
    for text in texts:
        sections.append('\n```text\n' + text.rstrip() + '\n```\n')
for dist in sorted(importlib.metadata.distributions(), key=lambda d:d.metadata.get('Name','').lower()):
    name = dist.metadata.get('Name', 'Unknown')
    if name.lower() in ('pip', 'setuptools'):
        continue
    license_name = dist.metadata.get('License-Expression') or dist.metadata.get('License') or 'See distribution license'
    sections.append(f'\n## Python: {name} {dist.version}\n\nLicense: {license_name}\n')
    for relative in dist.files or []:
        parts = Path(str(relative)).parts
        if any(p.endswith('.dist-info') for p in parts) and re.match(r'(?i)^(license|licence|copying|notice)(\..*)?$', parts[-1]):
            path = Path(dist.locate_file(relative))
            if path.is_file():
                sections.append('\n```text\n' + path.read_text(errors='replace').rstrip() + '\n```\n')
(ROOT / 'THIRD_PARTY_NOTICES.md').write_text('\n'.join(sections))
print(f'Generated notices for {len(seen)} npm packages and installed Python dependencies')
