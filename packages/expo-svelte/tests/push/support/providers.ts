import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo, Socket } from "node:net";

/**
 * Local stand-ins for the providers, for the tests of the command line (`cli.test.ts`): a plain HTTP server that is both Google's token endpoint (`/token`) and FCM
 * (`/v1/projects/…`), and a cleartext HTTP/2 server for APNs. Each records what it was sent and answers what a test tells it to. Nothing leaves the machine, and every key is
 * generated here: no credential of anyone's is in the repository. (The sender's own tests, `server.test.ts`, have stand-ins of their own, which this file does not replace.)
 */
export type Seen = { method: string; path: string; headers: IncomingHttpHeaders; text: string };
export type Reply = { status?: number; headers?: Record<string, string>; json?: unknown; text?: string };
export type Handler = (seen: Seen) => Reply | Promise<Reply>;

// Keys: the service account's RSA key and the `.p8`'s P-256 key, with their public halves, which the tests verify the signatures with.
export const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const pem = (key: KeyObject): string => key.export({ type: "pkcs8", format: "pem" }).toString();
export const P8 = pem(ec.privateKey);
export const RSA_PEM = pem(rsa.privateKey);
/** A key of the wrong kind for each provider. */
export const WRONG_FOR_APNS = RSA_PEM;
export const WRONG_FOR_FCM = P8;

export const KEY_ID = "ABC123DEFG";
export const TEAM_ID = "TEAM123456";

export const serviceAccount = (extra: Record<string, unknown> = {}) => ({
  type: "service_account",
  project_id: "test-project",
  private_key_id: "0123456789abcdef",
  private_key: RSA_PEM,
  client_email: "push@test-project.iam.gserviceaccount.com",
  ...extra,
});

export type Jwt = { header: Record<string, unknown>; claims: Record<string, unknown>; signature: Buffer; signed: Buffer };
export function decode(jwt: string): Jwt {
  const [header, claims, signature] = jwt.split(".") as [string, string, string];
  return {
    header: JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<string, unknown>,
    claims: JSON.parse(Buffer.from(claims, "base64url").toString("utf8")) as Record<string, unknown>,
    signature: Buffer.from(signature, "base64url"),
    signed: Buffer.from(`${header}.${claims}`),
  };
}
export const verifiesRs256 = (jwt: Jwt): boolean => verify("sha256", jwt.signed, rsa.publicKey, jwt.signature);
export const verifiesEs256 = (jwt: Jwt): boolean => verify("sha256", jwt.signed, { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, jwt.signature);

const listen = (server: Server | Http2Server): Promise<string> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

export type Google = {
  url: string;
  /** What the token endpoint (`/token`) was sent, and what FCM (everything else) was. */
  oauth: Seen[];
  fcm: Seen[];
  /** A good answer of the token endpoint: a new access token each time. */
  token(expiresIn?: number): Reply;
  onToken: Handler;
  onFcm: Handler;
};

export type Apns = { url: string; seen: Seen[]; sessions: ServerHttp2Session[]; onRequest: Handler };

export const FCM_NAME = "projects/test-project/messages/0:1700000000%31bd1c96";
export const APNS_ID = "11111111-2222-3333-4444-555555555555";

/** The stand-ins a test starts, and `stop()`, which ends them all (call it in an `afterEach`). */
export function mockProviders() {
  const cleanups: (() => Promise<void> | void)[] = [];
  return {
    async google(): Promise<Google> {
      let issued = 0;
      const google: Google = {
        url: "",
        oauth: [],
        fcm: [],
        token: (expiresIn = 3600) => ({ json: { access_token: `ya29.token-${++issued}`, expires_in: expiresIn, token_type: "Bearer" } }),
        onToken: () => google.token(),
        onFcm: () => ({ json: { name: FCM_NAME } }),
      };
      const sockets = new Set<Socket>();
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const seen: Seen = { method: request.method ?? "", path: request.url ?? "", headers: request.headers, text: Buffer.concat(chunks).toString("utf8") };
        const isToken = seen.path === "/token";
        (isToken ? google.oauth : google.fcm).push(seen);
        const reply = await (isToken ? google.onToken(seen) : google.onFcm(seen));
        response.writeHead(reply.status ?? 200, { "content-type": reply.json === undefined ? "text/plain" : "application/json", ...reply.headers });
        response.end(reply.text ?? (reply.json === undefined ? "" : JSON.stringify(reply.json)));
      });
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      google.url = await listen(server);
      cleanups.push(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
      });
      return google;
    },

    async apns(): Promise<Apns> {
      const apns: Apns = { url: "", seen: [], sessions: [], onRequest: () => ({ headers: { "apns-id": APNS_ID } }) };
      const server = createHttp2Server();
      server.on("session", (session) => {
        apns.sessions.push(session);
        session.on("error", () => undefined);
      });
      server.on("stream", async (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        const seen: Seen = { method: String(headers[":method"]), path: String(headers[":path"]), headers, text: Buffer.concat(chunks).toString("utf8") };
        apns.seen.push(seen);
        const reply = await apns.onRequest(seen);
        if (stream.destroyed || stream.closed) return;
        stream.respond({ ":status": reply.status ?? 200, ...reply.headers });
        stream.end(reply.text ?? (reply.json === undefined ? undefined : JSON.stringify(reply.json)));
      });
      apns.url = await listen(server);
      cleanups.push(async () => {
        for (const session of apns.sessions) session.destroy();
        await new Promise((resolve) => server.close(resolve));
      });
      return apns;
    },

    /** A URL nothing listens at: a port that was just released. */
    async dead(): Promise<string> {
      const server = createServer();
      const url = await listen(server);
      await new Promise((resolve) => server.close(resolve));
      return url;
    },

    async stop(): Promise<void> {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    },
  };
}

/** APNs's refusal of a request: its status and `{ "reason": … }`. */
export const apnsReason = (status: number, reason: string, headers: Record<string, string> = {}): Reply => ({ status, headers, json: { reason } });

/** The environment of a server that has both providers, pointed at the stand-ins. */
export function serverEnv(google: Google, apns: Apns, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    FCM_SERVICE_ACCOUNT: JSON.stringify(serviceAccount({ token_uri: "https://unused.example/token" })),
    FCM_BASE_URL: google.url,
    FCM_TOKEN_URL: `${google.url}/token`,
    APNS_KEY: P8,
    APNS_KEY_ID: KEY_ID,
    APNS_TEAM_ID: TEAM_ID,
    APNS_PRODUCTION_URL: apns.url,
    APNS_SANDBOX_URL: apns.url,
    ...extra,
  };
}
