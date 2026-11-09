# Architecture

Authenticator - 2FA is a React browser extension. It generates TOTP, HOTP and Steam codes locally, decodes QR images using bundled WebAssembly, and stores plain structured-clone-safe records in extension storage.

## Modules

- `src/domain`: OTP algorithms, account validation, import/export formats, encrypted portable backups, record merging, contextual matching and UI models.
- `src/platform/repository.ts`: schema-2 workspace validation, serialized transactions and storage subscriptions.
- `src/platform/controller.ts`: account operations, React subscriptions, authentication deadlines and sync scheduling.
- `src/platform/session.ts`: panel authorization leases for page fill and capture operations.
- `src/platform/passkey.ts` and `src/platform/touchID.ts`: passkey verification and the native authentication bridge.
- `src/platform/sync.ts`: recovery-key encryption, account synchronization and authenticated group deletion markers.
- `src/platform/time.ts`: optional device-local clock correction using HTTPS response headers.
- `src/worker.ts` and `src/injected.ts`: sender validation, optional OTP input menus, controlled code filling and page QR selection.
- `src/app`, `src/features`, `src/shared` and `src/app.css`: screens, workflows and shared UI controls.

## Storage and protection

The workspace contains account records, local preferences, optional screen-lock metadata and an optional sync connection. Writes validate the entire document and serialize changes. Account updates reject stale edits; sync merges preserve device-local ordering and preferences.

Password protection is optional and disabled initially. A screen password protects access to the interface; it does not encrypt local account secrets or the local sync recovery key. Passkeys and Touch ID can authorize access to the same interface. Password-protected exports and cloud copies are encrypted separately.

Successful authentication starts a fixed access deadline. Reopening a panel or restarting the browser does not extend it. Explicit locking invalidates access, including permanent access. Late authentication results cannot reopen a manually locked panel. Sensitive account controls unmount while locked.

Portable backups contain account data and omit screen passwords, passkey enrollment and sync credentials. JSON, otpauth links, migration QR codes and supported password-protected envelopes can be imported. Validate the imported codes before relying on a new installation.

## Browser integration

Page filling and capture require a valid extension sender and an authorized workspace. Account labels may be returned to the page menu; secrets stay in the extension. Optional page menus request host access when enabled. Input filling must respect the selected target, existing values and OTP field hints, and never submit forms.

Camera and authentication operations use persistent extension windows where toolbar popups cannot retain the workflow. Media streams are released on cancellation, navigation, timeout and late permission completion.

## Network access

Browser sync encrypts account records with a separate recovery key and uses the browser's sync storage. Authenticated deletion markers prevent offline devices from recreating a deleted group. Safari sync storage is local, so account sync is disabled there.

Optional time calibration requests permission for `https://www.google.com/*` before sending HEAD requests to `/generate_204`. It omits credentials and sends no account data. The correction remains local to the device. A failed calibration preserves the last usable correction.

There is no remote executable code, analytics or application-operated server. Runtime scripts, QR decoding and WebAssembly are packaged locally.

## Distribution

`build.sh` builds locally, updates the patch version, clears Go's build cache when available and removes `.artifacts` on entry and exit. Generated resources cover Chrome, Edge, Firefox and Safari. ZIP packages and a source archive are written to `artifacts/` and copied to `~/Downloads/dist/`.

Safari's native container and the macOS authentication companion use the corresponding `build.sh` options. Store signing, notarization, publication and browser-profile installation are separate operations. Included license notices are packaged with the extension and source archive.
