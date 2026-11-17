/**
 * The server's push credentials as the command line reads them: `svelte-native doctor --server` checks them and `svelte-native push send` sends with them. They are the
 * environment variables PUSH.md's `createPush` example reads, so what the command line accepts is what the app's server has:
 *
 * - `FCM_SERVICE_ACCOUNT`: the service account key's JSON, or the path of the key's file;
 * - `APNS_KEY`: the `.p8`'s PEM, or the path of the file (a PEM whose line breaks are written as `\n` is read as it was meant); `APNS_KEY_ID` and `APNS_TEAM_ID`: ten characters each;
 * - `FCM_BASE_URL`, `FCM_TOKEN_URL`, `APNS_PRODUCTION_URL` and `APNS_SANDBOX_URL`: the sender's `baseUrl`, `tokenUrl`, `productionUrl` and `sandboxUrl`, for tests and proxies.
 *
 * Nothing here prints a secret: a problem names the variable and what is wrong with it, and never quotes its value (a value that fails to parse may be the key itself, written wrong).
 * A path, once it has been read as a file, is a path, and may be named.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hostOf, httpUrl } from "./common.ts";
import { privateKeyOf } from "./jwt.ts";
import type { ApnsOptions, FcmOptions, ServiceAccount } from "./server.ts";

export type Env = Readonly<Record<string, string | undefined>>;

export const variables = {
  fcmServiceAccount: "FCM_SERVICE_ACCOUNT",
  fcmBaseUrl: "FCM_BASE_URL",
  fcmTokenUrl: "FCM_TOKEN_URL",
  apnsKey: "APNS_KEY",
  apnsKeyId: "APNS_KEY_ID",
  apnsTeamId: "APNS_TEAM_ID",
  apnsProductionUrl: "APNS_PRODUCTION_URL",
  apnsSandboxUrl: "APNS_SANDBOX_URL",
} as const;

/** A provider's credentials in the environment: not set, set and not usable (`problem`), or read (`options` for the sender, and what is safe to say about them). */
export type Credential<Read> = { state: "unset" } | { state: "invalid"; problem: string } | ({ state: "ok" } & Read);

export type FcmCredential = Credential<{ options: FcmOptions & { serviceAccount: ServiceAccount }; projectId: string; clientEmail: string; source: Source; tokenHost: string }>;
export type ApnsCredential = Credential<{ options: ApnsOptions; keyId: string; teamId: string; source: Source; sandboxHost: string }>;

/** Where a secret was read from: the variable's own text (which is what `createPush` takes), or a file the variable names (which only this command follows). */
export type Source = { file: false } | { file: true; path: string };
export const describeSource = (source: Source): string => (source.file ? `the file ${source.path}` : "the variable's text");

/** A variable's value when it is set and not empty (`FCM_SERVICE_ACCOUNT=` is not set). */
const valueSet = (env: Env, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
};

/**
 * The text of a variable that holds either the secret itself (`isText` says so) or the path of a file that holds it. A value that is neither is a problem that does not quote it.
 * `source` says where the text came from, for the report.
 */
function textOrFile(env: Env, name: string, cwd: string, isText: (value: string) => boolean, kind: string): { text: string; source: Source } | { problem: string } {
  const value = valueSet(env, name) ?? "";
  if (isText(value)) return { text: value, source: { file: false } };
  const path = resolve(cwd, value.trim());
  try {
    return { text: readFileSync(path, "utf8"), source: { file: true, path } };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { problem: `is neither ${kind} nor the path of a file that can be read (${code === "ENOENT" ? `no such file, from ${cwd}` : (code ?? "unreadable")}): set it to ${kind} itself, or to the path of its file` };
  }
}

/** An override of a provider's URL: an http or https URL, or a problem that does not quote it (a URL may carry a password). */
function urlOf(env: Env, name: string): { url?: string; problem?: string } {
  const value = valueSet(env, name);
  if (value === undefined) return {};
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:" || url.protocol === "https:") return { url: value.trim() };
  } catch {
    // reported below
  }
  return { problem: `${name} must be an http or https URL` };
}

/** A URL's host, which is what a report says of an endpoint (the rest may hold a password or a query). */
export { hostOf };

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const APNS_SANDBOX_URL = "https://api.sandbox.push.apple.com";

export function readFcm(env: Env, cwd: string): FcmCredential {
  const name = variables.fcmServiceAccount;
  if (valueSet(env, name) === undefined) return { state: "unset" };
  const read = textOrFile(env, name, cwd, (value) => /^\s*[{[]/.test(value), "the service account key's JSON");
  if ("problem" in read) return { state: "invalid", problem: `${name} ${read.problem}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    // The parser's message quotes the start of the text, which is the secret.
    return { state: "invalid", problem: `${name} (${describeSource(read.source)}) is not JSON: it must be the service account key's file as Google gave it` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { state: "invalid", problem: `${name} (${describeSource(read.source)}) must be the service account key's JSON object` };
  const account = parsed as Record<string, unknown>;
  for (const field of ["project_id", "client_email", "private_key"]) {
    if (typeof account[field] !== "string" || account[field] === "") return { state: "invalid", problem: `${name} (${describeSource(read.source)}) has no \`${field}\`: it is not a service account key` };
  }
  if (account.token_uri !== undefined && typeof account.token_uri !== "string") return { state: "invalid", problem: `${name} (${describeSource(read.source)}) has a \`token_uri\` that is not a string` };
  if (typeof account.token_uri === "string") {
    try {
      httpUrl(account.token_uri, "token_uri");
    } catch {
      return { state: "invalid", problem: `${name} (${describeSource(read.source)}) has a \`token_uri\` that is not an http or https URL` };
    }
  }
  try {
    privateKeyOf(String(account.private_key), "RS256", `the private_key of ${name}`);
  } catch (error) {
    return { state: "invalid", problem: `${error instanceof Error ? error.message : String(error)}` };
  }
  const base = urlOf(env, variables.fcmBaseUrl);
  const token = urlOf(env, variables.fcmTokenUrl);
  const problem = base.problem ?? token.problem;
  if (problem) return { state: "invalid", problem };
  const tokenUrl = token.url ?? (typeof account.token_uri === "string" ? account.token_uri : GOOGLE_TOKEN_URL);
  return {
    state: "ok",
    options: { serviceAccount: account as ServiceAccount, ...(base.url ? { baseUrl: base.url } : {}), ...(token.url ? { tokenUrl: token.url } : {}) },
    projectId: String(account.project_id),
    clientEmail: String(account.client_email),
    source: read.source,
    tokenHost: hostOf(tokenUrl),
  };
}

/** Apple's key id and team id: ten letters and digits. */
const tenCharacters = /^[A-Za-z0-9]{10}$/;

export function readApns(env: Env, cwd: string): ApnsCredential {
  const names = [variables.apnsKey, variables.apnsKeyId, variables.apnsTeamId];
  const unset = names.filter((name) => valueSet(env, name) === undefined);
  if (unset.length === names.length) return { state: "unset" };
  if (unset.length > 0) return { state: "invalid", problem: `${unset.join(" and ")} ${unset.length > 1 ? "are" : "is"} not set: APNs needs ${names.join(", ")} together` };
  const key = textOrFile(env, variables.apnsKey, cwd, (value) => value.includes("-----BEGIN"), "the .p8 key's PEM");
  if ("problem" in key) return { state: "invalid", problem: `${variables.apnsKey} ${key.problem}` };
  try {
    privateKeyOf(key.text, "ES256", variables.apnsKey);
  } catch (error) {
    return { state: "invalid", problem: error instanceof Error ? error.message : String(error) };
  }
  const keyId = (valueSet(env, variables.apnsKeyId) ?? "").trim();
  const teamId = (valueSet(env, variables.apnsTeamId) ?? "").trim();
  for (const [name, value] of [[variables.apnsKeyId, keyId], [variables.apnsTeamId, teamId]] as const) {
    if (!tenCharacters.test(value)) return { state: "invalid", problem: `${name} must be 10 letters and digits (it has ${value.length} characters)` };
  }
  const production = urlOf(env, variables.apnsProductionUrl);
  const sandbox = urlOf(env, variables.apnsSandboxUrl);
  const problem = production.problem ?? sandbox.problem;
  if (problem) return { state: "invalid", problem };
  return {
    state: "ok",
    options: { key: key.text, keyId, teamId, ...(production.url ? { productionUrl: production.url } : {}), ...(sandbox.url ? { sandboxUrl: sandbox.url } : {}) },
    keyId,
    teamId,
    source: key.source,
    sandboxHost: hostOf(sandbox.url ?? APNS_SANDBOX_URL),
  };
}
