#!/usr/bin/env bash
# Host check of the Android side of push (PUSH.md, "Android"): the mapping of a message to and from the RemoteMessage and the intent extras, the launch-message and `opened`
# rule, the de-duplication of taps, the events kept for a JavaScript that is not listening, the background wait and its limit, the foreground wait for `show`, the foreground
# count, the permission and channel rules, the enabled flag (svelte-core is in every app, so each entry into push asks it first), and, in the sources, that the plain files stay
# plain, that Firebase is compile-time only and named by two classes, that svelte-core's manifest declares nothing of push, and that the module, module config and config plugin agree
# with src/push/client.ts. No device, no Android SDK, no Firebase. Needs kotlinc and java; from any directory. CI: the engine-host job (apps/qa/qa/ci/host-tools.sh installs the pinned
# kotlinc). Usage: src/test/push.sh (or src/test/run.sh for all the host checks)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
android="$(cd "$here/../.." && pwd)"
library="$(cd "$android/../../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
main="$android/src/main/java/expo/modules/sveltepush"

# The plain classes only: the module, the service, the notifier, the manifest reader, the Firebase calls and the Activity listener need Android and are compiled by Gradle, not here.
kotlinc -nowarn \
  "$main/PushMessage.kt" "$main/PushMapping.kt" "$main/PushEvents.kt" "$main/PushTaps.kt" "$main/PushWaits.kt" "$main/PushRules.kt" "$main/PushDelivery.kt" "$main/ForegroundTracker.kt" \
  "$here/kotlin/expo/modules/sveltepush/PushCheck.kt" -include-runtime -d "$work/push-check.jar"
java -cp "$work/push-check.jar" expo.modules.sveltepush.PushCheckKt \
  "$main" "$android/src/main" "$library/expo-module.config.json" "$library/src/capabilities.ts" "$library/src/push/client.ts" "$android/build.gradle" "$android/consumer-rules.pro"
