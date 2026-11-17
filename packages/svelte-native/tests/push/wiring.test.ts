import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { baseStubs, load as loadBundle, src } from "../support/bundle.ts";
import { snapshotGlobals } from "../support/globals.ts";
import { createStorage, memoryBackend } from "../../src/web-storage.ts";
import { message, pushStubs, TOKEN, world, type PushWorld } from "./support/world.ts";
import { resolve } from "node:path";

/**
 * `push` (`src/push/push.svelte.ts`) as an app has it: the library's bundle over stand-ins for the native module, `AppState` and `Linking`. What `client.test.ts` cannot show: the
 * state is reactive, the hooks file's `push` export starts the client (and a hooks file without it loads none of push), the module and the hooks it reads are the ones the app registered,
 * and `Linking`, which the router reads, is what the client feeds.
 */
type Loaded = {
  watch(): { seen: string[]; stop(): void };
  push: typeof import("../../src/push/index.ts").push;
  registerHooks: typeof import("../../src/app-hooks.ts").registerHooks;
  Linking: { getInitialURL(): Promise<string | null>; addEventListener(name: "url", handler: (event: { url: string }) => void): { remove(): void } };
  platformLinking: Loaded["Linking"];
  flushSync(): void;
};

const loadLibrary = (): Promise<Loaded> => loadBundle<Loaded>({
  entry: `import { watch } from ${JSON.stringify(resolve(import.meta.dirname, "fixtures/watch.svelte.ts"))};
    import { push } from ${JSON.stringify(src("push/index.ts"))};
    import { registerHooks } from ${JSON.stringify(src("app-hooks.ts"))};
    import { Linking as platformLinking } from ${JSON.stringify(src("platform.ts"))};
    import Linking from "react-native/Libraries/Linking/Linking";
    import { flushSync } from "svelte";
    export { watch, push, registerHooks, Linking, platformLinking, flushSync };`,
  stubs: { ...baseStubs(), ...pushStubs },
  converters: false,
});

/** Only `registerHooks`, `Linking` and `push/load.ts` that `app.ts` imports: the entry of an app whose code never imports `push`. */
const loadHooksOnly = (): Promise<Pick<Loaded, "registerHooks" | "Linking">> => loadBundle({
  entry: `import ${JSON.stringify(src("push/load.ts"))};
    import { registerHooks } from ${JSON.stringify(src("app-hooks.ts"))};
    import Linking from "react-native/Libraries/Linking/Linking";
    export { registerHooks, Linking };`,
  stubs: { ...baseStubs(), ...pushStubs },
  converters: false,
});

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
};

const snapshot = snapshotGlobals();
let pushWorld: PushWorld;
beforeEach(() => {
  pushWorld = world();
  (globalThis as { localStorage?: Storage }).localStorage = createStorage(memoryBackend());
});
afterAll(() => snapshot.restore());

describe("push.permission and push.token", () => {
  test("are reactive: an effect sees the permission the system answers, the foreground read, the subscribe and the unsubscribe", async () => {
    pushWorld.permission = "prompt";
    const m = await loadLibrary();
    const { seen } = m.watch();
    await settle();
    expect(seen).toEqual(["prompt -"]);
    pushWorld.permission = "granted";
    for (const listener of pushWorld.appState) listener("background");
    for (const listener of pushWorld.appState) listener("active");
    await settle();
    m.flushSync();
    expect(seen).toEqual(["prompt -", "granted -"]);
    const saved: string[] = [];
    expect(await m.push.subscribe({ save: (token) => { saved.push(token.token); } })).toEqual(TOKEN);
    m.flushSync();
    expect(seen).toEqual(["prompt -", "granted -", "granted token-1"]);
    expect([m.push.permission, m.push.token, saved]).toEqual(["granted", TOKEN, ["token-1"]]);
    await m.push.unsubscribe();
    m.flushSync();
    expect(seen.at(-1)).toBe("granted -");
    expect(pushWorld.calls).toContain("unregister");
  });

  test("a granted permission reads `prompt` only until the system has answered", async () => {
    pushWorld.permission = "granted";
    let answer: (() => void) | undefined;
    pushWorld.holdPermission = new Promise<void>((resolve) => { answer = resolve; });
    const m = await loadLibrary();
    await settle();
    expect(m.push.permission).toBe("prompt");
    answer?.();
    await settle();
    expect(m.push.permission).toBe("granted");
  });

  test("a second launch starts at the permission the system last reported, and refreshes it from the module", async () => {
    pushWorld.permission = "granted";
    await loadLibrary();
    await settle();
    expect(localStorage.getItem("svelte-native.push.permission")).toBe("granted");

    // The module has not answered yet: no `prompt` for a user who granted it.
    let answer: (() => void) | undefined;
    pushWorld.holdPermission = new Promise<void>((resolve) => { answer = resolve; });
    pushWorld.permission = "denied";
    const second = await loadLibrary();
    const { seen } = second.watch();
    await settle();
    expect([second.push.permission, seen]).toEqual(["granted", ["granted -"]]);
    // The user changed it in the settings: the module's answer is what is read, and what the next launch starts from.
    answer?.();
    await settle();
    second.flushSync();
    expect([second.push.permission, seen]).toEqual(["denied", ["granted -", "denied -"]]);
    expect(localStorage.getItem("svelte-native.push.permission")).toBe("denied");
    pushWorld.holdPermission = undefined;
    expect((await loadLibrary()).push.permission).toBe("denied");
  });

  test("the answer to a question the app asks is stored too, and a stored value that is not a permission is ignored", async () => {
    localStorage.setItem("svelte-native.push.permission", "maybe");
    const m = await loadLibrary();
    expect(m.push.permission).toBe("prompt");
    await settle();
    await m.push.subscribe({ save: () => {} });
    expect(localStorage.getItem("svelte-native.push.permission")).toBe("granted");
  });

  test("push is an object whose methods do not read this", async () => {
    const m = await loadLibrary();
    const { subscribe, unsubscribe, on } = m.push;
    pushWorld.permission = "denied";
    expect(await subscribe({ save: () => {} })).toBeNull();
    await unsubscribe();
    expect(on("message", () => {})).toBeInstanceOf(Function);
  });

  test("in a build without the module: denied from the start, null from subscribe, and one warning that says what to install", async () => {
    pushWorld = world({ module: false });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const m = await loadLibrary();
      expect(m.push.permission).toBe("denied");
      expect(await m.push.subscribe({ save: () => {} })).toBeNull();
      expect(await m.push.subscribe({ save: () => {} })).toBeNull();
      expect(m.push.token).toBeNull();
      // A missing module is not the user's answer: nothing is stored for the build that has it later.
      expect(localStorage.getItem("svelte-native.push.permission")).toBeNull();
      expect(warn.mock.calls).toHaveLength(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("@alfayez/svelte-native-push");
      expect(String(warn.mock.calls[0]?.[0])).toContain("capabilities");
    } finally {
      warn.mockRestore();
    }
  });

  test("the last saved token is kept in localStorage under the library's key, and a new launch does not save it again", async () => {
    pushWorld.permission = "granted";
    const first = await loadLibrary();
    await first.push.subscribe({ save: () => {} });
    expect(localStorage.getItem("svelte-native.push.saved-token")).toContain("token-1");
    const second = await loadLibrary();
    const saved: string[] = [];
    await second.push.subscribe({ save: (token) => { saved.push(token.token); } });
    expect(saved).toEqual([]);
  });
});

describe("what loads push", () => {
  test("a build that has the native module starts the client at start, with no push hooks: it is listened to, and a message in the foreground is shown by default", async () => {
    const m = await loadHooksOnly();
    expect(pushWorld.lookups).toContain("SveltePush");
    expect(pushWorld.appState).toHaveLength(1);
    m.registerHooks({});
    m.registerHooks({ init: () => {} });
    pushWorld.dispatch("message", message());
    await settle();
    expect(pushWorld.calls).toContain(`show m1 ${JSON.stringify({ banner: true, sound: true, badge: true })}`);
    expect(m.Linking.getInitialURL as unknown).not.toBe(pushWorld.originalGetInitialURL);
  });

  test("the cold-start tap opens its link although the hooks have no push and nothing imports push", async () => {
    pushWorld.launch = message({ id: "launch", url: "/orders/42" });
    const m = await loadHooksOnly();
    m.registerHooks({ init: () => {} });
    expect(await m.Linking.getInitialURL()).toBe("https://app.invalid/orders/42");
    expect(pushWorld.calls.filter((call) => call === "take")).toHaveLength(1);
  });

  test("a build without the native module wraps nothing and loads nothing of the client, with hooks that have no push", async () => {
    pushWorld = world({ module: false });
    pushWorld.launch = message({ url: "/orders/42" });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const m = await loadHooksOnly();
      m.registerHooks({});
      m.registerHooks({ init: () => {} });
      // The lookup is `load.ts`'s alone: the client looks it up again when it loads, and it did not.
      expect(pushWorld.lookups.filter((name) => name === "SveltePush")).toHaveLength(1);
      expect(pushWorld.appState).toHaveLength(0);
      expect(m.Linking.getInitialURL as unknown).toBe(pushWorld.originalGetInitialURL);
      expect(warn).not.toHaveBeenCalled();
      expect(pushWorld.calls).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  test("a hooks file with `push` loads the client in a build without the module, which says so once and wraps nothing", async () => {
    pushWorld = world({ module: false });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const m = await loadHooksOnly();
      m.registerHooks({ push: {} });
      m.registerHooks({ push: {} });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(m.Linking.getInitialURL as unknown).toBe(pushWorld.originalGetInitialURL);
    } finally {
      warn.mockRestore();
    }
  });

  test("the hooks are read as registered when a message comes: a hot update of the hooks file changes the answer, and the client is not made again", async () => {
    const m = await loadHooksOnly();
    m.registerHooks({ push: { foreground: () => ({ banner: false }) } });
    pushWorld.dispatch("message", message());
    await settle();
    expect(pushWorld.calls).toContain(`show m1 ${JSON.stringify({ banner: false, sound: true, badge: true })}`);

    m.registerHooks({ push: { foreground: () => ({ sound: false }) } });
    expect(pushWorld.appState).toHaveLength(1);
    pushWorld.dispatch("message", message({ id: "m2" }));
    await settle();
    expect(pushWorld.calls).toContain(`show m2 ${JSON.stringify({ banner: true, sound: false, badge: true })}`);
  });

  test("a background message reaches the hook of an app that never imports push, and the native side is released", async () => {
    const m = await loadHooksOnly();
    const seen: string[] = [];
    m.registerHooks({ push: { background: async (arrived) => { seen.push(arrived.data.inbox); } } });
    pushWorld.dispatch("background", { id: "wake-1", message: message({ data: { inbox: "7" } }) });
    await settle();
    expect(seen).toEqual(["7"]);
    expect(pushWorld.calls).toContain("done wake-1");
  });

  test("importing push starts it too, with the hooks of the app's file", async () => {
    const m = await loadLibrary();
    m.registerHooks({ push: { foreground: () => ({ badge: false }) } });
    pushWorld.dispatch("message", message());
    await settle();
    expect(pushWorld.calls).toContain(`show m1 ${JSON.stringify({ banner: true, sound: true, badge: false })}`);
  });
});

describe("Linking, which the router reads", () => {
  test("getInitialURL of React Native's module, and of the platform entry, answers the launch notification's link", async () => {
    pushWorld.launch = message({ id: "launch", url: "/orders/42" });
    const m = await loadLibrary();
    expect(await m.Linking.getInitialURL()).toBe("https://app.invalid/orders/42");
    expect(await m.platformLinking.getInitialURL()).toBe("https://app.invalid/orders/42");
    expect(pushWorld.calls.filter((call) => call === "take")).toHaveLength(1);
  });

  test("the platform's link is kept, and with neither there is none", async () => {
    pushWorld.initialURL = "myapp://settings";
    pushWorld.launch = message({ url: "/orders/42" });
    expect(await (await loadLibrary()).Linking.getInitialURL()).toBe("myapp://settings");
    pushWorld = world();
    expect(await (await loadLibrary()).Linking.getInitialURL()).toBeNull();
  });

  test("a tap with the app running reaches the listeners of the `url` event, after the opened hook", async () => {
    const m = await loadLibrary();
    const heard: string[] = [];
    const subscription = m.Linking.addEventListener("url", ({ url }) => { heard.push(url); });
    const seen: string[] = [];
    m.registerHooks({ push: { opened: (arrived) => { seen.push(arrived.id); return arrived.id !== "stopped"; } } });
    pushWorld.dispatch("opened", message({ id: "m1", url: "/orders/42" }));
    pushWorld.dispatch("opened", message({ id: "stopped", url: "/orders/43" }));
    pushWorld.dispatch("opened", message({ id: "m3", url: "myapp://orders/44" }));
    await settle();
    expect(seen).toEqual(["m1", "stopped", "m3"]);
    expect(heard).toEqual(["https://app.invalid/orders/42", "myapp://orders/44"]);
    subscription.remove();
    pushWorld.dispatch("opened", message({ id: "m4", url: "/orders/45" }));
    await settle();
    expect(heard).toHaveLength(2);
  });
});
