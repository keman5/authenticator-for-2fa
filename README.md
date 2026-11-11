# Authenticator-For-2FA

A browser extension for generating and managing TOTP, HOTP and Steam verification codes, with account import/export, optional screen locking and encrypted browser sync.

[Privacy policy](PRIVACY.md) · [隐私政策](PRIVACY.zh-CN.md) · [Support](SUPPORT.md) · [Store submission materials](docs/store/README.md)

## Use

- Add accounts manually, import `otpauth://` links, QR images, Google migration QR codes, or JSON backups. Search, edit and reorder accounts from the code list.
- Click a code to copy it. HOTP has an explicit next-code action. Optional page fill writes only to identifiable OTP inputs and never submits a form.
- Optional page enhancement places its icon outside the OTP field's upper-right corner. Hover the icon for site-matched accounts; codes start masked with `*`, reveal only for the hovered or keyboard-focused row, and turn red in the final five seconds. Leaving a row masks it again. Only clicking an account fills the field.
- Password protection is off initially. Enable a screen password in Settings; one character is sufficient. This is an **interface lock**: account secrets remain unencrypted in this extension's local storage.
- The normal action defaults to Command+Shift+2 on macOS / Ctrl+Shift+2 elsewhere. Manage it from Settings → Passkey & shortcuts. Shortcuts follow the same screen-lock policy as clicking the extension icon.
- Auto-lock defaults to closing the panel. Choices are filtered by minutes, hours and days, with lock-on-close and never always available. Timed choices are every minute from 1–10 minutes, 30 minutes, every hour from 1–24 hours, and every day from 3–30 days. An existing 30-second setting switches to one minute and requires a fresh unlock. Successful password, passkey or Touch ID authentication starts a fresh deadline. Normal reopening and browser restart preserve access until that deadline. Explicit Lock clears the cached timestamp, including for forever. Timed panels check expiry once per second.
- Optional Touch ID on supported Macs verifies a fingerprint through Apple LocalAuthentication using the local authentication companion. A configured bridge is available on the lock screen. It does not encrypt local account data.
- Export an encrypted backup with a separate password, or an explicitly selected plaintext JSON/URI file. Backups contain accounts, not the screen password or cloud recovery key.
- Encrypted browser sync uses a separate recovery key. Create a sync group on the first device, copy its recovery key, then join on another device using the same browser sync account. Preferences and screen passwords remain local. Local account data and the recovery key are not encrypted by the screen password. Deleting a sync group retains an authenticated deletion marker so offline devices disconnect instead of recreating it. Safari's `storage.sync` is local only, so this sync option is disabled there. Different browser vendors do not share their sync services.

## Local development and builds

Requires Node.js 24 and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run build
./build.sh package
```

Build the requested `1.0` release with `BUILD_VERSION=1.0 ./build.sh store`. `extensionVersion` records the exact manifest/archive version; `package.json` keeps the corresponding npm-compatible `1.0.0`. Without `BUILD_VERSION`, the script increments the patch version automatically.

`build.sh` performs all builds locally and cleans Go's build cache when Go is available, plus this project's `.artifacts` cache. Output resources are `dist/chrome`, `dist/edge`, `dist/firefox` and `dist/safari`. Package archives and a review-source archive appear in `artifacts/` and are copied to `~/Downloads/dist/`. Third-party license notices are included. No build installs an extension, modifies browser profiles or publishes a release.

For a universal macOS Safari container, install Xcode and run:

```sh
./build.sh safari
```

This generates a new `Authenticator Workspace.app` with bundle identifier `local.Authenticator-Workspace`, built for arm64 and x86_64, under `dist/safari-native/Build/Products/Release/`. It is unsigned. Safari distribution requires Apple signing and the applicable distribution workflow. The extension inside retains the product name Authenticator-For-2FA.

## Touch ID on macOS

Chrome, Edge and Firefox need the local native-messaging companion. Build it locally:

```sh
./build.sh native
```

Copy the Chromium extension ID shown in Settings, then register the companion (this command explicitly installs into your user Library and registers the three browsers):

```sh
node scripts/install-touch-id.mjs YOUR_CHROMIUM_EXTENSION_ID
```

You can pass multiple Chromium IDs separated by spaces. Firefox uses the fixed extension ID automatically; local unpacked `dist/chrome` and `dist/edge` IDs are also included. Registration allows only these exact IDs. Restart the browser after registration if needed. A configured Touch ID bridge is available on the lock screen. No password, account secret or encryption key is sent to the native component. Cancelled or failed fingerprint verification leaves the panel locked, with the screen password available as fallback. Toolbar popups move into a persistent extension window for authentication because system dialogs can dismiss browser popups.

`./build.sh package` includes the built companion and installer in a separate macOS ZIP. After extracting it, run `node install-touch-id.mjs YOUR_CHROMIUM_EXTENSION_ID` from that folder. The companion is ad-hoc signed locally, not Developer ID signed or notarized; public distribution requires that separate signing workflow. Safari's generated app embeds the same Touch ID handler and needs no separate host registration, but must be signed and enabled through Safari's normal extension workflow.

The following background check validates the actual native framing, availability probe and installer in a disposable directory; it never requests a fingerprint or installs into your regular profile:

```sh
node scripts/check-native.mjs
```

An optional real-extension smoke check runs Edge in a temporary headless profile and removes the profile when done:

```sh
node scripts/check-ui.mjs
```

It uses the local Edge binary by default; set `EDGE_BINARY` to another Chromium-compatible binary if necessary. It does not open foreground windows or touch your everyday profile. It checks the React UI, real PNG QR import using the packaged WASM, layout heights, screen passwords, normal/direct entry, actual browser restarts and idle lock deadlines. Native authentication replies are simulated; this does not test a physical fingerprint or Firefox/Safari runtime behavior.

## Backup compatibility and distribution

Firefox uses the extension ID `authenticator-for-2fa@macseek.cc`. Store identities and signing are managed separately for each browser.

Portable account JSON, otpauth links and PBKDF2/AES-GCM backup envelopes are supported. Export accounts before moving between installations and compare generated codes after importing. Screen-lock settings, sync recovery keys and passkey enrollment stay local.

Mozilla signing is needed for ordinary Firefox installs. An unlisted signed XPI supports manual installation but does not provide automatic add-on installation through Firefox Sync. For that workflow, publish and obtain approval for your own public AMO listing, then enable add-on synchronization. Syncing the installation and syncing account records are separate operations. This repository's build does not submit or sign an XPI.

See `docs/architecture.md` for storage and security behavior, and `docs/testing.md` for validation commands. QR decoding runs locally. Optional time calibration requests HTTPS response headers from Google after permission is granted; it sends no account data. There is no remote executable code, analytics or developer-operated server.
