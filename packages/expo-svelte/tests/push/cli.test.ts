// `expo-svelte doctor --server` and `expo-svelte push send` (src/doctor/server.ts, src/push/cli.ts) against local stand-ins for Google and Apple: what each says to a provider that
// accepts the credentials and to one that refuses them, what each prints (never a key or a token), and the exit statuses. The sender itself is in server.test.ts.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { formatReport, runDoctor } from "../../src/doctor/index.ts";
import type { Check } from "../../src/doctor/checks.ts";
import { runPush } from "../../src/push/cli.ts";
import { createProject } from "../support/project.ts";
import { APNS_ID, apnsReason, decode, KEY_ID, mockProviders, P8, RSA_PEM, serverEnv, serviceAccount, TEAM_ID, verifiesEs256, verifiesRs256, WRONG_FOR_APNS, WRONG_FOR_FCM, type Apns, type Google, type Seen } from "./support/providers.ts";

const mocks = mockProviders();
afterEach(() => mocks.stop());

const capture = () => {
  const parts: string[] = [];
  return { write: (text: string) => { parts.push(text); }, text: () => parts.join("") };
};
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error("until: the condition did not come true");
    await settle(5);
  }
}

/** A directory the commands run in (and resolve paths from). */
const scratch = () => createProject({}, "push-cli-");

type Env = Record<string, string | undefined>;

/** What a secret looks like in output: the key's own text (a line of its base64 body), a token the stand-ins issued, a signed JWT. None of it may be printed. */
const bodyLine = (pem: string) => pem.split("\n")[2] ?? "";
function expectNoSecrets(text: string, ...extra: string[]): void {
  for (const secret of [bodyLine(P8), bodyLine(RSA_PEM), "BEGIN PRIVATE KEY", "ya29.", "eyJ", ...extra]) expect(text, secret).not.toContain(secret);
}

/** `expo-svelte doctor` with these arguments (`--server` by default), as the command prints it. */
async function doctor(env: Env, args: string[] = ["--server"], cwd = process.cwd()): Promise<{ status: number; text: string }> {
  const out = capture();
  const status = await runDoctor(cwd, args, out, {}, { env, cwd, timeout: 3000 });
  return { status, text: out.text() };
}
type Report = { ok: boolean; server?: boolean; checks: Check[] };
/** The same run with `--json`, parsed; `text` is the report as the text mode prints it, made of the same checks. */
async function inspect(env: Env, args: string[] = [], cwd = process.cwd()): Promise<{ status: number; report: Report; checks: Check[]; text: string }> {
  const { status, text } = await doctor(env, ["--server", ...args, "--json"], cwd);
  const report = JSON.parse(text) as Report;
  return { status, report, checks: report.checks, text: formatReport(report.checks, { title: "expo-svelte doctor --server" }) };
}
const line = (text: string, start: string): string => text.split("\n").find((entry) => entry.trim().startsWith(start)) ?? `(no line starts with ${start})`;
const statusOf = (checks: Check[], text: string) => checks.find((check) => check.message.includes(text))?.status;
const failuresOf = (checks: Check[]) => checks.filter((check) => check.status === "fail");

describe("doctor --server: providers that accept the credentials", () => {
  test("both pass: the key loads, a token request is made to Google's token endpoint and one request to the APNs sandbox", async () => {
    const google = await mocks.google();
    const sandbox = await mocks.apns();
    const production = await mocks.apns();
    sandbox.onRequest = () => apnsReason(400, "BadDeviceToken");
    const env = serverEnv(google, sandbox, { APNS_PRODUCTION_URL: production.url });
    const { status, text } = await doctor(env);
    expect(status).toBe(0);
    expect(text).toContain("expo-svelte doctor --server\n");
    expect(text).toContain("\npush server\n");
    expect(text).toContain("FCM_SERVICE_ACCOUNT is a service account key for project test-project (push@test-project.iam.gserviceaccount.com) with a private key that loads as RSA");
    expect(text).toContain(`APNS_KEY loads as a P-256 key; key id ${KEY_ID}, team id ${TEAM_ID}`);
    expect(text).toContain("accepted the credentials: it signed in the provider token and then answered BadDeviceToken");
    expect(text).toMatch(/4 passed, 0 failed, 0 could not tell, 0 skipped\n$/);

    // One token request, signed with the service account's key, for the token endpoint the variable names. Nothing was sent to FCM itself.
    expect(google.oauth).toHaveLength(1);
    expect(google.fcm).toHaveLength(0);
    const form = new URLSearchParams(google.oauth[0]?.text);
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    const assertion = decode(form.get("assertion") ?? "");
    expect(assertion.header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(assertion.claims).toMatchObject({ iss: "push@test-project.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/firebase.messaging", aud: `${google.url}/token` });
    expect(verifiesRs256(assertion)).toBe(true);

    // One request to the sandbox host, a provider token signed with the `.p8`, a device token that cannot exist, and the placeholder topic. None to production.
    expect(production.seen).toHaveLength(0);
    expect(sandbox.seen).toHaveLength(1);
    const [request] = sandbox.seen as [Seen];
    expect(request.method).toBe("POST");
    expect(request.path).toBe(`/3/device/${"0".repeat(64)}`);
    expect(request.headers["apns-topic"]).toBe("com.example.expo-svelte-doctor");
    const provider = decode(String(request.headers.authorization).replace(/^bearer /i, ""));
    expect(provider.header).toEqual({ alg: "ES256", kid: KEY_ID });
    expect(provider.claims.iss).toBe(TEAM_ID);
    expect(verifiesEs256(provider)).toBe(true);

    // Neither the keys nor what they signed, nor the access token, is in the report.
    expectNoSecrets(text, form.get("assertion") ?? "", String(request.headers.authorization));
    // The sandbox's session is closed again: the command does not leave a connection open.
    await until(() => sandbox.sessions.every((session) => session.closed || session.destroyed));
    // The same checks as JSON.
    expect((await inspect(env)).checks.map((check) => check.status)).toEqual(["pass", "pass", "pass", "pass"]);
  });

  test("--app is the topic of the APNs request", async () => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    apns.onRequest = () => apnsReason(400, "BadDeviceToken");
    await doctor(serverEnv(google, apns), ["--server", "--app", "io.example.app"]);
    expect(apns.seen[0]?.headers["apns-topic"]).toBe("io.example.app");
    await doctor(serverEnv(google, apns), ["--server", "--app=io.example.two"]);
    expect(apns.seen[1]?.headers["apns-topic"]).toBe("io.example.two");
  });

  test("DeviceTokenNotForTopic is as good a sign as BadDeviceToken: APNs read the key and the topic", async () => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    apns.onRequest = () => apnsReason(400, "DeviceTokenNotForTopic");
    expect(statusOf((await inspect(serverEnv(google, apns))).checks, "accepted the credentials")).toBe("pass");
  });

  test("a provider whose variables are unset is skipped, and the other is checked alone", async () => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    apns.onRequest = () => apnsReason(400, "BadDeviceToken");
    const noApns = await inspect(serverEnv(google, apns, { APNS_KEY: undefined, APNS_KEY_ID: "", APNS_TEAM_ID: "  " }));
    expect(noApns.status).toBe(0);
    expect(noApns.checks.map((check) => check.status)).toEqual(["pass", "pass", "skip"]);
    expect(noApns.text).toContain("skip  APNS_KEY is not set: APNs (iOS) is not configured here, nothing to check");
    expect(apns.seen).toHaveLength(0);
    const noFcm = await inspect(serverEnv(google, apns, { FCM_SERVICE_ACCOUNT: undefined }));
    expect(noFcm.status).toBe(0);
    expect(noFcm.checks.map((check) => check.status)).toEqual(["skip", "pass", "pass"]);
    expect(google.oauth).toHaveLength(1);
  });

  test("with neither provider configured it fails: a server that cannot send is not a server that is fine", async () => {
    const { status, text } = await doctor({});
    expect(status).toBe(1);
    expect(text).toContain("skip  FCM_SERVICE_ACCOUNT is not set");
    expect(text).toContain("skip  APNS_KEY is not set");
    expect(text).toContain("FAIL  no push provider is configured in this environment: neither FCM_SERVICE_ACCOUNT nor APNS_KEY is set");
  });

  test("the keys are read from files too: a path, relative to the directory the command runs in, and a PEM whose line breaks are written as \\n", async () => {
    using project = scratch();
    const google = await mocks.google();
    const apns = await mocks.apns();
    apns.onRequest = () => apnsReason(400, "BadDeviceToken");
    project.write("keys/service-account.json", JSON.stringify(serviceAccount()));
    project.write("keys/AuthKey_ABC123DEFG.p8", P8);
    const fromFiles = await inspect(serverEnv(google, apns, { FCM_SERVICE_ACCOUNT: "keys/service-account.json", APNS_KEY: join(project.directory, "keys/AuthKey_ABC123DEFG.p8") }), [], project.directory);
    expect(fromFiles.status).toBe(0);
    expect(fromFiles.checks.find((check) => check.message.startsWith("FCM_SERVICE_ACCOUNT"))?.details).toEqual([`read from the file ${join(project.directory, "keys/service-account.json")}`, "createPush takes the file's contents, not its path: the server's own variable must hold the text"]);
    expect(fromFiles.checks.find((check) => check.message.startsWith("APNS_KEY"))?.details).toEqual([`read from the file ${join(project.directory, "keys/AuthKey_ABC123DEFG.p8")}`, "createPush takes the file's contents, not its path: the server's own variable must hold the text"]);
    const escaped = await doctor(serverEnv(google, apns, { APNS_KEY: P8.trim().replaceAll("\n", "\\n") }));
    expect(escaped.status).toBe(0);
    expect(escaped.text).toContain("read from the variable's text");
  });
});

describe("doctor --server: FCM refuses the key", () => {
  const refuse = async (error: string, description: string, status = 400) => {
    const google = await mocks.google();
    google.onToken = () => ({ status, json: { error, error_description: description } });
    const apns = await mocks.apns();
    const result = await inspect(serverEnv(google, apns, { APNS_KEY: undefined, APNS_KEY_ID: undefined, APNS_TEAM_ID: undefined }));
    return { ...result, failure: failuresOf(result.checks)[0] };
  };

  test("a signature Google does not know: the key was deleted or disabled", async () => {
    const { status, failure } = await refuse("invalid_grant", "Invalid JWT Signature.");
    expect(status).toBe(1);
    expect(failure?.message).toContain("refused the key (HTTP 400): Invalid JWT Signature.");
    expect(failure?.fix).toContain("deleted or disabled");
  });

  test("timestamps Google does not accept: the clock is off", async () => {
    const { failure } = await refuse("invalid_grant", "Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe. Check your iat and exp values in the JWT claim.");
    expect(failure?.fix).toContain("this machine's clock is off");
  });

  test("a service account that is gone, and one Google does not know", async () => {
    expect((await refuse("invalid_grant", "Invalid grant: account not found")).failure?.fix).toContain("deleted or disabled");
    expect((await refuse("invalid_client", "The OAuth client was not found.", 401)).failure?.fix).toContain("client_email");
    expect((await refuse("invalid_grant", "something new")).failure?.fix).toContain("revoked or disabled");
  });

  test("a token endpoint that cannot be reached is a failure, with the cause and what the server must reach", async () => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    const dead = await mocks.dead();
    const { status, checks } = await inspect(serverEnv(google, apns, { FCM_TOKEN_URL: `${dead}/token`, APNS_KEY: undefined, APNS_KEY_ID: undefined, APNS_TEAM_ID: undefined }));
    expect(status).toBe(1);
    const failure = failuresOf(checks)[0];
    expect(failure?.message).toMatch(/^could not get an access token from 127\.0\.0\.1:\d+: The token request to .* failed: /);
    expect(failure?.fix).toContain("must reach 127.0.0.1");
  });

  test("an endpoint that rate limits is `could not tell`, which does not fail it; a 500 does", async () => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    const env = serverEnv(google, apns, { APNS_KEY: undefined, APNS_KEY_ID: undefined, APNS_TEAM_ID: undefined });
    google.onToken = () => ({ status: 429, json: { error: "rate_limit_exceeded" } });
    const limited = await inspect(env);
    expect([limited.status, limited.checks.map((check) => check.status)]).toEqual([0, ["pass", "unknown", "skip"]]);
    google.onToken = () => ({ status: 503, text: "down" });
    expect((await inspect(env)).status).toBe(1);
  });
});

describe("doctor --server: APNs refuses the credentials", () => {
  /** The doctor against an APNs that answers `status` and `reason` to everything; FCM is left out of it. */
  const refuse = async (status: number, reason: string, args: string[] = []) => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    apns.onRequest = () => apnsReason(status, reason);
    return inspect(serverEnv(google, apns, { FCM_SERVICE_ACCOUNT: undefined }), args);
  };
  const failureOf = async (status: number, reason: string) => failuresOf((await refuse(status, reason)).checks)[0];

  test("InvalidProviderToken (403): the key, its id and the team do not belong together", async () => {
    const result = await refuse(403, "InvalidProviderToken");
    expect(result.status).toBe(1);
    expect(result.text).toContain("refused the credentials (HTTP 403): InvalidProviderToken");
    expect(result.text).toContain("fix: APNs does not accept the key with this key id and team id: APNS_KEY_ID must be the id of this very key");
    expectNoSecrets(result.text);
  });

  test("ExpiredProviderToken (403): the provider token is signed with the current time, so the clock is off; the sender does not renew a token it has just made", async () => {
    expect((await failureOf(403, "ExpiredProviderToken"))?.fix).toContain("this machine's clock is off");
  });

  test("the other 403s are the credentials too", async () => {
    for (const reason of ["Forbidden", "MissingProviderToken", "BadCertificate"]) expect((await failureOf(403, reason))?.message, reason).toContain(`(HTTP 403): ${reason}`);
  });

  test("a topic APNs refuses is `could not tell` without --app (the topic is a placeholder), and a failure with it", async () => {
    for (const reason of ["TopicDisallowed", "BadTopic", "MissingTopic"]) {
      const placeholder = await refuse(400, reason);
      expect(placeholder.status).toBe(0);
      expect(placeholder.text).toContain("????  ");
      expect(placeholder.text).toContain(`answered ${reason} to the placeholder topic com.example.expo-svelte-doctor`);
      expect(placeholder.text).toContain("fix: run again with --app <the app's bundle id>");
      const given = await refuse(400, reason, ["--server", "--app", "io.example.app"]);
      expect(given.status).toBe(1);
      expect(given.text).toContain(`answered ${reason} for the topic io.example.app: the key's team cannot push to it`);
    }
  });

  test("an APNs that cannot be reached is a failure; a 429 is `could not tell`", async () => {
    const google = await mocks.google();
    const dead = await mocks.dead();
    const unreachable = await inspect(serverEnv(google, await mocks.apns(), { FCM_SERVICE_ACCOUNT: undefined, APNS_SANDBOX_URL: dead }));
    expect(unreachable.status).toBe(1);
    expect(unreachable.text).toMatch(/could not get an answer to the credentials from 127\.0\.0\.1:\d+/);
    const limited = await refuse(429, "TooManyRequests");
    expect(limited.status).toBe(0);
    expect(limited.text).toContain("is rate limiting requests (TooManyRequests)");
  });

  test("an answer that is none of the above is a failure that says what it was", async () => {
    const failure = await failureOf(500, "InternalServerError");
    expect(failure?.message).toContain("could not get an answer to the credentials from");
    expect(failure?.message).toContain("InternalServerError (HTTP 500)");
  });
});

describe("doctor --server: variables that do not load", () => {
  /** A secret-looking text that is not a key: if it is ever printed, `expectNoSecrets` and these tests see it. */
  const garbage = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSECRETSECRETSECRETSECRET";
  const run = async (extra: Env) => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    const result = await inspect(serverEnv(google, apns, extra));
    return { ...result, google, apns, failures: failuresOf(result.checks) };
  };

  test("a service account that is not JSON, not an object, or short of a field fails, and no request is made", async () => {
    for (const [value, problem] of [
      [`{ ${garbage}`, "is not JSON"],
      [JSON.stringify([1]), "must be the service account key's JSON object"],
      [JSON.stringify({ project_id: "p", client_email: "e" }), "has no `private_key`"],
      [JSON.stringify({ project_id: "p", private_key: RSA_PEM }), "has no `client_email`"],
      [JSON.stringify({ client_email: "e", private_key: RSA_PEM }), "has no `project_id`"],
      [JSON.stringify(serviceAccount({ token_uri: 5 })), "has a `token_uri` that is not a string"],
      [JSON.stringify(serviceAccount({ token_uri: "ftp://example.test/token" })), "has a `token_uri` that is not an http or https URL"],
    ] as const) {
      const { failures, google, text } = await run({ FCM_SERVICE_ACCOUNT: value });
      expect(failures[0]?.message, problem).toContain(`FCM_SERVICE_ACCOUNT (the variable's text) ${problem}`);
      expect(google.oauth).toHaveLength(0);
      expectNoSecrets(text, garbage);
    }
  });

  test("a private key that is not an RSA key (an EC key, a PEM of nothing) fails without quoting it", async () => {
    const wrongKind = await run({ FCM_SERVICE_ACCOUNT: JSON.stringify(serviceAccount({ private_key: WRONG_FOR_FCM })) });
    expect(wrongKind.failures[0]?.message).toContain("the private_key of FCM_SERVICE_ACCOUNT must be an RSA private key for RS256, not ec on prime256v1");
    const nothing = await run({ FCM_SERVICE_ACCOUNT: JSON.stringify(serviceAccount({ private_key: `-----BEGIN PRIVATE KEY-----\n${garbage}\n-----END PRIVATE KEY-----\n` })) });
    expect(nothing.failures[0]?.message).toContain("the private_key of FCM_SERVICE_ACCOUNT is not a PEM private key");
    expectNoSecrets(nothing.text, garbage);
    expect(wrongKind.google.oauth).toHaveLength(0);
  });

  test("a value that is neither JSON nor a file that exists does not quote the value", async () => {
    const { failures, text } = await run({ FCM_SERVICE_ACCOUNT: garbage });
    expect(failures[0]?.message).toContain("FCM_SERVICE_ACCOUNT is neither the service account key's JSON nor the path of a file that can be read (no such file, from ");
    expect(text).not.toContain(garbage);
  });

  test("a key of the wrong kind for APNs, a PEM of nothing, or a path that is not a file", async () => {
    expect((await run({ APNS_KEY: WRONG_FOR_APNS })).failures[0]?.message).toContain("APNS_KEY must be a P-256 (prime256v1) elliptic-curve private key for ES256, not rsa");
    const nothing = await run({ APNS_KEY: `-----BEGIN PRIVATE KEY-----\n${garbage}\n-----END PRIVATE KEY-----\n` });
    expect(nothing.failures[0]?.message).toContain("APNS_KEY is not a PEM private key");
    expect(nothing.text).not.toContain(garbage);
    const path = await run({ APNS_KEY: garbage });
    expect(path.failures[0]?.message).toContain("APNS_KEY is neither the .p8 key's PEM nor the path of a file that can be read");
    expect(path.text).not.toContain(garbage);
    expect(path.apns.seen).toHaveLength(0);
  });

  test("APNS_KEY_ID and APNS_TEAM_ID are ten letters and digits, and the three come together", async () => {
    expect((await run({ APNS_KEY_ID: "SHORT" })).failures[0]?.message).toBe("APNS_KEY_ID must be 10 letters and digits (it has 5 characters)");
    expect((await run({ APNS_TEAM_ID: "TEAM-12345" })).failures[0]?.message).toBe("APNS_TEAM_ID must be 10 letters and digits (it has 10 characters)");
    expect((await run({ APNS_KEY_ID: undefined })).failures[0]?.message).toBe("APNS_KEY_ID is not set: APNs needs APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID together");
    expect((await run({ APNS_KEY_ID: "", APNS_TEAM_ID: "" })).failures[0]?.message).toBe("APNS_KEY_ID and APNS_TEAM_ID are not set: APNs needs APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID together");
  });

  test("an endpoint override that is not an http(s) URL is named, not quoted (it may carry a password)", async () => {
    const result = await run({ FCM_BASE_URL: "ftp://user:hunter2@example.test", APNS_SANDBOX_URL: "not a url" });
    expect(result.failures.map((check) => check.message)).toEqual(["FCM_BASE_URL must be an http or https URL", "APNS_SANDBOX_URL must be an http or https URL"]);
    expect(result.text).not.toContain("hunter2");
  });
});

describe("doctor --server: its arguments and its output", () => {
  test("--json prints the checks, whether they all hold, and that it is the server's", async () => {
    const google = await mocks.google();
    const apns = await mocks.apns();
    apns.onRequest = () => apnsReason(400, "BadDeviceToken");
    const { status, text } = await doctor(serverEnv(google, apns), ["--server", "--json"]);
    expect(status).toBe(0);
    const report = JSON.parse(text) as Report;
    expect(report).toMatchObject({ ok: true, server: true });
    expect(report).not.toHaveProperty("appRoot");
    expect(report.checks.every((check) => check.group === "push server")).toBe(true);
    expectNoSecrets(text);
    const failing = await doctor(serverEnv(google, apns, { APNS_KEY_ID: "x" }), ["--json", "--server"]);
    expect([failing.status, (JSON.parse(failing.text) as Report).ok]).toEqual([1, false]);
  });

  test("an unknown argument, --app without its value or without --server, exit 2 with the usage; --help prints it", async () => {
    for (const [args, message] of [
      [["--server", "--fix"], "Unknown argument --fix"],
      [["--server", "--app"], "--app needs the app's bundle id"],
      [["--server", "--app", "--json"], "--app needs the app's bundle id"],
      [["--server", "--app="], "--app needs the app's bundle id"],
      [["--server", "--app", "io example"], "--app must be the app's bundle id (printable ASCII, no spaces)"],
      [["--app", "io.example.app"], "--app goes with --server"],
    ] as const) {
      const result = await doctor({}, [...args]);
      expect([result.status, result.text.split("\n")[0]], args.join(" ")).toEqual([2, message]);
      expect(result.text).toContain("Usage: expo-svelte doctor [--json]\n       expo-svelte doctor --server [--app <bundle id>] [--json]");
    }
    const help = await doctor({}, ["--server", "--help"]);
    expect(help.status).toBe(0);
    expect(help.text).toContain("FCM_SERVICE_ACCOUNT (the service account key's JSON, or the path of");
  });

  test("it writes nothing into the directory it runs in", async () => {
    using project = scratch();
    const google = await mocks.google();
    const apns = await mocks.apns();
    apns.onRequest = () => apnsReason(400, "BadDeviceToken");
    await doctor(serverEnv(google, apns), ["--server"], project.directory);
    expect(readdirSync(project.directory)).toEqual([]);
  });
});

// `push send`

const FCM_TOKEN = JSON.stringify({ provider: "fcm", token: "fcm-registration-token", app: "io.example.app" });
const APNS_HEX = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const APNS_TOKEN = JSON.stringify({ provider: "apns", token: APNS_HEX, environment: "production", app: "io.example.app" });

async function providers(): Promise<{ google: Google; apns: Apns; env: Env }> {
  const google = await mocks.google();
  const apns = await mocks.apns();
  return { google, apns, env: serverEnv(google, apns) };
}
async function send(args: string[], env: Env, cwd = process.cwd()): Promise<{ status: number; out: string; err: string }> {
  const out = capture();
  const err = capture();
  const status = await runPush(cwd, args, { out, err, env, cwd, timeout: 3000 });
  return { status, out: out.text(), err: err.text() };
}
const bodyOf = (seen: Seen | undefined): Record<string, unknown> => JSON.parse(seen?.text ?? "{}") as Record<string, unknown>;

describe("push send: a message to FCM", () => {
  test("a notification with a link and data reaches FCM as the sender maps it, and the result is the message id (exit 0)", async () => {
    const { google, env } = await providers();
    const result = await send(["send", "--token", FCM_TOKEN, "--title", "Order ready", "--body", "Pickup at gate 3", "--url", "/orders/42", "--data", "order=42", "--data", "note=a=b", "--data", "toString=1", "--data", "valueOf=2", "--collapse-key", "orders", "--priority", "high", "--ttl", "60", "--channel", "orders", "--sound", "none"], env);
    expect(result).toEqual({ status: 0, out: "sent to fcm (io.example.app): 0:1700000000%31bd1c96\n", err: "" });
    expect(google.fcm).toHaveLength(1);
    expect(google.fcm[0]?.path).toBe("/v1/projects/test-project/messages:send");
    expect(google.fcm[0]?.headers.authorization).toBe("Bearer ya29.token-1");
    expect(bodyOf(google.fcm[0])).toEqual({
      message: {
        token: "fcm-registration-token",
        // Keys named like members of Object.prototype are keys like any other.
        data: { order: "42", note: "a=b", toString: "1", valueOf: "2", url: "/orders/42" },
        android: { collapse_key: "orders", priority: "HIGH", ttl: "60s", notification: { title: "Order ready", body: "Pickup at gate 3", channel_id: "orders" } },
      },
    });
  });

  test("--json prints the SendResult", async () => {
    const { env } = await providers();
    const result = await send(["send", "--token", FCM_TOKEN, "--title", "Hi", "--json"], env);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ ok: true, id: "0:1700000000%31bd1c96" });
  });

  test("a raw token with its provider and app, the flags written --flag=value", async () => {
    const { google, env } = await providers();
    const result = await send(["send", "--token=raw-fcm-token", "--provider=fcm", "--app=io.example.app", "--silent"], env);
    expect(result.status).toBe(0);
    // A silent message is data only: FCM is given no `notification`, so it hands the message to the app's service.
    expect(bodyOf(google.fcm[0])).toEqual({ message: { token: "raw-fcm-token" } });
  });

  test("a token FCM says is gone: exit 1, the reason, the status and what to do", async () => {
    const { google, env } = await providers();
    google.onFcm = () => ({ status: 404, json: { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } } });
    const text = await send(["send", "--token", FCM_TOKEN, "--title", "Hi"], env);
    expect(text.status).toBe(1);
    expect(text.out).toBe("not sent (fcm, io.example.app): gone (HTTP 404): Requested entity was not found.\nthe token will never work again (uninstalled, expired, unregistered): delete it\n");
    const json = await send(["send", "--token", FCM_TOKEN, "--title", "Hi", "--json"], env);
    expect(json.status).toBe(1);
    expect(JSON.parse(json.out)).toEqual({ ok: false, reason: "gone", status: 404, detail: "Requested entity was not found." });
  });

  test("credentials FCM refuses are `auth`, with the doctor named; a rate limit says when to try again", async () => {
    const { google, env } = await providers();
    google.onToken = () => ({ status: 400, json: { error: "invalid_grant", error_description: "Invalid JWT Signature." } });
    const auth = await send(["send", "--token", FCM_TOKEN, "--title", "Hi"], env);
    expect(auth.status).toBe(1);
    expect(auth.out).toContain("not sent (fcm, io.example.app): auth (HTTP 400): Invalid JWT Signature.");
    expect(auth.out).toContain("run `expo-svelte doctor --server`");
    google.onToken = () => google.token();
    google.onFcm = () => ({ status: 429, headers: { "retry-after": "30" }, json: { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } } });
    const limited = await send(["send", "--token", FCM_TOKEN, "--title", "Hi"], env);
    expect(limited.status).toBe(1);
    expect(limited.out).toContain("rate-limited (HTTP 429): Quota exceeded.\nretry after 30000 ms\ntry again later\n");
  });

  test("a provider that cannot be reached is `unavailable` (exit 1), not an error of the command", async () => {
    const { google, env } = await providers();
    const dead = await mocks.dead();
    const result = await send(["send", "--token", FCM_TOKEN, "--title", "Hi", "--json"], { ...env, FCM_BASE_URL: dead });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.out)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(google.fcm).toHaveLength(0);
  });
});

describe("push send: a message to APNs", () => {
  test("the PushToken's environment picks the host: development goes to the sandbox, a raw production token to production", async () => {
    const sandbox = await mocks.apns();
    const production = await mocks.apns();
    const google = await mocks.google();
    const env = serverEnv(google, sandbox, { APNS_PRODUCTION_URL: production.url });
    const development = await send(["send", "--token", JSON.stringify({ provider: "apns", token: APNS_HEX, environment: "development", app: "io.example.app" }), "--title", "Order ready", "--body", "Pickup at gate 3"], env);
    expect(development).toEqual({ status: 0, out: `sent to apns (io.example.app): ${APNS_ID}\n`, err: "" });
    expect([sandbox.seen.length, production.seen.length]).toEqual([1, 0]);
    const raw = await send(["send", "--token", APNS_HEX, "--provider", "apns", "--app", "io.example.app", "--environment", "production", "--title", "Hi"], env);
    expect(raw.status).toBe(0);
    expect([sandbox.seen.length, production.seen.length]).toEqual([1, 1]);
  });

  test("the request: topic, push type, priority, collapse id, expiration, the provider token signed with the .p8, and the payload with the data beside aps", async () => {
    const { apns, env } = await providers();
    const result = await send(["send", "--token", APNS_TOKEN, "--title", "Order ready", "--body", "Pickup at gate 3", "--url", "/orders/42", "--data", "order=42", "--badge", "3", "--collapse-key", "orders", "--priority", "normal", "--ttl", "0"], env);
    expect(result.status).toBe(0);
    const [request] = apns.seen as [Seen];
    expect(request.path).toBe(`/3/device/${APNS_HEX}`);
    expect(request.headers).toMatchObject({ "apns-topic": "io.example.app", "apns-push-type": "alert", "apns-priority": "5", "apns-collapse-id": "orders", "apns-expiration": "0" });
    const provider = decode(String(request.headers.authorization).replace(/^bearer /i, ""));
    expect(provider.header).toEqual({ alg: "ES256", kid: KEY_ID });
    expect(provider.claims.iss).toBe(TEAM_ID);
    expect(verifiesEs256(provider)).toBe(true);
    expect(bodyOf(request)).toEqual({ order: "42", url: "/orders/42", aps: { alert: { title: "Order ready", body: "Pickup at gate 3" }, badge: 3, sound: "default" } });
    expectNoSecrets(result.out + result.err);
  });

  test("--silent is a background push: content-available, push type background, priority 5, no alert", async () => {
    const { apns, env } = await providers();
    expect((await send(["send", "--token", APNS_TOKEN, "--silent", "--data", "inbox=7", "--priority", "high"], env)).status).toBe(0);
    const [request] = apns.seen as [Seen];
    expect(request.headers).toMatchObject({ "apns-push-type": "background", "apns-priority": "5" });
    expect(bodyOf(request)).toEqual({ inbox: "7", aps: { "content-available": 1 } });
  });

  test("a token APNs says is gone: exit 1 with the reason; credentials it refuses: `auth`; BadDeviceToken: invalid-token", async () => {
    const { apns, env } = await providers();
    apns.onRequest = () => apnsReason(410, "Unregistered");
    const gone = await send(["send", "--token", APNS_TOKEN, "--title", "Hi", "--json"], env);
    expect([gone.status, JSON.parse(gone.out)]).toEqual([1, { ok: false, reason: "gone", status: 410, detail: "Unregistered" }]);
    apns.onRequest = () => apnsReason(403, "InvalidProviderToken");
    const auth = await send(["send", "--token", APNS_TOKEN, "--title", "Hi"], env);
    expect([auth.status, auth.out]).toEqual([1, expect.stringContaining("not sent (apns, io.example.app): auth (HTTP 403): InvalidProviderToken")]);
    apns.onRequest = () => apnsReason(400, "BadDeviceToken");
    expect(JSON.parse((await send(["send", "--token", APNS_TOKEN, "--title", "Hi", "--json"], env)).out)).toMatchObject({ reason: "invalid-token", detail: "BadDeviceToken" });
  });

  test("the sender is closed: the connection to APNs does not outlive the command", async () => {
    const { apns, env } = await providers();
    await send(["send", "--token", APNS_TOKEN, "--title", "Hi"], env);
    expect(apns.sessions).toHaveLength(1);
    await until(() => apns.sessions.every((session) => session.closed || session.destroyed));
    // ...also when the send failed.
    apns.onRequest = () => apnsReason(403, "InvalidProviderToken");
    await send(["send", "--token", APNS_TOKEN, "--title", "Hi"], env);
    await until(() => apns.sessions.every((session) => session.closed || session.destroyed));
  });
});

describe("push send: what is not a send (exit 2, nothing sent)", () => {
  const arguments_: [string, string[], string][] = [
    ["no token", ["send", "--title", "Hi"], "--token is needed"],
    ["a raw token without a provider", ["send", "--token", "abc", "--app", "io.e.a", "--title", "Hi"], "A raw --token needs --provider fcm|apns"],
    ["a raw token without an app", ["send", "--token", "abc", "--provider", "fcm", "--title", "Hi"], "A raw --token needs --app"],
    ["a raw APNs token without an environment", ["send", "--token", "abc", "--provider", "apns", "--app", "io.e.a", "--title", "Hi"], "An APNs --token needs --environment development|production"],
    ["an environment for an FCM token", ["send", "--token", "abc", "--provider", "fcm", "--app", "io.e.a", "--environment", "production", "--title", "Hi"], "--environment is for an APNs token"],
    ["a provider that is neither", ["send", "--token", "abc", "--provider", "web", "--app", "io.e.a"], "--provider must be fcm or apns"],
    ["an environment that is neither", ["send", "--token", "abc", "--provider", "apns", "--app", "io.e.a", "--environment", "staging"], "--environment must be development or production"],
    ["a token's JSON with the flags of a raw token", ["send", "--token", FCM_TOKEN, "--app", "io.e.a", "--title", "Hi"], "--token is a PushToken's JSON"],
    ["a token that starts like JSON and is not", ["send", "--token", "{nope", "--title", "Hi"], "--token starts with { but is not valid JSON"],
    ["a token's JSON without a provider", ["send", "--token", "{}", "--title", "Hi"], 'The token\'s "provider" must be "fcm" or "apns"'],
    ["a token's JSON without its token", ["send", "--token", '{"provider":"fcm","app":"io.e.a"}', "--title", "Hi"], 'The token\'s "token" must be a text that is not empty'],
    ["a token's JSON without its app", ["send", "--token", '{"provider":"fcm","token":"t"}', "--title", "Hi"], 'The token\'s "app" must be a text that is not empty'],
    ["a token's JSON with another environment", ["send", "--token", '{"provider":"apns","token":"t","app":"a","environment":"x"}', "--title", "Hi"], 'The token\'s "environment" must be'],
    ["a badge that is not a number", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--badge", "many"], "--badge must be a whole number of 0 or more"],
    ["a negative ttl", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--ttl", "-5"], "--ttl must be a whole number of 0 or more"],
    ["a priority that is neither", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--priority", "urgent"], "--priority must be high or normal"],
    ["a sound that is neither", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--sound", "loud"], "--sound must be default or none"],
    ["data without a value", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--data", "novalue"], "--data takes key=value, with a key"],
    ["data without a key", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--data", "=1"], "--data takes key=value, with a key"],
    ["the same data key twice", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--data", "a=1", "--data", "a=2"], "--data a is given twice"],
    ["a flag given twice", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--title", "Again"], "--title is given twice"],
    ["a flag with no value", ["send", "--token", FCM_TOKEN, "--title"], "--title needs a value"],
    ["a flag whose value is another flag", ["send", "--token", FCM_TOKEN, "--title", "--body", "x"], "--title needs a value"],
    ["a flag that takes no value, given one", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--silent=yes"], "--silent takes no value"],
    ["a flag it does not know", ["send", "--token", FCM_TOKEN, "--title", "Hi", "--loud"], "Unknown option --loud"],
    ["a short flag", ["send", "--token", FCM_TOKEN, "-t", "Hi"], "Unknown option -t"],
    ["a word that is no flag's value", ["send", "--token", FCM_TOKEN, "--title", "Hi", "stray"], "Unexpected argument stray"],
  ];
  for (const [name, args, message] of arguments_) {
    test(`${name}: ${message}`, async () => {
      // With no credentials at all: the arguments are judged first, so it is their error that is told.
      const result = await send(args, {});
      expect(result.status).toBe(2);
      expect(result.err).toContain(`expo-svelte push send: ${message}`);
      expect(result.err).toContain("expo-svelte push send --help");
      expect(result.out).toBe("");
    });
  }

  test("a flag's value may start with -- when it is written --flag=value", async () => {
    const { google, env } = await providers();
    expect((await send(["send", "--token", FCM_TOKEN, "--title=--important--"], env)).status).toBe(0);
    expect(bodyOf(google.fcm[0]).message).toMatchObject({ android: { notification: { title: "--important--" } } });
  });

  test("a message the sender refuses as a programming error is exit 2 with its words: no text, a silent title, a url that is also data, data.aps", async () => {
    const { google, apns, env } = await providers();
    for (const [args, message] of [
      [["--token", FCM_TOKEN], "A notification needs a `title` or a `body`"],
      [["--token", FCM_TOKEN, "--silent", "--title", "Hi"], "A `silent` message shows nothing, so it has no `title`"],
      [["--token", FCM_TOKEN, "--title", "Hi", "--url", "/a", "--data", "url=/b"], "`url` is carried as the data key `url`"],
      [["--token", APNS_TOKEN, "--title", "Hi", "--data", "aps=1"], "`data.aps` is APNs's own key"],
      [["--token", FCM_TOKEN, "--title", "Hi", "--collapse-key", ""], "`collapseKey` must be a non-empty string"],
    ] as const) {
      const result = await send(["send", ...args], env);
      expect([result.status, result.out], message).toEqual([2, ""]);
      expect(result.err).toContain(`expo-svelte push send: ${message}`);
    }
    expect([google.fcm.length, apns.seen.length]).toEqual([0, 0]);
  });

  test("credentials that are not set name the variables; credentials that do not load say why, and the other provider's are not asked about", async () => {
    const { google, apns, env } = await providers();
    const noFcm = await send(["send", "--token", FCM_TOKEN, "--title", "Hi"], { ...env, FCM_SERVICE_ACCOUNT: undefined });
    expect([noFcm.status, noFcm.out]).toEqual([2, ""]);
    expect(noFcm.err).toContain("FCM_SERVICE_ACCOUNT is not set: an FCM token is sent with the service account key");
    const noApns = await send(["send", "--token", APNS_TOKEN, "--title", "Hi"], { ...env, APNS_KEY: undefined, APNS_KEY_ID: undefined, APNS_TEAM_ID: undefined });
    expect(noApns.status).toBe(2);
    expect(noApns.err).toContain("APNS_KEY, APNS_KEY_ID and APNS_TEAM_ID are not set");
    const bad = await send(["send", "--token", APNS_TOKEN, "--title", "Hi"], { ...env, APNS_KEY: WRONG_FOR_APNS });
    expect(bad.status).toBe(2);
    expect(bad.err).toContain("APNS_KEY must be a P-256 (prime256v1) elliptic-curve private key for ES256, not rsa");
    expectNoSecrets(bad.err + noFcm.err + noApns.err);
    // An FCM send does not care that APNs's variables are wrong, and the other way round.
    expect((await send(["send", "--token", FCM_TOKEN, "--title", "Hi"], { ...env, APNS_KEY: "garbage", APNS_KEY_ID: "x" })).status).toBe(0);
    expect((await send(["send", "--token", APNS_TOKEN, "--title", "Hi"], { ...env, FCM_SERVICE_ACCOUNT: "{ garbage" })).status).toBe(0);
    expect([google.fcm.length, apns.seen.length]).toEqual([1, 1]);
  });

  test("the commands: push, push --help and push send --help print their usage (0); nothing or an unknown command exit 2", async () => {
    const help = await send(["--help"], {});
    expect([help.status, help.err]).toEqual([0, ""]);
    expect(help.out).toContain("Usage: expo-svelte push <command>");
    const sendHelp = await send(["send", "--help"], {});
    expect(sendHelp.status).toBe(0);
    for (const text of ["--token <token>", "--provider fcm|apns", "--app <id>", "--environment <env>", "--title <text>", "--body <text>", "--url <link>", "--data key=value", "--silent", "--badge <n>", "--collapse-key <key>", "--priority high|normal", "--ttl <seconds>", "--json", "FCM_SERVICE_ACCOUNT", "APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID"]) {
      expect(sendHelp.out, text).toContain(text);
    }
    const none = await send([], {});
    expect([none.status, none.out]).toEqual([2, ""]);
    expect(none.err).toContain("Missing command");
    const unknown = await send(["receive"], {});
    expect(unknown.status).toBe(2);
    expect(unknown.err).toContain("Unknown command receive");
  });

  test("it prints nothing secret on any of these paths", async () => {
    const { env } = await providers();
    const result = await send(["send", "--token", FCM_TOKEN, "--title", "Hi", "--json"], env);
    expectNoSecrets(result.out + result.err);
    expect(Object.keys(JSON.parse(result.out) as object).sort()).toEqual(["id", "ok"]);
  });
});

// The command as a process, through `src/cli.ts`: what `expo-svelte` runs, with plain Node.

const node = Bun.which("node");
const cli = join(import.meta.dirname, "../../src/cli.ts");
async function spawn(args: string[], env: Env, cwd: string): Promise<{ status: number; out: string; err: string }> {
  if (!node) throw new Error("node is not on the PATH");
  // The environment is the test's own: the real one's push variables must not reach it.
  const base = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(FCM_|APNS_)/.test(name)));
  const child = Bun.spawn([node, cli, ...args], { cwd, env: { ...base, NO_COLOR: "1", ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { status: await child.exited, out, err };
}

describe.skipIf(!node)("the process", () => {
  test("`expo-svelte push send` sends, prints, exits with the result's status, and leaves the directory as it was (no .expo-svelte/: it runs before the sync)", async () => {
    using project = scratch();
    const { google, apns, env } = await providers();
    const ok = await spawn(["push", "send", "--token", FCM_TOKEN, "--title", "Hi"], env, project.directory);
    expect(ok).toEqual({ status: 0, out: "sent to fcm (io.example.app): 0:1700000000%31bd1c96\n", err: "" });
    google.onFcm = () => ({ status: 404, json: { error: { status: "NOT_FOUND", message: "gone", details: [{ errorCode: "UNREGISTERED" }] } } });
    const gone = await spawn(["push", "send", "--token", FCM_TOKEN, "--title", "Hi", "--json"], env, project.directory);
    expect([gone.status, JSON.parse(gone.out)]).toEqual([1, { ok: false, reason: "gone", status: 404, detail: "gone" }]);
    const viaApns = await spawn(["push", "send", "--token", APNS_TOKEN, "--title", "Hi"], env, project.directory);
    expect(viaApns.status).toBe(0);
    const bad = await spawn(["push", "send", "--token", "x"], env, project.directory);
    expect([bad.status, bad.out]).toEqual([2, ""]);
    expect(bad.err).toContain("A raw --token needs --provider");
    expect(apns.seen).toHaveLength(1);
    expect(existsSync(join(project.directory, ".expo-svelte"))).toBe(false);
    expect(readdirSync(project.directory)).toEqual([]);
  });

  test("`expo-svelte doctor --server` runs the same checks, and its status is the exit status", async () => {
    using project = scratch();
    const { apns, env } = await providers();
    apns.onRequest = () => apnsReason(400, "BadDeviceToken");
    const ok = await spawn(["doctor", "--server"], env, project.directory);
    expect(ok.status).toBe(0);
    expect(ok.out).toContain("expo-svelte doctor --server");
    expect(ok.out).toMatch(/4 passed, 0 failed/);
    apns.onRequest = () => apnsReason(403, "InvalidProviderToken");
    const refused = await spawn(["doctor", "--server"], env, project.directory);
    expect(refused.status).toBe(1);
    expect(refused.out).toContain("refused the credentials (HTTP 403): InvalidProviderToken");
    const none = await spawn(["doctor", "--server"], {}, project.directory);
    expect(none.status).toBe(1);
    expect(readdirSync(project.directory)).toEqual([]);
  });

  test("the top-level help and the unknown-command message name push", async () => {
    // An unknown command is found after the sync that every other command makes first, which wants a routes directory.
    using project = createProject({ "src/routes/.gitkeep": "" }, "push-cli-");
    const help = await spawn(["--help"], {}, project.directory);
    expect(help.out).toContain("  push       `push send` sends one push message to one device with the server's credentials");
    expect(help.out).toContain("`doctor --server` checks the push server's credentials");
    const unknown = await spawn(["nope"], {}, project.directory);
    expect(unknown.err).toContain("Unknown command: nope. Use init, dev, android, ios, build, sync, css, doctor or push.");
    expect(line(help.out, "push")).toContain("push --help");
  });
});
