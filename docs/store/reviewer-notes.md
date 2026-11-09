# Reviewer notes — Authenticator - 2FA

Contact: **support@macseek.cc**. No developer account, purchase, subscription or developer-hosted login is needed for basic use. Use only synthetic test accounts below. Optional browser sync needs the reviewer's own browser sync account; do not provide or request a real user's credentials.

## Basic test

1. Open the extension. It starts without a screen password in a fresh installation.
2. Add a manual TOTP account: service `Example`, account `demo@example.invalid`, secret `JBSWY3DPEHPK3PXP`, SHA-1, 6 digits, 30 seconds. Alternatively import:

   ```text
   otpauth://totp/Example:demo%40example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30
   ```

3. Confirm the account appears, a six-digit code changes with time, clicking it copies the code, and search, edit, favorite and reorder work. This is a public dummy secret, never an actual sign-in credential.
4. Export a password-protected backup with a test-only password. In a separate disposable installation, import it and compare the account parameters and current code. An incorrect backup password must fail. Plaintext export is a separate explicit choice.
5. Enable a screen password in Settings, explicitly lock, and reopen. Incorrect passwords must not open the interface. This is an interface lock: it does **not** encrypt local account secrets. Test data may be cleared without affecting real accounts.

## Optional features

- QR: encode the test URI as a QR image; import the image. Camera, screen capture and page-area selection require browser/system authorization. Declining access must leave manual import usable. Decoder JS/WASM is bundled; no QR service is contacted.
- Page filling: on a test HTTPS page with an identifiable OTP input (for example `autocomplete="one-time-code"`), invoke the extension and explicitly select the account. Confirm only the intended field is filled and no form is submitted. Optional persistent input menus need website permission. The page receives the chosen code and may see account labels in the menu, never the account secret.
- Sync: set an interface password first; create a group, securely save its separate recovery key, and join from another installation using the same browser sync account. Confirm records synchronize, local preferences do not, and disconnect preserves the remote group. Delete the sync group while connected, then clear local records on both installations. An authenticated remote deletion marker remains to prevent resurrection by offline devices. Safari account sync is unavailable.
- Time calibration: explicitly invoke calibration and grant Google website access. Expect HEAD requests to `https://www.google.com/generate_204` containing a random value, no account payload and no credentials. Denial/network failure must preserve usable local code generation.
- Passkeys: require a compatible WebAuthn PRF provider; availability varies. Firefox requests relying-party permission for `macseek.cc`, without uploading accounts there. Cancellation leaves the panel locked; screen-password fallback is available.
- Touch ID: optional, on supported Macs only. Chromium/Firefox need the separately installed native companion registered to the final extension ID. Safari uses its native container handler. No physical fingerprint test is possible without compatible hardware. The local companion sends no OTP secrets or passwords. Do not treat mocked native test replies as hardware verification.

Deletion is not secure erasure: individual deleted records retain their fields and secrets for sync conflict resolution. Clear all local data to remove those records; remote groups, exported files and other devices require separate deletion. See [privacy policy](../../PRIVACY.md).

## Source and build reproduction

The source archive includes TypeScript/React sources, the pnpm lockfile, build scripts and license files. Use Node.js 24 and the exact pnpm version specified by `packageManager` in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
```

`build.sh` increments the patch version by default. To reproduce a submitted source archive without changing its version, read that version and pass it explicitly through `BUILD_VERSION` in a disposable extracted source copy:

```sh
BUILD_VERSION="$(node -p 'require("./package.json").version')" ./build.sh
```

Compare the extracted submitted Firefox ZIP with `dist/firefox/`. Compare file contents rather than ZIP timestamps or Mozilla-added signature files. React, QR and other dependencies are fetched by pnpm; bundled ZXing WASM comes from the locked `zxing-wasm` package. No runtime remote code is needed. The extension resources do not require Xcode or the native companion to build. Do not use `build.sh store` for source reproduction; that additionally captures promotional screenshots with local Edge.

For a submission built with native options, include its matching native source and signing/distribution notes. The current local Safari converter and ad-hoc companion build are not signed public releases.
