# Xtags Chrome Web Store 提交资料

0.1.8 候选资料更新于 2026-09-23。原 0.1.5 运行包不含本次全文分类、提示词边界和 key 隔离改动，**商城只上传本版重新生成的运行包**。GitHub Pages 公开政策已随 `main` 的 `/docs` 更新并匿名核对，与随包政策一致。

## 先看结论

1. **产品内披露与同意已接入。** 独立设置页在 key 设置之前说明：折叠长文在展开前会读取并发送全文，同时展示作者账号、当前 API 接收方、受保护帖子范围和费用。旧版同意失效，用户须重新勾选并同意；后台才允许请求。可撤回同意；中英文隐私政策随扩展提供。
2. **公开隐私政策已同步。** GitHub Pages 从 `main` 的 `/docs` 发布。0.1.8 中英文政策、支持页及主页已匿名验证，内容与本地文件逐字节一致；商城 Privacy policy URL 可填写下方英文地址。
3. **完成真实 X + TypeSafe 联调。** 当前 33 项后台/语言测试及 36 项浏览器 DOM 测试使用模拟服务；另有独立 Chrome MAIN/ISOLATED 世界通信检查通过。用户此前反馈全文功能在真实页面测试正常；正式送审仍需覆盖登录页、首页/详情页/引用/回复/长帖、暗色模式、滚动复用及暂停，并用实际帖子比较新版提示词的误判。key 现在限制在可信扩展上下文，真实 Chrome 中的存储访问边界仍需手工核对；最低支持版本为 Chrome 140。
4. **准备审核凭证和主功能截图。** 审核步骤已写好；专用 TypeSafe key/额度和必要的 X 访问方式由发布者在商城私有 Test instructions 字段提供。不要把 key 放进仓库、宣传图、公开政策或 listing。当前图片中设置与 popup 图片是实际界面代码的本地渲染，不能冒充已完成真实 X 联调；已另加用户提供并授权公开使用的实际标签截图，建议将 `assets/screenshot-labels-zh-CN.png` 或英文说明版作为第一张商城图片；截图不替代完整联调。

## 文件用途

| 文件 | 用途 |
| --- | --- |
| `listing.en.txt` / `listing.zh-CN.txt` | 各语言商店详细说明，可粘贴 |
| `dashboard-fields.md` | 单一用途、权限理由、远程代码与数据类型申报建议 |
| `reviewer-instructions.en.txt` | 私有审核说明模板；测试凭证仍需另填 |
| `disclosure-copy.md` | 已实现的数据上传披露和验收要求 |
| `PRE_SUBMISSION.md` | 提交前检查与风险分级 |
| `GITHUB_PAGES.md` | 隐私政策发布步骤与目标地址 |
| `assets/` | 128 图标、440×280 小宣传图、可选 1400×560 宣传图、中英 1280×800 设置页和 popup 截图 |
| `ASSETS.md` | 每张图的来源、尺寸及使用限制 |
| `xtags-0.1.8-chrome-web-store.zip` | 本版候选运行包；ZIP 根目录含 manifest，可用于商城上传，正式提交仍需完成 P0 检查 |
| `package-report.json` | 包哈希、文件清单及检查结果 |
| `../docs/` | 无追踪脚本的 GitHub Pages 主页、支持页、中英隐私政策 |

## 打包与复用

每次修改运行时代码后运行 `python3 scripts/package-store.py` 重建运行包。打包采用固定清单，不会把文档、截图、测试夹具或其他开发文件混入扩展。

根目录的 `xtags-chrome-web-store-submission-kit-0.1.5.zip` 是旧版完整资料备份，包含旧网站、脚本及源码。**商城的扩展上传入口只上传 `xtags-0.1.8-chrome-web-store.zip`，不要上传整套资料 ZIP。** 后续修改产品后，须同步版本、隐私描述、截图和打包结果。

## 公开信息

暂沿用现有项目署名 yishan 和 `linyishan@gmail.com`；没有替你验证邮箱收件能力或声明发布主体资格。发布者须确认这些信息以及隐私政策中的 Limited Use 承诺。该政策是根据当前代码准备的可审阅发布稿，不构成审核通过或法律合规保证。

- 主页：`https://manifoldor.github.io/xtags/`
- 隐私政策：`https://manifoldor.github.io/xtags/privacy.html`
- 中文隐私政策：`https://manifoldor.github.io/xtags/privacy.zh-CN.html`
- 支持页：`https://manifoldor.github.io/xtags/support.html`

以上地址于 2026-09-23 验证匿名访问成功，0.1.8 页面内容与本地 `docs/` 一致。

## 官方依据

- [图片规范](https://developer.chrome.com/docs/webstore/images)：必需 128 图标、440×280 小宣传图和至少一张截图；截图可用 1280×800 或 640×400，最多五张。1400×560 大宣传图可选；无需为了提交专门制作视频。
- [隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)：单一用途、权限理由、数据披露及隐私政策 URL。
- [披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)、[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)：应在收集前让用户了解数据用途并获得有效同意，使用应限定于披露的功能。
- [真实环境测试](https://developer.chrome.com/docs/webstore/prepare)、[审核说明](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)：提供可复现路径和必要的受限访问凭证。
- [MV3 要求](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)：远程推理 API 返回数据不等于下载执行远程 JavaScript。

资料更新日期：2026-09-23。最终后台表单及审核判断以 Chrome Web Store 为准。

自定义 API 配置及协议见 `../API_SERVICES.md`。新增可选域名权限理由已写入 dashboard-fields.md；不能声称安装时获得所有 HTTPS 域名权限，也不能宣称支持 OpenAI 聊天接口。
