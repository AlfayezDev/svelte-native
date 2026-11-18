/**
 * `push`, the app's side of push notifications (PUSH.md): `permission` and `token` as runes state, `subscribe`, `unsubscribe` and `on("message")`. The logic is `PushClient`
 * (`client.ts`) over the native module `SveltePush`; this file gives it the app's hooks, `localStorage`, the foreground event and `Linking`, and backs what the app reads with state.
 *
 * The module starts the client when it loads: `load.ts` loads it at start in a build that has the native module, or when the app's hooks file exports `push`, so a tapped
 * notification opens its link and a launch without a screen (a background message) reaches the hooks whatever the app imports; an app that imports `push` starts it there. In a build
 * without push (the module's `enabled` is false) it says so once, and `push.permission` reads `"denied"`.
 */
import { untrack } from "svelte";
import { appHooks, initSettling } from "../app-hooks.ts";
import { onForeground } from "../foreground.ts";
import { Linking } from "../platform.ts";
import { rootRouter } from "../router.svelte.ts";
import { loadNativePush, PushClient, storedPermission, type PushPermission } from "./client.ts";
import type { PushMessage, PushToken } from "./types.ts";

/** `localStorage` (MMKV), or `undefined` in a binary without it. */
const storage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

/**
 * What the system last reported, read from the storage when the module loads and written whenever the native module reports it, so that a user who has granted or denied
 * the permission never sees `prompt` while the first read takes; an app that has never read it starts at `prompt`, and a button that asks for it is harmless to press then.
 */
let permission = $state<PushPermission>(storedPermission(storage()) ?? "prompt");
/** Raw: a token is a value that is replaced, never changed in place, and the app compares it by what it holds. */
let token = $state.raw<PushToken | null>(null);

const client = new PushClient({
  native: loadNativePush(),
  state: {
    get permission() { return permission; },
    set permission(value) { permission = value; },
    get token() { return token; },
    set token(value) { token = value; },
  },
  hooks: () => appHooks().push,
  ready: initSettling,
  storage,
  onForeground,
  linking: Linking,
  // Each router reads the launch link once (`connectHost`), and an Activity that is made again while the runtime lives starts a surface with a router of its own. Read from the
  // router's mount effect, so not tracked: a new root router must not make that effect run again.
  launchScope: () => untrack(rootRouter),
});
client.start();

/**
 * Push notifications: `permission` is `"granted"`, `"denied"` or `"prompt"`, reactive, and read again when the app returns to the foreground; `token` is the device's
 * `PushToken` once `subscribe` has registered it. Nothing here reads `this`: `const { subscribe } = push` works.
 */
export const push = {
  get permission(): PushPermission { return permission; },
  get token(): PushToken | null { return token; },
  /**
   * Asks for the permission when it is `"prompt"`, registers with FCM or APNs, and calls `save(token)` when the token is new, has changed since the last `save` that
   * resolved, or is rotated by the system while the app runs. Call it on every start where the user is signed in. Resolves with the token, or `null` when the
   * permission is denied; rejects with `save`'s error, and then the next call saves again.
   */
  subscribe: (options: { save: (token: PushToken) => unknown }): Promise<PushToken | null> => client.subscribe(options),
  /** Deletes the device's token with the provider and forgets the saved one (sign-out). The app removes the token from its own server. */
  unsubscribe: (): Promise<void> => client.unsubscribe(),
  /** Calls `listener` with each message that arrives while the app is in the foreground, after the `foreground` hook has decided how it shows. Returns what stops it. */
  on: (event: "message", listener: (message: PushMessage) => void): (() => void) => client.on(event, listener),
};
