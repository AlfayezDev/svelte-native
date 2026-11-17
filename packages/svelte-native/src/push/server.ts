/**
 * The push sender of a server (Node): one message to one device, straight to Firebase Cloud Messaging (Android) or the Apple Push Notification service (iOS), with the app's
 * own credentials (PUSH.md, "Sending: the server"). It sends and says what happened. The queue, the retries, where the tokens are kept, fan-out and the providers' rate limits
 * are the app's own ("What the app owns").
 *
 * Node's own `crypto` and `http2` and the global `fetch`, no dependency. Nothing here runs on the device, and `package.json` points the entry at the built file in `dist/node/`,
 * which is what Node can load from a `node_modules`.
 */
import { inspect } from "node:util";
import { createApns, type ApnsSender } from "./apns.ts";
import { failure } from "./common.ts";
import { createFcm, type FcmSender } from "./fcm.ts";
import type { PushToken } from "./types.ts";

export type { PushToken } from "./types.ts";

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

export type SendResult =
  | { ok: true; id: string }
  | {
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
   * Sends one message to one device and resolves with what happened. It never queues, retries or waits for more than the `timeout`, and it never throws for a provider's
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

const DEFAULT_TIMEOUT = 30_000;

const show = (value: unknown): string => inspect(value, { depth: 0 });

function checkText(name: string, value: unknown): void {
  if (value !== undefined && typeof value !== "string") throw new TypeError(`${name} must be a string, not ${show(value)}.`);
}

function checkName(name: string, value: unknown): void {
  if (typeof value !== "string" || value === "") throw new TypeError(`${name} must be a non-empty string, not ${show(value)}.`);
}

/** The `{ provider, token, app }` that `push.subscribe` hands to `save`: anything else is a bug of the caller's (a row read wrong, a token of another shape). */
function checkToken(token: PushToken): void {
  if (typeof token !== "object" || token === null) throw new TypeError(`A push token is the { provider, token, app } the device saved, not ${show(token)}.`);
  if (token.provider !== "fcm" && token.provider !== "apns") throw new TypeError(`The token's \`provider\` must be "fcm" or "apns", not ${show(token.provider)}.`);
  checkName("The token's `token`", token.token);
  checkName("The token's `app`", token.app);
  if (token.environment !== undefined && token.environment !== "development" && token.environment !== "production") {
    throw new TypeError(`The token's \`environment\` must be "development" or "production", not ${show(token.environment)}.`);
  }
}

function checkMessage(message: PushSend): void {
  if (typeof message !== "object" || message === null) throw new TypeError(`A message is an object such as { title, body, url }, not ${show(message)}.`);
  checkText("`title`", message.title);
  checkText("`body`", message.body);
  checkText("`url`", message.url);
  if (message.collapseKey !== undefined) checkName("`collapseKey`", message.collapseKey);
  if (message.channel !== undefined) checkName("`channel`", message.channel);
  if (message.silent !== undefined && typeof message.silent !== "boolean") throw new TypeError(`\`silent\` must be a boolean, not ${show(message.silent)}.`);
  if (message.badge !== undefined && (!Number.isInteger(message.badge) || message.badge < 0)) throw new TypeError(`\`badge\` must be a whole number of 0 or more, not ${show(message.badge)}.`);
  if (message.sound !== undefined && message.sound !== null && message.sound !== "default") throw new TypeError(`\`sound\` must be "default" or null, not ${show(message.sound)}.`);
  if (message.priority !== undefined && message.priority !== "high" && message.priority !== "normal") throw new TypeError(`\`priority\` must be "high" or "normal", not ${show(message.priority)}.`);
  if (message.ttl !== undefined && (!Number.isInteger(message.ttl) || message.ttl < 0)) throw new TypeError(`\`ttl\` must be a whole number of seconds, 0 or more, not ${show(message.ttl)}.`);
  if (message.data !== undefined) {
    if (typeof message.data !== "object" || message.data === null || Array.isArray(message.data)) throw new TypeError(`\`data\` must be an object of strings, not ${show(message.data)}.`);
    for (const [key, value] of Object.entries(message.data)) {
      if (typeof value !== "string") throw new TypeError(`\`data.${key}\` must be a string (both providers carry strings only), not ${show(value)}.`);
    }
    if (message.url !== undefined && "url" in message.data) throw new TypeError("`url` is carried as the data key `url`: pass the link as `url`, not also in `data`.");
  }
  if (message.silent) {
    for (const name of ["title", "body", "badge", "sound", "channel"] as const) {
      if (message[name] !== undefined && message[name] !== null) throw new TypeError(`A \`silent\` message shows nothing, so it has no \`${name}\`.`);
    }
  } else if (!message.title && !message.body) {
    throw new TypeError("A notification needs a `title` or a `body`; a message for the app's background hook is `silent: true`.");
  }
}

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
export function createPush(options: PushOptions = {}): Push {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) throw new TypeError(`\`timeout\` must be a number of milliseconds above 0, not ${show(timeout)}.`);
  const fcm = createFcm(options.fcm, timeout);
  const apns = createApns(options.apns, timeout);
  let closed = false;
  /** The sends in flight, which `close` waits for. Each entry settles when its send does, whether it resolved or threw. */
  const pending = new Set<Promise<void>>();

  return {
    async send(token, message) {
      checkToken(token);
      checkMessage(message);
      const sender = token.provider === "fcm" ? fcm : apns;
      if (sender === undefined) {
        throw new TypeError(token.provider === "fcm" ? "A send to an FCM token needs `fcm: { serviceAccount }` in createPush's options." : "A send to an APNs token needs `apns: { key, keyId, teamId }` in createPush's options.");
      }
      if (closed) return failure("unavailable", "The sender was closed.");
      const work = deliver(sender, token, message);
      const settled = work.then(
        () => undefined,
        () => undefined,
      );
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return work;
    },
    async close() {
      closed = true;
      await Promise.all(pending);
      await apns?.close();
    },
  };
}

/**
 * One send through its provider's sender. A `TypeError` stays one (a message that cannot be mapped is the caller's bug); whatever else goes wrong in a sender that no
 * provider's answer explains is a result, `error`, which carries the message.
 */
async function deliver(sender: FcmSender | ApnsSender, token: PushToken, message: PushSend): Promise<SendResult> {
  try {
    return await sender.send(token, message);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return failure("error", error instanceof Error ? error.message : String(error));
  }
}
