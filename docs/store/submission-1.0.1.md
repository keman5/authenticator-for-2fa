# 1.0.1 商店提交记录

2026-11-11，拖拽排序修复版按用户确认统一递增为 **1.0.1**。通过本机 Microsoft Edge 中已登录的发布者账户提交；后台待审不代表审核通过或已公开发布。

| 商店 | 状态 | 管理入口 |
| --- | --- | --- |
| Firefox AMO | 等待审核；已关联新版源码 | [版本 1.0.1](https://addons.mozilla.org/zh-CN/developers/addon/authenticator-for-2fa/versions/6693181) |
| Microsoft Edge Add-ons | 正在审阅；旧版 1.0 已撤回 | [扩展概述](https://partner.microsoft.com/zh-cn/dashboard/microsoftedge/43cc0e24-314e-4ff3-938f-6786e30eefb4/packages/dashboard) |

## 修复与资料

- 修复默认站点优先模式禁用拖拽、折叠／展开列表顺序校验不一致，以及移动账户行导致指针捕获丢失的问题。组内拖拽保留收藏、当前站点优先及隐藏账户；键盘排序使用相同保存逻辑。
- 保留 14 种语言材料；简体／繁体中文分别使用对应中文，其余语言使用英文介绍。截图全部为英文。Edge 14 个语言页面保留；Firefox 11 个语言入口保留，AMO 不提供的阿拉伯语、孟加拉语、印地语使用默认英文介绍。
- Firefox 版本 ID：`6693181`，文件 ID：`5237269`；扩展 ID：`authenticator-for-2fa@macseek.cc`。上传验证 0 错误、3 条警告。
- Edge 产品 ID：`43cc0e24-314e-4ff3-938f-6786e30eefb4`；Store ID：`0RDCKGK3J99N`；CRX ID：`gpdgilccmnbcolfjkkapnodedbalehmk`。

## 构建与验证

通过 `BUILD_VERSION=1.0.1 pnpm run build store` 本地构建，输出到 `~/Downloads/dist/` 及 `~/Downloads/dist/store/`。

- 修复代码已通过检查、41 个测试文件共 597 个测试；此次仅递增版本号，未重复整套单元测试。
- 四种浏览器构建、manifest、本地化、脚本、WASM 与许可资源检查通过。
- 1.0.1 包在后台真实 Edge 中通过鼠标拖动、列表外松手、重新打开后顺序保存验证。
- 两个商店 ZIP 的 manifest 均为 1.0.1，包含 14 种语言；源码归档中的版本、修复代码、测试与脚本均与本地一致。

| 文件 | SHA-256 |
| --- | --- |
| Edge extension.zip | `26c08808a2702aef7462c463134769c574e00195526ccba83bbaf7daf61217bd` |
| Firefox extension.zip | `3cebdf4657adb9adc06ad00a12badf72ca43399af9de4443effd16479766ad82` |
| Firefox source.zip | `bc975373d35babf920629035169108f5468bbb08fb04b4cf8ddd976db297c59e` |

本次未补做真实 Firefox／Safari 功能验收或完整 Edge 重启冒烟。商店审核及既有隐私／数据同意实现问题尚待确认，参见 [1.0 记录](submission-1.0.md)。
