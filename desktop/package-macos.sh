#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version")
app="dist/macos/Tracelo Capture.app"
mkdir -p "$app/Contents/MacOS"
for arch in arm64 x86_64; do
  swift build --package-path desktop --scratch-path "dist/swift-$arch" -c release --arch "$arch" --product TraceloCapture
done
lipo -create dist/swift-arm64/arm64-apple-macosx/release/TraceloCapture dist/swift-x86_64/x86_64-apple-macosx/release/TraceloCapture -output "$app/Contents/MacOS/TraceloCapture"
cp desktop/Info.plist "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $version" "$app/Contents/Info.plist"
codesign --force --sign - "$app"
codesign --verify --strict "$app"
lipo "$app/Contents/MacOS/TraceloCapture" -verify_arch arm64 x86_64
"$app/Contents/MacOS/TraceloCapture" --smoke-test
ditto -c -k --sequesterRsrc --keepParent "$app" "dist/Tracelo-Capture-$version-macos-universal.zip"
