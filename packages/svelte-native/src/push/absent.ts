/**
 * `push` in an app that does not have `@alfayez/svelte-native-push`. The library's Metro config resolves `push.svelte.ts` to this file then (`metro.ts`), so the client and its
 * hooks are not in the bundle of an app without push. It answers as the client does in a build without the native module (PUSH.md): `permission` reads `"denied"`,
 * `subscribe` resolves with `null`, and one warning says what to install. It warns when it loads, as the client does: when the app imports `push`, or when its hooks file
 * exports `push` (`load.ts`).
 */
import type { PushPermission } from "./client.ts";
import { MISSING_PUSH } from "./missing.ts";
import type { PushMessage, PushToken } from "./types.ts";

console.warn(MISSING_PUSH);

export const push = {
  get permission(): PushPermission { return "denied"; },
  get token(): PushToken | null { return null; },
  subscribe: async (options: { save: (token: PushToken) => unknown }): Promise<PushToken | null> => {
    if (typeof (options as { save?: unknown } | null | undefined)?.save !== "function") throw new TypeError("push.subscribe takes `{ save }`: a function that stores the token on the app's server");
    return null;
  },
  unsubscribe: async (): Promise<void> => {},
  on: (event: "message", listener: (message: PushMessage) => void): (() => void) => {
    if (event !== "message") throw new TypeError(`push.on: "${String(event)}" is not an event of push (the one it has is "message")`);
    if (typeof listener !== "function") throw new TypeError("push.on: the listener is not a function");
    return () => {};
  },
};
