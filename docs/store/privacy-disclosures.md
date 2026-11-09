# 商店隐私表单填写依据

本文件供发布者填写审核表，不是用来替代公开隐私政策或产品内授权。不同商店对“处理”“传输”“收集”的定义不同，不能将“没有开发者服务器”等同于“不处理用户数据”。对照最终上传包逐项确认。

## 数据流核对

| 数据 | 本地用途 | 离开扩展／设备的情形 |
| --- | --- | --- |
| 账户名、邮箱标签、OTP 密钥、参数和验证码 | 生成、显示、管理验证码；密钥本地明文存储 | 开启同步时加密账户副本进入浏览器厂商服务；用户导出／复制；网页填充时仅验证码进入目标页，菜单可能显示账户标签 |
| 网页主机名／标题、输入框和页面像素 | 网站匹配、输入菜单、填充、二维码解码 | 不上传给开发者；填充代码进入用户选择的目标网页 |
| 选择的文件、图片、相机／屏幕画面 | 本地 QR 和备份导入 | 不上传给远程解码器；解码账户可能按用户选择同步或导出 |
| 界面锁元数据、通行密钥元数据、偏好 | 本机界面访问与设置 | 不在账户备份／同步中；系统凭据提供方可能自行同步通行密钥 |
| 同步组／记录标识、密文和删除信息 | 浏览器同步与冲突解决 | 浏览器厂商服务；删除组后保留组标识和认证删除标记 |
| IP 与普通请求元数据 | 校准时读取远程时间头 | Google HTTPS 请求；无账户密钥或验证码载荷 |
| Touch ID 操作、随机挑战及原因文本 | 本机可选身份验证 | nativeMessaging 发送至本机组件；无账户密钥、密码或生物模板 |
| 主动发出的支持邮件 | 解决用户问题 | 邮件服务商和维护者；GitHub 公开 issue 另外公开 |

源码核对入口：`src/platform/repository.ts`、`controller.ts`、`sync.ts`、`time.ts`、`passkey.ts`、`touchID.ts`、`src/worker.ts`、`src/injected.ts`、`src/domain/portable.ts`、`native/TouchID.swift`。

## Chrome / Edge 数据使用字段

建议按实际处理范围至少披露以下类型，并用上表解释本地处理及可选传输：

- **Personally identifiable information**：账户用户名／邮箱标签。
- **Authentication information**：OTP 密钥、验证码及界面锁／认证元数据。
- **Web history / browsing activity**：当前网站的主机名／标题用于匹配，而非完整历史数据库。
- **Website content**：所选页面二维码／像素、验证码输入框和填入的验证码。

不因本地处理就省略这些数据。若控制台另将相机图片、用户提供的备份归入用户内容，应据实际分类补选。不能因截图中可能偶然包含财务等内容，就声称产品在专门收集该类信息；按实际功能与控制台定义填写。

可确认的用途是提供所述功能；没有广告、出售数据、数据经纪或信用用途。只有在最终代码和政策一致时，才勾选“不出售／不用于与核心功能无关用途／不用于信用评估”等声明。远程代码选择 **No**，理由见 [permissions.md](permissions.md)。

**发布缺项：**本地账户密钥／恢复密钥仍为明文。不要把“云副本加密”写成“所有敏感数据静态加密”。Chrome 的 [用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) 要求披露本地处理，并提出安全存储要求；当前实现需要整改或取得明确审核确认。隐私政策如实说明并不能代替安全实现。

## Firefox AMO 与内置同意

当前生成器 `scripts/build-extension.mjs` 声明 `required: ["none"]`，没有 `optional` 类型，也没有 `permissions.request({data_collection: [...]})` 授权门控。现有网站权限提示不等于 Firefox 数据传输同意。

Mozilla 的 [内置同意文档](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) 要求声明扩展／本地浏览器以外的数据处理；仅有可选传输时可以保留 `required: ["none"]`，另声明可选类型并在使用前请求授权。[现行政策](https://extensionworkshop.com/documentation/publish/add-on-policies/) 也涵盖 nativeMessaging。

提交前需要实际解决：

1. 为加密账户同步评估 `authenticationInfo`、`personallyIdentifyingInfo`（用户名／邮箱标签），以及账户关联网站可能涉及的 `browsingActivity`；加密不是自动豁免。
2. 为时间校准与本机认证按传出的实际字段确认适用类型，必要时向 AMO 明确询问；不能因为没有开发者后台就认定没有传输。不要把未读取的生物模板声明成已收集。
3. 如适用，声明相应 `optional` 类型、使用前请求 `data_collection` 权限、检测拒绝／撤销并停止对应数据流；若不实施，则在 Firefox 发布构建移除相关传输功能并重新核对声明。不要把本段候选类型直接作为已完成的 manifest 配置。
4. 真实 Firefox 中测试安装、单项拒绝／同意、授权撤销、重启与已连接同步组。当前最低版本为桌面 140、Android 142；最低版本声明不构成移动端功能验收。

## Safari / App Store Connect

Apple 的 [App Privacy 定义](https://developer.apple.com/app-store/app-privacy-details/) 关注离开设备并由开发者或第三方合作方在实时请求所需时间之外留存的数据；与 Chrome 的本地处理披露定义不同。

当前 Safari 账户同步禁用，没有分析／广告 SDK，QR 在本机处理，Touch ID 使用本机处理程序。因此本地账户、图片、指纹模板不应因本地使用而直接填成远程收集。跟踪广告用途为 **No**。

“Data Not Collected”只能作为**最终核实后的候选答案**：需检查正式容器／所有依赖、Google 时间校准连接的处理与留存、系统凭据提供方，以及是否增加了应用内支持或诊断上传。如存在符合 Apple 定义的留存，应据实际选择相应标识／用户内容／诊断等类型并注明功能用途和关联性。不能直接照搬 Chrome 的勾选表，也不能保证当前未签名 Web 资源包已满足 App Store 要求。

没有开发者注册账户；不要捏造登录凭证或账户注销服务。OTP 数据清除和同步删除不等于开发者账户注销。出口合规另按最终 PBKDF2／AES-GCM／WebCrypto 使用和发行地区判断，不要未经审核自动填写免申报。
