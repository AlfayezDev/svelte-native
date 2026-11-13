import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * `crypto`, `localStorage` and `sessionStorage` on the device, from the library's own polyfills (`src/polyfills.ts`, imported as the Fabric entry imports it): defined without loading
 * anything, made when first read, and backed by react-native-quick-crypto and react-native-mmkv, which `web-apis-probe.ts` replaces by recording fakes in a process of its own
 * (`mock.module` is global to a test process). The storage object itself is in web-storage.test.ts.
 */
const done = Bun.spawnSync([process.execPath, join(import.meta.dirname, "web-apis-probe.ts")], { stdout: "pipe", stderr: "pipe" });
if (done.exitCode !== 0) throw new Error(`the probe failed:\n${done.stderr.toString().slice(-2000)}`);
const seen = JSON.parse(done.stdout.toString().trim().split("\n").at(-1) ?? "") as Record<string, Record<string, unknown>>;

test("importing the polyfills defines the three names as accessors and loads neither library, creates no MMKV instance and writes nothing", () => {
  const accessor = { accessor: true, enumerable: false, configurable: true };
  expect(seen.atImport).toEqual({ events: [], created: 0, crypto: accessor, localStorage: accessor, sessionStorage: accessor });
});

test("reading `crypto` loads react-native-quick-crypto, once, and makes the web's three members of it: nothing else, and none of what its install() would set", () => {
  expect(seen.cryptoRead).toEqual({ events: ["quick-crypto loaded"], keys: ["getRandomValues", "randomUUID", "subtle"], tag: "[object Crypto]", descriptor: { accessor: false, enumerable: false, configurable: true } });
  expect(seen.cryptoCalls).toEqual({
    bytes: [7, 7, 7, 7],
    uuid: "00000000-0000-4000-8000-000000000000",
    subtle: "subtle",
    same: true,
    detached: [7, 7],
    events: ["quick-crypto loaded"],
    installs: 0,
    bufferUntouched: true,
    processUntouched: true,
  });
});

test("reading `localStorage` makes the storage and starts nothing: react-native-mmkv is loaded, and the instance created, by the first call that reads or writes", () => {
  expect(seen.localRead).toEqual({ type: "object", events: ["quick-crypto loaded"], created: 0, descriptor: { accessor: false, enumerable: false, configurable: true } });
  expect(seen.localLength).toEqual({ length: 0, events: ["quick-crypto loaded", "mmkv loaded"], created: ["svelte-native.local-storage"] });
});

test("localStorage keeps strings in the MMKV instance `svelte-native.local-storage`, key for key, and its keys are the properties", () => {
  expect(seen.local).toEqual({
    theme: "dark",
    count: "3",
    named: "named",
    missing: null,
    length: 3,
    keys: ["theme", "count", "extra"],
    stored: [["theme", "dark"], ["count", "3"], ["extra", "named"]],
    sameStorage: true,
  });
});

test("the empty key, which MMKV refuses, is a key of localStorage too", () => {
  expect(seen.emptyKey).toEqual({ value: "empty key", keys: ["theme", "count", "extra", ""], stored: ['"theme"', '"count"', '"extra"', '"\\u0000"'] });
});

test("sessionStorage is in memory: it creates no MMKV instance and shares no key with localStorage", () => {
  expect(seen.session).toEqual({ theme: "light", localTheme: "dark", created: 1, files: ["svelte-native.local-storage"] });
});

test("`@alfayez/svelte-native/mmkv` exports createMMKV and localStorageMMKV, and localStorageMMKV is the instance behind localStorage (one instance, created once)", () => {
  expect(seen.entry).toEqual({ names: ["createMMKV", "localStorageMMKV"], id: "svelte-native.local-storage", getString: "dark", sameInstance: true, created: 1, typed: ["custom", 2, 1] });
});

test("an app whose build lacks react-native-quick-crypto gets an error that says what to do when it reads `crypto`, and the global stays an accessor", () => {
  const missing = Bun.spawnSync([process.execPath, join(import.meta.dirname, "web-apis-probe.ts"), "missing"], { stdout: "pipe", stderr: "pipe" });
  if (missing.exitCode !== 0) throw new Error(`the probe failed:\n${missing.stderr.toString().slice(-2000)}`);
  const result = JSON.parse(missing.stdout.toString().trim().split("\n").at(-1) ?? "") as { first: { message: string; cause: string }; accessor: boolean };
  expect(result.first.message).toContain("`crypto` needs react-native-quick-crypto");
  expect(result.first.message).toContain("svelte-native doctor");
  expect(result.first.cause).toBe('Requiring unknown module "react-native-quick-crypto"');
  expect(result.accessor).toBe(true);
});
