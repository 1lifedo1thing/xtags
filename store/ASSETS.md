# 图片清单与来源

| 文件 | 尺寸 | 使用位置 | 来源 |
| --- | --- | --- | --- |
| assets/icon-128.png | 128 × 128 | 扩展图标 | 复用 extension/icons/on/icon128.png |
| assets/promo-small.png | 440 × 280 | 必需的小宣传图 | 本项目图标、品牌名与 CSS 图形 |
| assets/promo-marquee.png | 1400 × 560 | 可选的大宣传图 | 同一品牌构图 |
| assets/screenshot-settings-en.png | 1280 × 800 | 英文设置截图 | 实际设置页 HTML、JS、翻译代码在本地 Chrome 中渲染 |
| assets/screenshot-settings-zh-CN.png | 1280 × 800 | 简体中文设置截图 | 同上，中文界面 |
| assets/screenshot-popup-en.png / screenshot-popup-zh-CN.png | 1280 × 800 | 中英文快捷操作截图 | 当前 popup 代码的本地渲染 |

设置截图使用空 API key、默认设置和本地模拟的 Chrome storage/runtime 接口，设置页展示默认未同意状态和真实披露区域，popup 展示设置入口；没有改写产品控件或伪造分类结果。popup 图外侧说明文字是宣传排版；设置页图直接展示页面。图片不代表完成了真实 X / TypeSafe 联调。当前图片对应 0.1.5 的首次同意界面，已重新生成。以后修改披露界面也应重生成截图。

**提交前补一张真实时间线截图作为主图。** 在已验证的 X 页面实际运行扩展，截取至少一条文本帖子及它的真实标签，避免私人内容、API key、账户敏感信息。建议用自己公开发布且允许展示的测试帖子；不要手工编造概率。尺寸保持 1280 × 800，每种语言最多上传五张截图。英文和简体中文的设置图分别放入对应语言 listing。

宣传图不按 locale 单独提供，因此仅使用品牌名。没有使用 X / Chrome 商标来暗示官方关联，也没有使用外部图库。

## 重新生成

在项目根目录运行：

```sh
python3 scripts/store-artwork.py
```

需要本机 Chrome；其他系统可通过 `CHROME_BIN` 指定 Chromium 可执行文件。脚本使用临时独立浏览器配置，不读取用户浏览器账户或扩展数据。HTML 源文件写入 `store/artwork/`，PNG 写入 `store/assets/`。图片生成后仍应目视检查，尤其在不同系统字体下。

依据：[Chrome Web Store 图片规范](https://developer.chrome.com/docs/webstore/images)。

`assets/screenshot-service-custom-zh-CN.png` 是自定义服务输入示例，URL 为保留示例域名 api.example.com 的未保存草稿；用于展示操作入口，不是可用服务推荐或真实联调结果。
