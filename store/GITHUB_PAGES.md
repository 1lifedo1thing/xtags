# GitHub Pages 发布隐私政策

发布进度（2026-09-20）：`docs/` 的 7 个文件已提交并推送至 `manifoldor/xtags` 的 `main`，提交 `f1a7525`。当前 GitHub CLI 令牌调用创建 Pages 接口返回 403（Resource not accessible by personal access token）；Pages 尚未启用，公开地址尚未验证。已打开 GitHub 网页登录入口，等待登录后继续配置。

## 已准备

`docs/index.html`、`docs/privacy.html`、`docs/privacy.zh-CN.html`、`docs/support.html`、`docs/styles.css`、本地图标和 `.nojekyll`。没有构建步骤、第三方字体、分析脚本或 cookie 弹窗。

## 发布步骤

1. 先审阅隐私政策、开发者署名和支持邮箱，确认与最终运行包的数据行为一致。
2. 已完成：通过临时仓库副本将 `docs/` 单独提交并推送到 `main`。本地原工作区仍保留之前的运行代码改动，未提交这些改动。
3. 在 GitHub 仓库打开 Settings → Pages。
4. Build and deployment → Source 选择 Deploy from a branch。
5. Branch 选择 `main`，目录选择 `/docs`，保存。
6. 等待部署完成，检查 HTTPS，并使用未登录/无痕浏览器验证下列地址返回页面而非 404/权限提示。

| 用途 | 预期 URL |
| --- | --- |
| 主页 | https://manifoldor.github.io/xtags/ |
| 商城 Privacy policy | https://manifoldor.github.io/xtags/privacy.html |
| 中文政策 | https://manifoldor.github.io/xtags/privacy.zh-CN.html |
| Support URL | https://manifoldor.github.io/xtags/support.html |

如果账号已有 Pages 自定义域名，GitHub 可能重定向到该域名；以实际部署确认的 canonical URL 为准，再填写商城和 popup。

公开站点不要包含审核 API key、X 登录密码、内部截图、测试日志或未公开个人资料。`store/` 不在本方案的 Pages 发布根目录中。

官方说明：[配置 Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

本地后续更新：0.1.4 已将披露和 key 配置迁至独立设置页，对应 `docs/` 文案已同步更新；这部分更新尚未推送，远端上述提交仍为 0.1.3 页面。

本地 0.1.5 政策又补充了可选自定义 API 接收方、域名授权和凭证切换规则；这些更新同样尚未推送。
