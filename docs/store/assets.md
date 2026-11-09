# 商店图片材料

运行根目录 `./build.sh store`，使用现有品牌 SVG 生成 PNG 图标，并在后台 Edge 临时配置中截取真实扩展页面。账户和密钥均为虚构演示数据，不读取日常浏览器或个人账户。输出为 `artifacts/store/`，同步复制到 `~/Downloads/dist/store/`。

`firefox/` 与 `edge/` 是各商店材料目录，包含独立命名的 `extension.zip`、中英文字段 JSON、图标、六张候选截图和 `SHA256SUMS`。Firefox 另含 `source.zip`。每个目录的 `submission.json` 标出准确版本、manifest locale、截图来源和未完成事项；`readyToSubmit: false` 表示仍需关闭提交门槛，不能把材料生成成功等同于可发布。

| 文件 | 规格／用途 |
| --- | --- |
| `icon-128.png` | Chrome、AMO／Opera 图标候选 |
| `icon-300.png` | Edge 商标图 |
| `icon-512.png` | 高分辨率品牌素材 |
| `icon-1024.png` | Safari 容器图标源素材；仍需集成 Xcode AppIcon 并核对不透明背景等规范 |
| `en/accounts-1280x800.png`、`zh-CN/accounts-1280x800.png` | 实际账户列表，Chrome／Edge 商品截图 |
| `en/data-1280x800.png`、`zh-CN/data-1280x800.png` | 实际导入／导出页，Chrome／Edge 商品截图 |
| `en/settings-1280x800.png`、`zh-CN/settings-1280x800.png` | 实际设置页，Chrome／Edge 商品截图 |
| `en/accounts-612x408.png`、`zh-CN/accounts-612x408.png` | Opera 尺寸候选，仍需在 Opera 中复拍并验证功能 |
| `material-version.json` | 截图对应的版本、演示数据说明与尺寸信息 |

1280×800 图片将实际 370×720 扩展画面等比例放在中性背景上，不添加安全性宣称或模拟控件。612×408 候选保留原比例缩小，不裁切隐藏控件。截图中的时间码来自公开演示密钥，不可用于真实服务。

Chrome 至少上传一张截图，最多五张；可使用 1280×800。Edge 接受 1280×800，最多六张，截图为可选项。两个商店另有 440×280 小宣传图和 1400×560 大宣传图字段，本材料未生成这两种可选图片；不要把账户截图直接拉伸当宣传图。AMO 按当前控制台要求上传图标及清晰截图。Opera 官方指南建议 612×408，最多 800×600，且展示真实浏览器环境；这里的 Edge 画面只作为复拍参考。

Safari 需从正式签名的 Mac 容器／Safari 扩展获取真实截图，并按 App Store Connect 对 Mac 的截图规格导出。不得将当前通用扩展截图标为 Safari 原生运行凭证。发布前人工检查每张图的语言、版本、显示完整性及实际平台一致性。

规范来源：[Chrome](https://developer.chrome.com/docs/webstore/images)、[Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)、[Opera](https://help.opera.com/en/extensions/publishing-guidelines/)、[Apple](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)。
