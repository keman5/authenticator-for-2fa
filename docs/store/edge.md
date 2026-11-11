# Microsoft Edge Add-ons 上架

材料入口：`artifacts/store/edge/`，或 `~/Downloads/dist/store/edge/`。运行根目录 `./build.sh store` 重建；只将 `extension.zip` 上传到 Partner Center 的扩展包字段。

## 控制台填写

| Partner Center 项目 | 准备的内容 |
| --- | --- |
| 包 | `extension.zip`，manifest 直接在 ZIP 根目录 |
| 名称／短描述 | 由包中的 `_locales` 元数据提供；产品名 Authenticator-For-2FA |
| 各语言描述 | `listing.en.json`、`listing.zh-CN.json` 的 description；其他启用语言需补齐描述，可在控制台允许时使用英文内容 |
| 类别 | Productivity 或控制台最接近的类别 |
| 搜索词 | JSON 的 keywords；按控制台限制逐项填写 |
| 支持邮箱 | support@macseek.cc |
| 主页 | https://github.com/keman5/authenticator-for-2fa |
| 支持 URL | https://github.com/keman5/authenticator-for-2fa/blob/main/SUPPORT.md |
| 隐私 URL | https://github.com/keman5/authenticator-for-2fa/blob/main/PRIVACY.md |
| 单一用途／每项权限 | [permissions.md](permissions.md) 中的英文可直接复制 |
| 远程代码 | No；JS 和 QR WebAssembly 随包提供 |
| 数据使用表 | 按 [privacy-disclosures.md](privacy-disclosures.md) 填写；账户认证信息、标签和本地网页处理都需如实披露 |
| 商标图 | `logo-300.png`；为启用的商品页语言复制相同图标 |
| 截图 | `screenshots/en/` 三张 1280×800 英文截图；中文商品页也使用英文截图 |
| Certification notes | [reviewer-notes.md](reviewer-notes.md)，无需开发者账户；Touch ID 需另装辅助程序 |

本次未制作可选宣传图／视频。不要把整份材料 ZIP 作为扩展包。包的浏览器平台名称、权限及本地 API 必须与上传版本一致。Edge 商店 ID 由商店分配，不使用 Firefox 邮箱形式的 ID；取得最终 Edge ID 后，再将其加入本机 Touch ID 辅助程序白名单。

## 提交门槛

- [ ] 在 Partner Center 完成发布者与联系邮箱验证，并填写实际法律身份／地区。
- [ ] 确认隐私／支持 URL 已公开发布，未登录也能访问；本地文件并不会自动上线。
- [ ] 为控制台启用的语言填入描述和商标图；生成器列出包内全部 locale，当前完整文案为英文、简体中文。
- [ ] 检查实际权限和数据声明，确认本地明文密钥的安全存储要求已评估并解决，不将界面锁描述为静态加密。
- [ ] 在 Edge 中测试导入／导出、重启、权限拒绝／撤销、网页填充与可选同步；截图只用虚构账户。
- [ ] 根据实际准备情况选择市场与可见性，最终核对后提交。

官方依据：[Edge 提交步骤、字段及图片尺寸](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)、[开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)。

后台截图已生成；完整 `scripts/check-ui.mjs` 在浏览器重启后等待扩展 worker 超时，尚未取得整套 UI 冒烟通过结果。首次启动、截图或单元测试通过均不能代替该项验证；提交前需解决重启测试环境并重新验收。
