#!/usr/bin/env bash
# Host check of the blur view's rules (BlurRules: intensity, tints, colours, radius, the backdrop picture) and of what the module and the view must keep (its one view and
# two props; the view leaves itself out of its own backdrop). No device, no Android SDK. Needs kotlinc and java; from any directory. CI: the unit job
# (qa/ci/host-tools.sh installs the pinned kotlinc). Usage: src/test/blur.sh (or src/test/run.sh for all the host checks)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
main="$here/../main/java/expo/modules/svelteblur"

# expo-blur's own tint names: the library's copy of it (vendor/expo-blur), else an installed one.
tints=""
vendored="$here/../../../../../vendor/expo-blur"
if [ -d "$vendored/android" ]; then
  tints="$vendored/android/src/main/java/expo/modules/blur/enums/TintStyle.kt"
elif blur="$(cd "$here" && node -p "require('path').dirname(require.resolve('expo-blur/package.json', { paths: [process.cwd()] }))" 2>/dev/null)"; then
  tints="$blur/android/src/main/java/expo/modules/blur/enums/TintStyle.kt"
fi

kotlinc -nowarn "$main/BlurRules.kt" "$here/kotlin/expo/modules/svelteblur/BlurRulesCheck.kt" -include-runtime -d "$work/blur-check.jar"
java -cp "$work/blur-check.jar" expo.modules.svelteblur.BlurRulesCheckKt "$main/SvelteBlurModule.kt" "$main/SvelteBlurView.kt" "$main/Backdrop.kt" "$main/SoftCopies.kt" ${tints:+"$tints"}
