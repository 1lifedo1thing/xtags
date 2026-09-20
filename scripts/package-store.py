#!/usr/bin/env python3
"""Build an allowlisted, deterministic Chrome Web Store candidate package."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'extension'
STORE = ROOT / 'store'
manifest = json.loads((EXT / 'manifest.json').read_text())
assert manifest['manifest_version'] == 3
files = ['manifest.json', 'service.js', 'background.js', 'content.js', 'popup.html', 'popup.js', 'settings.html', 'settings.js', 'i18n.js']
files += [f'icons/{state}/icon{size}.png' for state in ('on', 'off') for size in (16, 32, 48, 128)]
files += [f'_locales/{locale}/messages.json' for locale in ('en', 'zh_CN', 'zh_TW')]
# Offline policy links must work before the public GitHub Pages deployment.
files += [f'privacy/{name}' for name in ('index.html', 'privacy.html', 'privacy.zh-CN.html',
                                       'support.html', 'styles.css', 'assets/icon-128.png')]
refs = [manifest['background']['service_worker'], manifest['action']['default_popup'], manifest['options_ui']['page']]
refs += list(manifest['icons'].values()) + list(manifest['action']['default_icon'].values())
refs += [path for script in manifest['content_scripts'] for path in script['js']]
assert all(path in files for path in refs)
assert f"_locales/{manifest['default_locale']}/messages.json" in files
for path in files:
    assert (EXT / path).is_file(), path
    if path.endswith('.json'):
        json.loads((EXT / path).read_text())
STORE.mkdir(exist_ok=True)
target = STORE / f"xtags-{manifest['version']}-chrome-web-store.zip"
sources = {path: EXT / path for path in files}
sources['LICENSE'] = ROOT / 'LICENSE'
with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, source in sorted(sources.items()):
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, source.read_bytes())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read('manifest.json')) == manifest
report = {
    'version': manifest['version'], 'package': target.name,
    'status': 'candidate; see PRE_SUBMISSION.md before submission',
    'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size,
    'checks': {'manifest_at_root': True, 'manifest_references_present': True,
               'locales_parse': True, 'license_included': True, 'zip_integrity': True,
               'runtime_allowlist_only': True},
    'files': [{'path': name, 'bytes': source.stat().st_size,
               'sha256': hashlib.sha256(source.read_bytes()).hexdigest()}
              for name, source in sorted(sources.items())]
}
(STORE / 'package-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}, indent=2))
