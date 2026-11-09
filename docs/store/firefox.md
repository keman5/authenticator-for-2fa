# Firefox AMO 上架

材料入口：`artifacts/store/firefox/`，或 `~/Downloads/dist/store/firefox/`。运行根目录 `./build.sh store` 可重建；本目录是待提交材料，不代表已签名或已通过审核。

## 上传及填写

| AMO 项目 | 准备的内容 |
| --- | --- |
| 发布方式 | 公开商店选择 On this site；自行分发单独选择 On your own |
| 扩展包 | `extension.zip`，根目录直接包含 manifest，不上传整个材料目录 |
| 扩展 ID | `authenticator-for-2fa@macseek.cc` |
| 源码 | `source.zip`；本项目使用 TypeScript、React、Vite，需同时提交源码 |
| 重现说明 | [reviewer-notes.md](reviewer-notes.md) 的 Source and build reproduction；`BUILD_VERSION` 保持版本一致 |
| 名称／摘要／描述 | `listing.en.json`、`listing.zh-CN.json`；也可阅读[英文](listing.en.md)、[中文](listing.zh-CN.md) |
| 类别 | 选择当前控制台最接近的生产力／安全类别 |
| 支持邮箱 | support@macseek.cc |
| 支持 URL | https://github.com/keman5/authenticator-for-2fa/blob/main/SUPPORT.md |
| 隐私 | [英文政策](../../PRIVACY.md)；可复制全文到 AMO 隐私字段；需要 URL 时使用已发布政策地址 |
| 图标 | `icon-128.png` |
| 截图候选 | `screenshots/en/` 和 `screenshots/zh-CN/` 中三张 1280×800 图片 |
| 审核备注 | [reviewer-notes.md](reviewer-notes.md)，包含虚构账户、基本测试和可选功能依赖 |
| 许可 | MIT，依赖许可包含在扩展包中 |

当前截图来自临时配置中的真实 Edge 扩展页面，展示共用界面；**尚未作为 Firefox 运行验证或专属截图**。在 Firefox 验收后确认表现一致，必要时用 Firefox 复拍；不要提交为 Firefox 硬件／同步功能已验证的证据。

## ID 与安装

此 ID 用于 AMO 身份和 Firefox nativeMessaging 的精确白名单。若已有其他 ID 的安装，修改 ID 会成为另一扩展身份，不会自动继承旧安装的本地存储或同步命名空间。先导出并验证备份，再安装新身份。新 ID 不应提交为另一 ID 的原位更新。

Touch ID 安装脚本只允许新 ID；已有辅助程序注册需要重新运行安装脚本才能更新白名单。常规 Firefox 发布安装需要 Mozilla 签名，ZIP 本身未签名。不要将 Android 最低版本配置当作 Android 验收，首次提交只勾选已验证的平台。

## 提交门槛

- [ ] `extension.zip` 与 `source.zip` 版本和 ID 一致，源码重现得到相同文件内容。
- [ ] 官方 `web-ext lint` 检查完成，逐项处理错误并审阅警告。
- [ ] 完成真实 Firefox 基础功能、权限拒绝／撤销、重启及可选功能测试。
- [ ] **数据同意实现已解决**：当前 manifest 的 `required: ["none"]` 尚未覆盖可选同步等数据传输及 nativeMessaging 分类，见 [privacy-disclosures.md](privacy-disclosures.md)。材料已备齐不代表此项已完成。
- [ ] 已发布隐私／支持页面，并在未登录状态确认访问；验证支持邮箱。
- [ ] 发布者身份、发行地区及控制台必要信息由实际账号持有人填写。

官方依据：[提交步骤](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)、[源码提交](https://extensionworkshop.com/documentation/publish/source-code-submission/)、[内置数据同意](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)。

## 本地静态校验

使用 `pnpm dlx web-ext@10.8.0 lint --source-dir dist/firefox --output json`。当前结果为 0 errors、2 warnings（`UNSAFE_VAR_ASSIGNMENT`）；两处位于生成的 `assets/index.js` 内 React DOM 的 `dangerouslySetInnerHTML` 属性处理分支。应随源码供审核定位，不能把无校验错误当成安全审查或数据同意已通过。最终构建后重跑，并保留对应版本报告；报告不是扩展包的一部分。
