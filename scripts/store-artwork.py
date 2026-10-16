#!/usr/bin/env python3
"""Reproducible 0.2.1 store art using packaged UI and content scripts.

Self-authored demonstration posts and mocked scores, clearly marked in each image.
Isolated Chrome profile, no API calls, credentials or real X content.
"""
import html
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'store/artwork'
ASSETS = ROOT / 'store/assets'
CHROME = os.environ.get('CHROME_BIN', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
ART.mkdir(parents=True, exist_ok=True)
ASSETS.mkdir(parents=True, exist_ok=True)
shutil.copyfile(ROOT / 'extension/icons/on/icon128.png', ASSETS / 'icon-128.png')

def write(name, text):
    path = ART / f'{name}.html'
    path.write_text(text, encoding='utf-8')
    return path

def render(name, width=1280, height=800):
    target = ASSETS / f'{name}.png'
    target.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix='xtags-artwork-') as profile:
        args = [CHROME, '--headless', '--disable-gpu', '--disable-background-networking',
                '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
                '--force-device-scale-factor=1', '--allow-file-access-from-files',
                f'--user-data-dir={profile}', f'--window-size={width},{height}',
                f'--screenshot={target}', '--virtual-time-budget=2500',
                (ART / f'{name}.html').as_uri()]
        with (Path(profile) / 'chrome.log').open('w') as log, (Path(profile) / 'dom.html').open('w') as dom:
            args.insert(1, '--dump-dom')
            proc = subprocess.Popen(args, stdout=dom, stderr=log)
            try:
                proc.wait(timeout=25)
            except subprocess.TimeoutExpired:
                proc.terminate()
                try: proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()
            if not target.is_file():
                raise RuntimeError((Path(profile) / 'chrome.log').read_text())
            if name.startswith('screenshot-ai-'):
                assert 'data-artwork-ready="true"' in (Path(profile) / 'dom.html').read_text(), f'Unrendered or invalid fixture: {name}'
    assert struct.unpack('>II', target.read_bytes()[16:24]) == (width, height), name
    print(target.relative_to(ROOT), flush=True)

FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif'
CSS = '''*{box-sizing:border-box}body{margin:0;width:1280px;height:800px;overflow:hidden;background:#fffaf8;color:#18191d;font-family:FONTS}
.brand{position:absolute;left:56px;top:35px;display:flex;gap:10px;align-items:center;font-size:23px;font-weight:750;letter-spacing:-.6px}.brand img{width:30px;height:30px}.edition{position:absolute;right:56px;top:43px;color:#767276;font-size:13px;letter-spacing:1px}
h1{font-size:49px;line-height:1.15;letter-spacing:-1.8px;margin:0;font-weight:760}.intro{position:absolute;left:56px;top:108px}.intro p{font-size:20px;color:#6f6869;margin:17px 0 0;line-height:1.5}.accent{color:#bf453e}
.stage{position:absolute;left:56px;right:56px;top:290px;bottom:68px;display:flex;gap:24px}.frame{background:white;border:1px solid #e8dfdb;border-radius:20px;overflow:hidden;box-shadow:0 15px 35px #4b20100a}.bar{height:43px;display:flex;align-items:center;gap:6px;padding:0 18px;border-bottom:1px solid #eee8e5;font-size:12px;color:#857e7e}.bar i{display:block;width:7px;height:7px;border-radius:50%;background:#ddd5d2}.bar span{margin-left:12px}iframe{display:block;border:0;background:white}.note{position:absolute;left:56px;right:56px;bottom:25px;color:#7d7270;font-size:12px;display:flex;justify-content:space-between}.side{width:244px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;gap:26px}.point small{color:#c95b50;font-size:12px;font-weight:700;letter-spacing:1px}.point h2{font-size:23px;line-height:1.3;margin:8px 0}.point p{font-size:15px;line-height:1.65;color:#7b7270;margin:0}.feed{flex:1;min-width:0}.feed iframe{width:760px;height:420px;transform:scale(1.13);transform-origin:top left}.pair{flex:1;min-width:0}.pair iframe{width:560px;height:430px}.tag{font-size:13px;display:inline-block;color:#b9443e;background:#ffebe6;padding:6px 11px;border-radius:30px}.legend{display:flex;gap:12px;margin-top:18px}.popup-frame{width:395px;flex-shrink:0}.popup-frame iframe{width:360px;height:398px;margin-left:16px}.settings-frame{flex:1}.settings-frame iframe{width:100%;height:250px}.settings-frame .explain{padding:14px 25px;font-size:16px;line-height:1.7;color:#716968;border-top:1px solid #eee8e5}.settings-frame .explain b{color:#b9443e}
'''.replace('FONTS', FONT)
FEED_CSS = '''*{box-sizing:border-box}body{margin:0;background:white;color:#15191e;font:16px/1.6 FONTS}article{padding:16px 22px;border-bottom:1px solid #eff0f1}header{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:14px}a{color:inherit;text-decoration:none}header>a:first-child{font-weight:750}time,.handle{font-size:12px;color:#687481}.body{padding-top:10px;font-size:17px;line-height:1.65}.actions{color:#7e8a94;font-size:12px;padding-top:15px;display:flex;justify-content:space-between;max-width:420px}.more{color:#1d9bf0;font-size:14px;margin-top:5px}.media{height:100px;border-radius:12px;background:linear-gradient(110deg,#eef1ed,#e0e8df);display:flex;align-items:center;justify-content:center;color:#667261;font-size:14px;margin-top:12px}'''.replace('FONTS', FONT)
DATA = {
 'zh-CN': [
  ('随手记录','notes','10 分钟','今天沿河走了四公里，发现桥下新开了一家面包店。明早准备再去试试。'),
  ('效率观察','worknotes','18 分钟','在这个快速变化的时代，效率已成为每个人的必修课。以下三个关键策略，将帮助你重塑工作方式：明确目标、优化流程、持续复盘。让我们一起开启高效生活的新篇章！'),
  ('周末手记','weekend','26 分钟','周末修好了用了五年的台灯。原来只是开关接触不良，换一个小零件就又能用了。'),
  ('每日灵感','dailyideas','35 分钟','真正的成长，不在于一夜之间的蜕变，而在于日复一日的积累。拥抱变化，突破边界，成为更好的自己。')],
 'en': [
  ('Field Notes','notes','10m','Walked along the river this morning. A new bakery has opened under the bridge. Going back tomorrow.'),
  ('Work Notes','worknotes','18m',"In today's fast-paced world, productivity is essential. Three key strategies can transform your workflow: set clear goals, optimize your process, and reflect consistently. Let's unlock your full potential!"),
  ('Weekend Log','weekend','26m','Fixed my five-year-old desk lamp. It was just a loose switch. One small spare part and it works again.'),
  ('Daily Ideas','dailyideas','35m','Real growth is not an overnight transformation. Embrace change, push boundaries, and become your best self, one day at a time.')]
}
SOURCES = '\n'.join((ROOT / 'extension' / n).read_text() for n in ('fulltext.js','service.js','i18n.js','content.js'))

def make_feed(locale, variant):
    rows = DATA[locale]
    indices = [1] if variant in ('closed','open','long') else [0,1,2]
    articles=[]
    for index in indices:
        name,handle,time,text=rows[index]
        more=''
        if variant=='long':
            text = ('在这个快速变化的时代，效率已成为每个人的必修课。以下是我的三个建议……' if locale=='zh-CN' else "In today's fast-paced world, productivity is essential. Here are three strategies to transform your workflow…")
            more='<div class="more" data-testid="tweet-text-show-more-link">'+('显示更多' if locale=='zh-CN' else 'Show more')+'</div>'
        articles.append(f'<article data-testid="tweet"><header><a href="/{handle}">{name}</a><span class="handle">@{handle}</span><a href="/{handle}/status/{101+index}"><time>{time}</time></a></header><div class="body" data-testid="tweetText">{html.escape(text)}</div>{more}<div class="actions"><span>♡ 12</span><span>↻ 3</span><span>↗ 108</span></div></article>')
    cfg={'hasKey':True,'enabled':variant!='before','consentVersion':2,'showHud':False,'skipReplies':False,'language':'zh' if locale=='zh-CN' else 'en','aiMode':'label' if variant=='long' else 'collapse'}
    mock='''globalThis.chrome={i18n:{getUILanguage:()=>LOCALE},storage:{session:{onChanged:{addListener:()=>{}}}},runtime:{sendMessage:(msg,cb)=>{if(msg.type==="xtags-config"){cb({ok:true,data:CONFIG});return;}if(msg.type==="jev-cancel"){cb({ok:true});return;}setTimeout(()=>cb({ok:true,data:{answers:{intent:{choice:"inform",confidence:.86,probabilities:{inform:.86}},rage_bait:{noul:.12},undisclosed_ad:{noul:.08},synthetic:{noul:msg.id==="102"?.94:msg.id==="104"?.91:.17}},usage:{input_tokens:120}}}),0);}}};'''.replace('LOCALE',json.dumps(locale)).replace('CONFIG',json.dumps(cfg))
    code=mock
    if variant=='long':
        text=DATA[locale][1][3]+'\n\n'+('第一，列出今天最重要的任务。第二，减少重复劳动。第三，定期复盘并优化流程。' if locale=='zh-CN' else 'First, identify your most important task. Second, reduce repetitive work. Third, review your progress and refine your process.')
        code+='document.querySelector("article").__reactFiber$demo={memoizedProps:{tweet:{id_str:"102",note_tweet:{text:'+json.dumps(text)+'}}}};'
    code+='\n'+SOURCES
    if variant=='open': code+='\nsetTimeout(()=>document.querySelector("[data-xtags-ai-control] button")?.click(),300);'
    write(f'feed-{variant}-{locale}',f'<!doctype html><html lang="{locale}"><meta charset="utf-8"><style>{FEED_CSS}</style>'+''.join(articles)+'<script>'+code.replace('</script','<\\/script')+'</script></html>')

MANIFEST=json.loads((ROOT / 'extension/manifest.json').read_text())

def make_ui(locale):
    for kind in ['popup','settings']:
        original=(ROOT / f'extension/{kind}.html').read_text()
        mock='''<script>globalThis.chrome={i18n:{getUILanguage:()=>LANG},runtime:{getManifest:()=>MANIFEST},storage:{local:{get:async defaults=>({...defaults,language:LANG}),set:async()=>{}},session:{get:async defaults=>defaults},onChanged:{addListener:()=>{}}}};</script>'''.replace('LANG',json.dumps('zh' if locale=='zh-CN' else 'en')).replace('MANIFEST','(' + json.dumps(MANIFEST) + ')')
        original=original.replace('<script src="service.js">',mock+'<script src="../../extension/service.js">')
        for name in ['i18n',kind]: original=original.replace(f'src="{name}.js"',f'src="../../extension/{name}.js"')
        if kind=='popup':
            original=original.replace('</body>', '<script>setTimeout(()=>document.getElementById("aiMode").scrollIntoView({block:"center"}),200);</script></body>')
        if kind=='settings':
            original=original.replace('</body>','<script>setTimeout(()=>{document.getElementById("aiThreshold").closest("label").scrollIntoView({block:"start"});},200);</script></body>')
        write(f'{kind}-{locale}',original)

def frame(src, label, cls='feed'):
    return f'<div class="frame {cls}"><div class="bar"><i></i><i></i><i></i><span>{label}</span></div><iframe title="{label}" src="{src}.html"></iframe></div>'

def page(locale, name, number, title, desc, stage):
    zh=locale=='zh-CN'
    note='演示帖子与模拟分数 · 非真实检测结果，分数不代表识别准确率' if zh else 'Demo posts & mocked scores · Not live results or measured accuracy'
    footer='自备 API key · 分析由所选服务完成' if zh else 'Bring your own API key · Provider-side analysis'
    validator='''<script>setTimeout(()=>{try{for(const f of document.querySelectorAll("iframe")){const d=f.contentDocument;if(!d||d.body.hidden)throw Error("Hidden frame");if(d.querySelector("#aiMode")&&!d.querySelector("#aiMode option").textContent.trim())throw Error("Missing translations");if(f.src.includes("feed-")&&!f.src.includes("feed-before-")&&!d.querySelector("[data-xtags-badge]"))throw Error("Missing labels");if(f.src.includes("feed-long-")&&d.querySelector("[data-xtags-incomplete]"))throw Error("Missing full text");}document.documentElement.dataset.artworkReady="true";}catch(e){document.documentElement.dataset.artworkError=e.message;}},1000);</script>'''
    write(name,f'<!doctype html><html lang="{locale}"><meta charset="utf-8"><title>{html.escape(title.replace("<br>"," "))}</title><style>{CSS}</style><div class="brand"><img src="../assets/icon-128.png" alt="">Xtags</div><div class="edition">AI CONTENT FILTER / {number:02d}</div><div class="intro"><h1>{title}</h1><p>{desc}</p></div><div class="stage">{stage}</div><div class="note"><span>{note}</span><span>{footer}</span></div>{validator}</html>')
    render(name)

for locale in ['zh-CN','en']:
    zh=locale=='zh-CN'
    for variant in ['after','before','closed','open','long']: make_feed(locale,variant)
    make_ui(locale)
    points=[('01 / DETECT','识别疑似 AI','提示和分数紧随原有标签。'),('02 / FILTER','自动折叠','保留作者和时间，减少干扰。'),('03 / EXPAND','随时展开','下划线按钮，一点查看。')] if zh else [('01 / DETECT','Spot suspected AI','An inline indicator and score.'),('02 / FILTER','Auto-collapse','Keep the author. Reduce clutter.'),('03 / EXPAND','Read anytime','One underlined button to expand.')]
    side='<div class="side">'+''.join(f'<div class="point"><small>{n}</small><h2>{t}</h2><p>{d}</p></div>' for n,t,d in points)+'</div>'
    page(locale,f'screenshot-ai-feed-{locale}',1,'疑似 AI 推文，<span class="accent">自动折叠。</span>' if zh else 'Suspected AI posts.<br><span class="accent">Less clutter.</span>','少看 AI 灌水，把注意力留给值得读的推文。' if zh else 'Spot suspected AI text. Keep your feed focused.',frame(f'feed-after-{locale}','X / '+('信息流演示' if zh else 'Feed demonstration'))+side)
    page(locale,f'screenshot-ai-compare-{locale}',2,'信息流更清爽，<span class="accent">内容随时可看。</span>' if zh else 'A clearer feed.<br><span class="accent">Nothing out of reach.</span>','收到判断后折叠疑似 AI 内容；普通帖子保持正常阅读。' if zh else 'Suspected AI posts collapse after analysis. Other posts stay visible.',frame(f'feed-before-{locale}','01 / '+('未启用过滤' if zh else 'Without filtering'),'pair')+frame(f'feed-after-{locale}','02 / '+('自动折叠' if zh else 'Auto-collapse'),'pair'))
    page(locale,f'screenshot-ai-expand-{locale}',3,'想看时，<span class="accent">一点展开。</span>' if zh else 'Curious?<br><span class="accent">Expand anytime.</span>','展开后保留淡红提示，本标签页记住你的选择；详情页默认展开。' if zh else 'A subtle red tint stays. This tab remembers your choice. Detail pages stay open.',frame(f'feed-closed-{locale}','01 / '+('折叠状态' if zh else 'Collapsed'),'pair')+frame(f'feed-open-{locale}','02 / '+('点击展开后' if zh else 'After expanding'),'pair'))
    longside='<div class="side"><div class="point"><small>FULL TEXT</small><h2>'+('先看判断<br>再决定读不读' if zh else 'See the estimate.<br>Then decide.')+'</h2><p>'+('使用 X 页面已经提供的全文。<br><br>全文暂不可用时等待，不把摘要当成整篇。' if zh else "Uses full text already in X's page data.<br><br>If unavailable, waits rather than judging the preview.")+'</p></div></div>'
    page(locale,f'screenshot-ai-long-{locale}',4,'长推文，<span class="accent">展开前先看判断。</span>' if zh else 'Long posts.<br><span class="accent">An estimate before expansion.</span>','示例使用“仅标签”模式，展示长推文仍未展开时的 AI 提示。' if zh else 'Label-only mode: the long-post preview stays closed while the estimate appears.',frame(f'feed-long-{locale}','X / '+('未展开的长推文' if zh else 'Unexpanded long post'))+longside)
    explanation=('三种模式：<b>自动折叠 / 仅微红提示 / 仅标签</b><br>独立 AI 阈值，初始值 0.85；调整后复用已有判断。<br>首次使用需阅读数据说明、主动同意并填写 API key。' if zh else 'Three modes: <b>Auto-collapse / Light red background / Label only</b><br>Independent AI threshold, initially 0.85. Reuses existing judgments.<br>First use requires data-transfer consent and your API key.')
    stage=frame(f'popup-{locale}','POPUP / '+('AI 常用操作局部' if zh else 'AI controls excerpt'),'popup-frame')+frame(f'settings-{locale}','SETTINGS / '+('设置页局部' if zh else 'Preferences excerpt'),'settings-frame').replace('</div><iframe','</div><iframe',1).replace('</iframe></div>',f'</iframe><div class="explain">{explanation}</div></div>')
    page(locale,f'screenshot-ai-controls-{locale}',5,'过滤程度，<span class="accent">由你决定。</span>' if zh else 'Your feed.<br><span class="accent">Your filter.</span>','自由选择显示方式和阈值，同时保留原有意图标签。' if zh else 'Choose your mode and threshold. Keep intent signals, too.',stage)

# Locale-neutral promotional tiles: one clear capability, no unsupported claim.
for name,width,height in [('promo-small',440,280),('promo-marquee',1400,560)]:
    large=width>500
    title='Spot suspected AI posts.' if large else 'AI content<br>filter for X'
    sub='Auto-collapse. Expand anytime.' if large else 'Auto-collapse. Expand anytime.'
    card='<div class="post"><div class="author">Demo author <span>@demo · 2h</span></div><div class="indicator">Likely AI · 0.94 <u>Expand post</u></div><div class="line"></div></div>'
    text=f'''<!doctype html><meta charset="utf-8"><style>*{{box-sizing:border-box}}body{{margin:0;width:{width}px;height:{height}px;overflow:hidden;background:#fff7f3;font-family:{FONT};color:#19191d}}main{{padding:{65 if large else 24}px;position:relative;height:100%}}.brand{{display:flex;gap:10px;align-items:center;font-weight:750;font-size:{32 if large else 20}px}}img{{width:{42 if large else 26}px;height:{42 if large else 26}px}}h1{{font-size:{68 if large else 33}px;line-height:1.1;letter-spacing:-1.5px;margin:{46 if large else 19}px 0 12px;max-width:{690 if large else 280}px}}p{{color:#7b6a66;font-size:{22 if large else 13}px;margin:0}}.post{{position:absolute;right:{65 if large else -25}px;top:{180 if large else 177}px;width:{475 if large else 240}px;padding:{28 if large else 13}px;background:#fff0ed;border:1px solid #efcfc8;border-radius:18px;box-shadow:0 20px 35px #5b20100d;transform:rotate(-3deg)}}.author{{font-size:{18 if large else 11}px;font-weight:700}}.author span{{font-weight:400;color:#7a7474}}.indicator{{font-size:{17 if large else 10}px;color:#a1312a;margin-top:15px}}.line{{height:1px;background:#edcbc4;margin-top:24px}}small{{position:absolute;bottom:{32 if large else 14}px;left:{65 if large else 24}px;color:#907c76;font-size:{12 if large else 9}px}}</style><main><div class="brand"><img src="../assets/icon-128.png" alt="">Xtags</div><h1>{title}</h1><p>{sub}</p>{card}<small>Demo UI · Mocked score · API key required</small></main>'''
    write(name,text);render(name,width,height)

# Shareable local gallery; source fixtures remain next to the screenshots.
names = ['feed', 'compare', 'expand', 'long', 'controls']
groups = []
for locale in ['zh-CN', 'en']:
    figures = ''.join(f'<a href="../assets/screenshot-ai-{name}-{locale}.png"><img loading="lazy" src="../assets/screenshot-ai-{name}-{locale}.png" alt="{locale} {name}"><span>{index + 1}. {name}</span></a>' for index, name in enumerate(names))
    groups.append(f'<section><h2>{"简体中文" if locale == "zh-CN" else "English"}</h2><div class="grid">{figures}</div></section>')
write('index', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Xtags 0.2.1 商店素材预览</title><style>body{max-width:1200px;margin:40px auto;padding:0 24px;background:#fffaf8;color:#18191d;font:16px/1.6 system-ui}h1{font-size:36px}p{color:#746a66}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px}a{color:#ac3e37;text-decoration:none}img{width:100%;border:1px solid #eaded7;border-radius:12px}span{display:block;margin:6px 0}section{margin:32px 0}</style><h1>Xtags 0.2.1 · AI 识别与过滤</h1><p>本地商店素材预览。点击图片查看原始尺寸。所有示例帖子和分数为演示数据，不是真实检测结果或实测准确率。</p>' + ''.join(groups) + '<section><h2>宣传图</h2><div class="grid"><a href="../assets/promo-small.png"><img src="../assets/promo-small.png" alt="Small promotional tile"><span>440 × 280</span></a><a href="../assets/promo-marquee.png"><img src="../assets/promo-marquee.png" alt="Marquee promotional tile"><span>1400 × 560</span></a></div></section></html>')
