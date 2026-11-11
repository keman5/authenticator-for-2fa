# 扩展商店上架材料

本目录提供可复制的商品文案、数据披露、权限解释和审核步骤。公开隐私政策与支持页在仓库根目录。本地材料完成不等于已发布网页、已签名或已通过商店审核。

优先上架入口：[Firefox AMO](firefox.md) · [Microsoft Edge Add-ons](edge.md)。`./build.sh store` 生成各自的 `artifacts/store/firefox/`、`artifacts/store/edge/`，包含扩展包、字段 JSON、图片和 SHA-256 校验清单；Firefox 目录另含审核源码。只上传目录内的 `extension.zip`，其他文件按控制台字段分别提交。

## 通用资料

| 字段 | 内容 |
| --- | --- |
| 产品名 | Authenticator-For-2FA |
| 联系／支持／隐私邮箱 | support@macseek.cc |
| 项目主页 | https://github.com/keman5/authenticator-for-2fa |
| 公开问题 | https://github.com/keman5/authenticator-for-2fa/issues |
| 隐私政策 | [英文](../../PRIVACY.md)、[简体中文](../../PRIVACY.zh-CN.md) |
| 支持页 | [SUPPORT.md](../../SUPPORT.md) |
| 商品文案 | [英文](listing.en.md)、[简体中文](listing.zh-CN.md) |
| 单一用途／权限解释 | [permissions.md](permissions.md) |
| 隐私表单填写依据 | [privacy-disclosures.md](privacy-disclosures.md) |
| 审核测试与源码重现 | [reviewer-notes.md](reviewer-notes.md) |
| 图标与截图 | [assets.md](assets.md) |
| 代码许可证 | [MIT](../../LICENSE)，依赖许可随发布包提供 |

网页托管前，可在公开仓库发布后使用以下候选地址；**提交前必须在未登录浏览器中验证能访问，当前本地文件并不代表这些 URL 已上线**：

- 隐私：`https://github.com/keman5/authenticator-for-2fa/blob/main/PRIVACY.md`
- 中文隐私：`https://github.com/keman5/authenticator-for-2fa/blob/main/PRIVACY.zh-CN.md`
- 支持：`https://github.com/keman5/authenticator-for-2fa/blob/main/SUPPORT.md`

不要填写尚未部署的 `macseek.cc/privacy` 地址。使用自有站点时，发布同一政策并替换所有商店 URL。

## 各商店提交清单

| 商店 | 上传内容与材料 | 提交前要求 |
| --- | --- | --- |
| Chrome Web Store | `artifacts/*-chrome.zip`；商品文案、图标、至少一张截图、隐私 URL、用途和权限解释、数据使用表 | 验证开发者账户／邮箱；解决下方本地敏感数据存储项 |
| Microsoft Edge Add-ons | `artifacts/*-edge.zip`；商品文案、商标图、隐私 URL、用途和权限解释、数据表、审核说明 | Partner Center 发布者验证；为启用的商品页语言填写描述与商标图 |
| Firefox AMO | `artifacts/*-firefox.zip`；`*-source.zip`；商品文案、图标／截图、隐私、审核说明 | 解决数据同意声明；验证源码可重现；提交后由 Mozilla 签名；公开列出与自行分发分别选择 |
| Safari / Mac App Store | 经签名的 macOS 容器归档；商品描述、支持／隐私 URL、图标、Mac 截图、App Privacy、年龄分级、出口合规、审核备注 | Apple Developer 账户、正式 bundle ID、签名／描述文件及 App Store Connect 记录；`*-safari.zip` 只是 Web Extension 资源，不能直接上传 App Store |
| Opera Add-ons | 在 Opera 中验证的 Chromium 兼容包；商品文案、图标、截图、隐私及 MIT 许可 | 当前没有独立 Opera 构建和运行验收；先验证 API、权限及导入／填充，再使用兼容包提交，不能把 Edge 测试当作 Opera 测试 |

Safari 当前转换脚本只生成 macOS 容器，不表示已支持 iPhone/iPad。Brave 等 Chromium 浏览器通常通过 Chrome Web Store 安装；不需要虚构独立上架包或承诺未经验证的平台支持。

## 提交前必须关闭的缺项

- 发布者显示名、法律身份、地址／地区及各平台要求的交易者身份由实际账号持有人填写。`support@macseek.cc` 是联系邮箱，不代替法律身份验证。
- 发布并检查隐私及支持 URL；在商店控制台验证联系邮箱。
- 当前本地账户密钥及同步恢复密钥为明文；界面锁不加密它们。Chrome 用户数据 FAQ 对敏感数据的安全存储有要求。提交前应落实本地静态加密并同步修改政策／测试，或取得商店对当前实现的明确确认；不能仅靠隐私文案消除此风险。
- Firefox 目前仅声明 `data_collection_permissions.required: ["none"]`，没有可选数据声明和对应的运行时授权门控。应按 [数据披露说明](privacy-disclosures.md) 解决同步、时间校准及 nativeMessaging 的分类／授权；这是产品实现项，不能只在 AMO 表单写说明。
- Safari：完成正式签名归档、容器内可访问的隐私入口、真实 Mac 截图和最终二进制的 App Privacy／加密出口合规核对。不能用浏览器 Web UI 截图冒充原生容器截图。
- Touch ID 辅助程序目前仅本机 ad-hoc 签名；如公开提供，需准备 Developer ID 签名、公证、稳定下载与安装说明。不要在商品页承诺开箱即用；不依赖此可选功能即可测试基础验证码。
- 对最终上传版本逐个平台验收，尤其是权限拒绝／撤销、云端删除、QR 摄像头和通行密钥。商店描述只选用已验证且该平台提供的功能。

## 本地准备

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
./build.sh store
```

`store` 在本机构建并更新版本，打包四种资源及审核源码，同时用独立的后台 Edge 临时配置生成虚构账户截图和商店图标。输出见 `artifacts/store/`，并复制到 `~/Downloads/dist/store/`。不会登录、上传商店、发布网页或操作日常浏览器配置。

## 官方依据

提交时以控制台和当时有效政策为准：

- [Chrome 隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)、[用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、[图片规范](https://developer.chrome.com/docs/webstore/images)
- [Edge 提交流程](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Firefox 内置数据同意](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)、[有效附加组件政策](https://extensionworkshop.com/documentation/publish/add-on-policies/)、[源码提交](https://extensionworkshop.com/documentation/publish/source-code-submission/)
- [Safari 分发](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)、[App Privacy](https://developer.apple.com/app-store/app-privacy-details/)、[截图规格](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)、[出口合规](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)
- [Opera 发布指南](https://help.opera.com/en/extensions/publishing-guidelines/)
