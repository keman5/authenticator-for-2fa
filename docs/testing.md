# Testing

Run validation locally from the repository root:

```sh
pnpm run check
pnpm run test
pnpm run build
```

`check` runs lint and both test and production TypeScript checks. Vitest runs logic and React workflow tests without foreground windows. `build` invokes `build.sh`, increments the patch version and verifies generated manifests, localization, packaged assets and self-contained content scripts.

## Automated coverage

- OTP standard vectors, Base32 handling, account validation, URI/migration parsing and encrypted backup round trips.
- Plain structured-clone-safe storage, serialized changes, stale edits, record deletion and sync convergence.
- Password and authentication deadlines, explicit locking, late authentication results and panel authorization.
- Manual account entry, search, favorites, filtering, ordering, copy feedback, imports, exports and QR navigation.
- Camera acquisition, media cleanup, screen-capture cancellation, timeout and late-result handling.
- Passkey enrollment, permission requests, verification, cancellation, default unlock behavior and route preservation.
- Translation completeness, catalog snapshots, localized feedback, window geometry and popup sizing.
- Sender validation, optional input menus, safe OTP replacement and page-region selection.
- Clock calibration permissions, latency correction, persistence and failure handling.

## Browser checks

Build the extension first, then run the isolated background checks:

```sh
node scripts/check-ui.mjs
node scripts/check-input-menu.mjs
```

These scripts use the installed Edge binary with disposable headless profiles. They do not modify normal browser profiles. `EDGE_BINARY` can select another compatible binary.

The UI check exercises built resources, real PNG/WASM import, multiple viewport heights, password workflows, shortcut settings, restart persistence and fixed authentication deadlines. The input-menu check exercises actual page filling, preservation of unrelated or incompatible input values, menu cleanup and account UI behavior.

For the native authentication bridge:

```sh
bash native/build.sh
node scripts/check-native.mjs
```

The native check validates framing, bounded requests, a noninteractive availability probe and installation into a disposable directory. It does not request a fingerprint.

## Manual acceptance

Verify actual toolbar popup sizing and small-window layouts in each target browser. Exercise a physical camera, the operating system's screen picker and permissions, a compatible real passkey and Touch ID. Verify synchronization using two signed-in devices. Compilation, simulated media, credential fixtures and local sync storage do not prove those outcomes.

Before distribution, verify the package version, license notices, store identity and required signing. Build commands do not publish or replace an installed browser extension.
