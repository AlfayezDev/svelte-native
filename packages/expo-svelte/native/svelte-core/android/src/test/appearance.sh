#!/usr/bin/env bash
# Host check of the app's night mode on Android (`expo.modules.svelteappearance`): the mode of each `userInterfaceStyle`, and the meta-data name the config plugin writes. No device, no
# Android SDK. Needs kotlinc and java; from any directory. Usage: src/test/appearance.sh (or src/test/run.sh for all the host checks)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
android="$(cd "$here/../.." && pwd)"
library="$(cd "$android/../../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
main="$android/src/main/java/expo/modules/svelteappearance"

# The plain rules only: the package needs Android and AppCompat and is compiled by Gradle, not here.
kotlinc -nowarn "$main/AppearanceRules.kt" "$here/kotlin/expo/modules/svelteappearance/AppearanceCheck.kt" -include-runtime -d "$work/appearance-check.jar"
java -cp "$work/appearance-check.jar" expo.modules.svelteappearance.AppearanceCheckKt "$library/src/user-interface-style.ts"
