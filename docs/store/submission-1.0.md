# 1.0 商店提交记录

后续已统一递增并提交 **1.0.1**，最新状态见 [1.0.1 提交记录](submission-1.0.1.md)。以下保留 1.0 历史记录。

2026-11-11，通过本机 Microsoft Edge 中已登录的发布者账户提交。两家商店均已接收版本 **1.0**，以下是提交后的后台状态，不代表审核通过或已公开上架。

| 商店 | 后台状态 | 管理入口 |
| --- | --- | --- |
| Firefox AMO | 等待审核 | [版本 1.0](https://addons.mozilla.org/zh-CN/developers/addon/authenticator-for-2fa/versions/6692768) |
| Microsoft Edge Add-ons | 正在审阅 | [扩展概述](https://partner.microsoft.com/zh-cn/dashboard/microsoftedge/43cc0e24-314e-4ff3-938f-6786e30eefb4/packages/dashboard) |

## 展示资料

- 产品名：`Authenticator-For-2FA`。
- 为扩展支持的 14 种语言准备商品资料：`ar`、`bn`、`de`、`en`、`es`、`fr`、`hi`、`ja`、`ko`、`pt-BR`、`ru`、`tr`、`zh-CN`、`zh-TW`。简体中文和繁体中文使用对应中文介绍，其他语言统一使用英文介绍。
- Edge 的 14 种语言页面均已保存，提交前逐行确认“已完成”，并为全部语言复制英文截图及徽标。旧的两语言审核已撤回，包含 14 种语言的版本 1.0 已重新提交，最终后台显示“正在审阅”和“显示所有14语言”。
- Firefox AMO 已保存其语言菜单提供的 11 种对应语言：`en-US`、`de`、`es-ES`、`fr`、`ja`、`ko`、`pt-BR`、`ru`、`tr`、`zh-CN`、`zh-TW`。非中文页面的摘要及完整介绍统一为英文。菜单不提供阿拉伯语、孟加拉语、印地语的填写入口；这三种语言的英文资料保留在本地，商店介绍使用默认英文。最终版本状态仍为“等待审核”。
- 所有语言均使用三张英文界面截图：账户列表、数据导入导出、设置，尺寸均为 1280×800。Firefox 媒体区域已确认显示三张缩略图和自定义图标。
- 支持邮箱：`support@macseek.cc`。主页、隐私与支持地址均指向 `keman5/authenticator-for-2fa`；公开隐私与支持文档已检查可访问。
- 隐私说明如实披露本地密钥明文存储、可选加密同步、时间校准和用户主动网页填充。
- 审核员说明包含公开虚构测试账户及可选功能依赖；Firefox 同时上传了审核源码归档。

## 商店标识

| 项目 | 值 |
| --- | --- |
| Firefox 扩展 ID | `authenticator-for-2fa@macseek.cc` |
| AMO slug | `authenticator-for-2fa` |
| AMO 版本 ID | `6692768` |
| Edge 产品 ID | `43cc0e24-314e-4ff3-938f-6786e30eefb4` |
| Microsoft Store ID | `0RDCKGK3J99N` |
| Edge CRX ID | `gpdgilccmnbcolfjkkapnodedbalehmk` |

Firefox 预期公开地址为 <https://addons.mozilla.org/firefox/addon/authenticator-for-2fa/>；Edge 后台显示公开链接在发布后可用。可选 Touch ID 辅助程序配置需使用最终商店分配的扩展 ID。

## 构建与验证

通过 `BUILD_VERSION=1.0 bash build.sh store` 本地生成材料，输出保留在 `~/Downloads/dist/store/`。

- TypeScript 检查通过；Vitest 41 个文件、594 个测试通过。
- 四个浏览器目标构建及生成资源检查通过。
- Firefox 本地 `web-ext` 检查为 0 错误、2 警告；AMO 上传验证为 0 错误、3 警告。已知警告涉及打包 React DOM 的 HTML 赋值。
- 本次没有取得完整 Edge 重启 UI 冒烟通过结果，也没有补做真实 Firefox 功能验收。详见此前运行记录和各商店准备文档。

| 已上传文件 | SHA-256 |
| --- | --- |
| Edge extension.zip | `6d100114b3bdbeb13e5f31334a38d279e8d904901a40c71041a4dd1abe78832c` |
| Firefox extension.zip | `8702ed1af4e93aeb396e5e56f615ca6d0811f9b243ba8dfaaeb99c565bac49e2` |
| Firefox source.zip | `ab652d2be9358542b4e239f2566b5492025727466ccec6c3eea3a38ccb240e85` |

## 待审核事项

商店人工审核及公开上架仍待完成。现有文档中关于本地明文密钥、Firefox 可选数据传输同意的合规问题尚未通过代码整改或商店审核确认；已提交不表示这些问题已获认可。本次没有变更已上传的功能代码或重新打包。

`submission.json` 的本次副本已记录实际提交结果；重新运行材料生成脚本会生成新的准备清单，不能用其初始 `submitted: false` 判断本次提交状态。

## 2026-11-11 拖拽排序修复重打包

- 修复默认站点优先模式禁用拖拽、折叠／展开列表的顺序校验不一致，以及拖动 DOM 行时可能丢失指针捕获的问题。收藏和当前站点保持分组置顶，组内可拖动；隐藏账户继续保留，多面板顺序变更会取消旧拖拽。键盘排序沿用相同保存逻辑。
- `pnpm run check` 通过；41 个测试文件、597 个测试通过。通过 `BUILD_VERSION=1.0 pnpm run build store` 构建并检查四种浏览器资源。后台真实 Edge 鼠标事件验证拖动、在列表外松手、重新打开后顺序仍保存；源码归档中的修复代码和测试与本地逐字节一致。
- 材料生成脚本现为全部 14 种语言生成介绍及英文截图，避免重打包丢失多语言资料。
- **Edge：修复版 1.0 已重新提交，后台“正在审阅”，14 个语言页面均已完成。** 旧提交已撤回，审核说明包含本次修复与验证范围。
- **Firefox：修复包已准备，尚未提交成功。** AMO 自动验证后，在继续提交时返回“版本 1.0 已经存在”。旧版 1.0 未删除，仍保持原有提交；等待确认是否把 Firefox 修复版递增为 1.0.1。
- 本次未补做真实 Firefox、Safari 功能验收，也未重跑完整 Edge 重启冒烟；商店审核仍待完成。

| 修复版归档 | SHA-256 | 提交情况 |
| --- | --- | --- |
| Edge extension.zip | `eee74c7294b5b564b703247e52a63197e352c8706b67b082e3504dc2fc7183de` | 已重新提交，正在审阅 |
| Firefox extension.zip | `a8797eba0bbfe5b29dc1eac6d1cd0283bb2205df417471d819a65fb96558b77e` | 等待版本号决策 |
| Firefox source.zip | `7922f15bb44c074acc2987f2dadbc600a05b600d4eabe8be19e0616d63aefebc` | 等待版本号决策 |
