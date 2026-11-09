#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v go >/dev/null 2>&1; then go clean -cache; fi
rm -rf .artifacts dist/touch-id
app='dist/touch-id/Authenticator Touch ID.app'
mkdir -p "$app/Contents/MacOS" dist/touch-id/objects
for arch in arm64 x86_64; do
  xcrun swiftc -swift-version 6 -parse-as-library -O -target "$arch-apple-macosx13.3" -framework AppKit -framework LocalAuthentication native/TouchID.swift native/Host.swift -o "dist/touch-id/objects/$arch"
done
lipo -create dist/touch-id/objects/arm64 dist/touch-id/objects/x86_64 -output "$app/Contents/MacOS/AuthenticatorTouchID"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.Authenticator-Workspace.TouchID</string>
<key>CFBundleName</key><string>Authenticator Touch ID</string>
<key>CFBundleDisplayName</key><string>Authenticator - 2FA</string>
<key>CFBundleExecutable</key><string>AuthenticatorTouchID</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>13.3</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$app"
cp scripts/install-touch-id.mjs dist/touch-id/install-touch-id.mjs
rm -rf dist/touch-id/objects
