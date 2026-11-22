import { describe, expect, test } from "bun:test";
import type { PluginBuild } from "esbuild";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundle } from "../../support/bundle.ts";
import { createProject } from "../../support/project.ts";

/**
 * `polyfills.ts` makes `fetch`, `Headers`, `Request`, `Response`, `Blob`, `File`, `FileReader` and `FormData` lazy, and settles them to Expo Svelte's own only when the app's binary has
 * the native module `SvelteFetch`. Here the real file is bundled (the React Native and Expo modules it imports stood in for) and run in a process of its own, after a prelude that
 * installs what Expo's runtime installs: a lazy getter per name that answers "expo:<name>" and records that it was read. The process says what it saw.
 */
const root = resolve(import.meta.dirname, "../../..");
const NAMES = ["fetch", "Headers", "Request", "Response", "Blob", "File", "FileReader", "FormData"];

const stubs: Record<string, string> = {
  "react-native/Libraries/AppState/AppState": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Network/FormData": "export default class RnFormData { _parts = []; getParts() { return []; } };",
  "react-native/Libraries/Blob/Blob": "export default class RnBlob {};",
  "react-native/Libraries/Blob/FileReader": "export default class RnFileReader {};",
  // React Native's XMLHttpRequest reads the Blob global when it loads (`blob: typeof global.Blob === 'function'`), so loading it from the layer's activation reads one
  // of the globals the activation is settling (and quick-crypto's dependencies read Blob while they load, which starts that activation).
  "react-native/Libraries/Network/XMLHttpRequest": "globalThis.__xhrSawBlob = typeof globalThis.Blob; export default class RnXhr { send() {} }; globalThis.__RnXhr = RnXhr;",
  "expo-modules-core": "export const requireOptionalNativeModule = (name) => globalThis.__natives[name] ?? null;",
};

/** The real `polyfills.ts` against the stubs, built once for the run. */
const bundled = (): Promise<string> => bundle({
  entry: `import ${JSON.stringify(join(root, "src/polyfills.ts"))};`,
  resolveDir: root, converters: false, cacheKey: "fetch-polyfills",
  plugins: [{
    name: "stubs",
    setup(builder: PluginBuild) {
      builder.onResolve({ filter: /^(react-native\/Libraries\/|expo-modules-core$|expo\/src\/winter$|#vendor\/(?:hermes-intl|react-native-mmkv|react-native-quick-crypto)$)/ }, (args) => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
      // Counts the modules of src/fetch that are evaluated, to say when the layer was loaded.
      builder.onLoad({ filter: /src[\\/]fetch[\\/][^\\/]+\.ts$/ }, ({ path }) => ({ contents: `${readFileSync(path, "utf8")}\nglobalThis.__fetchLoaded = [...(globalThis.__fetchLoaded ?? []), ${JSON.stringify(path.split("/").at(-1))}];`, loader: "ts" }));
    },
  }],
}).then((built) => built.code);

const prelude = (scenario: "present" | "absent") => `
globalThis.window = globalThis;
globalThis.__expoReads = [];
for (const name of ${JSON.stringify(NAMES)}) {
  delete globalThis[name];
  // React Native's runtime installs most of them as lazy getters, and a library may have left a plain value (FileReader here).
  if (name === "FileReader") Object.defineProperty(globalThis, name, { configurable: true, enumerable: true, writable: true, value: "expo:FileReader" });
  else Object.defineProperty(globalThis, name, { configurable: true, enumerable: true, get() { globalThis.__expoReads.push(name); return "expo:" + name; } });
}
class MiniNativeBlob { constructor(parts, type) { this.size = parts.reduce((sum, part) => sum + (typeof part === "string" ? part.length : part.length ?? 0), 0); this.type = type; } objectURL() { return "file:///mini-blob"; } }
globalThis.__natives = ${scenario === "present" ? "{ SvelteFetch: { NativeBlob: MiniNativeBlob, NativeRequest: class {}, revokeObjectURL() { globalThis.__revoked = true; } } }" : "{}"};
`;

const probe = `
const names = ${JSON.stringify(NAMES)};
const g = globalThis;
const out = {};
out.accessorsAtBoot = names.map((name) => typeof Object.getOwnPropertyDescriptor(g, name).get);
out.loadedAtBoot = g.__fetchLoaded ?? [];
out.expoReadsAtBoot = [...g.__expoReads];
out.xhrPatchedAtBoot = g.__RnXhr?.prototype.send[Symbol.for("expo-svelte.xhr-send")] === true;
out.first = typeof g.Blob;
out.loadedAfterFirst = [...(g.__fetchLoaded ?? [])];
out.types = names.map((name) => typeof g[name]);
out.settled = names.map((name) => typeof Object.getOwnPropertyDescriptor(g, name).get);
out.expoReads = [...g.__expoReads];
out.sameAfter = g.Blob === g.Blob;
out.xhrPatched = g.__RnXhr?.prototype.send[Symbol.for("expo-svelte.xhr-send")] === true;
if (out.first === "function") {
  out.blobSize = new g.Blob(["abc", "de"]).size;
  out.objectURL = URL.createObjectURL(new g.Blob(["x"]));
  URL.revokeObjectURL("file:///x");
  out.revoked = g.__revoked === true;
}
g.fetch = "assigned";
out.assigned = g.fetch;
console.log("PROBE " + JSON.stringify(out));
`;

const probes = new Map<string, Promise<Record<string, unknown>>>();

/** What the probe saw in a process of its own: one process for each scenario, started by the first test that asks, however many ask. */
function run(scenario: "present" | "absent"): Promise<Record<string, unknown>> {
  let result = probes.get(scenario);
  if (!result) {
    result = (async () => {
      const project = createProject({}, "svelte-fetch-polyfills-");
      try {
        const file = project.write("probe.mjs", `${prelude(scenario)}\n${await bundled()}\n${probe}`);
        const done = Bun.spawnSync([process.execPath, file], { stdout: "pipe", stderr: "pipe" });
        if (done.exitCode !== 0) throw new Error(`the probe failed:\n${done.stderr.toString().slice(-3000)}`);
        const line = done.stdout.toString().split("\n").find((entry) => entry.startsWith("PROBE "));
        return JSON.parse((line as string).slice(6)) as Record<string, unknown>;
      } finally {
        project.remove();
      }
    })();
    probes.set(scenario, result);
  }
  return result;
}

describe("polyfills.ts and the fetch globals", () => {
  test("they are getters at boot and nothing of src/fetch is evaluated: boot reads neither the layer nor the native module registry", async () => {
    const seen = await run("present");
    expect(seen.accessorsAtBoot).toEqual(NAMES.map(() => "function"));
    expect(seen.loadedAtBoot).toEqual([]);
    expect(seen.expoReadsAtBoot).toEqual([]);
  });

  test("with the native module, the first read of any of them settles all eight on Expo Svelte's own, loads the layer once, and leaves Expo's unread", async () => {
    const seen = await run("present");
    expect(seen.first).toBe("function");
    expect(seen.loadedAfterFirst).toEqual(expect.arrayContaining(["install.ts", "index.ts", "fetch.ts", "blob.ts", "form-data.ts", "file-reader.ts", "url.ts"]));
    expect(seen.types).toEqual(NAMES.map(() => "function"));
    expect(seen.expoReads).toEqual([]);
    expect(seen.settled).toEqual(NAMES.map(() => "undefined"));
    expect(seen.sameAfter).toBe(true);
    expect(seen.blobSize).toBe(5);
  });

  test("with the native module the first read also wraps React Native's XMLHttpRequest.send (xhr.send of our Blob), and not before", async () => {
    const seen = await run("present");
    expect([seen.xhrPatchedAtBoot, seen.xhrPatched]).toEqual([false, true]);
    expect((await run("absent")).xhrPatched).toBe(false);
  });

  test("URL.createObjectURL and revokeObjectURL are ours for our Blobs", async () => {
    const seen = await run("present");
    expect(seen.objectURL).toBe("file:///mini-blob");
    expect(seen.revoked).toBe(true);
  });

  test("without the module (an old binary) each global is what the runtime installed, and the layer is not loaded", async () => {
    const seen = await run("absent");
    expect(seen.first).toBe("string");
    expect(seen.types).toEqual(NAMES.map(() => "string"));
    expect((seen.expoReads as string[]).toSorted()).toEqual(NAMES.filter((name) => name !== "FileReader").toSorted());
    expect(seen.loadedAfterFirst as string[]).not.toContain("index.ts");
    expect(seen.loadedAfterFirst as string[]).not.toContain("fetch.ts");
  });

  test("a global may be assigned before it is read, and the assignment stands", async () => {
    expect((await run("present")).assigned).toBe("assigned");
    expect((await run("absent")).assigned).toBe("assigned");
  });
});
