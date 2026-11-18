#!/usr/bin/env bash
# Host check of the Android side of location (SPEC.md, "Location"): the words JavaScript sends for the accuracy, the permission's state from the two Android permissions (the approximate one is
# enough), which providers a request tries (the fused provider from API 31, the GPS only with the precise permission, whichever is switched on, none is an answer and not a wait), the age of a
# position and the newest of several, the payloads (what the platform does not have is left out), the registry of watches, the enabled flag (svelte-core is in every app, so each call asks it
# first), and, in the sources, that the plain files stay plain, that no Google library is part of it, that svelte-core's manifests declare nothing of location, and that the module, the module
# config and the config plugin agree with src/geolocation.ts. No device, no Android SDK. Needs kotlinc and java; from any directory. CI: the engine-host job (apps/qa/qa/ci/host-tools.sh
# installs the pinned kotlinc). Usage: src/test/location.sh (or src/test/run.sh for all the host checks)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
android="$(cd "$here/../.." && pwd)"
library="$(cd "$android/../../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
main="$android/src/main/java/expo/modules/sveltelocation"

# The plain classes only: the module, the source of positions and the manifest reader need Android and are compiled by Gradle, not here.
kotlinc -nowarn \
  "$main/LocationRules.kt" "$main/LocationFix.kt" "$main/LocationWatches.kt" \
  "$here/kotlin/expo/modules/sveltelocation/LocationCheck.kt" -include-runtime -d "$work/location-check.jar"
java -cp "$work/location-check.jar" expo.modules.sveltelocation.LocationCheckKt \
  "$main" "$android" "$library/expo-module.config.json" "$library/src/capabilities.ts" "$library/src/geolocation.ts"
