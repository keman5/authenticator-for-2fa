#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if command -v go >/dev/null 2>&1; then go clean -cache; fi
rm -rf .artifacts
trap 'rm -rf .artifacts' EXIT
node --input-type=commonjs <<'NODE'
const fs = require("node:fs");
const file = "package.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const explicit = process.env.BUILD_VERSION;
const parts = (explicit ?? data.version).split(".");
if (!(explicit === undefined ? parts.length === 3 : [2, 3].includes(parts.length)) ||
    parts.some(part => !/^(0|[1-9]\d*)$/.test(part) || !Number.isSafeInteger(Number(part))))
  throw new Error("Expected major.minor or major.minor.patch release version");
if (parts.length === 2) parts.push("0");
if (explicit === undefined) parts[2] = String(Number(parts[2]) + 1);
data.version = parts.join(".");
data.extensionVersion = explicit ?? data.version;
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
NODE
pnpm exec vite build
node scripts/build-extension.mjs
node scripts/verify-build.mjs
case "${1:-}" in
  package) node scripts/package-extension.mjs ;;
  store)
    node scripts/package-extension.mjs
    node scripts/prepare-store.mjs
    ;;
  native) bash native/build.sh ;;
  safari)
    app_name='Authenticator Workspace'
    rm -rf dist/safari-project dist/safari-native
    xcrun safari-web-extension-converter dist/safari --project-location dist/safari-project --app-name "$app_name" --bundle-identifier local.Authenticator-Workspace --swift --macos-only --no-prompt --no-open
    cat native/TouchID.swift native/SafariWebExtensionHandler.swift > "dist/safari-project/$app_name/$app_name Extension/SafariWebExtensionHandler.swift"
    xcodebuild -project "dist/safari-project/$app_name/$app_name.xcodeproj" -scheme "$app_name" -configuration Release -derivedDataPath dist/safari-native MACOSX_DEPLOYMENT_TARGET=13.3 ONLY_ACTIVE_ARCH=NO 'ARCHS=arm64 x86_64' CODE_SIGNING_ALLOWED=NO build
    rm -rf dist/safari-native/Build/Intermediates.noindex dist/safari-native/ModuleCache.noindex dist/safari-native/SDKStatCaches.noindex dist/safari-native/SDKExplicitPrecompiledModules dist/safari-native/Index.noindex dist/safari-native/Logs
    ;;
  '') ;;
  *) echo 'Usage: ./build.sh [package|store|safari|native]' >&2; exit 2 ;;
esac
