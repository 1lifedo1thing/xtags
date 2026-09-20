#!/usr/bin/env python3
"""Render store-sized HTML frames around the unchanged user-provided screenshot."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
for locale in ('zh-CN', 'en'):
    target = ROOT / f'store/assets/screenshot-labels-{locale}.png'
    target.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='xtags-label-artwork-') as profile:
        with (Path(profile) / 'chrome.log').open('w') as log:
            proc = subprocess.Popen([
                CHROME, '--headless', '--disable-gpu', '--disable-background-networking',
                '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
                '--force-device-scale-factor=1', '--allow-file-access-from-files',
                f'--user-data-dir={profile}', '--window-size=1280,800',
                f'--screenshot={target}', '--virtual-time-budget=2000',
                (ROOT / f'store/artwork/screenshot-labels-{locale}.html').as_uri(),
            ], stdout=log, stderr=log)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
        if not target.is_file():
            raise RuntimeError((Path(profile) / 'chrome.log').read_text())
    print(target.relative_to(ROOT))
