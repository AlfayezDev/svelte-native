import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// The release build of Expo SDK 58's template runs R8, which renames or strips what nothing calls by name. A lookup by name in the engine's Kotlin then fails, and
// usually falls back quietly: the `focus` and `blur` commands once found the input's methods by name, and under R8 fell back to `clearFocus()`, which left the
// keyboard open. Every lookup by name is therefore one whose target R8 keeps, and listed here with what keeps it.
const root = resolve(import.meta.dirname, "../../../native/svelte-core/android/src/main/java");
const kept: Record<string, string> = {
  // React Native's `PreparedLayout`: its getters are `@DoNotStrip`, and the fields are the fallback.
  "expo/modules/svelteengine/TextLayouts.kt": 'getMethod("getLayout") getMethod("getVerticalOffset") getDeclaredField("layout") getDeclaredField("verticalOffset")',
  // The vendored Reanimated's hook, kept by its own rules (`com.swmansion.reanimated.**`).
  "expo/modules/svelteengine/SvelteEngineModule.kt": 'Class.forName("com.swmansion.reanimated.SvelteEngineHook") getMethod("setUpdater" getMethod("setKeyboardSubscribe" getMethod("setKeyboardUnsubscribe"',
  // A field of Fabric's event dispatcher, kept by the module's `consumer-rules.pro`.
  "expo/modules/svelteengine/EventBeat.kt": 'getDeclaredField("postEventDispatchListeners")',
  // The platform's `Canvas` Z ordering before API 29 (`insertReorderBarrier` and `insertInorderBarrier` are hidden there, as `CanvasUtil` in React Native reaches them), and the
  // lookup of one on API 28 through `Class.getDeclaredMethod` itself: framework classes, not the app's code. From API 29 the calls are `Canvas.enableZ` and `disableZ`.
  "expo/modules/svelteengine/views/CanvasZ.kt": 'getDeclaredMethod("getDeclaredMethod" getDeclaredMethod("insertReorderBarrier") getDeclaredMethod("insertInorderBarrier")',
  // A field of the framework's scroll views, which are not in the app's code.
  "expo/modules/svelteengine/views/EngineScroll.kt": 'getDeclaredField("mScroller")',
  // The framework's `View.mListenerInfo.mOnTouchListener`, read to see whether a listener was set on a foreign view (`EngineForeign.hasTouchListener`): fields of the platform, not of the app's code. Not
  // finding them is handled (logged once, the listener is not seen).
  "expo/modules/svelteengine/views/EngineForeign.kt": 'getDeclaredField("mListenerInfo") Class.forName("android.view.View\\$ListenerInfo") getDeclaredField("mOnTouchListener")',
};

function kotlinFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? kotlinFiles(path) : entry.name.endsWith(".kt") ? [path] : [];
  });
}

test("every lookup by name in the engine's Kotlin is one R8 keeps", () => {
  const found: string[] = [];
  for (const file of kotlinFiles(root)) {
    const name = relative(root, file);
    for (const match of readFileSync(file, "utf8").matchAll(/(?:Class\.forName|getMethod|getDeclaredMethod|getField|getDeclaredField)\([^)]*\)?/g)) {
      found.push(`${name}: ${match[0]}`);
      expect(kept[name] ?? "", `${name}: ${match[0]}`).toContain(match[0].replace(/,.*$/, ""));
    }
  }
  // The commands call the input's `focus` and `blur` directly.
  const commands = readFileSync(join(root, "expo/modules/svelteengine/Commands.kt"), "utf8");
  expect(commands).toContain('"focus" -> if (view is EngineInput) view.focus()');
  expect(commands).toContain('"blur" -> if (view is EngineInput) view.blur()');
  expect(found.length).toBeGreaterThan(0);
});
