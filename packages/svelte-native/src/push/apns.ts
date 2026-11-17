/**
 * The sender of APNs (iOS): HTTP/2 to `api.push.apple.com` (or `api.sandbox.push.apple.com` for a token of a development build), authenticated with a provider token that the
 * `.p8` key signs. Apple wants one connection kept open and reused (it treats a connection per notification as an attack), so each endpoint has one session, which is
 * made when a send needs it and again after Apple, the network or `close` ended it.
 */
import type { KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http2";
import { describeNetworkError, failure, httpUrl, isRecord, parseJson, retryAfterOf, type Failure } from "./common.ts";
import { privateKeyOf, signJwt } from "./jwt.ts";
import type { ApnsOptions, PushSend, SendResult } from "./server.ts";
import type { PushToken } from "./types.ts";

const PRODUCTION_URL = "https://api.push.apple.com";
const SANDBOX_URL = "https://api.sandbox.push.apple.com";
/** Apple refuses a provider token older than an hour, so it is replaced before 50 minutes... */
const RENEW_AFTER = 50 * 60_000;
/** ...and refuses a sender that replaces it more often than every 20 minutes (`TooManyProviderTokenUpdates`). */
const RENEW_NOT_BEFORE = 20 * 60_000;

type Config = { key: KeyObject; keyId: string; teamId: string; productionUrl: string; sandboxUrl: string; timeout: number };

/**
 * The sender of APNs for `options`, or `undefined` when no key is given (see `createFcm` for why a missing credential is not an error here). A key given without its key id or
 * team id, or a key that is not the `.p8`'s P-256 key, throws.
 */
export function createApns(options: ApnsOptions | undefined, timeout: number): ApnsSender | undefined {
  const names = ["key", "keyId", "teamId"] as const;
  if (options === undefined || names.every((name) => options[name] === undefined || options[name] === "")) return undefined;
  for (const name of names) {
    if (typeof options[name] !== "string" || options[name] === "") throw new TypeError(`\`apns.${name}\` is needed beside the other two: the \`.p8\`'s contents, its key id and the team id.`);
  }
  return new ApnsSender({
    key: privateKeyOf(String(options.key), "ES256", "`apns.key`"),
    keyId: String(options.keyId),
    teamId: String(options.teamId),
    productionUrl: httpUrl(options.productionUrl ?? PRODUCTION_URL, "`apns.productionUrl`"),
    sandboxUrl: httpUrl(options.sandboxUrl ?? SANDBOX_URL, "`apns.sandboxUrl`"),
    timeout,
  });
}

/** A header value Node writes as it is: printable ASCII. The topic and the collapse id are the caller's, so a character outside it is refused here instead of throwing from the session. */
const headerText = (value: string, name: string): string => {
  if (!/^[\x21-\x7e]+$/.test(value)) throw new TypeError(`${name} must be printable ASCII without spaces to be sent as an APNs header, not ${JSON.stringify(value)}.`);
  return value;
};

/** The headers and the body of the request for a message (PUSH.md, "How a message maps"). */
export function apnsRequest(token: PushToken, message: PushSend): { headers: OutgoingHttpHeaders; body: string } {
  const silent = message.silent === true;
  const headers: OutgoingHttpHeaders = {
    ":method": "POST",
    // A token that is not hex is APNs's to refuse (`BadDeviceToken`); encoded, it cannot add to the path.
    ":path": `/3/device/${encodeURIComponent(token.token)}`,
    "apns-topic": headerText(token.app, "The token's `app`"),
    "apns-push-type": silent ? "background" : "alert",
  };
  // A background push must have priority 5 (Apple answers 10 with `BadPriority`), whatever the message asks for.
  const priority = silent ? "5" : message.priority === undefined ? undefined : message.priority === "high" ? "10" : "5";
  if (priority !== undefined) headers["apns-priority"] = priority;
  // `apns-expiration` is a date, not a lifetime; 0 is "deliver once, do not store".
  if (message.ttl !== undefined) headers["apns-expiration"] = String(message.ttl === 0 ? 0 : Math.floor(Date.now() / 1000) + message.ttl);
  if (message.collapseKey !== undefined) headers["apns-collapse-id"] = headerText(message.collapseKey, "`collapseKey`");

  if (message.data !== undefined && "aps" in message.data) throw new TypeError("`data.aps` is APNs's own key and cannot carry data: name the key something else.");
  const aps: Record<string, unknown> = {};
  if (silent) {
    aps["content-available"] = 1;
  } else {
    aps.alert = { ...(message.title !== undefined ? { title: message.title } : {}), ...(message.body !== undefined ? { body: message.body } : {}) };
    if (message.badge !== undefined) aps.badge = message.badge;
    if (message.sound !== null) aps.sound = "default";
  }
  return { headers, body: JSON.stringify({ ...message.data, ...(message.url !== undefined ? { url: message.url } : {}), aps }) };
}

/**
 * What APNs's answer to a refused send means (the status table of "Handling notification responses from APNs"). A token APNs does not know is a fault of the token whatever
 * the status; every 403 is a credential, the provider token or the key's right to the topic.
 */
export function apnsFailure(status: number, reason: string | undefined, retryAfter: number | undefined): Failure {
  const detail = reason ?? `HTTP ${status}`;
  if (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") return failure("invalid-token", detail, status);
  if (status === 410) return failure("gone", detail, status);
  if (status === 401 || status === 403) return failure("auth", detail, status);
  if (status === 429) return failure("rate-limited", detail, status, retryAfter);
  if (status >= 500) return failure("unavailable", detail, status, retryAfter);
  if (status === 400 || status === 413) return failure("invalid-message", detail, status);
  return failure("error", detail, status);
}

type Answer = { ok: true; status: number; headers: IncomingHttpHeaders; body: string } | Failure;

/** One APNs host: the session its requests go through. */
class Endpoint {
  readonly #origin: string;
  readonly #timeout: number;
  /** The session new requests use: one that is open, or none. */
  #current: ClientHttp2Session | undefined;
  /** Every session that has not closed, including one that got a GOAWAY and is finishing its requests: `close` waits for them all. */
  readonly #sessions = new Set<ClientHttp2Session>();

  constructor(origin: string, timeout: number) {
    this.#origin = origin;
    this.#timeout = timeout;
  }

  /** Sends one request and resolves with the answer, or with why there is none. It never rejects. */
  request(headers: OutgoingHttpHeaders, body: string): Promise<Answer> {
    return new Promise((resolve) => {
      let session: ClientHttp2Session | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (answer: Answer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(answer);
      };
      try {
        session = this.#session();
        const stream = session.request(headers);
        const current = session;
        let responseHeaders: IncomingHttpHeaders | undefined;
        let text = "";
        stream.setEncoding("utf8");
        stream.on("response", (received) => {
          responseHeaders = received;
        });
        stream.on("data", (chunk: string) => {
          text += chunk;
        });
        // A stream can end without a response when its session died under it (Node reports that as an error or a reset, other runtimes as a plain end).
        stream.on("end", () =>
          finish(responseHeaders === undefined ? failure("unavailable", "The stream to APNs ended before APNs answered.") : { ok: true, status: Number(responseHeaders[":status"]), headers: responseHeaders, body: text }),
        );
        stream.on("error", (error) => finish(failure("unavailable", describeNetworkError(error))));
        // A stream that closes without having ended was reset, or its session went away under it.
        stream.on("close", () => finish(failure("unavailable", `The stream to APNs closed (code ${stream.rstCode}) before APNs answered.`)));
        // A connection that answers nothing is dropped, so that the next send makes a new one instead of waiting on a dead one too.
        timer = setTimeout(() => {
          finish(failure("unavailable", `APNs did not answer within ${this.#timeout} ms.`));
          this.#drop(current);
          current.destroy();
        }, this.#timeout);
        stream.end(body);
      } catch (error) {
        // `session.request` throws when the session was closed or sent a GOAWAY since it was chosen.
        if (session !== undefined) this.#drop(session);
        finish(failure("unavailable", describeNetworkError(error)));
      }
    });
  }

  /** Ends the connection once the requests in flight are answered. */
  async close(): Promise<void> {
    const sessions = [...this.#sessions];
    this.#current = undefined;
    await Promise.all(
      sessions.map(
        (session) =>
          new Promise<void>((resolve) => {
            if (session.destroyed) return resolve();
            session.once("close", resolve);
            session.close();
          }),
      ),
    );
  }

  #session(): ClientHttp2Session {
    if (this.#current !== undefined && !this.#current.closed && !this.#current.destroyed) return this.#current;
    const session = connect(this.#origin);
    this.#sessions.add(session);
    this.#current = session;
    // A failed session reports to each request on it, which answers `unavailable`; with none in flight the error has no one to tell, and the next send makes a new session.
    session.on("error", () => this.#drop(session));
    session.on("goaway", () => {
      this.#drop(session);
      if (!session.closed && !session.destroyed) session.close();
    });
    session.on("close", () => {
      this.#drop(session);
      this.#sessions.delete(session);
    });
    return session;
  }

  /** Stops new requests from using `session`. */
  #drop(session: ClientHttp2Session): void {
    if (this.#current === session) this.#current = undefined;
  }
}

export class ApnsSender {
  readonly #config: Config;
  readonly #endpoints = new Map<string, Endpoint>();
  #token: { jwt: string; issuedAt: number } | undefined;

  constructor(config: Config) {
    this.#config = config;
  }

  async send(token: PushToken, message: PushSend): Promise<SendResult> {
    const { headers, body } = apnsRequest(token, message);
    const endpoint = this.#endpoint(token.environment === "development" ? this.#config.sandboxUrl : this.#config.productionUrl);
    let jwt = this.#providerToken();
    for (let attempt = 0; ; attempt++) {
      const answer = await endpoint.request({ ...headers, authorization: `bearer ${jwt}` }, body);
      if (!answer.ok) return answer;
      const parsed = parseJson(answer.body);
      const reason = isRecord(parsed) && typeof parsed.reason === "string" ? parsed.reason : undefined;
      if (answer.status === 200) {
        const id = answer.headers["apns-id"];
        return typeof id === "string" && id !== "" ? { ok: true, id } : failure("error", "APNs answered without an apns-id.", answer.status);
      }
      // The one retry a send makes: an expired provider token is this sender's own, so it is replaced and the same request goes again, once. (Every other answer is the
      // provider's to give, and the caller decides what to do about it.) If the token cannot be replaced yet, the refusal is the answer.
      if (reason === "ExpiredProviderToken" && attempt === 0) {
        const renewed = this.#renew(jwt);
        if (renewed !== jwt) {
          jwt = renewed;
          continue;
        }
      }
      return apnsFailure(answer.status, reason, retryAfterOf(answer.headers["retry-after"]));
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.#endpoints.values()].map((endpoint) => endpoint.close()));
  }

  #endpoint(origin: string): Endpoint {
    let endpoint = this.#endpoints.get(origin);
    if (endpoint === undefined) {
      endpoint = new Endpoint(origin, this.#config.timeout);
      this.#endpoints.set(origin, endpoint);
    }
    return endpoint;
  }

  /** The provider token: the one signed less than 50 minutes ago, else a new one. The same token serves the production and the sandbox host. */
  #providerToken(): string {
    const now = Date.now();
    if (this.#token === undefined || now - this.#token.issuedAt >= RENEW_AFTER) this.#token = this.#sign(now);
    return this.#token.jwt;
  }

  /**
   * Replaces `used`, the token a request was refused with, unless it is not the current one (another send already replaced it) or the current one is younger than the 20
   * minutes Apple allows between tokens. Returns the token to send with now, which is `used` when nothing was replaced.
   */
  #renew(used: string): string {
    const now = Date.now();
    if (this.#token !== undefined && this.#token.jwt === used && now - this.#token.issuedAt >= RENEW_NOT_BEFORE) this.#token = this.#sign(now);
    return this.#token?.jwt ?? used;
  }

  #sign(now: number): { jwt: string; issuedAt: number } {
    const { key, keyId, teamId } = this.#config;
    return { jwt: signJwt("ES256", { kid: keyId }, { iss: teamId, iat: Math.floor(now / 1000) }, key), issuedAt: now };
  }
}
