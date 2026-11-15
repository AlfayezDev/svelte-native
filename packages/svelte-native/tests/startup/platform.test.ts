import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * `@alfayez/svelte-native/platform` exports React Native's JavaScript-only modules for an app without React. Importing it loads none of them (`Keyboard` alone reads the
 * constants of every view manager); each loads on the first read of a property, from the path its default export lives at, and a function read from one is bound to it.
 * `platform-probe.ts` does it against recording fakes in a process of its own (`mock.module` is global to a test process).
 */
let probed: Record<string, unknown> | undefined;
/** What the probe saw: one process for the six tests, started by the first of them, so a probe that fails fails that test and not the file's import. */
function probe(): Record<string, unknown> {
  if (!probed) {
    const done = Bun.spawnSync([process.execPath, join(import.meta.dirname, "fixtures/platform-probe.ts")], { stdout: "pipe", stderr: "pipe" });
    if (done.exitCode !== 0) throw new Error(`the probe failed:\n${done.stderr.toString().slice(-2000)}`);
    probed = JSON.parse(done.stdout.toString().trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
  }
  return probed;
}
const platformPath = "react-native/Libraries/Utilities/Platform";

test("importing the entry loads none of React Native's modules", () => {
  const seen = probe();
  expect(seen.afterImport).toEqual([]);
  expect(seen.exports).toEqual(["Alert", "AppState", "Appearance", "BackHandler", "Dimensions", "Keyboard", "Linking", "PixelRatio", "Platform", "Share", "Vibration", "nativeModule", "turboModule"]);
});

test("reading a property loads that module, once, and no other", () => {
  const seen = probe();
  expect([seen.os, seen.version]).toEqual(["android", 34]);
  expect(seen.afterPlatform).toEqual([platformPath]);
});

test("every export is the module its name says (the default export, or for Appearance the module's own functions), each loaded once", () => {
  const seen = probe();
  expect([seen.scheme, seen.window, seen.screen, seen.taps, seen.keyboard, seen.appState, seen.pixelRatio]).toEqual(["dark", 400, 420, 0, false, "active", 2]);
  expect([seen.backHandler, seen.share, seen.vibration, seen.alert]).toEqual(["function", "function", "function", "function"]);
  expect((seen.afterAll as string[]).length).toBe(11);
  expect(new Set(seen.afterAll as string[]).size).toBe(11);
  expect(seen.finalLoads).toBe(11);
});

test("a function read from an export is bound to the module: it can be passed on, and the same function comes back", () => {
  const seen = probe();
  expect(seen.select).toBe("a");
  expect(seen.tapped).toEqual([1, 2]);
  expect(seen.taps2).toBe(2);
  expect([seen.sameLinking, seen.sameMethod]).toEqual([true, true]);
});

test("writes and key listings go to the module", () => {
  const seen = probe();
  expect(seen.written).toBe("background");
  expect(seen.has).toEqual([true, false]);
  expect(seen.keys).toEqual(["addEventListener", "currentState"]);
});

test("turboModule and nativeModule are exports of the entry (`@alfayez/svelte-native/native-modules` exported them up to 0.4.0-rc.6) and load React Native's registries on their first call", () => {
  const seen = probe();
  expect(seen.turbo).toEqual({ turbo: "Blob" });
  expect(seen.turboMissing).toBe("no module Missing");
  expect(seen.legacy).toEqual({ ping: true });
  expect(seen.legacyMissing).toBeNull();
  expect(seen.afterModules).toEqual(["react-native/Libraries/TurboModule/TurboModuleRegistry", "react-native/Libraries/BatchedBridge/NativeModules"]);
});
