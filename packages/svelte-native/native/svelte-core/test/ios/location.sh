#!/usr/bin/env bash
# Host check of what the iOS side of location says without CoreLocation (`SvelteLocationPayload`) and of what turns it on (`SvelteLocationFlag`): the words for the accuracy, the payload of a position
# (what iOS marks invalid with -1 is left out), the permission from CLAuthorizationStatus, the refusals and their codes, the options of a call, the age of a position, the registry of watches, and the
# Info.plist boolean `SvelteLocationEnabled`. No app, no phone, no Xcode project, no CoreLocation: it needs only `swiftc` (any macOS with the command line tools). The two files are compiled with
# `-D SVELTE_LOCATION`, the condition SvelteCore.podspec sets for an app that turned location on (without it they are empty: an app without location has no location code). From any directory.
# Usage: test/ios/location.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here/SvelteLocationCheck.swift" "$work/main.swift"
swiftc -warnings-as-errors -O -D SVELTE_LOCATION "$here/../../ios/location/SvelteLocationPayload.swift" "$here/../../ios/location/SvelteLocationFlag.swift" "$work/main.swift" -o "$work/location-check"
"$work/location-check"
