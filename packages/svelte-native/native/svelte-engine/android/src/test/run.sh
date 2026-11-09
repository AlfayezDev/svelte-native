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

# What the accessibility hot path decides without asking Android: when a content description is built again, what an EngineText has told the live regions, the answer read once per frame.
kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/A11yWire.kt" \
  "$here/../main/java/expo/modules/svelteengine/A11yRules.kt" \
  "$here/../main/java/expo/modules/svelteengine/A11yLive.kt" \
  "$here/kotlin/expo/modules/svelteengine/A11yLiveCheck.kt" -include-runtime -d "$work/a11y-live-check.jar"
java -cp "$work/a11y-live-check.jar" expo.modules.svelteengine.A11yLiveCheckKt

# The code record 44 carries for autoCorrect, from a commit's raw props (create, change, unrelated update, removal).
g++ -std=c++20 -O1 -Wall -Wextra -Werror -fsanitize=address,undefined "$here/cpp/AutoCorrectCodeTest.cpp" -o "$work/autocorrect-test"
"$work/autocorrect-test"

# The text input's autoCorrect tri-state, against React Native's own setAutoCorrect.
kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/InputRules.kt" \
  "$here/kotlin/expo/modules/svelteengine/InputRulesCheck.kt" -include-runtime -d "$work/input-rules-check.jar"
java -cp "$work/input-rules-check.jar" expo.modules.svelteengine.InputRulesCheckKt \
  "$rn/ReactAndroid/src/main/java/com/facebook/react/views/textinput/ReactTextInputManager.kt" \
  "$here/../main/java/expo/modules/svelteengine/views/EngineInput.kt" \
  "$here/../main/cpp/AutoCorrectCode.h"

# What a header and a sheet decide from measurements that are not there yet (the first layout of a screen runs detached): the bar's offset, when a header lays out
# again, when a layout puts a sheet at its rest. The sources of EngineHeader, EngineSheet and EngineStack are read for the calls that use them.
kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/ChromeRules.kt" \
  "$here/kotlin/expo/modules/svelteengine/ChromeRulesCheck.kt" -include-runtime -d "$work/chrome-check.jar"
java -cp "$work/chrome-check.jar" expo.modules.svelteengine.ChromeRulesCheckKt "$here/../main/java/expo/modules/svelteengine/views/EngineHeader.kt" \
  "$here/../main/java/expo/modules/svelteengine/views/EngineSheet.kt" "$here/../main/java/expo/modules/svelteengine/views/EngineStack.kt"

# The order the engine applies Fabric's transactions in (SPEC.md, "Transaction order"): the main thread, asked to apply a transaction, applies the ones the JavaScript
# thread pulled before it first; MountingManager's source is read for the one call that applies a batch.
kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/TransactionOrder.kt" \
  "$here/kotlin/expo/modules/svelteengine/TransactionOrderCheck.kt" -include-runtime -d "$work/transaction-order-check.jar"
java -cp "$work/transaction-order-check.jar" expo.modules.svelteengine.TransactionOrderCheckKt "$here/../main/java/expo/modules/svelteengine/MountingManager.kt"

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

# The default of the status and navigation bars (SPEC.md, "Screen API contract": `auto` follows the system) and that the window is written the first time.
kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/SystemBarsRules.kt" \
  "$here/kotlin/expo/modules/svelteengine/SystemBarsRulesCheck.kt" -include-runtime -d "$work/system-bars-check.jar"
java -cp "$work/system-bars-check.jar" expo.modules.svelteengine.SystemBarsRulesCheckKt
