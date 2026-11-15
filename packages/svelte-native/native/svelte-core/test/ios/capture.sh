#!/usr/bin/env bash
# Host check of the iOS capture sweep (`SvelteCaptureFiles`): what a process deletes from tmp/ReactNative when it starts. No app, no phone, no Xcode project:
# it needs only `swiftc` (any macOS with the command line tools, or a Swift toolchain on Linux). From any directory. Usage: test/ios/capture.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here/SvelteCaptureFilesCheck.swift" "$work/main.swift"
swiftc -warnings-as-errors -O "$here/../../ios/capture/SvelteCaptureFiles.swift" "$work/main.swift" -o "$work/capture-files-check"
"$work/capture-files-check"
