import { type PushPermission } from "./client.js";
import type { PushMessage, PushToken } from "./types.js";
/**
 * Push notifications: `permission` is `"granted"`, `"denied"` or `"prompt"`, reactive, and read again when the app returns to the foreground; `token` is the device's
 * `PushToken` once `subscribe` has registered it. Nothing here reads `this`: `const { subscribe } = push` works.
 */
export declare const push: {
    readonly permission: PushPermission;
    readonly token: PushToken | null;
    /**
     * Asks for the permission when it is `"prompt"`, registers with FCM or APNs, and calls `save(token)` when the token is new, has changed since the last `save` that
     * resolved, or is rotated by the system while the app runs. Call it on every start where the user is signed in. Resolves with the token, or `null` when the
     * permission is denied; rejects with `save`'s error, and then the next call saves again.
     */
    subscribe: (options: {
        save: (token: PushToken) => unknown;
    }) => Promise<PushToken | null>;
    /** Deletes the device's token with the provider and forgets the saved one (sign-out). The app removes the token from its own server. */
    unsubscribe: () => Promise<void>;
    /** Calls `listener` with each message that arrives while the app is in the foreground, after the `foreground` hook has decided how it shows. Returns what stops it. */
    on: (event: "message", listener: (message: PushMessage) => void) => (() => void);
};
