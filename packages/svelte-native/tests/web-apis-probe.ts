// Run by web-apis.test.ts in a process of its own (with the argument `missing`, as an app whose build does not have react-native-quick-crypto): `mock.module` is global to a Bun test process. Puts fakes of react-native-quick-crypto and react-native-mmkv (and of what
// `polyfills.ts` imports besides) in the module registry, imports the library's polyfills as the Fabric entry does, and prints what the two web APIs did as JSON: what loaded
// at import, on the first read of each global, and on the first call that needs the native side.
import { mock } from "bun:test";

const scope = globalThis as Record<string, unknown>;
// A device's `window` is the global object, and Bun has its own `crypto` (a browser's would be too: the polyfill leaves a name the platform has).
scope.window = globalThis;
delete scope.crypto;

const missing = process.argv[2] === "missing";
const events: string[] = [];
const bufferBefore = scope.Buffer;

// react-native-quick-crypto: the exports `crypto` is made of, and `install`, which sets globals the library must not set.
let installs = 0;
const fakeSubtle = { digest: async () => new ArrayBuffer(32), marker: "subtle" };
mock.module("react-native-quick-crypto", () => {
  if (missing) throw new Error("Requiring unknown module \"react-native-quick-crypto\"");
  events.push("quick-crypto loaded");
  return {
    getRandomValues: <T extends ArrayBufferView>(array: T): T => { new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7); return array; },
    randomUUID: () => "00000000-0000-4000-8000-000000000000",
    subtle: fakeSubtle,
    createHash: () => ({}),
    install: () => { installs++; scope.Buffer = "installed"; scope.process = "installed"; },
  };
});

// react-native-mmkv: instances over a table of files by id, which a restart of the app would keep.
const files = new Map<string, Map<string, string | number | boolean>>();
const created: { id: string }[] = [];
class FakeMMKV {
  constructor(readonly id: string, private readonly data: Map<string, string | number | boolean>) {}
  get length() { return this.data.size; }
  getString(key: string) { const value = this.data.get(key); return typeof value === "string" ? value : undefined; }
  set(key: string, value: string | number | boolean) {
    if (key === "") throw new Error("Cannot set a value for an empty key!");
    this.data.set(key, value);
  }
  remove(key: string) { return this.data.delete(key); }
  clearAll() { this.data.clear(); }
  getAllKeys() { return [...this.data.keys()]; }
}
mock.module("react-native-mmkv", () => {
  events.push("mmkv loaded");
  return {
    createMMKV: (configuration: { id: string }) => {
      created.push(configuration);
      if (!files.has(configuration.id)) files.set(configuration.id, new Map());
      return new FakeMMKV(configuration.id, files.get(configuration.id) as Map<string, string | number | boolean>);
    },
  };
});

// What `polyfills.ts` imports besides: not under test.
mock.module("expo/src/winter", () => ({}));
mock.module("hermes-intl", () => ({}));
mock.module("react-native/Libraries/AppState/AppState", () => ({ default: { addEventListener: () => ({ remove() {} }) } }));

const result: Record<string, unknown> = {};
const descriptor = (name: string) => {
  const found = Object.getOwnPropertyDescriptor(globalThis, name);
  return found && { accessor: typeof found.get === "function", enumerable: found.enumerable, configurable: found.configurable };
};

await import("../src/polyfills.ts");
result.atImport = { events: [...events], created: created.length, crypto: descriptor("crypto"), localStorage: descriptor("localStorage"), sessionStorage: descriptor("sessionStorage") };

// An app without the library: the first read says what to do, and the accessor stays (`defineLazyGlobal` tries again on the next read; Bun's mock does not throw twice).
if (missing) {
  const attempt = () => { try { return String(globalThis.crypto); } catch (error) { return { message: (error as Error).message, cause: ((error as Error).cause as Error).message }; } };
  console.log(JSON.stringify({ first: attempt(), accessor: descriptor("crypto")?.accessor }));
  process.exit(0);
}

// `crypto`.
const globals = globalThis as unknown as { crypto: Crypto; localStorage: Storage; sessionStorage: Storage };
const web = globals.crypto;
result.cryptoRead = { events: [...events], keys: Object.keys(web).sort(), tag: Object.prototype.toString.call(web), descriptor: descriptor("crypto") };
const bytes = globals.crypto.getRandomValues(new Uint8Array(4));
result.cryptoCalls = {
  bytes: [...bytes],
  uuid: globals.crypto.randomUUID(),
  subtle: (globals.crypto.subtle as unknown as { marker: string }).marker,
  same: globals.crypto === web,
  detached: [...(({ getRandomValues }) => getRandomValues(new Uint8Array(2)))(globals.crypto)],
  events: [...events],
  installs,
  bufferUntouched: scope.Buffer === bufferBefore,
  processUntouched: scope.process !== "installed",
};

// `localStorage` and `sessionStorage`: the global is an object before the library is touched, and MMKV is created by the first call.
const local = globals.localStorage;
result.localRead = { type: typeof local, events: [...events], created: created.length, descriptor: descriptor("localStorage") };
result.localLength = { length: local.length, events: [...events], created: created.map((entry) => entry.id) };
local.setItem("theme", "dark");
local.setItem("count", 3 as unknown as string);
local.extra = "named";
result.local = {
  theme: local.getItem("theme"),
  count: local.getItem("count"),
  named: local.extra,
  missing: local.getItem("nothing"),
  length: local.length,
  keys: Object.keys(local),
  stored: [...(files.get("svelte-native.local-storage")?.entries() ?? [])],
  sameStorage: globals.localStorage === local,
};
local.setItem("", "empty key");
result.emptyKey = { value: local.getItem(""), keys: Object.keys(local), stored: [...(files.get("svelte-native.local-storage")?.keys() ?? [])].map((key) => JSON.stringify(key)) };
const session = globals.sessionStorage;
session.setItem("theme", "light");
result.session = { theme: session.getItem("theme"), localTheme: local.getItem("theme"), created: created.length, files: [...files.keys()] };

// The `/mmkv` entry: the same createMMKV, and the instance localStorage keeps its data in.
const entry = await import("../src/mmkv.ts");
const behind = entry.localStorageMMKV();
result.entry = {
  names: Object.keys(entry).sort(),
  id: behind.id,
  getString: behind.getString("theme"),
  sameInstance: entry.localStorageMMKV() === behind,
  created: created.length,
  typed: (() => { const custom = entry.createMMKV({ id: "custom" }); custom.set("n", 1); return [custom.id, created.length, files.get("custom")?.get("n")]; })(),
};

console.log(JSON.stringify(result));
