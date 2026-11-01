#!/usr/bin/env bash
# Host checks of the typed animated path (SPEC.md, "Animated write path"): the C++ encoder against Reanimated-shaped
# command streams, then the Kotlin decoder against the buffers the C++ test verified; and the foreign-view ownership
# rules (SPEC.md, "Foreign views"); what the view-shot capture decides before it draws (CaptureRules); the pointer-events mapping and
# the ids react-native-gesture-handler reads from an engine view, and who may claim a touch (SPEC.md, "Gestures"); the accessibility records,
# C++ encoder against the Kotlin decoder, and the Kotlin tables against React Native's own sources (SPEC.md, "Accessibility props"). No device, no Android SDK.
# Needs g++ (C++20), kotlinc and java; from any directory. CI: the unit job (qa/ci/host-tools.sh installs the pinned kotlinc). Usage: src/test/run.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# React Native's own `componentNameByReactViewName` (a pure function of std::string) is compiled in: the delegate registers foreign names through it.
rn="$(cd "$here" && node -p "require('path').dirname(require.resolve('react-native/package.json', { paths: [process.cwd()] }))")"
g++ -std=c++20 -O1 -Wall -Wextra -Werror -fsanitize=address,undefined -I"$rn/ReactCommon" "$here/cpp/ForeignSplitTest.cpp" "$rn/ReactCommon/react/renderer/componentregistry/componentNameByReactViewName.cpp" -o "$work/foreign-test"
"$work/foreign-test"

g++ -std=c++20 -O1 -Wall -Wextra -Werror -fsanitize=address,undefined "$here/cpp/AnimatedWireTest.cpp" -o "$work/wire-test"
"$work/wire-test" "$work/fixture.tsv"

# The accessibility records: React Native's plain structs (AccessibilityPrimitives.h) are the only header the encoder includes.
rn="$(node -p "require('path').dirname(require.resolve('react-native/package.json', { paths: [process.argv[1]] }))" "$here")"
g++ -std=c++20 -O1 -Wall -Wextra -Werror -fsanitize=address,undefined -I"$rn/ReactCommon" "$here/cpp/A11yWireTest.cpp" -o "$work/a11y-wire-test"
"$work/a11y-wire-test" "$work/a11y.tsv"

kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/A11yWire.kt" \
  "$here/../main/java/expo/modules/svelteengine/A11yRules.kt" \
  "$here/kotlin/expo/modules/svelteengine/A11yRulesCheck.kt" -include-runtime -d "$work/a11y-check.jar"
java -cp "$work/a11y-check.jar" expo.modules.svelteengine.A11yRulesCheckKt "$work/a11y.tsv" \
  "$rn/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.kt" \
  "$rn/ReactAndroid/src/main/java/com/facebook/react/uimanager/BaseViewManager.java" \
  "$rn/ReactCommon/react/renderer/components/view/AccessibilityPrimitives.h"

kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/AnimatedWire.kt" \
  "$here/kotlin/expo/modules/svelteengine/AnimatedWireCheck.kt" -include-runtime -d "$work/check.jar"
java -cp "$work/check.jar" expo.modules.svelteengine.AnimatedWireCheckKt "$work/fixture.tsv"

kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/CaptureRules.kt" \
  "$here/kotlin/expo/modules/svelteengine/CaptureCheck.kt" -include-runtime -d "$work/capture-check.jar"
java -cp "$work/capture-check.jar" expo.modules.svelteengine.CaptureCheckKt

kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/CaptureFiles.kt" \
  "$here/kotlin/expo/modules/svelteengine/CaptureFilesCheck.kt" -include-runtime -d "$work/capture-files-check.jar"
java -cp "$work/capture-files-check.jar" expo.modules.svelteengine.CaptureFilesCheckKt

# RNGH's own Pan source: the distance rule the edge swipe and the sheet's drag are tied to is read from it, not copied.
rngh="$(node -p "require('path').dirname(require.resolve('react-native-gesture-handler/package.json', { paths: [process.argv[1]] }))" "$here")"
views="$here/../main/java/expo/modules/svelteengine/views"
kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/GestureRules.kt" \
  "$here/../main/java/expo/modules/svelteengine/ClaimRules.kt" \
  "$here/../main/java/expo/modules/svelteengine/LabSwitches.kt" \
  "$here/kotlin/com/facebook/react/uimanager/PointerEvents.kt" \
  "$here/kotlin/expo/modules/svelteengine/GestureRulesCheck.kt" -include-runtime -d "$work/rules.jar"
java -cp "$work/rules.jar" expo.modules.svelteengine.GestureRulesCheckKt "$views/HitTest.kt" "$views/EngineRoot.kt" "$views/EngineStack.kt" "$views/EngineSheet.kt" \
  "$rngh/android/src/main/java/com/swmansion/gesturehandler/core/PanGestureHandler.kt" "$here/../main/java/expo/modules/svelteengine/SvelteEngineModule.kt"
