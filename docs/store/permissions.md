# Single purpose and permission justifications

The English text below is intended for store review fields. Compare it with the generated manifest for the exact package being submitted.

## Single purpose

Generate and manage one-time two-factor authentication codes, including adding accounts, importing and backing up account secrets, and optionally filling a selected verification-code field.

## Required permissions

| Manifest permission | Review explanation |
| --- | --- |
| `storage` | Save OTP accounts, preferences and optional interface-lock metadata locally. Optional account sync stores separately encrypted account copies in browser sync storage. Local account secrets are not encrypted by the interface lock. |
| `activeTab` | Access the current tab after a user action to obtain site context, fill a selected OTP input, or capture the visible page for local QR decoding. No background browsing-history collection is performed. |
| `scripting` | Inject packaged scripts for user-requested page QR selection, OTP input detection and code filling. Optional input menus use the same local scripts after website access is granted. No remotely hosted executable code is injected. |
| `nativeMessaging` | On supported Macs, communicate with the optional local Touch ID companion (or Safari native handler) for authentication availability and verification. Messages contain an action, nonce and display reason, not OTP secrets, screen passwords or encryption keys. Basic code generation works without a companion. |

## Optional website access

| Origin | Review explanation |
| --- | --- |
| `http://*/*`, `https://*/*` | Allow user-enabled OTP input menus on arbitrary sign-in sites. This access is optional. The scripts identify OTP fields, display account labels and fill the selected code only after user interaction. The destination page can read a filled code. No form submission or remote script loading occurs. |
| `https://www.google.com/*` (runtime request within the optional HTTPS pattern) | Only for user-selected time calibration: send HEAD requests to `/generate_204`, omit credentials, read time headers and save a local correction. No OTP secrets or account records are sent. Normal connection metadata reaches Google. |
| `https://macseek.cc/*` (Firefox runtime request within the optional HTTPS pattern) | Register a WebAuthn passkey using the relying-party domain `macseek.cc`. The extension does not use this permission to upload account records or fetch executable code from that domain. |

Camera and screen capture additionally use browser/system media permission prompts; they are not permission strings named `camera` or `desktopCapture` in the current manifest. Clipboard copy and user-triggered file export use web APIs; do not claim undeclared `clipboardRead`, `clipboardWrite` or `downloads` permissions. The extension does not request history, cookies, webRequest or geolocation APIs.

## Remote code field

**No.** All executable JavaScript and QR-decoder WebAssembly are bundled in the extension. The CSP permits local WASM execution with `wasm-unsafe-eval`; this does not fetch remote executable code. Browser sync transports encrypted data, and time calibration reads HTTPS headers. Neither path downloads code to execute. Dependency installation during a local build is separate from extension runtime behavior.

Current runtime CSP: `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self' data: https://www.google.com`.

## 中文填报提示

必需权限和可选网站授权分别解释。`activeTab` 不等于永久访问全部网站，`scripting` 也不代表远程代码。广泛站点权限用于用户开启的网页输入菜单；Google 校准和 Firefox 通行密钥是单独触发的用途。`nativeMessaging` 为可选功能服务，但目前仍属于安装包的必需 API 权限；不能写成“浏览器不会要求此权限”。功能未通过目标平台测试时不要宣称已验证。
