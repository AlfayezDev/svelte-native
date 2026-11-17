/**
 * The device's side of push (PUSH.md): `push.svelte.ts` makes one `PushClient` over the native module `SveltePush` (`@alfayez/svelte-native-push`) and exposes it as `push`.
 * Everything that is not reactive state is here, so that it runs against a stand-in of the module (`tests/push/client.test.ts`).
 *
 * - **Subscribing.** `subscribe({ save })` asks for the permission when the system still asks, registers with FCM or APNs, and calls `save(token)` when the token is new:
 *   not the one last saved successfully, which is remembered in `localStorage` (MMKV) across launches and forgotten by `unsubscribe`. A `save` that rejects is not remembered
 *   and `subscribe` rejects with its error, so the next call saves again. The module's `token` event (the provider rotated the token) saves the same way, with the `save`
 *   of the last `subscribe`; a failure there has no caller to reject to, so it is logged and retried by the next `subscribe`.
 * - **Receiving.** The native events `message` (foreground), `background` and `opened` run the app's `push` hooks (`hooks.ts`) after `init` has settled. A hook that throws is
 *   logged and its default applies, and an error that escapes a handler is logged too, never an unhandled rejection.
 * - **A tapped notification is a link** (PUSH.md, rule 1). The router reads the launch link with `Linking.getInitialURL()` and later links from `Linking.addEventListener("url")`,
 *   and this file feeds both without the router knowing: `getInitialURL()` is wrapped to answer the platform's link, or else the link of the notification whose tap launched
 *   the process; a tap with the app running is emitted as a `url` event, which every `addEventListener("url")` listener (the router's) hears. The `opened` hook runs first.
 *   A path of the app becomes a link `openURL` accepts by `linkOf`.
 *
 * What it assumes of the native module, beyond PUSH.md's table (the native phases implement these):
 *
 * - The module holds its events until JavaScript has a listener for them, and this file listens to all four at start (`token`, `message`, `opened`, `background`).
 * - `takeLaunchMessage()` is called at the first read of `Linking.getInitialURL()` (the router mounting), not when this file starts: a process that began without a screen (a
 *   background message) shows its first screen later, and the tap that opened it is the launch message then. A tap is the launch message until `takeLaunchMessage()` has been
 *   called once, and an `opened` event after that.
 */
import type { PushHooks, PushPresentation } from "./hooks.ts";
import type { PushMessage, PushToken } from "./types.ts";

/** The state of the notification permission, as the system reports it: `prompt` while it can still be asked for (Android 13+ `POST_NOTIFICATIONS`, iOS's first request). */
export type PushPermission = "granted" | "denied" | "prompt";

type Subscription = { remove(): void };

/** The events of the native module, with their payloads. */
export type NativePushEvents = {
  /** The provider rotated the registration: the new token, whole (its `app` and `environment` are part of it). */
  token: PushToken;
  /** A message arrived with the app in the foreground, before anything is shown. The native side holds it until `show` answers, for one second at most, and then shows it by default. */
  message: PushMessage;
  /** A notification was tapped with the app running (the tap that launched the process is `takeLaunchMessage`'s). */
  opened: PushMessage;
  /**
   * A data message arrived with the app in the background or not running. `id` is the completion id: the native side's own handle for this wake, not `message.id`. It holds the
   * process (Android: FCM's worker thread, 18 s at most; iOS: the fetch completion handler, 25 s) until `backgroundDone(id)` is called or its limit passes.
   */
  background: { id: string; message: PushMessage };
};

/** What this file uses of the native module `SveltePush`: the contract of PUSH.md, the same on both platforms. */
export type NativePushModule = {
  /** The system's state, without asking. */
  permission(): Promise<PushPermission>;
  /** Asks (Android 13+: `POST_NOTIFICATIONS`; iOS: alert, sound and badge), and resolves with the state after the user's answer. */
  requestPermission(): Promise<PushPermission>;
  /** Registers with FCM or APNs and resolves with the device's token (APNs's as lowercase hex). */
  register(): Promise<PushToken>;
  /** Deletes the device's token with the provider. */
  unregister(): Promise<void>;
  /**
   * The answer to a `message` event: `message` is the one the event carried (the native side finds the message it is holding by `message.id`) and `presentation` how to show it,
   * every member decided. A message without a title and a body shows nothing whatever the presentation is. Idempotent by `message.id`: when the native side's own second ran out
   * first and it showed the message by default, this does nothing.
   */
  show(message: PushMessage, presentation: Required<PushPresentation>): Promise<void>;
  /** The message whose tap launched the process, once; `null` after that and when no tap did. Synchronous. */
  takeLaunchMessage(): PushMessage | null;
  /** Ends the wait of a `background` event: `id` is its completion id. Synchronous. */
  backgroundDone(id: string): void;
  addListener<Event extends keyof NativePushEvents>(event: Event, listener: (payload: NativePushEvents[Event]) => void): Subscription;
};

/**
 * What the client needs of `Linking` (React Native's, as `platform.ts` exports it, which is the object the router reads): the launch link, which this file wraps, the `url` event
 * it emits for a tap with the app running, and the same event's listener, for a link that arrives before there is a screen to open it (`#feedLinking`).
 */
export type PushLinking = {
  getInitialURL: () => Promise<string | null | undefined>;
  addEventListener(event: "url", listener: (event: { url: string }) => void): Subscription;
  emit(event: "url", payload: { url: string }): void;
};

/** Where the client keeps what the app reads: `push.svelte.ts` backs it with runes state, a test with a plain object. */
export type PushState = { permission: PushPermission; token: PushToken | null };

export type PushClientOptions = {
  /** The native module, or `null` in a build without it (`loadNativePush`). */
  native: NativePushModule | null;
  state: PushState;
  /** The app's `push` hooks as registered now (`appHooks().push`). */
  hooks: () => PushHooks | undefined;
  /** While the app's `init` is in flight, a promise that resolves when it has settled: the hooks wait for it (`initSettling`). */
  ready?: () => Promise<void> | undefined;
  /** `localStorage` (MMKV on the device), or `undefined` in a binary without it: then the last saved token is remembered for this launch only. */
  storage: () => Storage | undefined;
  /** Subscribes to the app returning to the foreground (`foreground.ts`). */
  onForeground: (listener: () => void) => void;
  linking: PushLinking;
};

/**
 * How long the `foreground` hook has to answer. The native side holds a message for a second; this is a little less, so that the answer (or the default) arrives before the native
 * side shows the message by itself.
 */
export const FOREGROUND_TIMEOUT_MS = 900;

/** The `localStorage` key of the token last saved successfully (`tokenKey`). */
export const SAVED_TOKEN_KEY = "svelte-native.push.saved-token";

/** The `localStorage` key of the permission the system last reported, so that `push.permission` starts there on the next launch and does not flash `prompt` at a user who has answered. */
export const PERMISSION_KEY = "svelte-native.push.permission";

/** The permission the system last reported to this app, read from the storage; `null` for an app that has never read it. */
export function storedPermission(storage: Storage | undefined): PushPermission | null {
  const value = storage?.getItem(PERMISSION_KEY);
  return value === "granted" || value === "denied" || value === "prompt" ? value : null;
}

/** Why `push` does nothing in a build: the native module is missing. */
export const MISSING_PUSH =
  "[Svelte push] push is not part of this app's build: install @alfayez/svelte-native-push (npx expo install @alfayez/svelte-native-push), turn on `capabilities: { push: { … } }` in the @alfayez/svelte-native plugin of the app config, and rebuild the native app. Until then `push.permission` reads \"denied\" and `push.subscribe` resolves with null";

/** The default presentation of a message in the foreground: shown as it is in the background. */
const SHOWN: Required<PushPresentation> = { banner: true, sound: true, badge: true };

/** A link to the app's own scheme or a web one: what `message.url` may be besides a path. */
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * The host of the links made from a path. The router's `openURL` reads the path of an `https:` link and ignores its host, and `.invalid` is reserved (RFC 2606) so that this can
 * never be a site that exists.
 */
const PATH_HOST = "app.invalid";

/**
 * The link the router opens for a notification's `url`. A full link (any scheme: `myapp://orders/42`, `https://example.com/orders/42`) is kept as it is. A path of the app
 * (`/orders/42?tab=1#top`) is not a link, and `openURL` refuses what `URL.parse` does not accept, so it becomes `https://app.invalid/orders/42?tab=1#top`: the router takes
 * `https:` links by their path, search and hash. Leading slashes are collapsed to one, so that `//orders/42` stays a path and is not read as a host.
 */
export function linkOf(url: string): string {
  return SCHEME.test(url) ? url : `https://${PATH_HOST}/${url.replace(/^\/+/, "")}`;
}

/** What identifies a token to `save`: every field of it, so a token that moved to another project or APNs environment is a new one. */
const tokenKey = (token: PushToken): string => JSON.stringify([token.provider, token.environment ?? null, token.app, token.token]);

/** Calls an app's listener; what it throws is reported as an uncaught error (as the web reports it) instead of keeping the others from hearing the message. */
function invoke<Value>(listener: (value: Value) => void, value: Value): void {
  try {
    listener(value);
  } catch (error) {
    setTimeout(() => { throw error; }, 0);
  }
}

const report = (what: string) => (error: unknown): void => { console.error(`[Svelte push] ${what}`, error); };

export class PushClient {
  readonly #options: PushClientOptions;
  readonly #listeners = new Set<{ listener: (message: PushMessage) => void }>();
  #started = false;
  /** The `save` of the last `subscribe`, which a rotation of the token calls; `null` before the first and after `unsubscribe`. */
  #save: ((token: PushToken) => unknown) | null = null;
  /** `tokenKey` of the token last saved successfully: `undefined` until read from the storage. */
  #saved: string | null | undefined;
  /** The save in flight, so that a second `subscribe` (or a rotation) of the same token does not send it twice. */
  #saving: { key: string; done: Promise<void> } | null = null;
  /** Counts `unsubscribe`s: a `subscribe` or a save that began before one must not register or remember anything after it. */
  #generation = 0;
  #asking: Promise<PushPermission> | null = null;
  #launch: Promise<string | null> | undefined;

  constructor(options: PushClientOptions) {
    this.#options = options;
  }

  /**
   * Listens to the native module and reads the permission, and wraps `Linking.getInitialURL`; in a build without the module it says so once, and the permission reads `denied`.
   * Called once, when the module is evaluated: at start in a build that has the native module (`load.ts`), or where the app imports `push`.
   */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const native = this.#options.native;
    if (native === null) {
      // Not stored: it is the build that is missing the module, not the user who answered.
      this.#options.state.permission = "denied";
      console.warn(MISSING_PUSH);
      return;
    }
    native.addListener("token", (token) => { this.#rotated(token); });
    native.addListener("message", (message) => { this.#foreground(native, message).catch(report("a message in the foreground could not be handled")); });
    native.addListener("opened", (message) => { this.#tapped(message).catch(report("a tapped notification could not be opened")); });
    native.addListener("background", ({ id, message }) => { this.#background(native, id, message).catch(report("a background message could not be handled")); });
    this.#options.onForeground(() => { this.#refresh(native).catch(report("the permission could not be read")); });
    this.#refresh(native).catch(report("the permission could not be read"));
    this.#feedLinking(native);
  }

  /**
   * Asks for the permission when it is `prompt`, registers with the provider and calls `save` unless the token is the one last saved. Resolves with the token, or `null` when the
   * permission is denied (or the build has no push). Rejects with `save`'s error, and then the token is not remembered as saved.
   */
  async subscribe(options: { save: (token: PushToken) => unknown }): Promise<PushToken | null> {
    const given: unknown = (options as { save?: unknown } | null | undefined)?.save;
    if (typeof given !== "function") throw new TypeError("push.subscribe takes `{ save }`: a function that stores the token on the app's server");
    const save = given as (token: PushToken) => unknown;
    const native = this.#options.native;
    if (native === null) return null;
    const generation = this.#generation;
    // `unsubscribe` may run while this waits (a sign-out while signing in): what it registers would belong to nobody.
    if (!(await this.#permitted(native)) || generation !== this.#generation) return null;
    this.#save = save;
    const token = await native.register();
    if (generation !== this.#generation) return null;
    this.#options.state.token = token;
    await this.#persist(token, save);
    return token;
  }

  /** Deletes the device's token with the provider and forgets the saved one, so that the next `subscribe` saves again. The app removes the token from its own server. */
  async unsubscribe(): Promise<void> {
    this.#generation++;
    this.#save = null;
    this.#saving = null;
    this.#saved = null;
    this.#options.storage()?.removeItem(SAVED_TOKEN_KEY);
    this.#options.state.token = null;
    await this.#options.native?.unregister();
  }

  /** Calls `listener` with each message that arrives while the app is in the foreground, once the `foreground` hook has decided how it shows. Returns what stops it. */
  on(event: "message", listener: (message: PushMessage) => void): () => void {
    if (event !== "message") throw new TypeError(`push.on: "${String(event)}" is not an event of push (the one it has is "message")`);
    if (typeof listener !== "function") throw new TypeError("push.on: the listener is not a function");
    const entry = { listener };
    this.#listeners.add(entry);
    return () => { this.#listeners.delete(entry); };
  }

  async #refresh(native: NativePushModule): Promise<void> {
    this.#report(await native.permission());
  }

  /** The system's state as the module reported it now: what `push.permission` reads, and what the next launch starts from. */
  #report(permission: PushPermission): void {
    this.#options.state.permission = permission;
    const storage = this.#options.storage();
    if (storage !== undefined && storage.getItem(PERMISSION_KEY) !== permission) storage.setItem(PERMISSION_KEY, permission);
  }

  /** Whether the app may show notifications, asking when the system still lets it ask. One question at a time, whatever the number of callers. */
  async #permitted(native: NativePushModule): Promise<boolean> {
    let permission = await native.permission();
    if (permission === "prompt") {
      // Assigned before it can settle: `finally` runs later, so a request that fails at once does not leave a settled question in place for good.
      this.#asking ??= native.requestPermission().finally(() => { this.#asking = null; });
      permission = await this.#asking;
    }
    this.#report(permission);
    return permission === "granted";
  }

  /** The token last saved successfully: remembered in `localStorage` across launches, read once. */
  #savedKey(): string | null {
    this.#saved ??= this.#options.storage()?.getItem(SAVED_TOKEN_KEY) ?? null;
    return this.#saved;
  }

  /** Calls `save` for `token` unless it is the one last saved, or one already in flight; remembers it when `save` resolves. */
  #persist(token: PushToken, save: (token: PushToken) => unknown): Promise<void> {
    const key = tokenKey(token);
    if (key === this.#savedKey()) return Promise.resolve();
    if (this.#saving?.key === key) return this.#saving.done;
    const generation = this.#generation;
    const run = async (): Promise<void> => {
      await save(token);
      // Not after an `unsubscribe`, and not for a token the provider has replaced meanwhile: the rotation saves its own.
      const current = this.#options.state.token;
      if (generation !== this.#generation || current === null || key !== tokenKey(current)) return;
      this.#saved = key;
      this.#options.storage()?.setItem(SAVED_TOKEN_KEY, key);
    };
    const done: Promise<void> = run().finally(() => { if (this.#saving?.done === done) this.#saving = null; });
    this.#saving = { key, done };
    return done;
  }

  /** The provider rotated the token while the app runs: the app's server gets the new one, if the app has subscribed. */
  #rotated(token: PushToken): void {
    const save = this.#save;
    if (save === null) return;
    this.#options.state.token = token;
    this.#persist(token, save).catch(report("saving the token the provider rotated failed; the next push.subscribe saves it again"));
  }

  /** Calls one of the app's hooks, after `init` has settled; reports what it throws and answers `undefined` for it. Never rejects. */
  async #run<Answer>(name: string, call: () => Answer | Promise<Answer>): Promise<Answer | undefined> {
    try {
      await this.#options.ready?.();
      return await call();
    } catch (error) {
      console.error(`[Svelte push] the ${name} hook failed`, error);
      return undefined;
    }
  }

  /** How the `foreground` hook says to show `message`: its answer within `FOREGROUND_TIMEOUT_MS`, else the default. */
  async #presentation(message: PushMessage): Promise<Required<PushPresentation>> {
    const hooks = this.#options.hooks();
    const foreground = hooks?.foreground;
    if (typeof foreground !== "function") return SHOWN;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), FOREGROUND_TIMEOUT_MS); });
    try {
      const answer = await Promise.race([this.#run("foreground", () => foreground.call(hooks, message)), late]);
      const given: PushPresentation = typeof answer === "object" && answer !== null ? answer : {};
      return { banner: given.banner ?? SHOWN.banner, sound: given.sound ?? SHOWN.sound, badge: given.badge ?? SHOWN.badge };
    } finally {
      clearTimeout(timer);
    }
  }

  /** A message in the foreground: the hook decides, the native side shows it as decided, and then the listeners of `on("message")` hear it. */
  async #foreground(native: NativePushModule, message: PushMessage): Promise<void> {
    const presentation = await this.#presentation(message);
    try {
      await native.show(message, presentation);
    } catch (error) {
      console.error("[Svelte push] the native side could not show the message", error);
    }
    for (const { listener } of [...this.#listeners]) invoke(listener, message);
  }

  /** A data message in the background: the hook runs, and the native side is released whether it returned, rejected, threw, or there is none. */
  async #background(native: NativePushModule, id: string, message: PushMessage): Promise<void> {
    const hooks = this.#options.hooks();
    const background = hooks?.background;
    try {
      if (typeof background === "function") await this.#run("background", () => background.call(hooks, message));
    } finally {
      native.backgroundDone(id);
    }
  }

  /**
   * What a tap opens: the `opened` hook runs, and unless it answers `false` the link of the message (none for a message without a `url`). Without a hook it still waits for
   * `init`, as the router that hears the link mounts after it.
   */
  async #opened(message: PushMessage): Promise<string | null> {
    const hooks = this.#options.hooks();
    const opened = hooks?.opened;
    const answer = await this.#run("opened", () => (typeof opened === "function" ? opened.call(hooks, message) : undefined));
    if (answer === false || typeof message.url !== "string" || message.url === "") return null;
    return linkOf(message.url);
  }

  /** A tap with the app running: the link reaches the `url` listeners, the router's among them. */
  async #tapped(message: PushMessage): Promise<void> {
    const link = await this.#opened(message);
    if (link !== null) this.#options.linking.emit("url", { url: link });
  }

  /** The link of the notification whose tap launched the process, taken once, at the first read of `getInitialURL`. */
  #launchLink(native: NativePushModule): Promise<string | null> {
    this.#launch ??= (async () => {
      let message: PushMessage | null;
      try {
        message = native.takeLaunchMessage();
      } catch (error) {
        console.error("[Svelte push] the notification that launched the app could not be read", error);
        return null;
      }
      return message === null ? null : this.#opened(message);
    })();
    return this.#launch;
  }

  /**
   * Makes `Linking.getInitialURL()` answer the platform's link, or else a link that arrived before the first read, or else the notification's. The `opened` hook runs for the
   * launching tap in every case, and the router's own wait for the launch link (`LAUNCH_URL_TIMEOUT_MS`) bounds a hook that is slow: its answer is opened late if the app has
   * not navigated meanwhile.
   *
   * A link that arrives before the first read has nobody to hear it: on iOS, a process the system started in the background for a message runs without a screen (PUSH.md,
   * rule 2), and when a link (a universal link, the app's scheme) is what brings it to the foreground, React Native emits it as a `url` event while the router is not mounted
   * yet, drops it for want of a listener, and `getInitialURL` answers the launch of the process, which had no link. So this file listens from the start, keeps the last such
   * link, and stops at the first read: the router adds its own listener just before it reads (`connectHost`), so from then on the router hears every link itself.
   */
  #feedLinking(native: NativePushModule): void {
    const linking = this.#options.linking;
    const platform = linking.getInitialURL.bind(linking);
    let early: string | null = null;
    let listening: Subscription | null = linking.addEventListener("url", ({ url }) => { early = url; });
    linking.getInitialURL = async () => {
      listening?.remove();
      listening = null;
      const arrived = early;
      const launch = this.#launchLink(native);
      const url = await platform();
      return url || arrived || (await launch);
    };
  }
}

/** The native module `SveltePush`, looked up the way the library finds its other optional ones (`geolocation.ts`): `null` in a build without `@alfayez/svelte-native-push`. */
export function loadNativePush(): NativePushModule | null {
  /* eslint-disable @typescript-eslint/no-require-imports -- required when push starts */
  const registry = require("expo-modules-core") as Partial<typeof import("expo-modules-core")>;
  /* eslint-enable @typescript-eslint/no-require-imports */
  return registry.requireOptionalNativeModule?.<NativePushModule>("SveltePush") ?? null;
}
