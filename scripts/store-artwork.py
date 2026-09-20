#!/usr/bin/env python3
"""Render code-native store artwork and the real popup with empty local fixture data.

Requires Chrome/Chromium. No API key, live X content, or network service is used.
CHROME_BIN can override the default macOS Chrome path.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'store/artwork'
ASSETS = ROOT / 'store/assets'
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
ART.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)

def write(name, content):
    path = ART / name
    path.write_text(content, encoding='utf-8')
    return path

def render(name, width, height):
    target = ASSETS / f'{name}.png'
    # A stale image must never mask a failed render.
    target.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='xtags-artwork-') as profile:
        args = [CHROME, '--headless', '--disable-gpu', '--disable-background-networking',
                '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
                '--force-device-scale-factor=1', '--allow-file-access-from-files',
                f'--user-data-dir={profile}', f'--window-size={width},{height}',
                f'--screenshot={target}', '--virtual-time-budget=2000',
                (ART / f'{name}.html').as_uri()]
        with (Path(profile) / 'chrome.log').open('w') as log:
            proc = subprocess.Popen(args, stdout=log, stderr=log)
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

for name, width, height in [('promo-small', 440, 280), ('promo-marquee', 1400, 560)]:
    large = width > 500
    write(f'{name}.html', f'''<!doctype html><html lang="en"><meta charset="utf-8">
<title>Xtags promotional artwork</title><style>
*{{box-sizing:border-box}} body{{margin:0;width:{width}px;height:{height}px;overflow:hidden;
background:#0d454d;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
main{{height:100%;display:flex;align-items:center;justify-content:center;gap:{40 if large else 18}px;position:relative}}
main:before,main:after{{content:"";position:absolute;width:420px;height:420px;border:1px solid #407179;
border-radius:50%;right:-210px;top:-210px}}main:after{{width:560px;height:560px;right:-280px;top:-280px}}
.icon{{background:#edf8f5;border-radius:{32 if large else 22}px;width:{164 if large else 100}px;height:{164 if large else 100}px;
display:grid;place-items:center;z-index:1}}img{{width:{128 if large else 78}px;height:{128 if large else 78}px}}
h1{{font-size:{110 if large else 62}px;font-weight:650;letter-spacing:-.055em;margin:0;z-index:1}}
.signal{{position:absolute;bottom:{72 if large else 40}px;display:flex;gap:8px}}.signal i{{height:5px;width:{48 if large else 24}px;
border-radius:5px;background:#58b5c2}}.signal i:nth-child(2){{background:#d5eee7}}.signal i:nth-child(3){{background:#ef7970}}
</style><main><div class="icon"><img src="../assets/icon-128.png" alt=""></div><h1>Xtags</h1>
<div class="signal"><i></i><i></i><i></i></div></main></html>''')
    render(name, width, height)

manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
popup = (ROOT / 'extension/popup.html').read_text().replace('src="service.js"', 'src="../../extension/service.js"')
settings = (ROOT / 'extension/settings.html').read_text().replace('src="service.js"', 'src="../../extension/service.js"')
for locale in ['en', 'zh-CN']:
    lang = 'en' if locale == 'en' else 'zh'
    mock = '''<script>
globalThis.chrome={i18n:{getUILanguage:()=>LANG},runtime:{getManifest:()=>MANIFEST},
storage:{local:{get:async defaults=>({...defaults,language:LANG}),set:async()=>{}},
onChanged:{addListener:()=>{}}}};
</script>'''.replace('LANG', json.dumps(lang)).replace('MANIFEST', '(' + json.dumps(manifest) + ')')
    fixture = popup.replace('<script src="i18n.js"></script>', mock + '<script src="../../extension/i18n.js"></script>')
    fixture = fixture.replace('<script src="popup.js"></script>', '<script src="../../extension/popup.js"></script>')
    write(f'popup-{locale}.html', fixture)
    settings_fixture = settings.replace('<script src="i18n.js"></script>', mock + '<script src="../../extension/i18n.js"></script>')
    settings_fixture = settings_fixture.replace('<script src="settings.js"></script>', '<script src="../../extension/settings.js"></script>')
    write(f'screenshot-settings-{locale}.html', settings_fixture)
    render(f'screenshot-settings-{locale}', 1280, 800)
    title = 'Your everyday<br>controls.' if lang == 'en' else '常用操作，<br>一触即达。'
    desc = 'A compact popup.<br>A dedicated page for setup.' if lang == 'en' else '弹窗保留常用开关，<br>配置移至独立设置页。'
    note = 'TypeSafe is the default API service.<br>Compatible custom HTTPS APIs are supported.<br>AI estimates can be incorrect.' if lang == 'en' else '默认使用 TypeSafe 官方服务。<br>支持兼容的自定义 HTTPS API。<br>AI 估计可能有误。'
    write(f'screenshot-popup-{locale}.html', f'''<!doctype html><html lang="{locale}"><meta charset="utf-8">
<title>Xtags settings</title><style>
*{{box-sizing:border-box}}body{{margin:0;width:1280px;height:800px;overflow:hidden;background:#e9f3ee;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;color:#153e3f}}
.copy{{position:absolute;left:82px;top:94px;width:615px}}.brand{{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:600}}
.brand img{{width:40px;height:40px}}h1{{font-size:58px;line-height:1.12;letter-spacing:-.04em;margin:65px 0 26px;font-weight:650}}
.desc{{font-size:26px;line-height:1.65;color:#486864}}.note{{font-size:16px;line-height:1.75;margin-top:52px;color:#47645f}}
.popup{{position:absolute;left:753px;top:84px;width:392px;height:635px;background:white;border:1px solid #cbded6;
border-radius:14px;box-shadow:0 22px 44px #183f3b18;padding:14px 15px}}iframe{{display:block;width:360px;height:601px;border:0}}
</style><div class="copy"><div class="brand"><img src="../assets/icon-128.png" alt="">Xtags</div>
<h1>{title}</h1><div class="desc">{desc}</div><div class="note">{note}</div></div>
<div class="popup"><iframe title="Xtags popup" src="popup-{locale}.html"></iframe></div></html>''')
    render(f'screenshot-popup-{locale}', 1280, 800)

# Visual check of an unsaved custom-service draft; no network request is performed.
custom = (ART / 'screenshot-settings-zh-CN.html').read_text()
custom = custom.replace('</body>', '<script>document.getElementById("provider").value="custom";document.getElementById("provider").dispatchEvent(new Event("change"));document.getElementById("apiEndpoint").value="https://api.example.com/v1/systemone";document.getElementById("apiEndpoint").dispatchEvent(new Event("input"));</script></body>')
write('screenshot-service-custom-zh-CN.html', custom)
render('screenshot-service-custom-zh-CN', 1280, 800)
