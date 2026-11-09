// Host check of the code record 44 carries for autoCorrect (AutoCorrectCode.h): what a commit's raw props say about the key, as the commits of a TextInput
// produce it. Usage: AutoCorrectCodeTest (src/test/run.sh)
#include "../../main/cpp/AutoCorrectCode.h"

#include <cstdio>

using expo::svelteengine::autoCorrectOfRaw;

static int failures = 0;
static void expect(const char *what, int32_t got, int32_t want) {
  if (got != want) {
    std::fprintf(stderr, "FAIL %s: got %d, want %d\n", what, got, want);
    failures++;
  }
}

int main() {
  // The commit that creates the input with autoCorrect={true} / {false}: the key is in the raw props with a boolean.
  expect("create with autoCorrect true", autoCorrectOfRaw(true, true, true), 1);
  expect("create with autoCorrect false", autoCorrectOfRaw(true, true, false), 2);
  // The commit that creates it without the prop, and every later commit that changes something else (the raw props carry only what changed): not part of the update.
  expect("create without the prop", autoCorrectOfRaw(false, false, false), -1);
  expect("an unrelated update", autoCorrectOfRaw(false, false, false), -1);
  // The commit that changes it, both ways.
  expect("change to false", autoCorrectOfRaw(true, true, false), 2);
  expect("change to true", autoCorrectOfRaw(true, true, true), 1);
  // The commit that removes it: React Native receives null.
  expect("removal", autoCorrectOfRaw(true, false, false), 0);
  expect("removal (a null never reads as true)", autoCorrectOfRaw(true, false, true), 0);
  if (failures == 0) std::puts("AutoCorrectCodeTest: all checks passed");
  return failures == 0 ? 0 : 1;
}
