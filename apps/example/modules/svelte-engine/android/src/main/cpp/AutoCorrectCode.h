#pragma once

#include <cstdint>

namespace expo::svelteengine {

/**
 * The code record 44 carries for `autoCorrect` (InputRules.kt: 1 on, 2 off, 0 removed, -1 not part of this update), from what the commit's
 * raw props say about the key. No React Native type, so `src/test/cpp/AutoCorrectCodeTest.cpp` compiles this header as it is.
 *
 * @param present whether the raw props of this commit have the key at all
 * @param isBool  whether its value is a boolean (a removed prop arrives as null)
 * @param value   the boolean, when it is one
 */
inline int32_t autoCorrectOfRaw(bool present, bool isBool, bool value) {
  if (!present) return -1;
  if (!isBool) return 0;
  return value ? 1 : 2;
}

} // namespace expo::svelteengine
