import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// When the Android engine publishes the keyboard's insets (`Insets.kt`, SPEC.md "Insets and keyboard"). Kotlin is checked on the host by the engine checks; what the
// callback does at each step of an IME animation is read from the source: the window dispatches the end state between `onPrepare` and `onStart`, so the end state is
// published in `onStart` and again in `onEnd`. Published in `onPrepare`, it was still the start state, and the content moved only once the keyboard had finished (#109).
const source = readFileSync(resolve(import.meta.dirname, "../../../native/svelte-core/android/src/main/java/expo/modules/svelteengine/Insets.kt"), "utf8");

/** The body of the callback's `override fun <name>(`, up to the next `override fun`. */
function body(name: string): string {
  const from = source.indexOf(`override fun ${name}(`);
  expect(from).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("override fun ", from + 1);
  return source.slice(from, next === -1 ? undefined : next);
}

test("an IME animation is published when it starts and when it ends, not when it is prepared", () => {
  // A prepared animation makes the keyboard busy (`animating` is `frames.busy`), which holds the publishing back until the start.
  expect(source).toContain("private val animating: Boolean get() = frames.busy");
  expect(body("onPrepare")).toContain("frames.prepare(");
  expect(body("onPrepare")).not.toContain("publish()");
  expect(body("onStart")).toContain("publish()");
  expect(body("onStart")).toContain("return bounds");
  expect(body("onEnd")).toContain("frames.end(");
  expect(body("onEnd")).toContain("publish()");
  // Each step looks at IME animations only.
  for (const name of ["onPrepare", "onStart", "onEnd"]) expect(body(name)).toContain("WindowInsetsCompat.Type.ime()");
});
