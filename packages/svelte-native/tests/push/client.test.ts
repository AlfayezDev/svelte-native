// The device's side of push (`src/push/client.ts`) against a stand-in for the native module `SveltePush` that records what it was asked, and a fake `Linking`.
import { afterEach, describe, expect, jest, spyOn, test } from "bun:test";
import { FOREGROUND_TIMEOUT_MS, linkOf, MISSING_PUSH, PERMISSION_KEY, PushClient, SAVED_TOKEN_KEY, storedPermission, type NativePushModule, type PushLinking, type PushPermission, type PushState } from "../../src/push/client.ts";
import type { PushHooks } from "../../src/push/hooks.ts";
import type { PushMessage, PushToken } from "../../src/push/types.ts";
import { createStorage, memoryBackend } from "../../src/web-storage.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TOKEN: PushToken = { provider: "fcm", token: "token-1", app: "dev.example.app" };
const message = (patch: Partial<PushMessage> = {}): PushMessage => ({ id: "m1", title: "Order ready", body: "Pickup at gate 3", data: {}, provider: "fcm", ...patch });

type Options = {
  permission?: PushPermission;
  /** What the system answers when the app asks. */
  answer?: PushPermission;
  token?: PushToken;
  /** The message whose tap launched the process. */
  launch?: PushMessage | null;
  hooks?: PushHooks;
  /** What the platform's `Linking.getInitialURL` answers. */
  platformURL?: string | null | (() => Promise<string | null>);
  ready?: () => Promise<void> | undefined;
  storage?: Storage;
  /** A build without the native module. */
  module?: false;
};

function fake(options: Options = {}) {
  const calls: string[] = [];
  let permission = options.permission ?? "prompt";
  let token = options.token ?? TOKEN;
  let launch = options.launch ?? null;
  let hooks = options.hooks;
  const listeners = new Map<number, { event: string; listener: (payload: any) => void }>();
  let nextListener = 0;
  const native: NativePushModule = {
    permission: async () => { calls.push("permission"); return permission; },
    requestPermission: async () => { calls.push("request"); permission = options.answer ?? "granted"; return permission; },
    register: async () => { calls.push("register"); return token; },
    unregister: async () => { calls.push("unregister"); },
    show: async (shown, presentation) => { calls.push(`show ${shown.id} ${JSON.stringify(presentation)}`); },
    takeLaunchMessage: () => { calls.push("take"); const taken = launch; launch = null; return taken; },
    backgroundDone: (id) => { calls.push(`done ${id}`); },
    addListener: (event, listener) => {
      calls.push(`listen ${event}`);
      const key = nextListener++;
      listeners.set(key, { event, listener });
      return { remove: () => { listeners.delete(key); } };
    },
  };
  const state: PushState = { permission: "prompt", token: null };
  const storage = options.storage ?? createStorage(memoryBackend());
  const emitted: string[] = [];
  const platformURL = options.platformURL ?? null;
  // The `url` listeners the platform's links reach (React Native's emitter); `emit` is the client's own, for a tap, and records it instead.
  const urlListeners = new Set<(event: { url: string }) => void>();
  const linking: PushLinking = {
    getInitialURL: typeof platformURL === "function" ? platformURL : async () => platformURL,
    addEventListener: (_event, listener) => { urlListeners.add(listener); return { remove: () => { urlListeners.delete(listener); } }; },
    emit: (_event, payload) => { calls.push(`url ${payload.url}`); emitted.push(payload.url); },
  };
  /** A link the platform delivers as a `url` event. */
  const arrive = (url: string) => { for (const listener of [...urlListeners]) listener({ url }); };
  let returnToForeground: (() => void) | undefined;
  const client = new PushClient({
    native: options.module === false ? null : native,
    state,
    hooks: () => hooks,
    ready: options.ready,
    storage: () => storage,
    onForeground: (listener) => { returnToForeground = listener; },
    linking,
  });
  client.start();
  const dispatch = (event: string, payload: unknown) => { for (const { event: name, listener } of [...listeners.values()]) if (name === event) listener(payload); };
  return {
    client, native, state, calls, storage, emitted, linking, listeners, urlListeners,
    dispatch, arrive,
    setPermission: (value: PushPermission) => { permission = value; },
    setToken: (value: PushToken) => { token = value; },
    setHooks: (value: PushHooks | undefined) => { hooks = value; },
    foreground: () => returnToForeground?.(),
    /** The calls from `from` on, to read what one step did. */
    since: (from: number) => calls.slice(from),
  };
}

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
/** Lets every promise chain that is waiting on nothing but other promises run (what `settle` does without a timer, for the tests that fake them). */
const flush = async () => { for (let turn = 0; turn < 20; turn++) await Promise.resolve(); };

const spies: { mockRestore(): void }[] = [];
/** Silences `console.error` and `console.warn` for the rest of a test and records what they were called with; the test's end puts them back. */
function logs() {
  const errors = spyOn(console, "error").mockImplementation(() => {});
  const warnings = spyOn(console, "warn").mockImplementation(() => {});
  spies.push(errors, warnings);
  return { errors, warnings, messages: (spy: typeof errors) => spy.mock.calls.map((call) => String(call[0])) };
}
afterEach(() => {
  jest.useRealTimers();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("the permission", () => {
  test("reads the system's state when it starts, without asking: granted, denied or prompt", async () => {
    for (const permission of ["granted", "denied", "prompt"] as const) {
      const { state, calls } = fake({ permission });
      await settle();
      expect([permission, state.permission]).toEqual([permission, permission]);
      expect(calls).not.toContain("request");
    }
  });

  test("is read again when the app returns to the foreground: a change made in the settings shows", async () => {
    const { state, foreground, setPermission } = fake({ permission: "prompt" });
    await settle();
    expect(state.permission).toBe("prompt");
    setPermission("granted");
    foreground();
    await settle();
    expect(state.permission).toBe("granted");
    setPermission("denied");
    foreground();
    await settle();
    expect(state.permission).toBe("denied");
  });

  test("a build without the module: denied at once, subscribe resolves null, and one warning says what to install", async () => {
    const { warnings, messages } = logs();
    const storage = createStorage(memoryBackend());
    const { client, state, calls } = fake({ module: false, storage });
    expect(state.permission).toBe("denied");
    expect(storage.getItem(PERMISSION_KEY)).toBeNull(); // the build is missing the module; the user has not answered
    expect(await client.subscribe({ save: () => { throw new Error("no token to save"); } })).toBeNull();
    await client.subscribe({ save: () => {} });
    await client.unsubscribe();
    expect(calls).toEqual([]);
    expect(messages(warnings)).toEqual([MISSING_PUSH]);
    expect(MISSING_PUSH).toContain("@alfayez/svelte-native-push");
    expect(MISSING_PUSH).toContain("capabilities");
    // Messages are not delivered, but the listeners can still be added and removed.
    expect(client.on("message", () => {})).toBeInstanceOf(Function);
  });

  test("is written to the storage whenever the module reports it (at start, in the foreground, and after a question), and only when it changed", async () => {
    const storage = createStorage(memoryBackend());
    const writes: string[] = [];
    const counting = new Proxy(storage, { get: (target, key) => (key === "setItem" ? (name: string, value: string) => { if (name === PERMISSION_KEY) writes.push(`${name}=${value}`); target.setItem(name, value); } : Reflect.get(target, key)) });
    const { client, foreground, setPermission } = fake({ permission: "prompt", storage: counting });
    await settle();
    expect(storage.getItem(PERMISSION_KEY)).toBe("prompt");
    foreground();
    await settle();
    expect(writes).toEqual([`${PERMISSION_KEY}=prompt`]);
    await client.subscribe({ save: () => {} });
    expect(storage.getItem(PERMISSION_KEY)).toBe("granted");
    setPermission("denied");
    foreground();
    await settle();
    expect(storage.getItem(PERMISSION_KEY)).toBe("denied");
    expect(writes).toEqual([`${PERMISSION_KEY}=prompt`, `${PERMISSION_KEY}=granted`, `${PERMISSION_KEY}=denied`]);
  });

  test("storedPermission reads what was written, and nothing else: no storage, no value, or a value that is not a permission", () => {
    const storage = createStorage(memoryBackend());
    expect(storedPermission(undefined)).toBeNull();
    expect(storedPermission(storage)).toBeNull();
    for (const permission of ["granted", "denied", "prompt"] as const) {
      storage.setItem(PERMISSION_KEY, permission);
      expect(storedPermission(storage)).toBe(permission);
    }
    storage.setItem(PERMISSION_KEY, "maybe");
    expect(storedPermission(storage)).toBeNull();
  });

  test("starting twice listens once", () => {
    const { client, listeners } = fake();
    client.start();
    expect(listeners.size).toBe(4);
  });
});

describe("subscribe", () => {
  test("asks for the permission once, registers, and saves the token; the next call asks and saves nothing", async () => {
    const { client, state, calls } = fake();
    const saved: PushToken[] = [];
    const token = await client.subscribe({ save: (value) => { saved.push(value); } });
    expect(token).toEqual(TOKEN);
    expect(saved).toEqual([TOKEN]);
    expect(state).toEqual({ permission: "granted", token: TOKEN });
    expect(calls.filter((call) => ["request", "register"].includes(call))).toEqual(["request", "register"]);
    const mark = calls.length;
    expect(await client.subscribe({ save: (value) => { saved.push(value); } })).toEqual(TOKEN);
    expect(saved).toHaveLength(1);
    expect(calls.slice(mark)).toEqual(["permission", "register"]);
  });

  test("does not ask when the permission is granted, and does not register when it is denied", async () => {
    const granted = fake({ permission: "granted" });
    expect(await granted.client.subscribe({ save: () => {} })).toEqual(TOKEN);
    expect(granted.calls).not.toContain("request");

    const denied = fake({ permission: "denied" });
    const saved: PushToken[] = [];
    expect(await denied.client.subscribe({ save: (value) => { saved.push(value); } })).toBeNull();
    expect(denied.calls).not.toContain("request");
    expect(denied.calls).not.toContain("register");
    expect(saved).toEqual([]);
    expect(denied.state).toEqual({ permission: "denied", token: null });
  });

  test("a user who refuses the question gets null, the state follows, and nothing is registered or saved", async () => {
    const { client, state, calls } = fake({ answer: "denied" });
    let saved = 0;
    expect(await client.subscribe({ save: () => { saved++; } })).toBeNull();
    expect(state).toEqual({ permission: "denied", token: null });
    expect(calls).not.toContain("register");
    expect(saved).toBe(0);
  });

  test("calls at the same time ask once and save once", async () => {
    const { client, calls } = fake();
    let saved = 0;
    const save = () => { saved++; return settle(5); };
    const results = await Promise.all([client.subscribe({ save }), client.subscribe({ save }), client.subscribe({ save })]);
    expect(results).toEqual([TOKEN, TOKEN, TOKEN]);
    expect(calls.filter((call) => call === "request")).toHaveLength(1);
    expect(saved).toBe(1);
  });

  test("saves a token that changed since the last save, and one the app has not saved at all", async () => {
    const { client, setToken } = fake({ permission: "granted" });
    const saved: string[] = [];
    const save = (token: PushToken) => { saved.push(token.token); };
    await client.subscribe({ save });
    await client.subscribe({ save });
    setToken({ ...TOKEN, token: "token-2" });
    await client.subscribe({ save });
    await client.subscribe({ save });
    expect(saved).toEqual(["token-1", "token-2"]);
    // The project or the APNs environment is part of what a token is.
    setToken({ provider: "apns", token: "ab12", app: "dev.example.app", environment: "development" });
    await client.subscribe({ save });
    setToken({ provider: "apns", token: "ab12", app: "dev.example.app", environment: "production" });
    await client.subscribe({ save });
    expect(saved).toEqual(["token-1", "token-2", "ab12", "ab12"]);
  });

  test("remembers the last save across launches: a new client over the same storage saves nothing for the same token, and saves a different one", async () => {
    const storage = createStorage(memoryBackend());
    const first = fake({ permission: "granted", storage });
    await first.client.subscribe({ save: () => {} });
    expect(storage.getItem(SAVED_TOKEN_KEY)).not.toBeNull();

    const saved: string[] = [];
    const save = (token: PushToken) => { saved.push(token.token); };
    const second = fake({ permission: "granted", storage });
    await second.client.subscribe({ save });
    expect(saved).toEqual([]);

    const third = fake({ permission: "granted", storage, token: { ...TOKEN, token: "token-2" } });
    await third.client.subscribe({ save });
    expect(saved).toEqual(["token-2"]);
  });

  test("a save that rejects is not remembered: subscribe rejects with its error and the next call saves again", async () => {
    const storage = createStorage(memoryBackend());
    const { client, state } = fake({ permission: "granted", storage });
    let attempts = 0;
    const save = async () => { attempts++; if (attempts === 1) throw new Error("the server is down"); };
    await expect(client.subscribe({ save })).rejects.toThrow("the server is down");
    expect(storage.getItem(SAVED_TOKEN_KEY)).toBeNull();
    expect(state.token).toEqual(TOKEN); // registered, though not saved
    expect(await client.subscribe({ save })).toEqual(TOKEN);
    expect(attempts).toBe(2);
    expect(await client.subscribe({ save })).toEqual(TOKEN);
    expect(attempts).toBe(2);
    expect(storage.getItem(SAVED_TOKEN_KEY)).not.toBeNull();
  });

  test("without a storage (a binary without MMKV) the last save is remembered for this launch only", async () => {
    const { native } = fake({ permission: "granted" });
    const bare = new PushClient({
      native, state: { permission: "prompt", token: null }, hooks: () => undefined, storage: () => undefined, onForeground: () => {},
      linking: { getInitialURL: async () => null, addEventListener: () => ({ remove() {} }), emit: () => {} },
    });
    const saved: string[] = [];
    const save = (token: PushToken) => { saved.push(token.token); };
    await bare.subscribe({ save });
    await bare.subscribe({ save });
    expect(saved).toEqual(["token-1"]);
    await bare.unsubscribe();
    await bare.subscribe({ save });
    expect(saved).toEqual(["token-1", "token-1"]);
  });

  test("save must be a function", async () => {
    const { client, calls } = fake();
    await expect(client.subscribe({} as any)).rejects.toThrow(TypeError);
    await expect(client.subscribe(undefined as any)).rejects.toThrow("push.subscribe takes `{ save }`");
    expect(calls).not.toContain("request");
  });
});

describe("a rotated token", () => {
  test("is saved with the save of the last subscribe, and push.token follows", async () => {
    const { client, state, dispatch } = fake({ permission: "granted" });
    const saved: string[] = [];
    await client.subscribe({ save: (token) => { saved.push(token.token); } });
    dispatch("token", { ...TOKEN, token: "token-2" });
    await settle();
    expect(saved).toEqual(["token-1", "token-2"]);
    expect(state.token?.token).toBe("token-2");
    // The same token again is not a rotation.
    dispatch("token", { ...TOKEN, token: "token-2" });
    await settle();
    expect(saved).toEqual(["token-1", "token-2"]);
  });

  test("is not saved before the app has subscribed, nor after it unsubscribed; the next subscribe saves what it registers", async () => {
    const { client, state, dispatch } = fake({ permission: "granted" });
    const saved: string[] = [];
    const save = (token: PushToken) => { saved.push(token.token); };
    dispatch("token", { ...TOKEN, token: "early" });
    await settle();
    expect([saved, state.token]).toEqual([[], null]);
    await client.subscribe({ save });
    await client.unsubscribe();
    dispatch("token", { ...TOKEN, token: "late" });
    await settle();
    expect([saved, state.token]).toEqual([["token-1"], null]);
  });

  test("a save of it that fails is logged, is not remembered, and the next subscribe tries again", async () => {
    const { errors, messages } = logs();
    const { client, dispatch, setToken } = fake({ permission: "granted" });
    const saved: string[] = [];
    let failing = true;
    const save = async (token: PushToken) => { saved.push(token.token); if (failing && token.token === "token-2") throw new Error("offline"); };
    await client.subscribe({ save });
    dispatch("token", { ...TOKEN, token: "token-2" });
    await settle();
    expect(messages(errors)[0]).toContain("saving the token the provider rotated failed");
    failing = false;
    setToken({ ...TOKEN, token: "token-2" });
    await client.subscribe({ save });
    expect(saved).toEqual(["token-1", "token-2", "token-2"]);
  });

  test("a save that finishes after a newer rotation does not remember the older token", async () => {
    const storage = createStorage(memoryBackend());
    const { client, dispatch } = fake({ permission: "granted", storage });
    const finish: (() => void)[] = [];
    const saved: string[] = [];
    const save = (token: PushToken) => new Promise<void>((resolve) => { saved.push(token.token); finish.push(resolve); });
    const first = client.subscribe({ save });
    await settle();
    dispatch("token", { ...TOKEN, token: "token-2" });
    await settle();
    expect(saved).toEqual(["token-1", "token-2"]);
    finish[0]();
    await first;
    expect(storage.getItem(SAVED_TOKEN_KEY)).toBeNull(); // the older token's save came back: the newer one's is still out
    finish[1]();
    await settle();
    expect(JSON.parse(storage.getItem(SAVED_TOKEN_KEY) as string)).toEqual(["fcm", null, "dev.example.app", "token-2"]);
  });
});

describe("unsubscribe", () => {
  test("deletes the token with the provider, forgets the saved one and push.token, so the next subscribe saves again", async () => {
    const storage = createStorage(memoryBackend());
    const { client, state, calls } = fake({ permission: "granted", storage });
    const saved: string[] = [];
    const save = (token: PushToken) => { saved.push(token.token); };
    await client.subscribe({ save });
    await client.unsubscribe();
    expect(calls).toContain("unregister");
    expect(state.token).toBeNull();
    expect(storage.getItem(SAVED_TOKEN_KEY)).toBeNull();
    await client.subscribe({ save });
    expect(saved).toEqual(["token-1", "token-1"]);
  });

  test("a failure of the provider rejects, and what the app removed from its server is forgotten all the same", async () => {
    const { client, native, state } = fake({ permission: "granted" });
    let saved = 0;
    const save = () => { saved++; };
    await client.subscribe({ save });
    native.unregister = async () => { throw new Error("no network"); };
    await expect(client.unsubscribe()).rejects.toThrow("no network");
    expect(state.token).toBeNull();
    await client.subscribe({ save });
    expect(saved).toBe(2);
  });

  test("a subscribe that is still registering when it runs does not save a token for the signed-out user", async () => {
    const { client, native, state } = fake({ permission: "granted" });
    let release: (() => void) | undefined;
    native.register = () => new Promise((resolve) => { release = () => resolve(TOKEN); });
    let saved = 0;
    const subscribing = client.subscribe({ save: () => { saved++; } });
    await settle();
    await client.unsubscribe();
    release?.();
    expect(await subscribing).toBeNull();
    expect([saved, state.token]).toEqual([0, null]);
  });

  test("a subscribe that is still asking for the permission when it runs registers nothing", async () => {
    const { client, native, state, calls } = fake();
    let answer: ((permission: PushPermission) => void) | undefined;
    native.requestPermission = () => new Promise((resolve) => { answer = resolve; });
    let saved = 0;
    const subscribing = client.subscribe({ save: () => { saved++; } });
    await settle();
    await client.unsubscribe();
    answer?.("granted");
    expect(await subscribing).toBeNull();
    expect([saved, state.token, calls.includes("register")]).toEqual([0, null, false]);
  });

  test("a save that is still in flight when it runs is not remembered", async () => {
    const storage = createStorage(memoryBackend());
    const { client } = fake({ permission: "granted", storage });
    let finish: (() => void) | undefined;
    const subscribing = client.subscribe({ save: () => new Promise<void>((resolve) => { finish = resolve; }) });
    await settle();
    await client.unsubscribe();
    finish?.();
    await subscribing;
    expect(storage.getItem(SAVED_TOKEN_KEY)).toBeNull();
  });
});

describe("a message in the foreground", () => {
  const defaults = JSON.stringify({ banner: true, sound: true, badge: true });

  test("is shown by default when the app has no hook, and the native side is answered with the message it sent", async () => {
    const { dispatch, calls } = fake();
    const arrived = message();
    dispatch("message", arrived);
    await settle();
    expect(calls).toContain(`show m1 ${defaults}`);
  });

  test("the hook's answer is the presentation; a member it leaves out is shown", async () => {
    const seen: PushMessage[] = [];
    const { dispatch, calls, setHooks } = fake({ hooks: { foreground: (arrived) => { seen.push(arrived); return { banner: false }; } } });
    const arrived = message();
    dispatch("message", arrived);
    await settle();
    expect(seen).toEqual([arrived]);
    expect(calls).toContain(`show m1 ${JSON.stringify({ banner: false, sound: true, badge: true })}`);

    setHooks({ foreground: async () => { await settle(5); return { sound: false, badge: false }; } });
    dispatch("message", message({ id: "m2" }));
    await settle(20);
    expect(calls).toContain(`show m2 ${JSON.stringify({ banner: true, sound: false, badge: false })}`);

    // Nothing answered, or something that is not a presentation: the default.
    for (const [id, answer] of [["m3", undefined], ["m4", null], ["m5", false], ["m6", "yes"]] as const) {
      setHooks({ foreground: () => answer as any });
      dispatch("message", message({ id }));
    }
    await settle();
    for (const id of ["m3", "m4", "m5", "m6"]) expect(calls).toContain(`show ${id} ${defaults}`);
  });

  test("the hook is called as a method of the app's hooks, with the hooks as they are registered when the message comes", async () => {
    const hooks = { name: "mine", foreground(this: { name: string }) { return { banner: this.name === "mine" }; } };
    const { dispatch, calls, setHooks } = fake({ hooks: hooks as PushHooks });
    dispatch("message", message());
    await settle();
    expect(calls.filter((call) => call.startsWith("show"))).toEqual([`show m1 ${JSON.stringify({ banner: true, sound: true, badge: true })}`]);
    setHooks({ foreground: () => ({ banner: false }) });
    dispatch("message", message({ id: "m2" }));
    await settle();
    expect(calls).toContain(`show m2 ${JSON.stringify({ banner: false, sound: true, badge: true })}`);
  });

  test("a hook that takes longer than the timeout gets the default, shown without waiting, and its late answer is ignored", async () => {
    const { errors } = logs();
    jest.useFakeTimers();
    let answer: ((value: { banner: boolean }) => void) | undefined;
    const { dispatch, calls } = fake({ hooks: { foreground: () => new Promise((resolve) => { answer = resolve; }) } });
    const shows = () => calls.filter((call) => call.startsWith("show"));
    dispatch("message", message());
    await flush();
    expect(shows()).toEqual([]);
    jest.advanceTimersByTime(FOREGROUND_TIMEOUT_MS - 1);
    await flush();
    expect(shows()).toEqual([]);
    jest.advanceTimersByTime(1);
    await flush();
    expect(shows()).toEqual([`show m1 ${defaults}`]);
    answer?.({ banner: false });
    await flush();
    expect(shows()).toHaveLength(1);
    expect(errors).not.toHaveBeenCalled();
    // The native side shows a message by itself after a second: the default must arrive before.
    expect(FOREGROUND_TIMEOUT_MS).toBeLessThan(1000);
  });

  test("a hook that answers in time does not leave its timer behind", async () => {
    jest.useFakeTimers();
    const { dispatch } = fake({ hooks: { foreground: () => ({ banner: false }) } });
    dispatch("message", message());
    await flush();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a hook that throws, or rejects, gets the default, and the error is logged", async () => {
    const { errors, messages } = logs();
    const { dispatch, calls, setHooks } = fake({ hooks: { foreground: () => { throw new Error("sync failure"); } } });
    dispatch("message", message());
    await settle();
    expect(calls).toContain(`show m1 ${defaults}`);
    setHooks({ foreground: async () => { throw new Error("async failure"); } });
    dispatch("message", message({ id: "m2" }));
    await settle();
    expect(calls).toContain(`show m2 ${defaults}`);
    expect(messages(errors)).toEqual(["[Svelte push] the foreground hook failed", "[Svelte push] the foreground hook failed"]);
    expect((errors.mock.calls.map((call) => (call[1] as Error).message))).toEqual(["sync failure", "async failure"]);
  });

  test("the listeners of on(\"message\") hear it after it was shown; one that stops listening does not; one that throws does not keep the others from it", async () => {
    const reported: unknown[] = [];
    const { setTimeout: realSetTimeout } = globalThis;
    (globalThis as any).setTimeout = (callback: () => void, ms?: number) => realSetTimeout(() => { try { callback(); } catch (error) { reported.push(error); } }, ms);
    try {
      const { client, dispatch, calls } = fake();
      const heard: string[] = [];
      client.on("message", (arrived) => { heard.push(`first ${arrived.id} after ${calls.filter((call) => call.startsWith("show")).length} shows`); });
      const stop = client.on("message", (arrived) => { heard.push(`second ${arrived.id}`); });
      client.on("message", () => { throw new Error("a listener's bug"); });
      client.on("message", (arrived) => { heard.push(`fourth ${arrived.id}`); });
      dispatch("message", message());
      await settle(5);
      expect(heard).toEqual(["first m1 after 1 shows", "second m1", "fourth m1"]);
      expect(reported.map((error) => (error as Error).message)).toEqual(["a listener's bug"]);
      stop();
      stop();
      dispatch("message", message({ id: "m2" }));
      await settle(5);
      expect(heard.slice(3)).toEqual(["first m2 after 2 shows", "fourth m2"]);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("the same listener added twice hears it twice, and each stop removes one", async () => {
    const { client, dispatch } = fake();
    let heard = 0;
    const listener = () => { heard++; };
    const stopFirst = client.on("message", listener);
    client.on("message", listener);
    dispatch("message", message());
    await settle();
    expect(heard).toBe(2);
    stopFirst();
    dispatch("message", message({ id: "m2" }));
    await settle();
    expect(heard).toBe(3);
  });

  test("the listeners hear a message whose presentation the native side could not show, and the failure is logged", async () => {
    const { errors, messages } = logs();
    const { client, dispatch, native } = fake();
    native.show = async () => { throw new Error("no channel"); };
    const heard: string[] = [];
    client.on("message", (arrived) => { heard.push(arrived.id); });
    dispatch("message", message());
    await settle();
    expect(heard).toEqual(["m1"]);
    expect(messages(errors)).toEqual(["[Svelte push] the native side could not show the message"]);
  });

  test("on takes only \"message\" and a function", () => {
    const { client } = fake();
    expect(() => client.on("opened" as any, () => {})).toThrow(TypeError);
    expect(() => client.on("message", "nope" as any)).toThrow(TypeError);
  });

  test("waits for init: the hook does not run until it has settled", async () => {
    let settled: (() => void) | undefined;
    const initializing = new Promise<void>((resolve) => { settled = resolve; });
    const seen: string[] = [];
    const { dispatch, calls } = fake({ ready: () => initializing, hooks: { foreground: () => { seen.push("hook"); return { banner: false }; } } });
    dispatch("message", message());
    await settle();
    expect(seen).toEqual([]);
    settled?.();
    await settle();
    expect(seen).toEqual(["hook"]);
    expect(calls).toContain(`show m1 ${JSON.stringify({ banner: false, sound: true, badge: true })}`);
  });
});

describe("a message in the background", () => {
  const event = (id = "wake-1", arrived = message({ id: "d1", data: { inbox: "7" } })) => ({ id, message: arrived });

  test("runs the hook with the message and then releases the native side with the event's completion id", async () => {
    const log: string[] = [];
    const { dispatch, calls } = fake({
      hooks: { background: async (arrived) => { log.push(`hook ${arrived.id} ${arrived.data.inbox}`); await settle(5); log.push("hook done"); } },
    });
    const mark = calls.length;
    dispatch("background", event());
    await settle(20);
    expect(log).toEqual(["hook d1 7", "hook done"]);
    expect(calls.slice(mark)).toEqual(["done wake-1"]);
    // The hook finished before the release.
    log.length = 0;
    const slow = fake({ hooks: { background: async () => { await settle(30); log.push("finished"); } } });
    slow.dispatch("background", event("wake-2"));
    await settle(5);
    expect(slow.calls).not.toContain("done wake-2");
    await settle(60);
    expect(log).toEqual(["finished"]);
    expect(slow.calls).toContain("done wake-2");
  });

  test("releases it when the hook throws or rejects (the error is logged), and when there is no hook", async () => {
    const { errors, messages } = logs();
    const sync = fake({ hooks: { background: () => { throw new Error("sync failure"); } } });
    sync.dispatch("background", event("a"));
    const rejecting = fake({ hooks: { background: async () => { throw new Error("async failure"); } } });
    rejecting.dispatch("background", event("b"));
    const none = fake();
    none.dispatch("background", event("c"));
    const other = fake({ hooks: { opened: () => {} } });
    other.dispatch("background", event("d"));
    await settle();
    expect(sync.calls).toContain("done a");
    expect(rejecting.calls).toContain("done b");
    expect(none.calls).toContain("done c");
    expect(other.calls).toContain("done d");
    expect(messages(errors)).toEqual(["[Svelte push] the background hook failed", "[Svelte push] the background hook failed"]);
  });

  test("waits for init, as a launch without a screen runs it", async () => {
    let settled: (() => void) | undefined;
    const initializing = new Promise<void>((resolve) => { settled = resolve; });
    const seen: string[] = [];
    const { dispatch, calls } = fake({ ready: () => initializing, hooks: { background: () => { seen.push("hook"); } } });
    dispatch("background", event());
    await settle();
    expect([seen, calls.includes("done wake-1")]).toEqual([[], false]);
    settled?.();
    await settle();
    expect([seen, calls.includes("done wake-1")]).toEqual([["hook"], true]);
  });

  test("does not call the foreground hook, and shows nothing itself", async () => {
    const { dispatch, calls } = fake({ hooks: { foreground: () => { throw new Error("not for a background message"); } } });
    dispatch("background", event());
    await settle();
    expect(calls.filter((call) => call.startsWith("show"))).toEqual([]);
  });
});

describe("a tap with the app running", () => {
  test("runs the opened hook and then opens the link: a path of the app reaches the url listeners as a link openURL takes", async () => {
    const { dispatch, calls } = fake({ hooks: { opened: (arrived) => { calls.push(`hook ${arrived.id}`); } } });
    dispatch("opened", message({ url: "/orders/42" }));
    await settle();
    expect(calls.filter((call) => call.startsWith("hook") || call.startsWith("url"))).toEqual(["hook m1", "url https://app.invalid/orders/42"]);
  });

  test("a full link is opened as it is", async () => {
    const { dispatch, emitted } = fake();
    dispatch("opened", message({ url: "myapp://orders/42?tab=1" }));
    dispatch("opened", message({ id: "m2", url: "https://example.com/orders/42" }));
    await settle();
    expect(emitted).toEqual(["myapp://orders/42?tab=1", "https://example.com/orders/42"]);
  });

  test("the default, with no hook or one that returns nothing or true, opens the link", async () => {
    const none = fake();
    none.dispatch("opened", message({ url: "/a" }));
    const quiet = fake({ hooks: { opened: () => {} } });
    quiet.dispatch("opened", message({ url: "/b" }));
    const yes = fake({ hooks: { opened: () => true } });
    yes.dispatch("opened", message({ url: "/c" }));
    const later = fake({ hooks: { opened: async () => { await settle(5); } } });
    later.dispatch("opened", message({ url: "/d" }));
    await settle(20);
    expect([none.emitted, quiet.emitted, yes.emitted, later.emitted]).toEqual([["https://app.invalid/a"], ["https://app.invalid/b"], ["https://app.invalid/c"], ["https://app.invalid/d"]]);
  });

  test("a hook that returns false, or resolves false, stops the link; it still ran", async () => {
    const seen: string[] = [];
    const sync = fake({ hooks: { opened: (arrived) => { seen.push(arrived.id); return false; } } });
    sync.dispatch("opened", message({ url: "/orders/42" }));
    const async = fake({ hooks: { opened: async (arrived) => { await settle(5); seen.push(`async ${arrived.id}`); return false; } } });
    async.dispatch("opened", message({ url: "/orders/42" }));
    await settle(20);
    expect(seen).toEqual(["m1", "async m1"]);
    expect([sync.emitted, async.emitted]).toEqual([[], []]);
  });

  test("a message without a url opens nothing, and the hook runs", async () => {
    const seen: string[] = [];
    const { dispatch, emitted } = fake({ hooks: { opened: (arrived) => { seen.push(arrived.id); } } });
    dispatch("opened", message());
    dispatch("opened", message({ id: "m2", url: "" }));
    await settle();
    expect(seen).toEqual(["m1", "m2"]);
    expect(emitted).toEqual([]);
  });

  test("a hook that throws is logged and the link opens, as it does without a hook", async () => {
    const { errors, messages } = logs();
    const { dispatch, emitted } = fake({ hooks: { opened: () => { throw new Error("broken hook"); } } });
    dispatch("opened", message({ url: "/orders/42" }));
    await settle();
    expect(emitted).toEqual(["https://app.invalid/orders/42"]);
    expect(messages(errors)).toEqual(["[Svelte push] the opened hook failed"]);
  });

  test("waits for init", async () => {
    let settled: (() => void) | undefined;
    const initializing = new Promise<void>((resolve) => { settled = resolve; });
    const { dispatch, emitted } = fake({ ready: () => initializing });
    dispatch("opened", message({ url: "/orders/42" }));
    await settle();
    expect(emitted).toEqual([]);
    settled?.();
    await settle();
    expect(emitted).toEqual(["https://app.invalid/orders/42"]);
  });
});

describe("the tap that launched the app, through Linking.getInitialURL", () => {
  const launching = message({ id: "launch", url: "/orders/42" });

  test("the launch notification's link, after the opened hook, when the platform has no link", async () => {
    const order: string[] = [];
    const { linking, calls } = fake({ launch: launching, hooks: { opened: async (arrived) => { await settle(5); order.push(`hook ${arrived.id}`); } } });
    expect(calls).not.toContain("take"); // taken when the router asks, not before
    const link = await linking.getInitialURL();
    order.push(`link ${link}`);
    expect(order).toEqual(["hook launch", "link https://app.invalid/orders/42"]);
    expect(calls.filter((call) => call === "take")).toHaveLength(1);
  });

  test("the platform's own link wins; the opened hook still runs for the tap", async () => {
    const seen: string[] = [];
    const { linking } = fake({ launch: launching, platformURL: "myapp://settings", hooks: { opened: (arrived) => { seen.push(arrived.id); } } });
    expect(await linking.getInitialURL()).toBe("myapp://settings");
    expect(seen).toEqual(["launch"]);
  });

  test("a hook that returns false stops the notification's link, not the platform's", async () => {
    const stopped = fake({ launch: launching, hooks: { opened: () => false } });
    expect(await stopped.linking.getInitialURL()).toBeNull();
    const platform = fake({ launch: launching, platformURL: "myapp://settings", hooks: { opened: () => false } });
    expect(await platform.linking.getInitialURL()).toBe("myapp://settings");
  });

  test("a full link, and no link at all", async () => {
    expect(await fake({ launch: message({ url: "myapp://orders/42" }) }).linking.getInitialURL()).toBe("myapp://orders/42");
    expect(await fake({ launch: message() }).linking.getInitialURL()).toBeNull();
    const plain = fake({ launch: null, platformURL: "myapp://x" });
    expect(await plain.linking.getInitialURL()).toBe("myapp://x");
    expect(await fake().linking.getInitialURL()).toBeNull();
  });

  test("the launch message is taken once: a second read answers the same and does not run the hook again", async () => {
    let ran = 0;
    const { linking, calls } = fake({ launch: launching, hooks: { opened: () => { ran++; } } });
    const first = await linking.getInitialURL();
    const second = await linking.getInitialURL();
    expect([first, second]).toEqual(["https://app.invalid/orders/42", "https://app.invalid/orders/42"]);
    expect(ran).toBe(1);
    expect(calls.filter((call) => call === "take")).toHaveLength(1);
  });

  test("a read that starts together with another shares the one take", async () => {
    const { linking, calls } = fake({ launch: launching });
    const links = await Promise.all([linking.getInitialURL(), linking.getInitialURL()]);
    expect(links).toEqual(["https://app.invalid/orders/42", "https://app.invalid/orders/42"]);
    expect(calls.filter((call) => call === "take")).toHaveLength(1);
  });

  test("a platform that fails to answer fails the read as it did, and the tap's hook has run", async () => {
    const seen: string[] = [];
    const { linking } = fake({ launch: launching, platformURL: async () => { throw new Error("the link service is down"); }, hooks: { opened: (arrived) => { seen.push(arrived.id); } } });
    await expect(linking.getInitialURL()).rejects.toThrow("the link service is down");
    await settle();
    expect(seen).toEqual(["launch"]);
  });

  test("a launch message that cannot be read is logged and the platform's link is what the app gets", async () => {
    const { errors, messages } = logs();
    const { linking, native } = fake({ platformURL: "myapp://settings" });
    native.takeLaunchMessage = () => { throw new Error("no extras"); };
    expect(await linking.getInitialURL()).toBe("myapp://settings");
    expect(messages(errors)).toEqual(["[Svelte push] the notification that launched the app could not be read"]);
  });

  test("the hook waits for init, and the answer is the link after it", async () => {
    let settled: (() => void) | undefined;
    const initializing = new Promise<void>((resolve) => { settled = resolve; });
    const seen: string[] = [];
    const { linking } = fake({ launch: launching, ready: () => initializing, hooks: { opened: () => { seen.push("hook"); } } });
    const reading = linking.getInitialURL();
    await settle();
    expect(seen).toEqual([]);
    settled?.();
    expect(await reading).toBe("https://app.invalid/orders/42");
    expect(seen).toEqual(["hook"]);
  });

  test("a build without the module leaves Linking as it was", async () => {
    logs();
    const original = async () => "myapp://x";
    let listened = 0;
    const linking: PushLinking = { getInitialURL: original, addEventListener: () => { listened++; return { remove() {} }; }, emit: () => {} };
    new PushClient({ native: null, state: { permission: "prompt", token: null }, hooks: () => undefined, storage: () => undefined, onForeground: () => {}, linking }).start();
    expect(linking.getInitialURL).toBe(original);
    expect(listened).toBe(0);
  });
});

describe("a link that arrives before the first read of getInitialURL", () => {
  // iOS: a process the system started for a background message has no screen, and a link that brings it to the foreground is a `url` event no router hears yet.
  test("is the launch link when the platform has none, and wins over the notification's; the opened hook still runs for the tap", async () => {
    const seen: string[] = [];
    const { linking, arrive } = fake({ launch: message({ id: "launch", url: "/orders/42" }), hooks: { opened: (arrived) => { seen.push(arrived.id); } } });
    arrive("myapp://settings");
    expect(await linking.getInitialURL()).toBe("myapp://settings");
    expect(seen).toEqual(["launch"]);
    const alone = fake();
    alone.arrive("https://example.test/orders/7");
    expect(await alone.linking.getInitialURL()).toBe("https://example.test/orders/7");
  });

  test("the last one is kept, and the platform's own launch link wins over it", async () => {
    const twice = fake();
    twice.arrive("myapp://first");
    twice.arrive("myapp://second");
    expect(await twice.linking.getInitialURL()).toBe("myapp://second");
    const platform = fake({ platformURL: "myapp://launched" });
    platform.arrive("myapp://later");
    expect(await platform.linking.getInitialURL()).toBe("myapp://launched");
  });

  test("the listening stops at the first read: a link after it is the router's, and a second read answers the same", async () => {
    const { linking, arrive, urlListeners } = fake();
    expect(urlListeners.size).toBe(1);
    arrive("myapp://early");
    const first = linking.getInitialURL();
    expect(urlListeners.size).toBe(0); // at once, before the read settles: the router's listener, added just before its read, hears what comes next
    arrive("myapp://late");
    expect([await first, await linking.getInitialURL()]).toEqual(["myapp://early", "myapp://early"]);
  });

  test("no link before the read leaves the launch as it was", async () => {
    expect(await fake({ launch: message({ url: "/orders/42" }) }).linking.getInitialURL()).toBe("https://app.invalid/orders/42");
    expect(await fake().linking.getInitialURL()).toBeNull();
  });
});

describe("the link a path becomes", () => {
  test("a path of the app is an https link whose path, search and hash are the path's", () => {
    expect(linkOf("/orders/42")).toBe("https://app.invalid/orders/42");
    expect(linkOf("/orders/42?tab=1&x=a%20b#top")).toBe("https://app.invalid/orders/42?tab=1&x=a%20b#top");
    expect(linkOf("/")).toBe("https://app.invalid/");
    expect(linkOf("orders/42")).toBe("https://app.invalid/orders/42");
    // Not read as a host.
    expect(linkOf("//orders/42")).toBe("https://app.invalid/orders/42");
    expect(linkOf("///evil.example/x")).toBe("https://app.invalid/evil.example/x");
  });

  test("openURL reads it as the path: `URL.parse` accepts it, and the router takes an https link by its pathname, search and hash", () => {
    // The rule of `openURL` in router.svelte.ts: `https:` and `http:` links give their pathname; the others their hostname and pathname.
    const pathOf = (href: string): string | undefined => {
      const url = URL.parse(href);
      if (!url) return undefined;
      const path = url.protocol === "https:" || url.protocol === "http:" ? url.pathname : `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}`;
      return `${path}${url.search}${url.hash}`;
    };
    for (const path of ["/orders/42", "/orders/42?tab=1#top", "/", "/a/b%20c", "//orders/42"]) {
      const link = linkOf(path);
      expect([path, URL.parse(link) !== null, pathOf(link)]).toEqual([path, true, `/${path.replace(/^\/+/, "")}`]);
    }
    // What `openURL` refuses, and why the conversion is needed: a bare path is no URL.
    expect(URL.parse("/orders/42")).toBeNull();
  });

  test("a full link, of any scheme, is kept as it is, and the router reads the app's own scheme by its host and path (`myapp://orders/42` is /orders/42)", () => {
    for (const link of ["myapp://orders/42", "myapp:///orders/42", "https://example.com/orders/42?a=1#b", "HTTP://example.com/x", "mailto:a@b.example", "exp+myapp://orders/42"]) expect(linkOf(link)).toBe(link);
  });
});
