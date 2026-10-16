# Xtags 0.2.1 Chrome Web Store 提交资料

2026-10-16 · 商城候选版，推广重点：X 推文 AI 内容识别与过滤。仅 docs 页面已按授权推送并部署 Pages；本次 GitHub 同步包含 0.2.1 源码与商店素材，未创建 Release；商店尚未提审。

[查看整套图片预览](artwork/index.html)。

## 上传什么

扩展上传入口只选 **[xtags-0.2.1-chrome-web-store.zip](xtags-0.2.1-chrome-web-store.zip)**，ZIP 根目录直接包含 manifest.json。不要上传仓库目录、截图或整套资料备份；旧版本 ZIP 不含本版完整功能与文案。

| 文件 | 填写／上传位置 |
| --- | --- |
| listing.en.txt / listing.zh-CN.txt | 对应语言的商店详细说明 |
| dashboard-fields.md | 名称、短描述、单一用途、权限及数据申报参考 |
| reviewer-instructions.en.txt | Test instructions；有效专用 key 只填私有凭证字段 |
| assets/screenshot-ai-*-en.png / *-zh-CN.png | 商店对应语言的五张功能截图，顺序见 ASSETS.md |
| assets/promo-small.png | 440×280 小宣传图 |
| assets/promo-marquee.png | 1400×560 可选大宣传图 |
| assets/icon-128.png | 128×128 图标 |
| ASSETS.md | 图片尺寸、来源、演示与真实结果的区别 |
| disclosure-copy.md | 当前设置页的数据披露与同意流程 |
| PRE_SUBMISSION.md | 本地验证记录及送审前待办 |
| GITHUB_PAGES.md | 公开 URL、历史部署记录及本次待发布状态 |
| RELEASE_NOTES_0.2.1.md | 本版更新说明 |
| package-report.json | 上传 ZIP 的哈希、清单及检查结果 |
| ../PRODUCT_PLAN_0.2.1.md | 产品定位、实现行为和宣传边界 |

## 提交顺序

1. 按 PRE_SUBMISSION.md 完成真实 X／服务商联调及专用审核访问准备。
2. 本地政策在 docs/ 与 extension/privacy/ 已同步；**公开 Pages 已通过 docs-only 提交 58fd341 部署并逐页核对一致**，见 GITHUB_PAGES.md。
3. 上传 0.2.1 运行包；按语言粘贴 listing，上传五张新截图、图标及宣传图。
4. 填写单一用途、权限理由及隐私申报，核对收费、接收方和第三方数据传输。
5. 在商城私有测试字段填有效审核 key、额度、测试链接和需要的 X 访问方式；不要提交占位符或公开凭证。

保留原有政策 URL：Privacy https://manifoldor.github.io/xtags/privacy.html ，中文 https://manifoldor.github.io/xtags/privacy.zh-CN.html ，Support https://manifoldor.github.io/xtags/support.html 。

## 重建

在项目根目录运行：

```sh
npm test
npm run test:browser
python3 scripts/store-artwork.py
python3 scripts/package-store.py
```

图片脚本使用独立 Chrome 配置、自写演示帖子、模拟 API 与实际扩展代码，不访问真实 X 或 API。截图清楚标注模拟分数，不代表真实识别准确率；API key 留空。旧的用户实际意图截图保留为历史素材，不作为新版 AI 过滤的效果证明。

署名 yishan，支持 linyishan@gmail.com。参考：[官方图片规范](https://developer.chrome.com/docs/webstore/images)、[披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)。
