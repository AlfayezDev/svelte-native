#!/usr/bin/env bash
# Host check of what iOS push maps (`SveltePushPayload`, `SveltePushEnvironment`) and of what turns it on (`SveltePushFlag`): an APNs payload to the message JavaScript receives, a
# provisioning profile to the build's `aps-environment`, and the Info.plist boolean `SveltePushEnabled`. No app, no phone, no Xcode project: it needs only `swiftc` (any macOS with the
# command line tools). From any directory. Usage: test/ios/message.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here/SveltePushMessageCheck.swift" "$work/main.swift"
swiftc -warnings-as-errors -O "$here/../../ios/push/SveltePushMessage.swift" "$here/../../ios/push/SveltePushEnvironment.swift" "$here/../../ios/push/SveltePushFlag.swift" "$work/main.swift" -o "$work/message-check"
"$work/message-check"
