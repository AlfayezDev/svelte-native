import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * `crypto`, `localStorage` and `sessionStorage` on the device, from the library's own polyfills (`src/polyfills.ts`, imported as the Fabric entry imports it): defined without loading
 * anything, made when first read, and backed by react-native-quick-crypto and react-native-mmkv, which `fixtures/web-apis-probe.ts` replaces by recording fakes in a process of its own
 * (`mock.module` is global to a test process). The storage object itself is in web-storage.test.ts.
 */
type Seen = Record<string, Record<string, unknown>>;
type Without = { first: string; warnings: string[]; accessor: boolean; session: string; created?: number };

/** Runs the probe (`missing` is an app whose binary lacks react-native-quick-crypto, `missing-mmkv` one without react-native-mmkv's native module) and parses the last line it prints. */
async function probe<T>(...mode: ("missing" | "missing-mmkv")[]): Promise<T> {
  const run = Bun.spawn([process.execPath, join(import.meta.dirname, "fixtures/web-apis-probe.ts"), ...mode], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text()]);
  if ((await run.exited) !== 0) throw new Error(`the probe failed:\n${err.slice(-2000)}`);
  return JSON.parse(out.trim().split("\n").at(-1) ?? "") as T;
}

let seen: Seen;
let noCrypto: Without;
let noMmkv: Without;
beforeAll(async () => { [seen, noCrypto, noMmkv] = await Promise.all([probe<Seen>(), probe<Without>("missing"), probe<Without>("missing-mmkv")]); });

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

test("reading `localStorage` loads react-native-mmkv and creates its instance, once: a binary without the native module is found out by the read, not by a later call", () => {
  expect(seen.localRead).toEqual({ type: "object", events: ["quick-crypto loaded", "mmkv loaded"], created: 1, descriptor: { accessor: false, enumerable: false, configurable: true } });
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

test("an app whose build lacks react-native-quick-crypto reads `crypto` as undefined (a feature probe works), is told once what to do, and the global stays an accessor for the next read", () => {
  const result = noCrypto;
  expect(result.first).toBe("undefined");
  expect(result.warnings.length).toBe(1);
  expect(result.warnings[0]).toContain("`crypto` is not available");
  expect(result.warnings[0]).toContain("`crypto` needs react-native-quick-crypto");
  expect(result.warnings[0]).toContain("svelte-native doctor");
  expect(result.accessor).toBe(true);
  expect(result.session).toBe("object");
});

test("an app whose binary lacks react-native-mmkv's native module reads `localStorage` as undefined, is told once, and keeps sessionStorage", () => {
  const result = noMmkv;
  expect(result.first).toBe("undefined");
  expect(result.warnings.length).toBe(1);
  expect(result.warnings[0]).toContain("`localStorage` is not available");
  expect(result.warnings[0]).toContain("MMKVFactory");
  expect(result.accessor).toBe(true);
  expect(result.session).toBe("object");
  expect(result.created).toBe(0);
});
