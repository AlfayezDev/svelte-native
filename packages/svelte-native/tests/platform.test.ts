import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * `@example/svelte-native/platform` exports React Native's JavaScript-only modules for an app without React. Importing it loads none of them (`Keyboard` alone reads the
 * constants of every view manager); each loads on the first read of a property, from the path its default export lives at, and a function read from one is bound to it.
 * `platform-probe.ts` does it against recording fakes in a process of its own (`mock.module` is global to a test process).
 */
const done = Bun.spawnSync([process.execPath, join(import.meta.dirname, "platform-probe.ts")], { stdout: "pipe", stderr: "pipe" });
if (done.exitCode !== 0) throw new Error(`the probe failed:\n${done.stderr.toString().slice(-2000)}`);
const seen = JSON.parse(done.stdout.toString().trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
const platformPath = "react-native/Libraries/Utilities/Platform";

test("importing the entry loads none of React Native's modules", () => {
  expect(seen.afterImport).toEqual([]);
  expect(seen.exports).toEqual(["Alert", "AppState", "Appearance", "BackHandler", "Dimensions", "Keyboard", "Linking", "PixelRatio", "Platform", "Share", "Vibration"]);
});

test("reading a property loads that module, once, and no other", () => {
  expect([seen.os, seen.version]).toEqual(["android", 34]);
  expect(seen.afterPlatform).toEqual([platformPath]);
});

test("every export is the module its name says (the default export, or for Appearance the module's own functions), each loaded once", () => {
  expect([seen.scheme, seen.window, seen.screen, seen.taps, seen.keyboard, seen.appState, seen.pixelRatio]).toEqual(["dark", 400, 420, 0, false, "active", 2]);
  expect([seen.backHandler, seen.share, seen.vibration, seen.alert]).toEqual(["function", "function", "function", "function"]);
  expect((seen.afterAll as string[]).length).toBe(11);
  expect(new Set(seen.afterAll as string[]).size).toBe(11);
  expect(seen.finalLoads).toBe(11);
});

test("a function read from an export is bound to the module: it can be passed on, and the same function comes back", () => {
  expect(seen.select).toBe("a");
  expect(seen.tapped).toEqual([1, 2]);
  expect(seen.taps2).toBe(2);
  expect([seen.sameLinking, seen.sameMethod]).toEqual([true, true]);
});

test("writes and key listings go to the module", () => {
  expect(seen.written).toBe("background");
  expect(seen.has).toEqual([true, false]);
  expect(seen.keys).toEqual(["addEventListener", "currentState"]);
});
