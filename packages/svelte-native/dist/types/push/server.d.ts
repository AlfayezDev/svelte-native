import type { PushToken } from "./types.js";
export type { PushToken } from "./types.js";
/** A service account key of Google Cloud: the fields of its JSON that the sender reads. The rest of the file's fields may be there. */
export type ServiceAccount = {
    project_id: string;
    client_email: string;
    /** The key, as the PEM of the file (`-----BEGIN PRIVATE KEY-----`). */
    private_key: string;
    /** Where the access token is requested. Default `https://oauth2.googleapis.com/token`, which is what the key's file names. */
    token_uri?: string;
    [field: string]: unknown;
};
export type FcmOptions = {
    /**
     * The service account key's JSON, as the file's text or the parsed object. The account needs the "Firebase Cloud Messaging API Admin" role. Left out (an unset
     * environment variable), FCM is not configured, and a send to an FCM token throws a `TypeError`.
     */
    serviceAccount?: string | ServiceAccount;
    /** The origin (and path) FCM's HTTP v1 API is reached at. For tests and proxies; default `https://fcm.googleapis.com`. */
    baseUrl?: string;
    /** Where the access token is requested. For tests and proxies; default the service account's `token_uri`. */
    tokenUrl?: string;
};
export type ApnsOptions = {
    /** The contents of the `.p8` file, a PEM private key. A key whose line breaks were written as `\n` in an environment variable is read as it was meant. */
    key?: string;
    /** The key's id (10 characters, in the Apple Developer account and in the `.p8`'s file name). */
    keyId?: string;
    /** The Apple Developer team's id. */
    teamId?: string;
    /** The host a token of a production build is sent to. For tests and proxies; default `https://api.push.apple.com`. An `http://` URL is spoken to in cleartext HTTP/2. */
    productionUrl?: string;
    /** The host a token whose `environment` is `development` is sent to. For tests and proxies; default `https://api.sandbox.push.apple.com`. */
    sandboxUrl?: string;
};
export type PushOptions = {
    /** Android: FCM. Left out, a send to an FCM token throws a `TypeError`. */
    fcm?: FcmOptions;
    /** iOS: APNs. Left out, a send to an APNs token throws a `TypeError`. */
    apns?: ApnsOptions;
    /** How long a send waits for a provider, in milliseconds, before it answers `unavailable`. Default 30000. */
    timeout?: number;
};
/** A message, as the sender takes it (PUSH.md maps each field to FCM's and APNs's). */
export type PushSend = {
    title?: string;
    body?: string;
    /** The link a tap opens: a path of the app (`/orders/42`) or a full link. Carried as the data key `url` (FCM) or the custom key `url` (APNs). */
    url?: string;
    /** Strings only, as both providers carry them. */
    data?: Record<string, string>;
    /** A data message: no notification is shown; the app's `background` hook gets it (see PUSH.md for the limits). It has no `title`, `body`, `badge`, `sound` or `channel`. */
    silent?: boolean;
    /** iOS. */
    badge?: number;
    /** Default `"default"` for a notification; `null` for none. */
    sound?: "default" | null;
    /** Android: the channel id (default: the config's channel). */
    channel?: string;
    /** A newer message with the same key replaces the older one. */
    collapseKey?: string;
    priority?: "high" | "normal";
    /** Seconds the provider keeps the message for a device that is offline. */
    ttl?: number;
};
export type SendResult = {
    ok: true;
    id: string;
} | {
    ok: false;
    /**
     * gone: the token will never work again (uninstalled, expired, unregistered): delete it.
     * invalid-token / invalid-message: a fault of the request; do not retry it as it is.
     * rate-limited / unavailable: try again later, after `retryAfter` when the provider gave one.
     * auth: the server's credentials are wrong or revoked.
     */
    reason: "gone" | "invalid-token" | "invalid-message" | "rate-limited" | "unavailable" | "auth" | "error";
    /** Milliseconds, from the provider's `Retry-After`. */
    retryAfter?: number;
    /** The provider's HTTP status, when it answered. */
    status?: number;
    /** The provider's own reason text (FCM's error message, APNs's `reason`), or what went wrong on the way to it. */
    detail: string;
};
export type Push = {
    /**
     * Sends one message to one device and resolves with what happened. It never queues or retries, each request to a provider waits at most `timeout`, and it never throws for a provider's
     * answer: only for a programming error (a `TypeError`: a token or a message that is not of the type, or a provider that was not configured). After `close`, it resolves with
     * `unavailable`.
     */
    send(token: PushToken, message: PushSend): Promise<SendResult>;
    /**
     * Waits for the sends in flight and closes the connections to APNs, which otherwise stay open (and keep a script from exiting) as Apple wants them to. Call it when the
     * server shuts down or the script is done.
     */
    close(): Promise<void>;
};
/**
 * The sender for the providers given. A provider that is given and wrong (a service account that is not JSON, a `.p8` that is not a P-256 key) throws a `TypeError` here;
 * one that is not given is not configured, and a send to its tokens throws.
 *
 * ```ts
 * const push = createPush({
 *   fcm: { serviceAccount: env.FCM_SERVICE_ACCOUNT },
 *   apns: { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID },
 * });
 * const result = await push.send(token, { title: "Order ready", body: "Pickup at gate 3", url: "/orders/42" });
 * if (!result.ok && result.reason === "gone") await deleteToken(token);
 * ```
 */
export declare function createPush(options?: PushOptions): Push;
