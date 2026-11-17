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
import type { PushHooks, PushPresentation } from "./hooks.js";
import type { PushMessage, PushToken } from "./types.js";
/** The state of the notification permission, as the system reports it: `prompt` while it can still be asked for (Android 13+ `POST_NOTIFICATIONS`, iOS's first request). */
export type PushPermission = "granted" | "denied" | "prompt";
type Subscription = {
    remove(): void;
};
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
    background: {
        id: string;
        message: PushMessage;
    };
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
    addEventListener(event: "url", listener: (event: {
        url: string;
    }) => void): Subscription;
    emit(event: "url", payload: {
        url: string;
    }): void;
};
/** Where the client keeps what the app reads: `push.svelte.ts` backs it with runes state, a test with a plain object. */
export type PushState = {
    permission: PushPermission;
    token: PushToken | null;
};
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
export declare const FOREGROUND_TIMEOUT_MS = 900;
/** The `localStorage` key of the token last saved successfully (`tokenKey`). */
export declare const SAVED_TOKEN_KEY = "svelte-native.push.saved-token";
/** The `localStorage` key of the permission the system last reported, so that `push.permission` starts there on the next launch and does not flash `prompt` at a user who has answered. */
export declare const PERMISSION_KEY = "svelte-native.push.permission";
/** The permission the system last reported to this app, read from the storage; `null` for an app that has never read it. */
export declare function storedPermission(storage: Storage | undefined): PushPermission | null;
/** Why `push` does nothing in a build: the native module is missing. */
export declare const MISSING_PUSH = "[Svelte push] push is not part of this app's build: install @alfayez/svelte-native-push from the same git tag as @alfayez/svelte-native (its README shows the command), turn on `capabilities: { push: { \u2026 } }` in the @alfayez/svelte-native plugin of the app config, and rebuild the native app. Until then `push.permission` reads \"denied\" and `push.subscribe` resolves with null";
/**
 * The link the router opens for a notification's `url`. A full link (any scheme: `myapp://orders/42`, `https://example.com/orders/42`) is kept as it is. A path of the app
 * (`/orders/42?tab=1#top`) is not a link, and `openURL` refuses what `URL.parse` does not accept, so it becomes `https://app.invalid/orders/42?tab=1#top`: the router takes
 * `https:` links by their path, search and hash. Leading slashes are collapsed to one, so that `//orders/42` stays a path and is not read as a host.
 */
export declare function linkOf(url: string): string;
export declare class PushClient {
    #private;
    constructor(options: PushClientOptions);
    /**
     * Listens to the native module and reads the permission, and wraps `Linking.getInitialURL`; in a build without the module it says so once, and the permission reads `denied`.
     * Called once, when the module is evaluated: at start in a build that has the native module (`load.ts`), or where the app imports `push`.
     */
    start(): void;
    /**
     * Asks for the permission when it is `prompt`, registers with the provider and calls `save` unless the token is the one last saved. Resolves with the token, or `null` when the
     * permission is denied (or the build has no push). Rejects with `save`'s error, and then the token is not remembered as saved.
     */
    subscribe(options: {
        save: (token: PushToken) => unknown;
    }): Promise<PushToken | null>;
    /** Deletes the device's token with the provider and forgets the saved one, so that the next `subscribe` saves again. The app removes the token from its own server. */
    unsubscribe(): Promise<void>;
    /** Calls `listener` with each message that arrives while the app is in the foreground, once the `foreground` hook has decided how it shows. Returns what stops it. */
    on(event: "message", listener: (message: PushMessage) => void): () => void;
}
/** The native module `SveltePush`, looked up the way the library finds its other optional ones (`geolocation.ts`): `null` in a build without `@alfayez/svelte-native-push`. */
export declare function loadNativePush(): NativePushModule | null;
export {};
