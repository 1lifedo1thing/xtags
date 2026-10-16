# 0.2.1 图片清单与来源

2026-10-16 · 白底、黑字、珊瑚红。每种语言使用下面五张，全球通用备用截图使用相同英文五张，不混用旧的 0.1.9 popup／settings 图。

| 顺序 | 文件（locale = en / zh-CN） | 尺寸 | 内容 |
| --- | --- | --- | --- |
| 1 | assets/screenshot-ai-feed-{locale}.png | 1280×800 | AI 行内提示、自动折叠和普通帖子并存 |
| 2 | assets/screenshot-ai-compare-{locale}.png | 1280×800 | 同组帖子未过滤／折叠后对照 |
| 3 | assets/screenshot-ai-expand-{locale}.png | 1280×800 | 同一帖子的折叠／展开及微红底色 |
| 4 | assets/screenshot-ai-long-{locale}.png | 1280×800 | 仅标签模式下，长推文仍有“显示更多”时已显示判断 |
| 5 | assets/screenshot-ai-controls-{locale}.png | 1280×800 | 实际 popup 与设置页 AI 阈值／模式局部 |
| — | assets/promo-small.png | 440×280 | 品牌与 AI 过滤功能概念 |
| — | assets/promo-marquee.png | 1400×560 | 品牌、AI 提示与折叠概念 |
| — | assets/icon-128.png | 128×128 | 复用实际扩展图标 |

## 来源与真实性

功能截图使用项目自写示例文字和虚构示例账号，通过**当前 extension/content.js、fulltext.js、service.js、i18n.js** 渲染标签、按钮和折叠效果。全文例子使用模拟的 X React 帖子数据，由真实 fulltext.js 读取；显示“仅标签”模式是为了同时看到尚未展开的摘要和判断。

API 返回为固定模拟分数；不是实测检测结果，不能用于证明示例文字的作者来源或模型准确率。每张功能截图底部都明确标注“演示帖子与模拟分数／非真实检测结果”。处理前后采用同一组自写帖子，不代表真实 X 联调或性能测量。截图中的模型分数不等于识别准确率。

[整套本地预览](artwork/index.html)。

Popup 与设置截图使用实际 HTML、JS 和翻译，模拟 Chrome storage/runtime，key 为空、同意未授予；设置页局部仅滚动到真实 AI 控件，没有重新设计产品控件或隐藏数据收集事实。推广画布的注解、边框、标题属于图外宣传排版。小／大宣传图使用代码绘制的简化演示卡片，并标记 Demo UI / Mocked score。没有外部图库或需要授权的第三方头像。

用户 2026-09-20 提供并授权的本人实际意图截图 screenshot-labels-original.png 及旧 screenshot-labels-* 保留为历史辅助素材，不进入本次五张 AI 截图。原图分数来自当时的真实判断，不替换或伪造为新版 AI 识别结果。

## 重建

`python3 scripts/store-artwork.py`。需要本机 Chrome；可用 CHROME_BIN 指定路径。使用独立临时浏览器配置，不读取用户账户，无真实 API 请求。HTML 写入 store/artwork/，PNG 写入 store/assets/；使用本机系统字体，无远程字体。运行后检查尺寸、中文／英文排版、AI 行内顺序、折叠与展开差异及控件可读性。

官方依据：[Chrome Web Store 图片规范](https://developer.chrome.com/docs/webstore/images)。
