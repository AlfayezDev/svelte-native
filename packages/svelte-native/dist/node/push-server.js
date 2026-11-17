// src/push/server.ts
import { inspect } from "node:util";

// src/push/apns.ts
import { connect } from "node:http2";

// src/push/common.ts
function failure(reason, detail, status, retryAfter) {
  return { ok: false, reason, ...status !== void 0 ? { status } : {}, ...retryAfter !== void 0 ? { retryAfter } : {}, detail };
}
function retryAfterOf(value) {
  const header = (Array.isArray(value) ? value[0] : value)?.trim();
  if (header === void 0 || header === "") return void 0;
  if (/^\d+$/.test(header)) return Number(header) * 1e3;
  const date = Date.parse(header);
  return Number.isNaN(date) ? void 0 : Math.max(0, date - Date.now());
}
function describeNetworkError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message : void 0;
  return cause === void 0 || cause === error.message ? error.message : `${error.message} (${cause})`;
}
function parseJson(text) {
  if (text === "") return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function httpUrl(value, name) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new TypeError(`${name} must be an http or https URL, not ${JSON.stringify(value)}.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`${name} must be an http or https URL, not ${JSON.stringify(value)}.`);
  return url.href.replace(/\/+$/, "");
}

// src/push/jwt.ts
import { createPrivateKey, sign } from "node:crypto";
var KEYS = {
  RS256: { type: "rsa" },
  ES256: { type: "ec", curve: "prime256v1" }
};
var pemOf = (value) => (value.includes("\n") ? value : value.replaceAll("\\n", "\n")).trim();
function privateKeyOf(pem, algorithm, name) {
  let key;
  try {
    key = createPrivateKey(pemOf(pem));
  } catch (error) {
    throw new TypeError(`${name} is not a PEM private key (${error instanceof Error ? error.message : String(error)}).`, { cause: error });
  }
  const wanted = KEYS[algorithm];
  if (key.asymmetricKeyType !== wanted.type || wanted.curve !== void 0 && key.asymmetricKeyDetails?.namedCurve !== wanted.curve) {
    throw new TypeError(`${name} must be ${wanted.curve === void 0 ? "an RSA" : "a P-256 (prime256v1) elliptic-curve"} private key for ${algorithm}, not ${key.asymmetricKeyType ?? "another kind of key"}${key.asymmetricKeyDetails?.namedCurve ? ` on ${key.asymmetricKeyDetails.namedCurve}` : ""}.`);
  }
  return key;
}
var encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function signJwt(algorithm, header, claims, key) {
  const input = `${encode({ alg: algorithm, ...header })}.${encode(claims)}`;
  const signature = sign("sha256", Buffer.from(input), algorithm === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key);
  return `${input}.${signature.toString("base64url")}`;
}

// src/push/apns.ts
var PRODUCTION_URL = "https://api.push.apple.com";
var SANDBOX_URL = "https://api.sandbox.push.apple.com";
var RENEW_AFTER = 50 * 6e4;
var RENEW_NOT_BEFORE = 20 * 6e4;
function createApns(options, timeout) {
  const names = ["key", "keyId", "teamId"];
  if (options === void 0 || names.every((name) => options[name] === void 0 || options[name] === "")) return void 0;
  for (const name of names) {
    if (typeof options[name] !== "string" || options[name] === "") throw new TypeError(`\`apns.${name}\` is needed beside the other two: the \`.p8\`'s contents, its key id and the team id.`);
  }
  return new ApnsSender({
    key: privateKeyOf(String(options.key), "ES256", "`apns.key`"),
    keyId: String(options.keyId),
    teamId: String(options.teamId),
    productionUrl: httpUrl(options.productionUrl ?? PRODUCTION_URL, "`apns.productionUrl`"),
    sandboxUrl: httpUrl(options.sandboxUrl ?? SANDBOX_URL, "`apns.sandboxUrl`"),
    timeout
  });
}
var headerText = (value, name) => {
  if (!/^[\x21-\x7e]+$/.test(value)) throw new TypeError(`${name} must be printable ASCII without spaces to be sent as an APNs header, not ${JSON.stringify(value)}.`);
  return value;
};
function apnsRequest(token, message) {
  const silent = message.silent === true;
  const headers = {
    ":method": "POST",
    // A token that is not hex is APNs's to refuse (`BadDeviceToken`); encoded, it cannot add to the path.
    ":path": `/3/device/${encodeURIComponent(token.token)}`,
    "apns-topic": headerText(token.app, "The token's `app`"),
    "apns-push-type": silent ? "background" : "alert"
  };
  const priority = silent ? "5" : message.priority === void 0 ? void 0 : message.priority === "high" ? "10" : "5";
  if (priority !== void 0) headers["apns-priority"] = priority;
  if (message.ttl !== void 0) headers["apns-expiration"] = String(message.ttl === 0 ? 0 : Math.floor(Date.now() / 1e3) + message.ttl);
  if (message.collapseKey !== void 0) headers["apns-collapse-id"] = headerText(message.collapseKey, "`collapseKey`");
  if (message.data !== void 0 && "aps" in message.data) throw new TypeError("`data.aps` is APNs's own key and cannot carry data: name the key something else.");
  const aps = {};
  if (silent) {
    aps["content-available"] = 1;
  } else {
    aps.alert = { ...message.title !== void 0 ? { title: message.title } : {}, ...message.body !== void 0 ? { body: message.body } : {} };
    if (message.badge !== void 0) aps.badge = message.badge;
    if (message.sound !== null) aps.sound = "default";
  }
  return { headers, body: JSON.stringify({ ...message.data, ...message.url !== void 0 ? { url: message.url } : {}, aps }) };
}
function apnsFailure(status, reason, retryAfter) {
  const detail = reason ?? `HTTP ${status}`;
  if (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") return failure("invalid-token", detail, status);
  if (status === 410 && (reason === "Unregistered" || reason === "ExpiredToken")) return failure("gone", detail, status);
  if (status === 401 || status === 403) return failure("auth", detail, status);
  if (status === 429) return failure("rate-limited", detail, status, retryAfter);
  if (status >= 500) return failure("unavailable", detail, status, retryAfter);
  if (status === 400 || status === 413) return failure("invalid-message", detail, status);
  return failure("error", detail, status);
}
var Endpoint = class {
  #origin;
  #timeout;
  /** The session new requests use: one that is open, or none. */
  #current;
  /** Every session that has not closed, including one that got a GOAWAY and is finishing its requests: `close` waits for them all. */
  #sessions = /* @__PURE__ */ new Set();
  constructor(origin, timeout) {
    this.#origin = origin;
    this.#timeout = timeout;
  }
  /** Sends one request and resolves with the answer, or with why there is none. It never rejects. */
  request(headers, body) {
    return new Promise((resolve) => {
      let session;
      let timer;
      let settled = false;
      const finish = (answer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(answer);
      };
      try {
        session = this.#session();
        const stream = session.request(headers);
        const current = session;
        let responseHeaders;
        let text = "";
        stream.setEncoding("utf8");
        stream.on("response", (received) => {
          responseHeaders = received;
        });
        stream.on("data", (chunk) => {
          text += chunk;
        });
        stream.on(
          "end",
          () => finish(responseHeaders === void 0 ? failure("unavailable", "The stream to APNs ended before APNs answered.") : { ok: true, status: Number(responseHeaders[":status"]), headers: responseHeaders, body: text })
        );
        stream.on("error", (error) => finish(failure("unavailable", describeNetworkError(error))));
        stream.on("close", () => finish(failure("unavailable", `The stream to APNs closed (code ${stream.rstCode}) before APNs answered.`)));
        timer = setTimeout(() => {
          finish(failure("unavailable", `APNs did not answer within ${this.#timeout} ms.`));
          this.#drop(current);
          current.destroy();
        }, this.#timeout);
        stream.end(body);
      } catch (error) {
        if (session !== void 0) this.#drop(session);
        finish(failure("unavailable", describeNetworkError(error)));
      }
    });
  }
  /** Ends the connection once the requests in flight are answered. */
  async close() {
    const sessions = [...this.#sessions];
    this.#current = void 0;
    await Promise.all(
      sessions.map(
        (session) => new Promise((resolve) => {
          if (session.destroyed) return resolve();
          session.once("close", resolve);
          session.close();
        })
      )
    );
  }
  #session() {
    if (this.#current !== void 0 && !this.#current.closed && !this.#current.destroyed) return this.#current;
    const session = connect(this.#origin);
    this.#sessions.add(session);
    this.#current = session;
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
  #drop(session) {
    if (this.#current === session) this.#current = void 0;
  }
};
var ApnsSender = class {
  #config;
  #endpoints = /* @__PURE__ */ new Map();
  #token;
  constructor(config) {
    this.#config = config;
  }
  async send(token, message) {
    const { headers, body } = apnsRequest(token, message);
    const endpoint = this.#endpoint(token.environment === "development" ? this.#config.sandboxUrl : this.#config.productionUrl);
    let jwt = this.#providerToken();
    for (let attempt = 0; ; attempt++) {
      const answer = await endpoint.request({ ...headers, authorization: `bearer ${jwt}` }, body);
      if (!answer.ok) return answer;
      const parsed = parseJson(answer.body);
      const reason = isRecord(parsed) && typeof parsed.reason === "string" ? parsed.reason : void 0;
      if (answer.status === 200) {
        const id = answer.headers["apns-id"];
        return typeof id === "string" && id !== "" ? { ok: true, id } : failure("error", "APNs answered without an apns-id.", answer.status);
      }
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
  async close() {
    await Promise.all([...this.#endpoints.values()].map((endpoint) => endpoint.close()));
  }
  #endpoint(origin) {
    let endpoint = this.#endpoints.get(origin);
    if (endpoint === void 0) {
      endpoint = new Endpoint(origin, this.#config.timeout);
      this.#endpoints.set(origin, endpoint);
    }
    return endpoint;
  }
  /** The provider token: the one signed less than 50 minutes ago, else a new one. The same token serves the production and the sandbox host. */
  #providerToken() {
    const now = Date.now();
    if (this.#token === void 0 || now - this.#token.issuedAt >= RENEW_AFTER) this.#token = this.#sign(now);
    return this.#token.jwt;
  }
  /**
   * Replaces `used`, the token a request was refused with, unless it is not the current one (another send already replaced it) or the current one is younger than the 20
   * minutes Apple allows between tokens. Returns the token to send with now, which is `used` when nothing was replaced.
   */
  #renew(used) {
    const now = Date.now();
    if (this.#token !== void 0 && this.#token.jwt === used && now - this.#token.issuedAt >= RENEW_NOT_BEFORE) this.#token = this.#sign(now);
    return this.#token?.jwt ?? used;
  }
  #sign(now) {
    const { key, keyId, teamId } = this.#config;
    return { jwt: signJwt("ES256", { kid: keyId }, { iss: teamId, iat: Math.floor(now / 1e3) }, key), issuedAt: now };
  }
};

// src/push/fcm.ts
var SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
var FCM_URL = "https://fcm.googleapis.com";
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var ASSERTION_SECONDS = 3600;
var EXPIRY_MARGIN = 5 * 6e4;
function readAccount(value) {
  let account = value;
  if (typeof value === "string") {
    try {
      account = JSON.parse(value);
    } catch {
      throw new TypeError("`fcm.serviceAccount` is a string but not JSON: pass the service account key's file as it is, or the parsed object.");
    }
  }
  if (!isRecord(account)) throw new TypeError("`fcm.serviceAccount` must be the service account key's JSON, a string or an object.");
  for (const name of ["project_id", "client_email", "private_key"]) {
    if (typeof account[name] !== "string" || account[name] === "") throw new TypeError(`\`fcm.serviceAccount\` has no \`${name}\`: it is not a service account key.`);
  }
  if (account.token_uri !== void 0 && typeof account.token_uri !== "string") throw new TypeError("`fcm.serviceAccount.token_uri` must be a string.");
  return { projectId: String(account.project_id), clientEmail: String(account.client_email), privateKey: String(account.private_key), tokenUri: account.token_uri };
}
function createFcm(options, timeout) {
  if (options === void 0 || options.serviceAccount === void 0 || options.serviceAccount === "") return void 0;
  const account = readAccount(options.serviceAccount);
  const base = httpUrl(options.baseUrl ?? FCM_URL, "`fcm.baseUrl`");
  return new FcmSender({
    projectId: account.projectId,
    clientEmail: account.clientEmail,
    key: privateKeyOf(account.privateKey, "RS256", "`fcm.serviceAccount.private_key`"),
    tokenUrl: httpUrl(options.tokenUrl ?? account.tokenUri ?? TOKEN_URL, "`fcm.tokenUrl`"),
    sendUrl: `${base}/v1/projects/${encodeURIComponent(account.projectId)}/messages:send`,
    timeout
  });
}
function fcmBody(token, message) {
  const data = { ...message.data };
  if (message.url !== void 0) data.url = message.url;
  const android = {};
  if (message.collapseKey !== void 0) android.collapse_key = message.collapseKey;
  if (message.priority !== void 0) android.priority = message.priority === "high" ? "HIGH" : "NORMAL";
  if (message.ttl !== void 0) android.ttl = `${message.ttl}s`;
  if (!message.silent) {
    const notification = {};
    if (message.title !== void 0) notification.title = message.title;
    if (message.body !== void 0) notification.body = message.body;
    if (message.sound !== null) notification.sound = "default";
    if (message.channel !== void 0) notification.channel_id = message.channel;
    android.notification = notification;
  }
  return { message: { token: token.token, ...Object.keys(data).length > 0 ? { data } : {}, ...Object.keys(android).length > 0 ? { android } : {} } };
}
function readError(body) {
  const error = isRecord(body) && isRecord(body.error) ? body.error : void 0;
  if (error === void 0) return { aboutToken: false };
  const details = Array.isArray(error.details) ? error.details.filter(isRecord) : [];
  const fcm = details.find((detail) => typeof detail.errorCode === "string")?.errorCode;
  const message = typeof error.message === "string" ? error.message : void 0;
  const violations = details.flatMap((detail) => Array.isArray(detail.fieldViolations) ? detail.fieldViolations.filter(isRecord) : []);
  const aboutToken = violations.some((violation) => violation.field === "message.token") || /registration token/i.test(message ?? "");
  return { code: typeof fcm === "string" ? fcm : typeof error.status === "string" ? error.status : void 0, message, aboutToken };
}
function fcmFailure(status, body, text, retryAfter) {
  const { code, message, aboutToken } = readError(body);
  const detail = message ?? code ?? (text.trim() === "" ? `HTTP ${status}` : text.trim().slice(0, 300));
  switch (code) {
    case "UNREGISTERED":
      return failure("gone", detail, status);
    case "SENDER_ID_MISMATCH":
      return failure("invalid-token", detail, status);
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
var FcmSender = class {
  #config;
  #access;
  /** The token request in flight: sends that need a token while one is on its way wait for it, and one request serves them all. */
  #pending;
  constructor(config) {
    this.#config = config;
  }
  async send(token, message) {
    const access = await this.#accessToken();
    if (typeof access !== "string") return access;
    let response;
    let text;
    try {
      response = await fetch(this.#config.sendUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${access}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify(fcmBody(token, message)),
        signal: AbortSignal.timeout(this.#config.timeout)
      });
      text = await response.text();
    } catch (error) {
      return failure("unavailable", describeNetworkError(error));
    }
    const body = parseJson(text);
    if (response.ok) {
      const name = isRecord(body) && typeof body.name === "string" ? body.name : "";
      const id = name.slice(name.lastIndexOf("/") + 1);
      return id === "" ? failure("error", "FCM answered without a message name.", response.status) : { ok: true, id };
    }
    if (response.status === 401 && this.#access?.token === access) this.#access = void 0;
    return fcmFailure(response.status, body, text, retryAfterOf(response.headers.get("retry-after")));
  }
  /** The access token: the cached one while it has more than the margin left, else a new one that every send waiting for it shares. */
  #accessToken() {
    if (this.#access !== void 0 && this.#access.usableUntil > Date.now()) return Promise.resolve(this.#access.token);
    this.#pending ??= this.#exchange().finally(() => {
      this.#pending = void 0;
    });
    return this.#pending;
  }
  /** Signs an assertion with the service account's key and exchanges it at the token endpoint (RFC 7523): the access token, or why there is none. */
  async #exchange() {
    const { clientEmail, key, tokenUrl, timeout } = this.#config;
    const issuedAt = Math.floor(Date.now() / 1e3);
    const assertion = signJwt("RS256", { typ: "JWT" }, { iss: clientEmail, scope: SCOPE, aud: tokenUrl, iat: issuedAt, exp: issuedAt + ASSERTION_SECONDS }, key);
    let response;
    let text;
    try {
      response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        signal: AbortSignal.timeout(timeout)
      });
      text = await response.text();
    } catch (error) {
      return failure("unavailable", `The token request to ${tokenUrl} failed: ${describeNetworkError(error)}`);
    }
    const body = parseJson(text);
    if (!response.ok) {
      const reason = isRecord(body) ? typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : void 0 : void 0;
      const detail = reason ?? `The token endpoint answered ${response.status}.`;
      if (response.status === 429) return failure("rate-limited", detail, response.status, retryAfterOf(response.headers.get("retry-after")));
      if (response.status >= 500) return failure("unavailable", detail, response.status, retryAfterOf(response.headers.get("retry-after")));
      return failure(response.status >= 400 && response.status < 500 ? "auth" : "error", detail, response.status);
    }
    if (!isRecord(body) || typeof body.access_token !== "string" || body.access_token === "") return failure("error", "The token endpoint answered without an access token.", response.status);
    const lifetime = typeof body.expires_in === "number" ? body.expires_in : ASSERTION_SECONDS;
    this.#access = { token: body.access_token, usableUntil: Date.now() + lifetime * 1e3 - EXPIRY_MARGIN };
    return body.access_token;
  }
};

// src/push/server.ts
var DEFAULT_TIMEOUT = 3e4;
var show = (value) => inspect(value, { depth: 0 });
function checkText(name, value) {
  if (value !== void 0 && typeof value !== "string") throw new TypeError(`${name} must be a string, not ${show(value)}.`);
}
function checkName(name, value) {
  if (typeof value !== "string" || value === "") throw new TypeError(`${name} must be a non-empty string, not ${show(value)}.`);
}
function checkToken(token) {
  if (typeof token !== "object" || token === null) throw new TypeError(`A push token is the { provider, token, app } the device saved, not ${show(token)}.`);
  if (token.provider !== "fcm" && token.provider !== "apns") throw new TypeError(`The token's \`provider\` must be "fcm" or "apns", not ${show(token.provider)}.`);
  checkName("The token's `token`", token.token);
  checkName("The token's `app`", token.app);
  if (token.environment !== void 0 && token.environment !== "development" && token.environment !== "production") {
    throw new TypeError(`The token's \`environment\` must be "development" or "production", not ${show(token.environment)}.`);
  }
}
function checkMessage(message) {
  if (typeof message !== "object" || message === null) throw new TypeError(`A message is an object such as { title, body, url }, not ${show(message)}.`);
  checkText("`title`", message.title);
  checkText("`body`", message.body);
  checkText("`url`", message.url);
  if (message.collapseKey !== void 0) checkName("`collapseKey`", message.collapseKey);
  if (message.channel !== void 0) checkName("`channel`", message.channel);
  if (message.silent !== void 0 && typeof message.silent !== "boolean") throw new TypeError(`\`silent\` must be a boolean, not ${show(message.silent)}.`);
  if (message.badge !== void 0 && (!Number.isInteger(message.badge) || message.badge < 0)) throw new TypeError(`\`badge\` must be a whole number of 0 or more, not ${show(message.badge)}.`);
  if (message.sound !== void 0 && message.sound !== null && message.sound !== "default") throw new TypeError(`\`sound\` must be "default" or null, not ${show(message.sound)}.`);
  if (message.priority !== void 0 && message.priority !== "high" && message.priority !== "normal") throw new TypeError(`\`priority\` must be "high" or "normal", not ${show(message.priority)}.`);
  if (message.ttl !== void 0 && (!Number.isInteger(message.ttl) || message.ttl < 0)) throw new TypeError(`\`ttl\` must be a whole number of seconds, 0 or more, not ${show(message.ttl)}.`);
  if (message.data !== void 0) {
    if (typeof message.data !== "object" || message.data === null || Array.isArray(message.data)) throw new TypeError(`\`data\` must be an object of strings, not ${show(message.data)}.`);
    for (const [key, value] of Object.entries(message.data)) {
      if (typeof value !== "string") throw new TypeError(`\`data.${key}\` must be a string (both providers carry strings only), not ${show(value)}.`);
    }
    if (message.url !== void 0 && "url" in message.data) throw new TypeError("`url` is carried as the data key `url`: pass the link as `url`, not also in `data`.");
  }
  if (message.silent) {
    for (const name of ["title", "body", "badge", "sound", "channel"]) {
      if (message[name] !== void 0 && message[name] !== null) throw new TypeError(`A \`silent\` message shows nothing, so it has no \`${name}\`.`);
    }
  } else if (!message.title && !message.body) {
    throw new TypeError("A notification needs a `title` or a `body`; a message for the app's background hook is `silent: true`.");
  }
}
function createPush(options = {}) {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) throw new TypeError(`\`timeout\` must be a number of milliseconds above 0, not ${show(timeout)}.`);
  const fcm = createFcm(options.fcm, timeout);
  const apns = createApns(options.apns, timeout);
  let closed = false;
  const pending = /* @__PURE__ */ new Set();
  return {
    async send(token, message) {
      checkToken(token);
      checkMessage(message);
      const sender = token.provider === "fcm" ? fcm : apns;
      if (sender === void 0) {
        throw new TypeError(token.provider === "fcm" ? "A send to an FCM token needs `fcm: { serviceAccount }` in createPush's options." : "A send to an APNs token needs `apns: { key, keyId, teamId }` in createPush's options.");
      }
      if (closed) return failure("unavailable", "The sender was closed.");
      const work = deliver(sender, token, message);
      const settled = work.then(
        () => void 0,
        () => void 0
      );
      pending.add(settled);
      void settled.then(() => pending.delete(settled));
      return work;
    },
    async close() {
      closed = true;
      await Promise.all(pending);
      await apns?.close();
    }
  };
}
async function deliver(sender, token, message) {
  try {
    return await sender.send(token, message);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    return failure("error", error instanceof Error ? error.message : String(error));
  }
}
export {
  createPush
};
