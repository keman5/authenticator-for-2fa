# Support — Authenticator - 2FA

Email: **support@macseek.cc**
Public issue tracker: <https://github.com/keman5/authenticator-for-2fa/issues>
Privacy: [English](PRIVACY.md) · [简体中文](PRIVACY.zh-CN.md)

For a bug report, include the extension version, browser/OS versions, expected behavior, actual behavior and steps to reproduce with a dummy account. Redact account names, email labels, website details and screenshots as needed. Never attach real OTP secrets, passwords, recovery keys, current codes or backups. Send security reports privately by email, not in a public issue.

If codes are rejected, check the selected account, OTP settings and device clock. Time calibration is optional and contacts Google after permission. HOTP counters must match the service; avoid advancing them unnecessarily. Keep each service's recovery methods available.

The screen password is an interface lock and cannot encrypt local account secrets. Passkeys and Touch ID depend on browser/system support; the screen password is the fallback. The developer cannot retrieve account secrets or a lost sync recovery key. Before resetting or uninstalling, export a password-protected backup and verify that it can be imported. See the privacy policy for deletion steps, including separate remote sync-group deletion.

## 中文支持

联系邮箱：**support@macseek.cc**。公开问题可提交至上方 GitHub 链接；安全漏洞请私下发邮件。

请提供扩展、浏览器及系统版本、预期与实际表现，并尽量用虚构账户复现。不要发送真实密钥、密码、恢复密钥、有效验证码或备份，截图也请脱敏。验证码不匹配时先检查账户参数和系统时间；HOTP 需核对计数器。重置或卸载前，请导出加密备份并验证可恢复。开发者无法找回账户密钥或丢失的同步恢复密钥。
