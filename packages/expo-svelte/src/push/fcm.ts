/**
 * The sender of FCM (Android): HTTP v1 (`POST /v1/projects/<project>/messages:send`) with an OAuth access token that the service account's key signs for. Plain `fetch`: FCM
 * needs no HTTP/2 from a client, and nothing here holds a connection open.
 */
import type { KeyObject } from "node:crypto";
import { describeNetworkError, failure, hostOf, httpUrl, isRecord, parseJson, retryAfterOf, type Failure } from "./common.ts";
import { privateKeyOf, signJwt } from "./jwt.ts";
import type { FcmOptions, PushSend, SendResult } from "./server.ts";
import type { PushToken } from "./types.ts";

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_URL = "https://fcm.googleapis.com";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** The longest an assertion may live (Google's limit), and so the `exp` it is signed with. */
const ASSERTION_SECONDS = 3600;
/** How long before an access token expires it is replaced, so that no send starts with a token that expires on the way. */
const EXPIRY_MARGIN = 5 * 60_000;

type Config = { projectId: string; clientEmail: string; key: KeyObject; tokenUrl: string; sendUrl: string; timeout: number };

/** A service account key's JSON, read from the string or the object an option holds: the four fields the sender uses. */
function readAccount(value: NonNullable<FcmOptions["serviceAccount"]>): { projectId: string; clientEmail: string; privateKey: string; tokenUri?: string } {
  let account: unknown = value;
  if (typeof value === "string") {
    try {
      account = JSON.parse(value);
    } catch {
      // The parser's message quotes the start of the text, which is the secret.
      throw new TypeError("`fcm.serviceAccount` is a string but not JSON: pass the service account key's file as it is, or the parsed object.");
    }
  }
  if (!isRecord(account)) throw new TypeError("`fcm.serviceAccount` must be the service account key's JSON, a string or an object.");
  for (const name of ["project_id", "client_email", "private_key"]) {
    if (typeof account[name] !== "string" || account[name] === "") throw new TypeError(`\`fcm.serviceAccount\` has no \`${name}\`: it is not a service account key.`);
  }
  if (account.token_uri !== undefined && typeof account.token_uri !== "string") throw new TypeError("`fcm.serviceAccount.token_uri` must be a string.");
  return { projectId: String(account.project_id), clientEmail: String(account.client_email), privateKey: String(account.private_key), tokenUri: account.token_uri };
}

/**
 * The sender of FCM for `options`, or `undefined` when no service account is given: an unset environment variable is a provider that is not configured (and the first
 * send to it says so), not an error at the import of the module that makes the sender, which a build that analyses the server code without the secrets would fail on. A
 * service account that is given and wrong throws here.
 */
export function createFcm(options: FcmOptions | undefined, timeout: number): FcmSender | undefined {
  if (options === undefined || options.serviceAccount === undefined || options.serviceAccount === "") return undefined;
  const account = readAccount(options.serviceAccount);
  const base = httpUrl(options.baseUrl ?? FCM_URL, "`fcm.baseUrl`");
  return new FcmSender({
    projectId: account.projectId,
    clientEmail: account.clientEmail,
    key: privateKeyOf(account.privateKey, "RS256", "`fcm.serviceAccount.private_key`"),
    tokenUrl: httpUrl(options.tokenUrl ?? account.tokenUri ?? TOKEN_URL, "`fcm.tokenUrl`"),
    sendUrl: `${base}/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
    timeout,
  });
}

/** What the sender sends for a message: FCM's v1 `Message` (PUSH.md, "How a message maps"). */
function fcmBody(token: PushToken, message: PushSend): { message: Record<string, unknown> } {
  const data: Record<string, string> = { ...message.data };
  if (message.url !== undefined) data.url = message.url;
  const android: Record<string, unknown> = {};
  if (message.collapseKey !== undefined) android.collapse_key = message.collapseKey;
  if (message.priority !== undefined) android.priority = message.priority === "high" ? "HIGH" : "NORMAL";
  if (message.ttl !== undefined) android.ttl = `${message.ttl}s`;
  // A silent message has no `notification`: that is what makes FCM hand it to the app's service instead of showing it.
  if (!message.silent) {
    const notification: Record<string, string> = {};
    if (message.title !== undefined) notification.title = message.title;
    if (message.body !== undefined) notification.body = message.body;
    // `sound: null` sends none, and the channel's own sound plays (from Android 8 the channel decides, and `"default"` is what the notification asks of it).
    if (message.sound !== null) notification.sound = "default";
    if (message.channel !== undefined) notification.channel_id = message.channel;
    android.notification = notification;
  }
  return { message: { token: token.token, ...(Object.keys(data).length > 0 ? { data } : {}), ...(Object.keys(android).length > 0 ? { android } : {}) } };
}

/** The fields of an FCM error that decide what a failure is: its `FcmError` code (or the canonical status), its message and whether it is about the registration token. */
function readError(body: unknown): { code?: string; message?: string; aboutToken: boolean } {
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
  if (error === undefined) return { aboutToken: false };
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  const fcm = details.find((detail) => typeof detail.errorCode === "string")?.errorCode;
  const message = typeof error.message === "string" ? error.message : undefined;
  // An INVALID_ARGUMENT names its field in a `BadRequest` detail, and its message says "The registration token is not a valid FCM registration token".
  const violations = details.flatMap((detail) => (Array.isArray(detail.fieldViolations) ? detail.fieldViolations.filter(isRecord) : []));
  const aboutToken = violations.some((violation) => violation.field === "message.token") || /registration token/i.test(message ?? "");
  return { code: typeof fcm === "string" ? fcm : typeof error.status === "string" ? error.status : undefined, message, aboutToken };
}

/**
 * What FCM's answer to a refused send means (the error table of the HTTP v1 reference). The FCM-specific code decides when there is one, and the HTTP status when there is not
 * (an error page of a proxy, a `NOT_FOUND` of the canonical codes). `gone` and `invalid-token` tell the app to delete a token, so only the body's own word for it decides
 * them: a bare 404 is a wrong project id or endpoint, which would otherwise make a misconfigured server delete every token it has.
 */
function fcmFailure(status: number, body: unknown, text: string, retryAfter: number | undefined): Failure {
  const { code, message, aboutToken } = readError(body);
  const detail = message ?? code ?? (text.trim() === "" ? `HTTP ${status}` : text.trim().slice(0, 300));
  switch (code) {
    case "UNREGISTERED":
      return failure("gone", detail, status);
    case "SENDER_ID_MISMATCH":
      // Every token answers it when the server holds another Firebase project's credentials: the server's fault, not the token's, and a reason that deletes tokens would
      // delete them all (and a device does not save an unchanged token again).
      return failure("auth", `${detail}: the token belongs to another Firebase project than the service account's; check the server's credentials before suspecting the token`, status);
    case "INVALID_ARGUMENT":
      return failure(aboutToken ? "invalid-token" : "invalid-message", detail, status);
    case "QUOTA_EXCEEDED":
    case "RESOURCE_EXHAUSTED":
      return failure("rate-limited", detail, status, retryAfter);
    case "UNAVAILABLE":
    case "INTERNAL":
      return failure("unavailable", detail, status, retryAfter);
    case "UNAUTHENTICATED":
    case "THIRD_PARTY_AUTH_ERROR":
    case "PERMISSION_DENIED":
      return failure("auth", detail, status);
  }
  if (status === 404) return failure("error", `FCM answered 404 (${detail}): the endpoint or the project was not found; check the service account's \`project_id\` and \`fcm.baseUrl\`.`, status);
  if (status === 429) return failure("rate-limited", detail, status, retryAfter);
  if (status >= 500) return failure("unavailable", detail, status, retryAfter);
  if (status === 401 || status === 403) return failure("auth", detail, status);
  if (status === 400) return failure(aboutToken ? "invalid-token" : "invalid-message", detail, status);
  return failure("error", detail, status);
}

export class FcmSender {
  readonly #config: Config;
  #access: { token: string; usableUntil: number; lifetime: number } | undefined;
  /** The token request in flight: sends that need a token while one is on its way wait for it, and one request serves them all. */
  #pending: Promise<string | Failure> | undefined;

  constructor(config: Config) {
    this.#config = config;
  }

  async send(token: PushToken, message: PushSend): Promise<SendResult> {
    const access = await this.#accessToken();
    if (typeof access !== "string") return access;
    let response: Response;
    let text: string;
    try {
      response = await fetch(this.#config.sendUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(fcmBody(token, message)),
        signal: AbortSignal.timeout(this.#config.timeout),
      });
      text = await response.text();
    } catch (error) {
      return failure("unavailable", describeNetworkError(error));
    }
    const body = parseJson(text);
    if (response.ok) {
      // `name` is `projects/<project>/messages/<id>`, and the id is the `message_id` the device reads.
      const name = isRecord(body) && typeof body.name === "string" ? body.name : "";
      const id = name.slice(name.lastIndexOf("/") + 1);
      return id === "" ? failure("error", "FCM answered without a message name.", response.status) : { ok: true, id };
    }
    // Google refused the access token: it is not used again (a revoked one would otherwise fail every send until it expired).
    if (response.status === 401 && this.#access?.token === access) this.#access = undefined;
    return fcmFailure(response.status, body, text, retryAfterOf(response.headers.get("retry-after")));
  }

  /**
   * Asks the token endpoint for an access token without sending anything: what `expo-svelte doctor --server` checks the service account's key with. It resolves with the
   * lifetime (seconds) of the token the endpoint gave, or with why there is none (`auth` for a key Google refuses: `invalid_grant`, with its description as the detail). The token
   * is kept for the next send, and never returned.
   */
  async verify(): Promise<{ ok: true; expiresIn: number } | Failure> {
    const access = await this.#accessToken();
    return typeof access === "string" ? { ok: true, expiresIn: this.#access?.lifetime ?? 0 } : access;
  }

  /** The access token: the cached one while it has more than the margin left, else a new one that every send waiting for it shares. */
  #accessToken(): Promise<string | Failure> {
    if (this.#access !== undefined && this.#access.usableUntil > Date.now()) return Promise.resolve(this.#access.token);
    this.#pending ??= this.#exchange().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  /** Signs an assertion with the service account's key and exchanges it at the token endpoint (RFC 7523): the access token, or why there is none. */
  async #exchange(): Promise<string | Failure> {
    const { clientEmail, key, tokenUrl, timeout } = this.#config;
    const issuedAt = Math.floor(Date.now() / 1000);
    const assertion = signJwt("RS256", { typ: "JWT" }, { iss: clientEmail, scope: SCOPE, aud: tokenUrl, iat: issuedAt, exp: issuedAt + ASSERTION_SECONDS }, key);
    let response: Response;
    let text: string;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        signal: AbortSignal.timeout(timeout),
      });
      text = await response.text();
    } catch (error) {
      return failure("unavailable", `The token request to ${hostOf(tokenUrl)} failed: ${describeNetworkError(error)}`);
    }
    const body = parseJson(text);
    if (!response.ok) {
      const reason = isRecord(body) ? (typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : undefined) : undefined;
      const detail = reason ?? `The token endpoint answered ${response.status}.`;
      // A 4xx of the token endpoint is the service account's key being refused (`invalid_grant`: revoked, deleted, a clock that is off), which is the credentials' fault.
      if (response.status === 429) return failure("rate-limited", detail, response.status, retryAfterOf(response.headers.get("retry-after")));
      if (response.status >= 500) return failure("unavailable", detail, response.status, retryAfterOf(response.headers.get("retry-after")));
      return failure(response.status >= 400 && response.status < 500 ? "auth" : "error", detail, response.status);
    }
    if (!isRecord(body) || typeof body.access_token !== "string" || body.access_token === "") return failure("error", "The token endpoint answered without an access token.", response.status);
    const lifetime = typeof body.expires_in === "number" ? body.expires_in : ASSERTION_SECONDS;
    this.#access = { token: body.access_token, usableUntil: Date.now() + lifetime * 1000 - EXPIRY_MARGIN, lifetime };
    return body.access_token;
  }
}
