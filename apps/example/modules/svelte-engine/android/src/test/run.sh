#!/usr/bin/env bash
# Host checks of the typed animated path (SPEC.md, "Animated write path"): the C++ encoder against Reanimated-shaped
# command streams, then the Kotlin decoder against the buffers the C++ test verified; and the foreign-view ownership
# rules (SPEC.md, "Foreign views"). No device, no Android SDK.
# Needs g++ (C++20) and kotlinc. Usage: src/test/run.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

g++ -std=c++20 -O1 -Wall -Wextra -Werror -fsanitize=address,undefined "$here/cpp/ForeignSplitTest.cpp" -o "$work/foreign-test"
"$work/foreign-test"

g++ -std=c++20 -O1 -Wall -Wextra -Werror -fsanitize=address,undefined "$here/cpp/AnimatedWireTest.cpp" -o "$work/wire-test"
"$work/wire-test" "$work/fixture.tsv"

kotlinc -nowarn "$here/../main/java/expo/modules/svelteengine/AnimatedWire.kt" \
  "$here/kotlin/expo/modules/svelteengine/AnimatedWireCheck.kt" -include-runtime -d "$work/check.jar"
java -cp "$work/check.jar" expo.modules.svelteengine.AnimatedWireCheckKt "$work/fixture.tsv"
