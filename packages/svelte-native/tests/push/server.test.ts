// The server's sender (`src/push/server.ts`) against local stand-ins for the providers: a plain HTTP server for FCM and Google's token endpoint, and a cleartext HTTP/2
// server for APNs. Each stand-in records what it was sent and answers what a test tells it to.
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo, Socket } from "node:net";
import { createPush, type Push, type PushOptions, type PushSend, type PushToken, type SendResult } from "../../src/push/server.ts";

type Failure = Extract<SendResult, { ok: false }>;
type Seen = { method: string; path: string; headers: IncomingHttpHeaders; text: string };
type Reply = { status?: number; headers?: Record<string, string>; json?: unknown; text?: string };
type Handler = (seen: Seen) => Reply | Promise<Reply>;

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("until: the condition did not come true");
    await settle(5);
  }
}

// What a test starts (servers, senders) and the afterEach below ends, in the reverse order: senders before the servers they talk to.
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  setSystemTime();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const listen = (server: Server | Http2Server): Promise<string> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

/** A URL nothing listens at: a port that was just released. */
async function deadUrl(): Promise<string> {
  const server = createServer();
  const url = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return url;
}

// Keys: the service account's RSA key, and the `.p8`'s P-256 key, with their public halves for verifying the signatures.
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = (key: KeyObject): string => key.export({ type: "pkcs8", format: "pem" }).toString();
const P8 = pem(ec.privateKey);

const account = (extra: Record<string, unknown> = {}) => ({
  type: "service_account",
  project_id: "test-project",
  private_key_id: "0123456789abcdef",
  private_key: pem(rsa.privateKey),
  client_email: "push@test-project.iam.gserviceaccount.com",
  ...extra,
});

type Jwt = { header: Record<string, unknown>; claims: Record<string, unknown>; signature: Buffer; signed: Buffer };
function decode(jwt: string): Jwt {
  const parts = jwt.split(".");
  expect(parts).toHaveLength(3);
  const [header, claims, signature] = parts as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(claims, "base64url").toString("utf8")) as Record<string, unknown>,
    signature: Buffer.from(signature, "base64url"),
    signed: Buffer.from(`${header}.${claims}`),
  };
}
const verifiesRs256 = (jwt: Jwt): boolean => verify("sha256", jwt.signed, rsa.publicKey, jwt.signature);
const verifiesEs256 = (jwt: Jwt): boolean => verify("sha256", jwt.signed, { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, jwt.signature);

/** A plain HTTP server that records what it is sent and answers with `handler`; it also lets a test leave a request unanswered. */
async function startHttp(handler: Handler): Promise<{ url: string; seen: Seen[]; handler: Handler }> {
  const state = { url: "", seen: [] as Seen[], handler };
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const seen: Seen = { method: request.method ?? "", path: request.url ?? "", headers: request.headers, text: Buffer.concat(chunks).toString("utf8") };
    state.seen.push(seen);
    const reply = await state.handler(seen);
    response.writeHead(reply.status ?? 200, { "content-type": reply.json === undefined ? "text/plain" : "application/json", ...reply.headers });
    response.end(reply.text ?? (reply.json === undefined ? "" : JSON.stringify(reply.json)));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  state.url = await listen(server);
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return state;
}

const FCM_NAME = "projects/test-project/messages/0:1700000000%31bd1c96";

/** Google: the token endpoint at `/token` and FCM at `/v1/projects/…`, with the requests of each recorded apart. */
async function startGoogle() {
  const oauth: Seen[] = [];
  const fcm: Seen[] = [];
  let issued = 0;
  const google = {
    url: "",
    oauth,
    fcm,
    /** The token endpoint's answer for a good request: a new token each time (`ya29.token-1`, `-2`…). */
    token: (expiresIn = 3600): Reply => ({ json: { access_token: `ya29.token-${++issued}`, expires_in: expiresIn, token_type: "Bearer" } }),
    onToken: undefined as Handler | undefined,
    onFcm: (() => ({ json: { name: FCM_NAME } })) as Handler,
  };
  const http = await startHttp((seen) => {
    if (seen.path === "/token") {
      oauth.push(seen);
      return (google.onToken ?? (() => google.token()))(seen);
    }
    fcm.push(seen);
    return google.onFcm(seen);
  });
  google.url = http.url;
  return google;
}

const ID = "11111111-2222-3333-4444-555555555555";

/** An APNs stand-in over cleartext HTTP/2: it records each request and keeps its sessions, so a test can end one. */
async function startApns() {
  const seen: Seen[] = [];
  const sessions: ServerHttp2Session[] = [];
  const apns = {
    url: "",
    seen,
    sessions,
    onRequest: (() => ({ headers: { "apns-id": ID } })) as Handler,
  };
  const server = createHttp2Server();
  server.on("session", (session) => {
    sessions.push(session);
    // A test that destroys a session leaves the client's request an error to report; the stand-in has nothing to do with it.
    session.on("error", () => undefined);
  });
  server.on("stream", async (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const entry: Seen = { method: String(headers[":method"]), path: String(headers[":path"]), headers, text: Buffer.concat(chunks).toString("utf8") };
    seen.push(entry);
    const reply = await apns.onRequest(entry);
    if (stream.destroyed || stream.closed) return;
    stream.respond({ ":status": reply.status ?? 200, ...reply.headers });
    stream.end(reply.text ?? (reply.json === undefined ? undefined : JSON.stringify(reply.json)));
  });
  apns.url = await listen(server);
  cleanups.push(async () => {
    for (const session of sessions) session.destroy();
    await new Promise((resolve) => server.close(resolve));
  });
  return apns;
}

function make(options: PushOptions): Push {
  const push = createPush(options);
  cleanups.push(() => push.close());
  return push;
}

const fcmOptions = (google: { url: string }, extra: Record<string, unknown> = {}) => ({ serviceAccount: JSON.stringify(account({ token_uri: "https://unused.example/token" })), baseUrl: google.url, tokenUrl: `${google.url}/token`, ...extra });
const apnsOptions = (production: { url: string }, sandbox: { url: string } = production) => ({ key: P8, keyId: "ABC123DEFG", teamId: "TEAM123456", productionUrl: production.url, sandboxUrl: sandbox.url });

const android: PushToken = { provider: "fcm", token: "fcm-registration-token", app: "io.example.app" };
const iphone: PushToken = { provider: "apns", token: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90", environment: "production", app: "io.example.app" };
const note: PushSend = { title: "Order ready", body: "Pickup at gate 3" };

const bodyOf = (seen: Seen | undefined): Record<string, unknown> => JSON.parse(seen?.text ?? "{}") as Record<string, unknown>;
const messageOf = (google: { fcm: Seen[] }, index = 0) => bodyOf(google.fcm[index]).message as Record<string, unknown>;
const authorization = (seen: Seen | undefined): string => String(seen?.headers.authorization);
const providerToken = (seen: Seen | undefined): Jwt => decode(authorization(seen).replace(/^bearer /i, ""));

describe("FCM: the access token", () => {
  test("an RS256 assertion signed with the service account's key is exchanged at the token endpoint, and the access token goes to FCM as a bearer", async () => {
    const google = await startGoogle();
    const push = make({ fcm: fcmOptions(google) });
    const before = Math.floor(Date.now() / 1000);
    expect(await push.send(android, note)).toEqual({ ok: true, id: "0:1700000000%31bd1c96" });

    expect(google.oauth).toHaveLength(1);
    const [exchange] = google.oauth;
    expect([exchange?.method, exchange?.headers["content-type"]]).toEqual(["POST", "application/x-www-form-urlencoded"]);
    const form = new URLSearchParams(exchange?.text);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = decode(form.get("assertion") ?? "");
    expect(assertion.header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(assertion.claims).toEqual({
      iss: "push@test-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: `${google.url}/token`,
      iat: expect.any(Number),
      exp: expect.any(Number),
    });
    const iat = assertion.claims.iat as number;
    expect(iat).toBeGreaterThanOrEqual(before);
    expect(iat).toBeLessThanOrEqual(before + 5);
    expect(assertion.claims.exp).toBe(iat + 3600);
    expect(assertion.signature).toHaveLength(256);
    expect(verifiesRs256(assertion)).toBe(true);

    expect(google.fcm).toHaveLength(1);
    expect([google.fcm[0]?.method, google.fcm[0]?.path, google.fcm[0]?.headers.authorization, google.fcm[0]?.headers["content-type"]]).toEqual([
      "POST",
      "/v1/projects/test-project/messages:send",
      "Bearer ya29.token-1",
      "application/json; charset=utf-8",
    ]);
  });

  test("the key is accepted as the file's text or as the parsed object, and the token endpoint is the service account's `token_uri` unless `tokenUrl` says otherwise", async () => {
    const google = await startGoogle();
    const asObject = make({ fcm: { serviceAccount: account({ token_uri: `${google.url}/token` }), baseUrl: google.url } });
    expect((await asObject.send(android, note)).ok).toBe(true);
    const asText = make({ fcm: { serviceAccount: JSON.stringify(account({ token_uri: `${google.url}/token` })), baseUrl: google.url } });
    expect((await asText.send(android, note)).ok).toBe(true);
    expect(google.oauth).toHaveLength(2);
    expect(decode(new URLSearchParams(google.oauth[0]?.text).get("assertion") ?? "").claims.aud).toBe(`${google.url}/token`);
    // The key's line breaks written as `\n` in an environment variable are the key's line breaks.
    const escaped = make({ fcm: { serviceAccount: account({ token_uri: `${google.url}/token`, private_key: pem(rsa.privateKey).replaceAll("\n", "\\n") }), baseUrl: google.url } });
    expect((await escaped.send(android, note)).ok).toBe(true);
  });

  test("a token is used until five minutes before it expires, and then a new one is asked for", async () => {
    const google = await startGoogle();
    const push = make({ fcm: fcmOptions(google) });
    const start = Date.now();
    setSystemTime(new Date(start));
    await push.send(android, note);
    setSystemTime(new Date(start + 3299_000));
    await push.send(android, note);
    expect(google.oauth).toHaveLength(1);
    expect(google.fcm.map(authorization)).toEqual(["Bearer ya29.token-1", "Bearer ya29.token-1"]);
    setSystemTime(new Date(start + 3301_000));
    await push.send(android, note);
    expect(google.oauth).toHaveLength(2);
    expect(authorization(google.fcm[2])).toBe("Bearer ya29.token-2");
  });

  test("the margin follows the `expires_in` the endpoint gives", async () => {
    const google = await startGoogle();
    google.onToken = () => google.token(900);
    const push = make({ fcm: fcmOptions(google) });
    const start = Date.now();
    setSystemTime(new Date(start));
    await push.send(android, note);
    setSystemTime(new Date(start + 599_000));
    await push.send(android, note);
    expect(google.oauth).toHaveLength(1);
    setSystemTime(new Date(start + 601_000));
    await push.send(android, note);
    expect(google.oauth).toHaveLength(2);
  });

  test("sends that need a token while one is being asked for share that request", async () => {
    const google = await startGoogle();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    google.onToken = async () => {
      await gate;
      return google.token();
    };
    const push = make({ fcm: fcmOptions(google) });
    const sends = Array.from({ length: 5 }, () => push.send(android, note));
    await until(() => google.oauth.length === 1);
    await settle(50);
    expect(google.oauth).toHaveLength(1);
    expect(google.fcm).toHaveLength(0);
    release();
    expect((await Promise.all(sends)).map((result) => result.ok)).toEqual([true, true, true, true, true]);
    expect(google.oauth).toHaveLength(1);
    expect(google.fcm.map(authorization)).toEqual(Array(5).fill("Bearer ya29.token-1"));
  });

  test("a token request that failed is not kept: the next send asks again", async () => {
    const google = await startGoogle();
    let calls = 0;
    google.onToken = () => (++calls === 1 ? { status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } } : google.token());
    const push = make({ fcm: fcmOptions(google) });
    expect(await push.send(android, note)).toEqual({ ok: false, reason: "auth", status: 400, detail: "Invalid JWT Signature." });
    expect(google.fcm).toHaveLength(0);
    expect((await push.send(android, note)).ok).toBe(true);
    expect(google.oauth).toHaveLength(2);
  });

  const tokenFailures: [string, Reply, Failure][] = [
    ["the key refused (invalid_grant)", { status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } }, { ok: false, reason: "auth", status: 400, detail: "Invalid JWT Signature." }],
    ["a client that is unknown (401)", { status: 401, json: { error: "invalid_client" } }, { ok: false, reason: "auth", status: 401, detail: "invalid_client" }],
    ["too many requests, with a Retry-After", { status: 429, headers: { "retry-after": "7" }, json: { error: "rate_limit" } }, { ok: false, reason: "rate-limited", status: 429, retryAfter: 7000, detail: "rate_limit" }],
    ["the endpoint down", { status: 503, text: "Service Unavailable" }, { ok: false, reason: "unavailable", status: 503, detail: "The token endpoint answered 503." }],
    ["an answer with no token", { json: { token_type: "Bearer" } }, { ok: false, reason: "error", status: 200, detail: "The token endpoint answered without an access token." }],
  ];
  for (const [name, reply, expected] of tokenFailures) {
    test(`${name}: the send answers ${expected.reason}, and nothing is sent to FCM`, async () => {
      const google = await startGoogle();
      google.onToken = () => reply;
      expect(await make({ fcm: fcmOptions(google) }).send(android, note)).toEqual(expected);
      expect(google.fcm).toHaveLength(0);
    });
  }

  test("a token endpoint that cannot be reached is `unavailable`", async () => {
    const google = await startGoogle();
    const dead = await deadUrl();
    const push = make({ fcm: fcmOptions(google, { tokenUrl: `${dead}/token` }) });
    const result = await push.send(android, note);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    // The endpoint by its host: the rest of a URL may hold a password or a key.
    expect((result as Failure).detail).toStartWith(`The token request to ${new URL(dead).host} failed: `);
    expect(google.fcm).toHaveLength(0);
  });

  test("an access token FCM refuses (401) is dropped, so that the next send gets a new one", async () => {
    const google = await startGoogle();
    let calls = 0;
    google.onFcm = () => (++calls === 1 ? { status: 401, json: { error: { code: 401, message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } } } : { json: { name: FCM_NAME } });
    const push = make({ fcm: fcmOptions(google) });
    expect(await push.send(android, note)).toEqual({ ok: false, reason: "auth", status: 401, detail: "Request had invalid authentication credentials." });
    expect((await push.send(android, note)).ok).toBe(true);
    expect(google.oauth).toHaveLength(2);
    expect(google.fcm.map(authorization)).toEqual(["Bearer ya29.token-1", "Bearer ya29.token-2"]);
  });
});

describe("FCM: the message", () => {
  async function sent(message: PushSend, token: PushToken = android): Promise<Record<string, unknown>> {
    const google = await startGoogle();
    expect((await make({ fcm: fcmOptions(google) }).send(token, message)).ok).toBe(true);
    return messageOf(google);
  }

  test("a notification carries its title and body in `android.notification`, with the default sound, and nothing else", async () => {
    expect(await sent(note)).toEqual({ token: "fcm-registration-token", android: { notification: { title: "Order ready", body: "Pickup at gate 3", sound: "default" } } });
    expect(await sent({ body: "Only a body" })).toEqual({ token: "fcm-registration-token", android: { notification: { body: "Only a body", sound: "default" } } });
  });

  test("`url` is the data key `url`, beside the data", async () => {
    const message = await sent({ ...note, url: "/orders/42", data: { order: "42", kind: "ready" } });
    expect(message.data).toEqual({ order: "42", kind: "ready", url: "/orders/42" });
    expect(await sent({ ...note, url: "myapp://orders/42" })).toMatchObject({ data: { url: "myapp://orders/42" } });
    expect(await sent({ ...note, data: { order: "42" } })).toMatchObject({ data: { order: "42" } });
  });

  test("`silent` is a data message: no `notification`, and what a notification shows is not sent", async () => {
    expect(await sent({ silent: true, data: { inbox: "3" }, url: "/inbox" })).toEqual({ token: "fcm-registration-token", data: { inbox: "3", url: "/inbox" } });
  });

  test("`sound` is the default one, or none when it is null", async () => {
    expect(await sent({ ...note, sound: "default" })).toMatchObject({ android: { notification: { sound: "default" } } });
    expect(((await sent({ ...note, sound: null })).android as { notification: Record<string, unknown> }).notification).toEqual({ title: "Order ready", body: "Pickup at gate 3" });
  });

  test("`channel` is the notification's channel id", async () => {
    expect(await sent({ ...note, channel: "orders" })).toMatchObject({ android: { notification: { channel_id: "orders" } } });
  });

  test("`collapseKey`, `priority` and `ttl` are the Android config's collapse_key, priority (HIGH or NORMAL) and ttl (a duration in seconds)", async () => {
    expect(await sent({ ...note, collapseKey: "order-42", priority: "high", ttl: 3600 })).toMatchObject({ android: { collapse_key: "order-42", priority: "HIGH", ttl: "3600s" } });
    expect(await sent({ ...note, priority: "normal", ttl: 0 })).toMatchObject({ android: { priority: "NORMAL", ttl: "0s" } });
    expect(await sent({ silent: true, data: { a: "b" }, collapseKey: "sync", priority: "high" })).toEqual({ token: "fcm-registration-token", data: { a: "b" }, android: { collapse_key: "sync", priority: "HIGH" } });
  });

  test("`badge` is not sent: Android has no reliable count", async () => {
    expect(await sent({ ...note, badge: 3 })).toEqual(await sent(note));
  });

  test("the id is the message id the device reads: the last part of the name FCM gives", async () => {
    const google = await startGoogle();
    expect(await make({ fcm: fcmOptions(google) }).send(android, note)).toEqual({ ok: true, id: "0:1700000000%31bd1c96" });
  });

  test("a project id is put in the path as it is, and a path in `baseUrl` stays", async () => {
    const google = await startGoogle();
    expect((await make({ fcm: fcmOptions(google, { baseUrl: `${google.url}/proxy/` }) }).send(android, note)).ok).toBe(true);
    expect(google.fcm[0]?.path).toBe("/proxy/v1/projects/test-project/messages:send");
  });
});

describe("FCM: every answer", () => {
  const error = (code: number, status: string, message: string, errorCode?: string, details: object[] = []) => ({
    error: { code, message, status, details: [...(errorCode === undefined ? [] : [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }]), ...details] },
  });
  const badToken = { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.token", description: "The registration token is not a valid FCM registration token" }] };

  const cases: [string, Reply, Omit<Failure, "ok">][] = [
    ["UNREGISTERED (404)", { status: 404, json: error(404, "NOT_FOUND", "Requested entity was not found.", "UNREGISTERED") }, { reason: "gone", status: 404, detail: "Requested entity was not found." }],
    ["UNREGISTERED as the top-level status of a 404", { status: 404, json: error(404, "UNREGISTERED", "Requested entity was not found.") }, { reason: "gone", status: 404, detail: "Requested entity was not found." }],
    // A 404 that does not say the token is unregistered is a wrong project id or endpoint, and `gone` would have the app delete every token it has.
    ["a 404 NOT_FOUND that does not say UNREGISTERED is an error, not a token that is gone", { status: 404, json: error(404, "NOT_FOUND", "Requested entity was not found.") }, { reason: "error", status: 404, detail: "FCM answered 404 (Requested entity was not found.): the endpoint or the project was not found; check the service account's `project_id` and `fcm.baseUrl`." }],
    ["a 404 with another FCM error code", { status: 404, json: error(404, "NOT_FOUND", "Requested entity was not found.", "UNSPECIFIED_ERROR") }, { reason: "error", status: 404, detail: "FCM answered 404 (Requested entity was not found.): the endpoint or the project was not found; check the service account's `project_id` and `fcm.baseUrl`." }],
    ["a 404 that is a page (a wrong path)", { status: 404, text: "<html>Not Found</html>" }, { reason: "error", status: 404, detail: "FCM answered 404 (<html>Not Found</html>): the endpoint or the project was not found; check the service account's `project_id` and `fcm.baseUrl`." }],
    ["INVALID_ARGUMENT about the message", { status: 400, json: error(400, "INVALID_ARGUMENT", "Android message is too big", "INVALID_ARGUMENT") }, { reason: "invalid-message", status: 400, detail: "Android message is too big" }],
    ["INVALID_ARGUMENT about the registration token (its field)", { status: 400, json: error(400, "INVALID_ARGUMENT", "Request contains an invalid argument.", "INVALID_ARGUMENT", [badToken]) }, { reason: "invalid-token", status: 400, detail: "Request contains an invalid argument." }],
    ["INVALID_ARGUMENT about the registration token (its message)", { status: 400, json: error(400, "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token", "INVALID_ARGUMENT") }, { reason: "invalid-token", status: 400, detail: "The registration token is not a valid FCM registration token" }],
    ["a 400 with no FCM error", { status: 400, json: error(400, "INVALID_ARGUMENT", "Invalid JSON payload received.") }, { reason: "invalid-message", status: 400, detail: "Invalid JSON payload received." }],
    // Every token answers it when the server has another project's credentials: `auth`, which no app deletes tokens on.
    ["SENDER_ID_MISMATCH (403) is the server's credentials, not the token", { status: 403, json: error(403, "PERMISSION_DENIED", "SenderId mismatch", "SENDER_ID_MISMATCH") }, { reason: "auth", status: 403, detail: "SenderId mismatch: the token belongs to another Firebase project than the service account's; check the server's credentials before suspecting the token" }],
    ["QUOTA_EXCEEDED (429) with a Retry-After", { status: 429, headers: { "retry-after": "30" }, json: error(429, "RESOURCE_EXHAUSTED", "Quota exceeded for quota metric 'Send requests'", "QUOTA_EXCEEDED") }, { reason: "rate-limited", status: 429, retryAfter: 30_000, detail: "Quota exceeded for quota metric 'Send requests'" }],
    ["a 429 with no body and no Retry-After", { status: 429 }, { reason: "rate-limited", status: 429, detail: "HTTP 429" }],
    ["UNAVAILABLE (503) with a Retry-After", { status: 503, headers: { "retry-after": "5" }, json: error(503, "UNAVAILABLE", "The service is currently unavailable.", "UNAVAILABLE") }, { reason: "unavailable", status: 503, retryAfter: 5000, detail: "The service is currently unavailable." }],
    ["INTERNAL (500)", { status: 500, json: error(500, "INTERNAL", "Internal error encountered.", "INTERNAL") }, { reason: "unavailable", status: 500, detail: "Internal error encountered." }],
    ["a 502 that is a proxy's error page", { status: 502, text: "<html>Bad Gateway</html>" }, { reason: "unavailable", status: 502, detail: "<html>Bad Gateway</html>" }],
    ["UNAUTHENTICATED (401)", { status: 401, json: error(401, "UNAUTHENTICATED", "Request had invalid authentication credentials.") }, { reason: "auth", status: 401, detail: "Request had invalid authentication credentials." }],
    ["THIRD_PARTY_AUTH_ERROR (401)", { status: 401, json: error(401, "UNAUTHENTICATED", "Auth error from APNS or Web Push Service", "THIRD_PARTY_AUTH_ERROR") }, { reason: "auth", status: 401, detail: "Auth error from APNS or Web Push Service" }],
    ["PERMISSION_DENIED (403): the account may not send", { status: 403, json: error(403, "PERMISSION_DENIED", "The caller does not have permission") }, { reason: "auth", status: 403, detail: "The caller does not have permission" }],
    ["a status FCM does not document (409)", { status: 409, json: error(409, "ABORTED", "Aborted.") }, { reason: "error", status: 409, detail: "Aborted." }],
    ["UNSPECIFIED_ERROR (400)", { status: 400, json: error(400, "INVALID_ARGUMENT", "Something.", "UNSPECIFIED_ERROR") }, { reason: "invalid-message", status: 400, detail: "Something." }],
    ["a 200 with no message name", { json: {} }, { reason: "error", status: 200, detail: "FCM answered without a message name." }],
  ];
  for (const [name, reply, expected] of cases) {
    test(`${name} is ${expected.reason}`, async () => {
      const google = await startGoogle();
      google.onFcm = () => reply;
      expect(await make({ fcm: fcmOptions(google) }).send(android, note)).toEqual({ ok: false, ...expected });
    });
  }

  test("Retry-After is milliseconds: seconds as given, an HTTP date as the time until it, nothing for what is neither, 0 for a date that has passed", async () => {
    const google = await startGoogle();
    const push = make({ fcm: fcmOptions(google) });
    const retryAfter = async (header: string): Promise<number | undefined> => {
      google.onFcm = () => ({ status: 429, headers: { "retry-after": header }, json: error(429, "RESOURCE_EXHAUSTED", "Quota", "QUOTA_EXCEEDED") });
      const result = (await push.send(android, note)) as Failure;
      return result.retryAfter;
    };
    expect(await retryAfter("120")).toBe(120_000);
    const later = (await retryAfter(new Date(Date.now() + 90_000).toUTCString())) ?? 0;
    expect(later).toBeGreaterThan(87_000);
    expect(later).toBeLessThanOrEqual(90_000);
    expect(await retryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
    expect(await retryAfter("soon")).toBeUndefined();
  });

  test("a server that cannot be reached is `unavailable`, with the reason of the failure", async () => {
    const google = await startGoogle();
    const result = await make({ fcm: fcmOptions(google, { baseUrl: await deadUrl() }) }).send(android, note);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect((result as Failure).status).toBeUndefined();
    expect((result as Failure).detail).not.toBe("");
  });

  test("a URL in a network error is cut to its host: a password or a key in the query never reaches `detail`", async () => {
    const google = await startGoogle();
    const withPassword = await make({ fcm: fcmOptions(google, { tokenUrl: "https://user:hunter2@127.0.0.1:1/token?key=SECRETQUERY" }) }).send(android, note);
    expect(withPassword).toMatchObject({ ok: false, reason: "unavailable" });
    expect((withPassword as Failure).detail).not.toMatch(/hunter2|SECRETQUERY|user:/);
    expect((withPassword as Failure).detail).toContain("127.0.0.1:1");
    const dead = await deadUrl();
    const withQuery = await make({ fcm: fcmOptions(google, { baseUrl: `${dead}/?key=SECRETQUERY` }) }).send(android, note);
    expect(withQuery).toMatchObject({ ok: false, reason: "unavailable" });
    expect((withQuery as Failure).detail).not.toContain("SECRETQUERY");
  });

  test("a server that does not answer is `unavailable` after the timeout", async () => {
    const google = await startGoogle();
    google.onFcm = () => new Promise<Reply>(() => {});
    const started = Date.now();
    const result = await make({ fcm: fcmOptions(google), timeout: 150 }).send(android, note);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("APNs: the provider token", () => {
  test("an ES256 token of the key id and the team, with the raw r and s as its signature", async () => {
    const apns = await startApns();
    const push = make({ apns: apnsOptions(apns) });
    const before = Math.floor(Date.now() / 1000);
    expect((await push.send(iphone, note)).ok).toBe(true);
    const token = providerToken(apns.seen[0]);
    expect(token.header).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(token.claims).toEqual({ iss: "TEAM123456", iat: expect.any(Number) });
    expect(token.claims.iat as number).toBeGreaterThanOrEqual(before);
    expect(token.claims.iat as number).toBeLessThanOrEqual(before + 5);
    // JOSE's signature is r and s at 32 bytes each, not the DER Node writes by default.
    expect(token.signature).toHaveLength(64);
    expect(verifiesEs256(token)).toBe(true);
    expect(verify("sha256", token.signed, ec.publicKey, token.signature)).toBe(false);
  });

  test("the key's line breaks written as `\\n` in an environment variable are the key's line breaks", async () => {
    const apns = await startApns();
    const push = make({ apns: { ...apnsOptions(apns), key: P8.replaceAll("\n", "\\n") } });
    expect((await push.send(iphone, note)).ok).toBe(true);
    expect(verifiesEs256(providerToken(apns.seen[0]))).toBe(true);
  });

  test("one token serves every send, and the sandbox too, until 50 minutes; then a new one is signed", async () => {
    const production = await startApns();
    const sandbox = await startApns();
    const push = make({ apns: apnsOptions(production, sandbox) });
    const start = new Date("2026-11-17T12:00:00Z").getTime();
    setSystemTime(new Date(start));
    await push.send(iphone, note);
    await push.send({ ...iphone, environment: "development" }, note);
    setSystemTime(new Date(start + 49 * 60_000 + 59_000));
    await push.send(iphone, note);
    const first = authorization(production.seen[0]);
    expect([authorization(sandbox.seen[0]), authorization(production.seen[1])]).toEqual([first, first]);
    expect(providerToken(production.seen[0]).claims.iat).toBe(start / 1000);

    setSystemTime(new Date(start + 50 * 60_000));
    await push.send(iphone, note);
    const renewed = providerToken(production.seen[2]);
    expect(authorization(production.seen[2])).not.toBe(first);
    expect(renewed.claims.iat).toBe(start / 1000 + 3000);
    expect(verifiesEs256(renewed)).toBe(true);
  });

  test("an expired provider token is replaced and the request sent again, once, when it is old enough to replace (Apple refuses a new one within 20 minutes of the last)", async () => {
    const apns = await startApns();
    const push = make({ apns: apnsOptions(apns) });
    const start = new Date("2026-11-17T12:00:00Z").getTime();
    setSystemTime(new Date(start));
    apns.onRequest = () => ({ status: 403, json: { reason: "ExpiredProviderToken" } });

    // Fresh: replacing it would sign the same token and be refused by Apple, so the refusal is the answer.
    expect(await push.send(iphone, note)).toEqual({ ok: false, reason: "auth", status: 403, detail: "ExpiredProviderToken" });
    expect(apns.seen).toHaveLength(1);

    setSystemTime(new Date(start + 30 * 60_000));
    apns.onRequest = (seen) => (authorization(seen) === authorization(apns.seen[0]) ? { status: 403, json: { reason: "ExpiredProviderToken" } } : { headers: { "apns-id": ID } });
    expect(await push.send(iphone, note)).toEqual({ ok: true, id: ID });
    expect(apns.seen).toHaveLength(3);
    expect(providerToken(apns.seen[2]).claims.iat).toBe(start / 1000 + 1800);
    expect(verifiesEs256(providerToken(apns.seen[2]))).toBe(true);

    // A token that is refused again after the retry is the answer: a send retries once.
    setSystemTime(new Date(start + 60 * 60_000));
    apns.onRequest = () => ({ status: 403, json: { reason: "ExpiredProviderToken" } });
    expect(await push.send(iphone, note)).toMatchObject({ ok: false, reason: "auth", detail: "ExpiredProviderToken" });
    expect(apns.seen).toHaveLength(5);
  });

  test("an expired token is replaced once for the sends that were refused with it", async () => {
    const apns = await startApns();
    const push = make({ apns: apnsOptions(apns) });
    const start = new Date("2026-11-17T12:00:00Z").getTime();
    setSystemTime(new Date(start));
    await push.send(iphone, note);
    const old = authorization(apns.seen[0]);
    setSystemTime(new Date(start + 45 * 60_000));
    apns.onRequest = async (seen) => {
      await settle(30);
      return authorization(seen) === old ? { status: 403, json: { reason: "ExpiredProviderToken" } } : { headers: { "apns-id": ID } };
    };
    const results = await Promise.all([push.send(iphone, note), push.send(iphone, note), push.send(iphone, note)]);
    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
    expect(new Set(apns.seen.slice(1).map(authorization)).size).toBe(2);
  });
});

describe("APNs: the message", () => {
  async function sent(message: PushSend, token: PushToken = iphone) {
    const apns = await startApns();
    expect((await make({ apns: apnsOptions(apns) }).send(token, message)).ok).toBe(true);
    const [seen] = apns.seen;
    return { headers: seen?.headers ?? {}, path: seen?.path, method: seen?.method, payload: bodyOf(seen) };
  }

  test("a notification is a POST to the device's path, to the app's topic, with `aps.alert` and the default sound", async () => {
    const { method, path, headers, payload } = await sent(note);
    expect([method, path]).toEqual(["POST", `/3/device/${iphone.token}`]);
    expect([headers["apns-topic"], headers["apns-push-type"]]).toEqual(["io.example.app", "alert"]);
    expect([headers["apns-priority"], headers["apns-expiration"], headers["apns-collapse-id"]]).toEqual([undefined, undefined, undefined]);
    expect(payload).toEqual({ aps: { alert: { title: "Order ready", body: "Pickup at gate 3" }, sound: "default" } });
    expect((await sent({ body: "Only a body" })).payload).toEqual({ aps: { alert: { body: "Only a body" }, sound: "default" } });
  });

  test("`url` and `data` are custom keys beside `aps`", async () => {
    expect((await sent({ ...note, url: "/orders/42", data: { order: "42" } })).payload).toEqual({ order: "42", url: "/orders/42", aps: { alert: { title: "Order ready", body: "Pickup at gate 3" }, sound: "default" } });
    expect((await sent({ ...note, url: "https://app.example.com/orders/42" })).payload).toMatchObject({ url: "https://app.example.com/orders/42" });
  });

  test("`badge` is `aps.badge` (0 clears it), and `sound` is the default one or, when null, none", async () => {
    expect((await sent({ ...note, badge: 3 })).payload.aps).toMatchObject({ badge: 3 });
    expect((await sent({ ...note, badge: 0 })).payload.aps).toMatchObject({ badge: 0 });
    expect((await sent({ ...note, sound: null })).payload.aps).toEqual({ alert: { title: "Order ready", body: "Pickup at gate 3" } });
  });

  test("`silent` is a background push: `content-available`, push type background and priority 5 (which a priority of high does not change)", async () => {
    for (const message of [{ silent: true, data: { inbox: "3" }, url: "/inbox" }, { silent: true, data: { inbox: "3" }, url: "/inbox", priority: "high" as const }]) {
      const { headers, payload } = await sent(message);
      expect([headers["apns-push-type"], headers["apns-priority"]]).toEqual(["background", "5"]);
      expect(payload).toEqual({ inbox: "3", url: "/inbox", aps: { "content-available": 1 } });
    }
  });

  test("`priority` is apns-priority 10 or 5, `collapseKey` is apns-collapse-id, and `channel` is not sent", async () => {
    expect((await sent({ ...note, priority: "high" })).headers["apns-priority"]).toBe("10");
    expect((await sent({ ...note, priority: "normal" })).headers["apns-priority"]).toBe("5");
    const { headers, payload } = await sent({ ...note, collapseKey: "order-42", channel: "orders" });
    expect(headers["apns-collapse-id"]).toBe("order-42");
    expect(JSON.stringify(payload)).not.toContain("orders");
  });

  test("`ttl` is apns-expiration, the time it ends as seconds since the epoch, and 0 is 0 (deliver once, do not store)", async () => {
    const now = new Date("2026-11-17T12:00:00Z");
    setSystemTime(now);
    expect((await sent({ ...note, ttl: 3600 })).headers["apns-expiration"]).toBe(String(now.getTime() / 1000 + 3600));
    expect((await sent({ ...note, ttl: 0 })).headers["apns-expiration"]).toBe("0");
  });

  test("the id is the answer's `apns-id`", async () => {
    const apns = await startApns();
    apns.onRequest = () => ({ headers: { "apns-id": "abcdef12-0000-0000-0000-000000000000" } });
    expect(await make({ apns: apnsOptions(apns) }).send(iphone, note)).toEqual({ ok: true, id: "abcdef12-0000-0000-0000-000000000000" });
  });

  test("a token that is not hex is APNs's to refuse, and cannot change the path", async () => {
    const apns = await startApns();
    apns.onRequest = () => ({ status: 400, json: { reason: "BadDeviceToken" } });
    const result = await make({ apns: apnsOptions(apns) }).send({ ...iphone, token: "../../3/device/x?y#z" }, note);
    expect(result).toMatchObject({ ok: false, reason: "invalid-token" });
    expect(apns.seen[0]?.path).toBe(`/3/device/${encodeURIComponent("../../3/device/x?y#z")}`);
  });
});

describe("APNs: the endpoint", () => {
  test("a token of a development build goes to the sandbox, one of a production build or of none to production", async () => {
    const production = await startApns();
    const sandbox = await startApns();
    const push = make({ apns: apnsOptions(production, sandbox) });
    await push.send({ ...iphone, environment: "development" }, note);
    expect([production.seen.length, sandbox.seen.length]).toEqual([0, 1]);
    await push.send({ ...iphone, environment: "production" }, note);
    expect([production.seen.length, sandbox.seen.length]).toEqual([1, 1]);
    await push.send({ provider: "apns", token: iphone.token, app: iphone.app }, note);
    expect([production.seen.length, sandbox.seen.length]).toEqual([2, 1]);
    // One session for each host, however many sends.
    expect([production.sessions.length, sandbox.sessions.length]).toEqual([1, 1]);
  });
});

describe("APNs: every answer", () => {
  const cases: [string, Reply, Omit<Failure, "ok">][] = [
    ["410 Unregistered", { status: 410, json: { reason: "Unregistered", timestamp: 1700000000000 } }, { reason: "gone", status: 410, detail: "Unregistered" }],
    ["410 ExpiredToken", { status: 410, json: { reason: "ExpiredToken" } }, { reason: "gone", status: 410, detail: "ExpiredToken" }],
    // `gone` and `invalid-token` are decided by APNs's reason, never by the status alone.
    ["a 410 with no reason (a proxy's)", { status: 410 }, { reason: "error", status: 410, detail: "HTTP 410" }],
    ["a 410 with another reason", { status: 410, json: { reason: "Elsewhere" } }, { reason: "error", status: 410, detail: "Elsewhere" }],
    ["a 400 with no reason", { status: 400 }, { reason: "invalid-message", status: 400, detail: "HTTP 400" }],
    ["400 BadDeviceToken", { status: 400, json: { reason: "BadDeviceToken" } }, { reason: "invalid-token", status: 400, detail: "BadDeviceToken" }],
    ["400 DeviceTokenNotForTopic", { status: 400, json: { reason: "DeviceTokenNotForTopic" } }, { reason: "invalid-token", status: 400, detail: "DeviceTokenNotForTopic" }],
    ["400 BadCollapseId", { status: 400, json: { reason: "BadCollapseId" } }, { reason: "invalid-message", status: 400, detail: "BadCollapseId" }],
    ["400 PayloadEmpty", { status: 400, json: { reason: "PayloadEmpty" } }, { reason: "invalid-message", status: 400, detail: "PayloadEmpty" }],
    ["400 BadPriority", { status: 400, json: { reason: "BadPriority" } }, { reason: "invalid-message", status: 400, detail: "BadPriority" }],
    ["413 PayloadTooLarge", { status: 413, json: { reason: "PayloadTooLarge" } }, { reason: "invalid-message", status: 413, detail: "PayloadTooLarge" }],
    ["403 InvalidProviderToken", { status: 403, json: { reason: "InvalidProviderToken" } }, { reason: "auth", status: 403, detail: "InvalidProviderToken" }],
    ["403 ExpiredProviderToken, that cannot be replaced yet", { status: 403, json: { reason: "ExpiredProviderToken" } }, { reason: "auth", status: 403, detail: "ExpiredProviderToken" }],
    ["403 TopicDisallowed", { status: 403, json: { reason: "TopicDisallowed" } }, { reason: "auth", status: 403, detail: "TopicDisallowed" }],
    ["400 IdleTimeout: APNs closed an idle connection, and a new one takes the same request", { status: 400, json: { reason: "IdleTimeout" } }, { reason: "unavailable", status: 400, detail: "IdleTimeout" }],
    ["429 TooManyRequests, with a Retry-After", { status: 429, headers: { "retry-after": "20" }, json: { reason: "TooManyRequests" } }, { reason: "rate-limited", status: 429, retryAfter: 20_000, detail: "TooManyRequests" }],
    ["429 TooManyProviderTokenUpdates", { status: 429, json: { reason: "TooManyProviderTokenUpdates" } }, { reason: "rate-limited", status: 429, detail: "TooManyProviderTokenUpdates" }],
    ["500 InternalServerError", { status: 500, json: { reason: "InternalServerError" } }, { reason: "unavailable", status: 500, detail: "InternalServerError" }],
    ["503 ServiceUnavailable, with a Retry-After", { status: 503, headers: { "retry-after": "2" }, json: { reason: "ServiceUnavailable" } }, { reason: "unavailable", status: 503, retryAfter: 2000, detail: "ServiceUnavailable" }],
    ["503 Shutdown", { status: 503, json: { reason: "Shutdown" } }, { reason: "unavailable", status: 503, detail: "Shutdown" }],
    ["a 502 with no JSON", { status: 502, text: "Bad Gateway" }, { reason: "unavailable", status: 502, detail: "HTTP 502" }],
    ["404 BadPath", { status: 404, json: { reason: "BadPath" } }, { reason: "error", status: 404, detail: "BadPath" }],
    ["a 200 with no apns-id", { status: 200 }, { reason: "error", status: 200, detail: "APNs answered without an apns-id." }],
  ];
  for (const [name, reply, expected] of cases) {
    test(`${name} is ${expected.reason}`, async () => {
      const apns = await startApns();
      apns.onRequest = () => reply;
      expect(await make({ apns: apnsOptions(apns) }).send(iphone, note)).toEqual({ ok: false, ...expected });
    });
  }

  test("a host that cannot be reached is `unavailable`, and a send after it works when the host is back", async () => {
    const apns = await startApns();
    const push = make({ apns: { ...apnsOptions(apns), productionUrl: await deadUrl() } });
    const result = await push.send(iphone, note);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    expect((result as Failure).status).toBeUndefined();
    expect((await push.send({ ...iphone, environment: "development" }, note)).ok).toBe(true);
  });

  test("a host that does not answer is `unavailable` after the timeout, and its connection is replaced for the next send", async () => {
    const apns = await startApns();
    let answer = false;
    apns.onRequest = () => (answer ? { headers: { "apns-id": ID } } : new Promise<Reply>(() => {}));
    const push = make({ apns: apnsOptions(apns), timeout: 150 });
    const started = Date.now();
    expect(await push.send(iphone, note)).toMatchObject({ ok: false, reason: "unavailable", detail: "APNs did not answer within 150 ms." });
    expect(Date.now() - started).toBeLessThan(2000);
    answer = true;
    expect((await push.send(iphone, note)).ok).toBe(true);
    expect(apns.sessions).toHaveLength(2);
  });
});

describe("APNs: the connection", () => {
  test("one HTTP/2 session carries every send, concurrent ones too", async () => {
    const apns = await startApns();
    apns.onRequest = async () => {
      await settle(20);
      return { headers: { "apns-id": ID } };
    };
    const push = make({ apns: apnsOptions(apns) });
    expect((await Promise.all(Array.from({ length: 10 }, () => push.send(iphone, note)))).every((result) => result.ok)).toBe(true);
    await push.send(iphone, note);
    expect(apns.sessions).toHaveLength(1);
    expect(apns.seen).toHaveLength(11);
  });

  test("a session that was closed or dropped is replaced by the next send", async () => {
    const apns = await startApns();
    const push = make({ apns: apnsOptions(apns) });
    expect((await push.send(iphone, note)).ok).toBe(true);
    apns.sessions[0]?.destroy();
    await settle(50);
    expect((await push.send(iphone, note)).ok).toBe(true);
    expect(apns.sessions).toHaveLength(2);
  });

  test("a session that got a GOAWAY is replaced by the next send", async () => {
    const apns = await startApns();
    const push = make({ apns: apnsOptions(apns) });
    expect((await push.send(iphone, note)).ok).toBe(true);
    apns.sessions[0]?.goaway();
    await settle(50);
    expect((await push.send(iphone, note)).ok).toBe(true);
    expect(apns.sessions).toHaveLength(2);
  });

  test("a session that fails with a send on it answers that send `unavailable`, and the next send reconnects", async () => {
    const apns = await startApns();
    let drop = true;
    apns.onRequest = () => {
      if (drop) {
        apns.sessions.at(-1)?.destroy();
        return new Promise<Reply>(() => {});
      }
      return { headers: { "apns-id": ID } };
    };
    const push = make({ apns: apnsOptions(apns) });
    const lost = await push.send(iphone, note);
    expect(lost).toMatchObject({ ok: false, reason: "unavailable" });
    drop = false;
    expect(await push.send(iphone, note)).toEqual({ ok: true, id: ID });
    expect(apns.sessions).toHaveLength(2);
  });
});

describe("close", () => {
  test("it ends the connection to APNs, and a send after it is `unavailable`", async () => {
    const apns = await startApns();
    const push = make({ apns: apnsOptions(apns) });
    await push.send(iphone, note);
    expect(apns.sessions[0]?.closed || apns.sessions[0]?.destroyed).toBe(false);
    await push.close();
    // The server's session learns of it a moment after the client's has closed.
    await until(() => apns.sessions[0]?.closed === true || apns.sessions[0]?.destroyed === true);
    expect(await push.send(iphone, note)).toEqual({ ok: false, reason: "unavailable", detail: "The sender was closed." });
    expect(apns.sessions).toHaveLength(1);
    expect(apns.seen).toHaveLength(1);
  });

  test("it waits for the sends in flight, to APNs and to FCM, and they get their answers", async () => {
    const google = await startGoogle();
    const apns = await startApns();
    let answered = 0;
    google.onFcm = async () => {
      await settle(80);
      answered++;
      return { json: { name: FCM_NAME } };
    };
    apns.onRequest = async () => {
      await settle(80);
      answered++;
      return { headers: { "apns-id": ID } };
    };
    const push = make({ fcm: fcmOptions(google), apns: apnsOptions(apns) });
    const sends = Promise.all([push.send(android, note), push.send(iphone, note)]);
    await until(() => google.fcm.length === 1 && apns.seen.length === 1);
    expect(answered).toBe(0);
    await push.close();
    expect(answered).toBe(2);
    expect((await sends).map((result) => result.ok)).toEqual([true, true]);
  });

  test("it can be called twice, and on a sender that has sent nothing", async () => {
    const push = createPush({ apns: { key: P8, keyId: "ABC123DEFG", teamId: "TEAM123456" } });
    await push.close();
    await push.close();
    const apns = await startApns();
    const used = make({ apns: apnsOptions(apns) });
    await used.send(iphone, note);
    await used.close();
    await used.close();
    expect(apns.sessions).toHaveLength(1);
  });
});

describe("what is a programming error", () => {
  async function refused(push: Push, token: unknown, message: unknown): Promise<string> {
    try {
      await push.send(token as PushToken, message as PushSend);
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      return (error as TypeError).message;
    }
    throw new Error("the send did not throw");
  }

  test("a token that is not a PushToken throws a TypeError, and nothing is sent", async () => {
    const google = await startGoogle();
    const apns = await startApns();
    const push = make({ fcm: fcmOptions(google), apns: apnsOptions(apns) });
    for (const token of [null, undefined, "token", 42, {}, { ...android, provider: "web" }, { ...android, token: "" }, { ...android, token: 12 }, { ...android, app: "" }, { provider: "fcm", token: "t" }, { ...iphone, environment: "staging" }]) {
      await refused(push, token, note);
    }
    expect(await refused(push, { ...iphone, environment: "staging" }, note)).toContain('"development" or "production"');
    expect([google.oauth.length, google.fcm.length, apns.seen.length]).toEqual([0, 0, 0]);
  });

  test("a message that is not a PushSend throws a TypeError, and nothing is sent", async () => {
    const google = await startGoogle();
    const apns = await startApns();
    const push = make({ fcm: fcmOptions(google), apns: apnsOptions(apns) });
    const cases: [unknown, RegExp][] = [
      [null, /is an object/],
      ["hello", /is an object/],
      [{ title: 5, body: "b" }, /`title` must be a string/],
      [{ title: "t", body: ["b"] }, /`body` must be a string/],
      [{ title: "t", url: 5 }, /`url` must be a string/],
      [{ title: "t", data: { count: 3 } }, /`data.count` must be a string/],
      [{ title: "t", data: ["a"] }, /`data` must be an object/],
      [{ title: "t", data: null }, /`data` must be an object/],
      [{ title: "t", badge: -1 }, /`badge`/],
      [{ title: "t", badge: 1.5 }, /`badge`/],
      [{ title: "t", sound: "ding" }, /`sound`/],
      [{ title: "t", priority: "urgent" }, /`priority`/],
      [{ title: "t", ttl: 1.5 }, /`ttl`/],
      [{ title: "t", ttl: -1 }, /`ttl`/],
      [{ title: "t", collapseKey: "" }, /`collapseKey`/],
      [{ title: "t", channel: 4 }, /`channel`/],
      [{ title: "t", silent: "yes" }, /`silent` must be a boolean/],
      [{ url: "/x" }, /needs a `title` or a `body`/],
      [{ data: { a: "b" } }, /needs a `title` or a `body`/],
      [{ silent: true, title: "t" }, /no `title`/],
      [{ silent: true, badge: 1 }, /no `badge`/],
      [{ silent: true, sound: "default" }, /no `sound`/],
      [{ title: "t", url: "/x", data: { url: "/y" } }, /not also in `data`/],
    ];
    for (const token of [android, iphone]) for (const [message, pattern] of cases) expect(await refused(push, token, message)).toMatch(pattern);
    expect([google.oauth.length, google.fcm.length, apns.seen.length]).toEqual([0, 0, 0]);
  });

  test("what only APNs cannot carry throws for an APNs token: the key `aps` in the data, and a topic or a collapse id that is not printable ASCII", async () => {
    const apns = await startApns();
    const google = await startGoogle();
    const push = make({ fcm: fcmOptions(google), apns: apnsOptions(apns) });
    expect(await refused(push, iphone, { ...note, data: { aps: "x" } })).toMatch(/`data.aps`/);
    expect(await refused(push, iphone, { ...note, collapseKey: "ordre é" })).toMatch(/`collapseKey` must be printable ASCII/);
    expect(await refused(push, { ...iphone, app: "io.example.é" }, note)).toMatch(/`app` must be printable ASCII/);
    expect(apns.seen).toHaveLength(0);
    // FCM carries all of it.
    expect((await push.send(android, { ...note, data: { aps: "x" }, collapseKey: "ordre é" })).ok).toBe(true);
  });

  test("a provider that was not given to createPush throws for its tokens, whatever else is configured", async () => {
    const google = await startGoogle();
    const apns = await startApns();
    expect(await refused(make({ fcm: fcmOptions(google) }), iphone, note)).toMatch(/APNs token needs `apns/);
    expect(await refused(make({ apns: apnsOptions(apns) }), android, note)).toMatch(/FCM token needs `fcm/);
    expect(await refused(make({}), android, note)).toMatch(/FCM token needs/);
    expect(await refused(createPush(), iphone, note)).toMatch(/APNs token needs/);
    // An unset environment variable is a provider that is not given: the module that makes the sender can be imported without the secrets.
    const unset = make({ fcm: { serviceAccount: undefined }, apns: { key: undefined, keyId: undefined, teamId: undefined } });
    expect(await refused(unset, android, note)).toMatch(/FCM token needs/);
    expect(await refused(make({ fcm: { serviceAccount: "" }, apns: { key: "", keyId: "", teamId: "" } }), iphone, note)).toMatch(/APNs token needs/);
    expect([google.fcm.length, apns.seen.length]).toEqual([0, 0]);
  });

  test("a provider that is given and wrong throws when the sender is made, and never quotes the secret", () => {
    const ecP384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    const rsaPem = pem(rsa.privateKey);
    expect(() => createPush({ fcm: { serviceAccount: '{"private_key": "SECRET-VALUE"' } })).toThrow(/is a string but not JSON/);
    try {
      createPush({ fcm: { serviceAccount: '{"private_key": "SECRET-VALUE"' } });
    } catch (error) {
      expect(String((error as Error).message) + String((error as Error).cause)).not.toContain("SECRET-VALUE");
    }
    expect(() => createPush({ fcm: { serviceAccount: "[]" } })).toThrow(/must be the service account key's JSON/);
    expect(() => createPush({ fcm: { serviceAccount: JSON.stringify({ ...account(), project_id: undefined }) } })).toThrow(/no `project_id`/);
    expect(() => createPush({ fcm: { serviceAccount: JSON.stringify({ ...account(), client_email: "" }) } })).toThrow(/no `client_email`/);
    expect(() => createPush({ fcm: { serviceAccount: account({ private_key: "garbage" }) } })).toThrow(/`fcm.serviceAccount.private_key` is not a PEM private key/);
    expect(() => createPush({ fcm: { serviceAccount: account({ private_key: pem(ec.privateKey) }) } })).toThrow(/must be an RSA private key for RS256/);
    expect(() => createPush({ fcm: { serviceAccount: account({ token_uri: 5 }) } })).toThrow(/token_uri/);
    expect(() => createPush({ fcm: { serviceAccount: account(), baseUrl: "ftp://fcm.example" } })).toThrow(/`fcm.baseUrl` must be an http or https URL/);
    expect(() => createPush({ fcm: { serviceAccount: account(), tokenUrl: "not a url" } })).toThrow(/`fcm.tokenUrl`/);

    const apns = { key: P8, keyId: "ABC123DEFG", teamId: "TEAM123456" };
    expect(() => createPush({ apns: { ...apns, key: "garbage" } })).toThrow(/`apns.key` is not a PEM private key/);
    expect(() => createPush({ apns: { ...apns, key: rsaPem } })).toThrow(/must be a P-256 \(prime256v1\) elliptic-curve private key for ES256, not rsa/);
    expect(() => createPush({ apns: { ...apns, key: pem(ecP384.privateKey) } })).toThrow(/not ec on secp384r1/);
    expect(() => createPush({ apns: { key: P8 } })).toThrow(/`apns.keyId` is needed beside the other two/);
    expect(() => createPush({ apns: { keyId: "ABC123DEFG", teamId: "TEAM123456" } })).toThrow(/`apns.key` is needed/);
    expect(() => createPush({ apns: { ...apns, sandboxUrl: "nope" } })).toThrow(/`apns.sandboxUrl`/);
    expect(() => createPush({ apns: { ...apns, productionUrl: "file:///x" } })).toThrow(/`apns.productionUrl`/);
    // Above 2^31 - 1 a timer of Node's fires at once, and every send would answer `unavailable`.
    for (const timeout of [0, -1, Number.NaN, Infinity, 2_147_483_648, 3e9]) expect(() => createPush({ timeout })).toThrow(/`timeout`/);
    expect(() => createPush({ timeout: 2_147_483_647 })).not.toThrow();
  });
});
