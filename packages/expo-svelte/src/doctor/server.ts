/**
 * `expo-svelte doctor --server` (PUSH.md, "`expo-svelte doctor`"): the server's side of push. It reads the environment the sender reads (`push/credentials.ts`), checks that each
 * provider's credentials parse and load as the key they must be, and then makes one real request to each provider to see whether it accepts them:
 *
 * - FCM: the OAuth token exchange against the service account's `token_uri` (the first thing every send does). A refusal says why: `invalid_grant` is a key that was deleted or
 *   disabled, a service account that is gone, or a clock that is off.
 * - APNs: there is no token endpoint, so it signs the provider token and sends one request to the sandbox host with a device token that cannot exist. APNs judges the provider
 *   token first: `BadDeviceToken` means it accepted the key, key id and team id; `InvalidProviderToken` and `ExpiredProviderToken` (HTTP 403) mean it did not.
 *
 * A provider whose variables are unset is `skip`ped. Nothing here prints a key or a token: a line names a variable, a project, an email, an id or a host, and never a value that is secret.
 */
import { createApns } from "../push/apns.ts";
import { describeSource, readApns, readFcm, variables, type Env, type Source } from "../push/credentials.ts";
import { createFcm } from "../push/fcm.ts";
import type { Check } from "./checks.ts";

const group = "push server";

export type ServerOptions = {
  /** The variables to read (default: the process's). */
  env?: Env;
  /** Where a path in a variable is resolved from (default: the current directory). */
  cwd?: string;
  /** The APNs topic of the probe: the app's bundle id. Default a placeholder that is not any app's, which Apple may judge only after the provider token. */
  app?: string;
  /** How long a provider has to answer, in milliseconds (default 15000). */
  timeout?: number;
};

/** The topic of the APNs probe when none is given: it names no app, so a key can only be judged by what APNs says of its provider token. */
const placeholderTopic = "com.example.expo-svelte-doctor";

/** A device token that cannot be a real one: APNs answers `BadDeviceToken` once it has accepted the provider token. */
const impossibleDeviceToken = "0".repeat(64);

/**
 * Where the secret was read from, and, for a file, what the app's own server must do differently: the sender takes the secret's text (`createPush({ fcm: { serviceAccount: env.X } })`),
 * so a variable that holds a path loads here and fails there.
 */
function sourceDetails(source: Source): string[] {
  return source.file
    ? [`read from ${describeSource(source)}`, "createPush takes the file's contents, not its path: the server's own variable must hold the text"]
    : [`read from ${describeSource(source)}`];
}

/** What a refusal by the token endpoint means, from the description Google gives (`error_description`, or the `error` code). */
function fcmAdvice(detail: string): string {
  const text = detail.toLowerCase();
  if (/short-lived|reasonable timeframe|\biat\b|\bexp\b|clock/.test(text)) {
    return "the assertion's timestamps were refused: this machine's clock is off (compare `date -u` with a time server and fix the clock; Google accepts about five minutes of drift)";
  }
  if (/signature/.test(text)) {
    return "Google does not accept the key's signature: the key was deleted or disabled (Google Cloud console, IAM and admin, Service accounts, Keys), or the private_key was changed; create a new key and set FCM_SERVICE_ACCOUNT again";
  }
  if (/invalid_client|oauth client|not a valid email|unauthorized_client/.test(text)) {
    return "Google does not know this client_email as a service account of the key; use the key file of the service account as Google gave it";
  }
  if (/account not found|deleted|disabled/.test(text)) {
    return "the service account was deleted or disabled (Google Cloud console, IAM and admin, Service accounts); use a key of a service account that exists";
  }
  return "Google refused the key: it was revoked or disabled, or the file was changed; create a new key (Google Cloud console, IAM and admin, Service accounts, Keys) and set FCM_SERVICE_ACCOUNT again";
}

async function fcmChecks(env: Env, cwd: string, timeout: number): Promise<Check[]> {
  const name = variables.fcmServiceAccount;
  const credential = readFcm(env, cwd);
  if (credential.state === "unset") return [{ group, status: "skip", message: `${name} is not set: FCM (Android) is not configured here, nothing to check` }];
  if (credential.state === "invalid") return [{ group, status: "fail", message: credential.problem, fix: `set ${name} to the service account key's JSON (or the path of its file): Firebase console, Project settings, Service accounts, Generate new private key (the role "Firebase Cloud Messaging API Admin")` }];
  const checks: Check[] = [{
    group,
    status: "pass",
    message: `${name} is a service account key for project ${credential.projectId} (${credential.clientEmail}) with a private key that loads as RSA`,
    details: sourceDetails(credential.source),
  }];
  // The sender made from what was just checked cannot throw, but it is made the way a real one is.
  const sender = createFcm(credential.options, timeout);
  if (sender === undefined) return checks;
  const result = await sender.verify();
  if (result.ok) {
    checks.push({ group, status: "pass", message: `${credential.tokenHost} gave an access token for ${credential.clientEmail} (valid ${result.expiresIn} s): Google accepts the key` });
  } else if (result.reason === "auth") {
    checks.push({ group, status: "fail", message: `${credential.tokenHost} refused the key${result.status ? ` (HTTP ${result.status})` : ""}: ${result.detail}`, fix: fcmAdvice(result.detail) });
  } else if (result.reason === "rate-limited") {
    checks.push({ group, status: "unknown", message: `${credential.tokenHost} is rate limiting token requests (${result.detail})`, fix: "try again in a while" });
  } else {
    checks.push({ group, status: "fail", message: `could not get an access token from ${credential.tokenHost}: ${result.detail}`, fix: `the server must reach ${credential.tokenHost} over HTTPS (a firewall or proxy may be in the way); if the failure is the provider's, try again` });
  }
  return checks;
}

/** What APNs's refusal of the provider token means, by its `reason`. */
function apnsAdvice(reason: string): string {
  if (reason === "ExpiredProviderToken") return "APNs found the provider token expired: it is signed with the current time, so this machine's clock is off; fix the clock";
  if (reason === "InvalidProviderToken") {
    return "APNs does not accept the key with this key id and team id: APNS_KEY_ID must be the id of this very key (the .p8 is named AuthKey_<KEYID>.p8), APNS_TEAM_ID the team's (Apple Developer, Membership), and the key must not be revoked";
  }
  if (reason === "MissingProviderToken") return "APNs received no provider token: this is a fault of the doctor's request; report it";
  return "APNs refused the credentials: check APNS_KEY, APNS_KEY_ID and APNS_TEAM_ID against the key in the Apple Developer account (Certificates, Identifiers and Profiles, Keys), which must have Apple Push Notifications service enabled";
}

async function apnsChecks(env: Env, cwd: string, timeout: number, app: string | undefined): Promise<Check[]> {
  const credential = readApns(env, cwd);
  if (credential.state === "unset") return [{ group, status: "skip", message: `${variables.apnsKey} is not set: APNs (iOS) is not configured here, nothing to check` }];
  if (credential.state === "invalid") return [{ group, status: "fail", message: credential.problem, fix: `set ${variables.apnsKey} to the .p8's contents (or the path of the file), ${variables.apnsKeyId} to the key's id and ${variables.apnsTeamId} to the team's id (Apple Developer account, Keys: an APNs key with Apple Push Notifications service enabled)` }];
  const checks: Check[] = [{
    group,
    status: "pass",
    message: `${variables.apnsKey} loads as a P-256 key; key id ${credential.keyId}, team id ${credential.teamId}`,
    details: sourceDetails(credential.source),
  }];
  const sender = createApns(credential.options, timeout);
  if (sender === undefined) return checks;
  const topic = app ?? placeholderTopic;
  const host = credential.sandboxHost;
  try {
    const result = await sender.send({ provider: "apns", token: impossibleDeviceToken, environment: "development", app: topic }, { title: "expo-svelte doctor", body: "This device token does not exist." });
    if (result.ok) {
      checks.push({ group, status: "pass", message: `${host} accepted a request signed with the key (it answered ok to a device token that cannot exist)` });
    } else if (result.reason === "invalid-token" && (result.detail === "BadDeviceToken" || result.detail === "DeviceTokenNotForTopic")) {
      checks.push({ group, status: "pass", message: `${host} accepted the credentials: it signed in the provider token and then answered ${result.detail} to a device token that cannot exist` });
    } else if (result.reason === "auth") {
      checks.push({ group, status: "fail", message: `${host} refused the credentials (HTTP ${result.status ?? "?"}): ${result.detail}`, fix: apnsAdvice(result.detail) });
    } else if (result.reason === "invalid-message" && /^(BadTopic|TopicDisallowed|MissingTopic)$/.test(result.detail)) {
      // The provider token was read before the topic was judged, but "accepted" is not proved, and the topic is a guess when the doctor was not told the app.
      checks.push(app === undefined
        ? { group, status: "unknown", message: `${host} answered ${result.detail} to the placeholder topic ${topic}: it did not get as far as the device token, so the credentials are not confirmed`, fix: "run again with --app <the app's bundle id>, a topic that the key's team owns" }
        : { group, status: "fail", message: `${host} answered ${result.detail} for the topic ${topic}: the key's team cannot push to it`, fix: `check that ${topic} is the app's bundle id, and that APNS_TEAM_ID is the team that owns the app` });
    } else if (result.reason === "rate-limited") {
      checks.push({ group, status: "unknown", message: `${host} is rate limiting requests (${result.detail})`, fix: "try again in a while" });
    } else {
      checks.push({ group, status: "fail", message: `could not get an answer to the credentials from ${host}: ${result.detail}${result.status ? ` (HTTP ${result.status})` : ""}`, fix: `the server must reach ${host} over HTTP/2 on port 443 (a firewall or proxy may be in the way); if the failure is Apple's, try again` });
    }
  } finally {
    await sender.close();
  }
  return checks;
}

/** The checks of the server's push environment, FCM then APNs, ending with one failure when neither provider is configured at all. */
export async function serverChecks(options: ServerOptions = {}): Promise<Check[]> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const timeout = options.timeout ?? 15_000;
  const checks = [...(await fcmChecks(env, cwd, timeout)), ...(await apnsChecks(env, cwd, timeout, options.app))];
  if (checks.every((check) => check.status === "skip")) {
    checks.push({
      group,
      status: "fail",
      message: "no push provider is configured in this environment: neither FCM_SERVICE_ACCOUNT nor APNS_KEY is set",
      fix: "set FCM_SERVICE_ACCOUNT (Android) and/or APNS_KEY, APNS_KEY_ID and APNS_TEAM_ID (iOS) in the server's environment, as the sender reads them",
    });
  }
  return checks;
}
