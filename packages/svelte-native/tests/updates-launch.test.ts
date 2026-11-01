import { afterEach, describe, expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SvelteUpdatesNative } from "../src/updates/native.ts";
import { UPDATE_ID, directiveResponse, noUpdateDirective } from "./updates-fixtures/eas.ts";

// The host's launch hook and the module entry load React Native modules; both are replaced by stubs that report to `globalThis.__updates`.
type World = {
  native: Partial<SvelteUpdatesNative> | null;
  transformers: unknown[];
  idle: (() => void)[];
  warnings: unknown[][];
  /** `setTimeout` calls of the hook: the delay asked for, and the callback to run by hand. */
  timers: { delay: number; run: () => void }[];
};
const world = (): World => (globalThis as unknown as { __updates: World }).__updates;

const stubs: Record<string, string> = {
  "expo-modules-core": "export const requireOptionalNativeModule = (name) => name === 'SvelteUpdates' ? globalThis.__updates.native : null;",
  "react-native/Libraries/Image/resolveAssetSource": "export default { pickScale: (scales, ratio) => scales.find((scale) => scale >= ratio) ?? scales.at(-1) ?? 1, setCustomSourceTransformer: (transformer) => globalThis.__updates.transformers.push(transformer) };",
  "react-native/Libraries/Utilities/PixelRatio": "export default { get: () => 2 };",
};

async function load<T>(entry: string): Promise<T> {
  const bundle = await build({
    entryPoints: [resolve(import.meta.dirname, entry)],
    bundle: true, format: "esm", platform: "neutral", write: false,
    plugins: [{
      name: "updates-stubs",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core)/ }, (args) => ({ path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-updates-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const module = await import(`${pathToFileURL(file).href}?${Math.random()}`);
  await rm(directory, { recursive: true });
  return module as T;
}

const native = (overrides: Partial<SvelteUpdatesNative> = {}): Partial<SvelteUpdatesNative> => ({
  isEnabled: true, platform: "android", updateId: null, runtimeVersion: "0.1.0", updateUrl: "https://u.expo.dev/p", requestHeaders: { "expo-channel-name": "production" },
  checkOnLaunch: "ALWAYS", hasEmbeddedUpdate: true, isEmbeddedLaunch: true, createdAt: 0, localAssets: {}, clientId: "c", readStore: async () => JSON.stringify({ embeddedCreatedAt: 0, updates: {}, failedIds: [], metadata: { serverDefinedHeaders: null, manifestFilters: null } }),
  markLaunched: async () => { requests.push("markLaunched"); },
  request: async () => { requests.push("request"); return { status: 200, headers: { "content-type": 'multipart/mixed; boundary=formdata-6bd8f2c7ef0b1e3ad4f9b1f4b2c8d3e6', "expo-protocol-version": "1", "expo-manifest-filters": 'branchname="production"' }, body: await directiveResponse(noUpdateDirective).text() }; },
  saveMetadata: async () => { requests.push("saveMetadata"); },
  ...overrides,
});
let requests: string[] = [];

function reset(value: Partial<SvelteUpdatesNative> | null): void {
  requests = [];
  (globalThis as unknown as { __updates: World }).__updates = { native: value, transformers: [], idle: [], warnings: [], timers: [] };
  (globalThis as { requestIdleCallback?: (callback: () => void) => void }).requestIdleCallback = (callback) => { world().idle.push(callback); };
  delete (globalThis as { __svelteFatalSeen?: boolean }).__svelteFatalSeen;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => { world().timers.push({ delay: delay ?? 0, run: callback }); return 0; }) as unknown as typeof setTimeout;
}
const realSetTimeout = globalThis.setTimeout;
afterEach(() => {
  delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
  delete (globalThis as { __svelteFatalSeen?: boolean }).__svelteFatalSeen;
  globalThis.setTimeout = realSetTimeout;
});
const settle = async () => { for (let turn = 0; turn < 10; turn++) await Promise.resolve(); await new Promise((done) => realSetTimeout(done, 0)); };

describe("host launch hook", () => {
  test("an embedded launch installs nothing and queues the check and the end of the healthy window for idle time", async () => {
    reset(native());
    const launch = await load<{ onFirstCommit(): void }>("../src/updates/launch.ts");
    expect(world().transformers).toEqual([]);
    launch.onFirstCommit();
    // The first commit alone confirms nothing: Svelte runs onMount and effects after it.
    expect(requests).toEqual([]);
    expect(world().idle).toHaveLength(2);
    for (const callback of world().idle) callback();
    await settle();
    // The check ran through the native request and stored the response's headers.
    expect(requests).toEqual(["request", "saveMetadata"]);
  });
  test("the launch is confirmed after the first idle callback and a healthy window of about three seconds, not at the first commit", async () => {
    reset(native({ updateId: UPDATE_ID, isEmbeddedLaunch: false }));
    const launch = await load<{ onFirstCommit(): void; HEALTHY_WINDOW_MS: number }>("../src/updates/launch.ts");
    expect(launch.HEALTHY_WINDOW_MS).toBe(3000);
    launch.onFirstCommit();
    expect(requests).toEqual([]);
    expect(world().timers).toEqual([]);
    for (const callback of world().idle) callback();
    // The window runs from the first commit: what is left of it is waited out.
    expect(world().timers).toHaveLength(1);
    expect(world().timers[0]?.delay).toBeGreaterThan(2500);
    expect(world().timers[0]?.delay).toBeLessThanOrEqual(3000);
    await settle();
    expect(requests.includes("markLaunched")).toBe(false);
    world().timers[0]?.run();
    await settle();
    expect(requests.filter((request) => request === "markLaunched")).toEqual(["markLaunched"]);
  });
  test("a fatal error in the window keeps the launch unconfirmed", async () => {
    reset(native({ updateId: UPDATE_ID, isEmbeddedLaunch: false }));
    const launch = await load<{ onFirstCommit(): void }>("../src/updates/launch.ts");
    launch.onFirstCommit();
    for (const callback of world().idle) callback();
    // A microtask error after the first commit (a layout's onMount, an effect) reaches the global handler as a fatal.
    (globalThis as { __svelteFatalSeen?: boolean }).__svelteFatalSeen = true;
    world().timers[0]?.run();
    await settle();
    expect(requests.includes("markLaunched")).toBe(false);
  });
  test("a launch from the update store routes image sources to the downloaded files", async () => {
    reset(native({ updateId: UPDATE_ID, isEmbeddedLaunch: false, localAssets: { aaa: "file:///store/aaa.png", bbb: "file:///store/bbb.png" } }));
    await load("../src/updates/launch.ts");
    expect(world().transformers).toHaveLength(1);
    const transformer = world().transformers[0] as (resolver: unknown) => unknown;
    const resolver = { asset: { scales: [1, 2, 3], fileHashes: ["aaa", "bbb", "ccc"] }, fromSource: (uri: string) => ({ uri }), defaultAsset: () => "default", resourceIdentifierWithoutScale: () => "drawable" };
    // The stubbed device pixel ratio is 2, so the second file is picked.
    expect(transformer(resolver)).toEqual({ uri: "file:///store/bbb.png" });
  });
  test("a build that does not check on launch still confirms the launch, and queues no check", async () => {
    reset(native({ checkOnLaunch: "NEVER" }));
    const launch = await load<{ onFirstCommit(): void }>("../src/updates/launch.ts");
    launch.onFirstCommit();
    expect(world().idle).toHaveLength(1);
    world().idle[0]?.();
    world().timers[0]?.run();
    await settle();
    expect(requests).toEqual(["markLaunched"]);
  });
  test("with updates off or the module missing the hook does nothing", async () => {
    for (const value of [native({ isEnabled: false }), null]) {
      reset(value);
      const launch = await load<{ onFirstCommit(): void }>("../src/updates/launch.ts");
      launch.onFirstCommit();
      expect(requests).toEqual([]);
      expect(world().transformers).toEqual([]);
      expect(world().idle).toEqual([]);
    }
  });
  test("a failure to record the launch is reported, not thrown", async () => {
    reset(native({ markLaunched: async () => { throw new Error("disk full"); } }));
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { world().warnings.push(args); };
    try {
      const launch = await load<{ onFirstCommit(): void }>("../src/updates/launch.ts");
      launch.onFirstCommit();
      world().idle[0]?.();
      world().timers[0]?.run();
      await settle();
    } finally { console.warn = warn; }
    expect(String(world().warnings[0]?.[0])).toContain("could not record the launch");
  });
});

describe("module entry", () => {
  test("constants and calls come from the native module", async () => {
    reset(native({ updateId: UPDATE_ID, isEmbeddedLaunch: false }));
    const updates = await load<typeof import("../src/updates/index.ts")>("../src/updates/index.ts");
    expect([updates.isEnabled, updates.updateId, updates.channel, updates.runtimeVersion]).toEqual([true, UPDATE_ID, "production", "0.1.0"]);
    expect(await updates.checkForUpdateAsync()).toMatchObject({ isAvailable: false, reason: "noUpdateAvailableOnServer" });
  });
  test("without the native module the exports are inert", async () => {
    reset(null);
    const updates = await load<typeof import("../src/updates/index.ts")>("../src/updates/index.ts");
    expect([updates.isEnabled, updates.updateId, updates.channel, updates.runtimeVersion]).toEqual([false, null, null, null]);
    expect((await updates.checkForUpdateAsync()).reason).toBe("updatesDisabled");
    expect(await updates.fetchUpdateAsync()).toMatchObject({ isNew: false });
    await updates.reloadAsync();
  });
});
