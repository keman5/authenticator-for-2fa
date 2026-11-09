# Privacy Policy — Authenticator - 2FA

Effective date: November 9, 2026

[简体中文](PRIVACY.zh-CN.md)

This policy covers Authenticator - 2FA and its optional local authentication companion. The project maintainer can be contacted at **support@macseek.cc**. Project information: <https://github.com/keman5/authenticator-2fa>.

## Account information and local storage

The extension processes the accounts you add or import: service names, usernames or email labels, OTP secret keys, account identifiers, site associations, OTP settings, counters, favorites, ordering and modification/deletion records. It generates TOTP, HOTP and Steam verification codes on your device. Basic code generation does not require an account with the developer or a network connection.

Account records and preferences are saved in the extension's local browser storage. **Local account secrets and the local browser-sync recovery key are not encrypted by this extension.** The optional screen password, passkey and Touch ID protect access to the interface; they do not encrypt these local records. Password protection is initially disabled. Screen-lock verification metadata and authentication deadlines are stored locally. Protect your operating-system account and browser profile.

## QR images, camera and screen capture

Files you select, QR images, camera frames and screen/page captures are processed on your device with the bundled QR decoder. They are not uploaded to a remote decoding service. Camera or screen capture starts through a user action and the applicable browser/system permission prompt. Capture streams are stopped when the operation ends or is cancelled. Decoded accounts may be saved to local storage; the extension does not intentionally keep a separate camera recording or screenshot archive.

## Webpage interaction and clipboard

When you use site matching or page filling, the extension reads the active page's hostname and may read its title. After authorization it can inspect a selected page for QR codes or identify OTP inputs. Optional input menus require website access. Account labels can appear in those menus. When you choose an account to fill, its current verification code is sent to the destination webpage; that website can read it and handles it under its own policy. The extension does not send the underlying OTP secret to the page or submit the sign-in form.

Copy actions place codes or a sync recovery key on the system clipboard. Other software and clipboard-history services may access copied content under their own permissions and policies.

## Optional encrypted browser sync

If you enable account sync, the extension encrypts account records with a separate recovery key before writing them to the browser vendor's sync service through `storage.sync`. Encrypted records, record identifiers, a group identifier and deletion metadata are handled by that service and your other connected installations. The recovery key remains in local extension storage and is shared with another installation only when you transfer it yourself. The screen password, passkey enrollment and local preferences are not included in this account-sync payload.

Sync depends on your browser account, vendor settings, quotas and service availability. The browser vendor handles service/account/connection information under its own policy. Different vendors do not share a sync service. Account sync is disabled in the Safari version because its sync storage is local only. The developer does not operate an account-sync server or receive the recovery key through this feature.

## Optional time calibration

After you select time calibration and grant website permission, the extension sends HTTPS HEAD requests to `https://www.google.com/generate_204` to read response time headers. Requests omit credentials and contain a fresh random request value, not an account secret or verification code. Google receives normal connection information, including your IP address and request metadata, and handles it under [Google's privacy policy](https://policies.google.com/privacy). The calculated clock offset and calibration time are stored locally. This feature does not change your system clock.

## Optional passkeys and local authentication

Passkey enrollment and verification use the browser/operating system's WebAuthn service. Credential identifiers, wrapping metadata and a verification token are kept locally. The passkey provider may store or sync a credential under its own policies. Firefox enrollment requests permission for the relying-party domain `macseek.cc`; the extension does not make an HTTP request to that site to upload your accounts. Passkeys are for the interface lock, not local account encryption.

On supported Macs, the optional local companion or Safari handler uses Apple LocalAuthentication for Touch ID. The extension sends an authentication action, random challenge and display reason to that local component, and receives an availability or verification result. No screen password, OTP secret or account encryption key is sent to it. The extension and companion do not receive fingerprint images or biometric templates. Your system or passkey provider controls biometric processing.

## Backups and exports

Exports are saved to the location you choose through the browser. Password-protected backups use PBKDF2 and AES-GCM encryption with a separate export password. Plaintext JSON, OTP links and account QR codes contain secrets readable by whoever can access them. Exported files, printed QR codes, screenshots, external backups and copies you share are outside the extension's control. Keep them secure. Exported account backups exclude the screen password, passkey enrollment and sync recovery key.

## Developer collection and support

The extension contains no advertising, analytics or tracking SDK and does not send accounts or usage telemetry to a developer-operated server. We do not sell user data, use it for advertising or credit decisions, or transfer it to data brokers. Data handling is limited to the described user-facing functions and support. Human access to information voluntarily sent for support is limited to addressing that request, security, or legal obligations.

If you email support, we receive the address, message and attachments you send through our email provider. If you open a public GitHub issue, its contents are public and GitHub processes them under its own policy. **Never send OTP secrets, recovery keys, live verification codes, passwords or unredacted backups.** Support correspondence is retained only as needed to resolve requests, address security issues and meet applicable obligations; contact us to request deletion. Visiting a hosted policy/support page is also subject to its hosting provider's normal connection handling.

## Retention, deletion and your choices

- Local information remains until you change it, clear the extension's data or remove the installation. Deleting an individual account removes it from the visible list but retains a deletion record, **including the account fields and secret**, for sync conflict resolution. It is not secure erasure.
- To clear local account records and screen-lock/passkey metadata, use the data screen's clear-all/reset action. The separately stored clock correction and browser-granted permissions may remain; clear the extension's browser data or remove it to clear installation storage, and revoke permissions in browser settings. A passkey held by your credential provider must be deleted there separately.
- Disconnecting sync removes the connection from this installation; it does not delete the remote group. To remove remote account records, use **Delete sync group while still connected**, and then clear local data on each device. A small authenticated deletion marker and group identifier remain in sync storage to prevent offline installations from recreating that group. Service-side backups and retention are controlled by the browser vendor.
- Uninstalling or clearing local data does not delete remote sync groups, other installations, exported files, system backups or clipboard history. Delete those copies separately. The developer cannot recover your secrets or recovery key or remotely erase your local records.
- Camera, screen capture, website permissions, page menus, sync and time calibration are optional. Decline or revoke permissions to limit access; related features will be unavailable. You may access, edit and export your accounts in the extension. For support information we hold, contact **support@macseek.cc** to request access, correction or deletion.

## Changes and contact

We will update this policy and its effective date when data handling changes. Material changes requiring consent will be handled through the applicable product/browser consent flow. Privacy and security questions: **support@macseek.cc**.
