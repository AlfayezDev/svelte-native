/**
 * `push`, the app's side of push notifications (PUSH.md): `permission` and `token` as runes state, `subscribe`, `unsubscribe` and `on("message")`. The logic is `PushClient`
 * (`client.ts`) over the native module `SveltePush`; this file gives it the app's hooks, `localStorage`, the foreground event and `Linking`, and backs what the app reads with state.
 *
 * The module starts the client when it loads: `load.ts` loads it as soon as the app's hooks file exports `push`, so a launch without a screen (a background message)
 * reaches the hooks, and an app that imports `push` starts it there. In a build without `@alfayez/svelte-native-push` it says so once, and `push.permission` reads `"denied"`.
 */
import { appHooks, initSettling } from "../app-hooks.ts";
import { onForeground } from "../foreground.ts";
import { Linking } from "../platform.ts";
import { loadNativePush, PushClient, type PushPermission } from "./client.ts";
import type { PushMessage, PushToken } from "./types.ts";

/** `prompt` until the system has answered: a granted permission reads so for the moment the first read takes, and a button that asks for it is harmless to press then. */
let permission = $state<PushPermission>("prompt");
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
  storage: () => (typeof localStorage === "undefined" ? undefined : localStorage),
  onForeground,
  linking: Linking,
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
