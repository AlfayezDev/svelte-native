/**
 * `svelte-native push send` (PUSH.md, "`svelte-native doctor`"): sends one message to one device with the server's credentials, for trying a device. It is `createPush(...).send(...)`
 * of `server.ts` and nothing else: the credentials are the environment variables the app's own server reads (`credentials.ts`), and what it prints is the `SendResult`.
 *
 * The exit status is 0 when the provider took the message, 1 when it did not (the result's `reason` says why), and 2 when nothing was sent because the command or its environment is
 * not usable: an argument that is wrong, a token or message that the sender refuses as a programming error, or credentials that are not set or do not parse. The sender is always closed.
 */
import { resolve } from "node:path";
import { readApns, readFcm, variables, type Env } from "./credentials.ts";
import { createPush, type Push, type PushOptions, type PushSend, type PushToken, type SendResult } from "./server.ts";

const SEND_USAGE = `Usage: svelte-native push send --token <token> [options]

Sends one message to one device with the credentials of the server's environment (the variables \`svelte-native doctor --server\` checks), and prints what the provider
answered. Exits 0 when the message was accepted, 1 when it was not, and 2 when nothing was sent because an argument or the environment is not usable.

Which device:
  --token <token>        the device's token: the JSON of the PushToken exactly as \`push.subscribe\`'s save received it
                         ({"provider":"fcm","token":"…","app":"io.example.app"}), or a raw token string, with the three options below
  --provider fcm|apns    a raw token's provider
  --app <id>             a raw token's app: the Android package or the iOS bundle id (the APNs topic)
  --environment <env>    an APNs raw token's environment: development or production (which APNs host it is sent to)

The message (a notification needs a title or a body; a silent one neither):
  --title <text>         the notification's title
  --body <text>          the notification's text
  --url <link>           the link a tap opens: a path of the app (/orders/42) or a full link
  --data key=value       a data entry (repeat it for more); strings only
  --silent               a data message: nothing is shown, the app's background hook gets it
  --badge <n>            iOS: the badge number
  --sound default|none   default: the default sound; none: no sound
  --channel <id>         Android: the notification channel's id
  --collapse-key <key>   a newer message with the same key replaces the older one
  --priority high|normal
  --ttl <seconds>        how long the provider keeps the message for a device that is offline

Output:
  --json                 print the result as JSON ({"ok":true,"id":…} or {"ok":false,"reason":…,"detail":…})

Environment (nothing is passed on the command line, so no key lands in a shell history):
  FCM_SERVICE_ACCOUNT    the service account key's JSON, or the path of its file (Android tokens)
  APNS_KEY               the .p8's PEM, or the path of its file; with APNS_KEY_ID and APNS_TEAM_ID (iOS tokens)
  FCM_BASE_URL, FCM_TOKEN_URL, APNS_PRODUCTION_URL, APNS_SANDBOX_URL   replace the provider's endpoints (tests, proxies)
`;

const USAGE = `Usage: svelte-native push <command>

  send     send one message to one device with the server's credentials; \`push send --help\` lists its options
`;

export type PushOutput = { write(text: string): unknown };

export type PushIo = {
  out: PushOutput;
  err: PushOutput;
  /** The variables to read (default: the process's). */
  env: Env;
  /** Where a path in a variable is resolved from (default: the current directory). */
  cwd: string;
  /** How long a provider has to answer, in milliseconds (the sender's default, 30000). */
  timeout?: number;
};

/** The flags of `push send`: those that take a value, those that may repeat, and those that stand alone. */
const VALUE_FLAGS = ["token", "provider", "app", "environment", "title", "body", "url", "data", "badge", "sound", "channel", "collapse-key", "priority", "ttl"] as const;
const REPEATED = new Set<string>(["data"]);
const SWITCHES = ["silent", "json", "help"] as const;

/** An error of the command's arguments: the message is what the user reads. */
class UsageError extends Error {}

type Flags = { values: Map<string, string[]>; switches: Set<string> };

/** `--flag value` and `--flag=value`; a flag that takes a value and finds another flag where it should be is missing its value (`--title=--x` is how a value starts with `--`). */
function parseFlags(args: readonly string[]): Flags {
  const values = new Map<string, string[]>();
  const switches = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (!arg.startsWith("--")) throw new UsageError(arg.startsWith("-") ? `Unknown option ${arg}` : `Unexpected argument ${arg}`);
    const equals = arg.indexOf("=");
    const name = arg.slice(2, equals < 0 ? undefined : equals);
    if ((SWITCHES as readonly string[]).includes(name)) {
      if (equals >= 0) throw new UsageError(`--${name} takes no value`);
      switches.add(name);
      continue;
    }
    if (!(VALUE_FLAGS as readonly string[]).includes(name)) throw new UsageError(`Unknown option --${name}`);
    let value: string | undefined;
    if (equals >= 0) value = arg.slice(equals + 1);
    else {
      value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
      index++;
    }
    const seen = values.get(name) ?? [];
    if (seen.length > 0 && !REPEATED.has(name)) throw new UsageError(`--${name} is given twice`);
    values.set(name, [...seen, value]);
  }
  return { values, switches };
}

/** A whole number of 0 or more, from the digits of a flag. */
function wholeNumber(flags: Flags, name: string): number | undefined {
  const value = flags.values.get(name)?.[0];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new UsageError(`--${name} must be a whole number of 0 or more`);
  return Number(value);
}

function choice<T extends string>(flags: Flags, name: string, allowed: readonly T[]): T | undefined {
  const value = flags.values.get(name)?.[0];
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new UsageError(`--${name} must be ${allowed.join(" or ")}`);
  return value as T;
}

/** The device's token: a PushToken as JSON, or a raw token with its provider, app and (APNs) environment. */
function tokenOf(flags: Flags): PushToken {
  const given = flags.values.get("token")?.[0];
  if (given === undefined) throw new UsageError("--token is needed: the device's token (the PushToken's JSON, or a raw token with --provider and --app)");
  const provider = choice(flags, "provider", ["fcm", "apns"]);
  const app = flags.values.get("app")?.[0];
  const environment = choice(flags, "environment", ["development", "production"]);
  if (given.trim().startsWith("{")) {
    if (provider !== undefined || app !== undefined || environment !== undefined) throw new UsageError("--token is a PushToken's JSON, which has its provider, app and environment: --provider, --app and --environment are for a raw token");
    let parsed: unknown;
    try {
      parsed = JSON.parse(given);
    } catch {
      throw new UsageError("--token starts with { but is not valid JSON: pass the PushToken as `push.subscribe`'s save received it");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new UsageError("--token must be a PushToken's JSON object");
    const token = parsed as Record<string, unknown>;
    if (token.provider !== "fcm" && token.provider !== "apns") throw new UsageError('The token\'s "provider" must be "fcm" or "apns"');
    if (typeof token.token !== "string" || token.token === "") throw new UsageError('The token\'s "token" must be a text that is not empty');
    if (typeof token.app !== "string" || token.app === "") throw new UsageError('The token\'s "app" must be a text that is not empty: the Android package or the iOS bundle id');
    if (token.environment !== undefined && token.environment !== "development" && token.environment !== "production") throw new UsageError('The token\'s "environment" must be "development" or "production"');
    return { provider: token.provider, token: token.token, app: token.app, ...(token.environment === undefined ? {} : { environment: token.environment }) };
  }
  if (provider === undefined) throw new UsageError("A raw --token needs --provider fcm|apns (or pass the PushToken's JSON)");
  if (app === undefined) throw new UsageError("A raw --token needs --app: the Android package or the iOS bundle id");
  if (provider === "apns" && environment === undefined) throw new UsageError("An APNs --token needs --environment development|production: the token belongs to one APNs, and the other answers BadDeviceToken");
  if (provider === "fcm" && environment !== undefined) throw new UsageError("--environment is for an APNs token");
  return { provider, token: given, app, ...(environment === undefined ? {} : { environment }) };
}

function messageOf(flags: Flags): PushSend {
  const message: PushSend = {};
  const text = (flag: string, key: "title" | "body" | "url" | "channel") => {
    const value = flags.values.get(flag)?.[0];
    if (value !== undefined) message[key] = value;
  };
  text("title", "title");
  text("body", "body");
  text("url", "url");
  text("channel", "channel");
  const collapseKey = flags.values.get("collapse-key")?.[0];
  if (collapseKey !== undefined) message.collapseKey = collapseKey;
  const data = flags.values.get("data");
  if (data !== undefined) {
    message.data = {};
    for (const entry of data) {
      const equals = entry.indexOf("=");
      if (equals < 1) throw new UsageError("--data takes key=value, with a key");
      const key = entry.slice(0, equals);
      if (Object.hasOwn(message.data, key)) throw new UsageError(`--data ${key} is given twice`);
      message.data[key] = entry.slice(equals + 1);
    }
  }
  if (flags.switches.has("silent")) message.silent = true;
  const badge = wholeNumber(flags, "badge");
  if (badge !== undefined) message.badge = badge;
  const ttl = wholeNumber(flags, "ttl");
  if (ttl !== undefined) message.ttl = ttl;
  const sound = choice(flags, "sound", ["default", "none"]);
  if (sound !== undefined) message.sound = sound === "none" ? null : "default";
  const priority = choice(flags, "priority", ["high", "normal"]);
  if (priority !== undefined) message.priority = priority;
  return message;
}

/** The sender's options for the token's provider, from the environment, or why they cannot be made. Only that provider's variables matter to a send to it. */
function optionsFor(token: PushToken, io: PushIo): PushOptions {
  if (token.provider === "fcm") {
    const fcm = readFcm(io.env, io.cwd);
    if (fcm.state === "unset") throw new UsageError(`${variables.fcmServiceAccount} is not set: an FCM token is sent with the service account key (its JSON, or the path of its file)`);
    if (fcm.state === "invalid") throw new UsageError(fcm.problem);
    return { fcm: fcm.options, ...(io.timeout === undefined ? {} : { timeout: io.timeout }) };
  }
  const apns = readApns(io.env, io.cwd);
  if (apns.state === "unset") throw new UsageError(`${variables.apnsKey}, ${variables.apnsKeyId} and ${variables.apnsTeamId} are not set: an APNs token is sent with the .p8 key (its PEM, or the path of its file), its key id and the team id`);
  if (apns.state === "invalid") throw new UsageError(apns.problem);
  return { apns: apns.options, ...(io.timeout === undefined ? {} : { timeout: io.timeout }) };
}

/** What to do about a failure, in a sentence (the reasons are PUSH.md's). */
const ADVICE: Record<Extract<SendResult, { ok: false }>["reason"], string> = {
  gone: "the token will never work again (uninstalled, expired, unregistered): delete it",
  "invalid-token": "the provider does not take this token for this app or environment; do not retry it as it is",
  "invalid-message": "the provider refused the message itself; do not retry it as it is",
  "rate-limited": "try again later",
  unavailable: "the provider could not be reached or did not answer: try again later",
  auth: "the server's credentials are wrong or revoked: run `svelte-native doctor --server`",
  error: "the provider answered something the sender cannot place; the detail is its own text",
};

function report(result: SendResult, token: PushToken, json: boolean): string {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  if (result.ok) return `sent to ${token.provider} (${token.app}): ${result.id}\n`;
  const lines = [`not sent (${token.provider}, ${token.app}): ${result.reason}${result.status === undefined ? "" : ` (HTTP ${result.status})`}: ${result.detail}`];
  if (result.retryAfter !== undefined) lines.push(`retry after ${result.retryAfter} ms`);
  lines.push(ADVICE[result.reason]);
  return `${lines.join("\n")}\n`;
}

/**
 * `svelte-native push <command>`: only `send` so far. Returns the exit status. `root` is where a relative path in a credential variable is resolved from; `io` is for tests.
 */
export async function runPush(root: string, args: readonly string[], io: Partial<PushIo> = {}): Promise<number> {
  const full: PushIo = { out: process.stdout, err: process.stderr, env: process.env, cwd: resolve(root), ...io };
  const [command, ...rest] = args;
  if (command === "--help" || command === "-h" || command === "help") {
    full.out.write(USAGE);
    return 0;
  }
  if (command === undefined) {
    full.err.write(`Missing command\n\n${USAGE}`);
    return 2;
  }
  if (command !== "send") {
    full.err.write(`Unknown command ${command}\n\n${USAGE}`);
    return 2;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    full.out.write(SEND_USAGE);
    return 0;
  }
  let token: PushToken;
  let message: PushSend;
  let options: PushOptions;
  let json: boolean;
  try {
    const flags = parseFlags(rest);
    json = flags.switches.has("json");
    token = tokenOf(flags);
    message = messageOf(flags);
    options = optionsFor(token, full);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    full.err.write(`svelte-native push send: ${error.message}\n\nRun \`svelte-native push send --help\` for the options.\n`);
    return 2;
  }
  let push: Push | undefined;
  try {
    push = createPush(options);
    const result = await push.send(token, message);
    full.out.write(report(result, token, json));
    return result.ok ? 0 : 1;
  } catch (error) {
    // The sender throws a TypeError for what a person got wrong in the message (`silent` with a title, a notification with neither title nor body, `url` also in `data`...), or in the options it was made with.
    if (!(error instanceof TypeError)) throw error;
    full.err.write(`svelte-native push send: ${error.message}\n`);
    return 2;
  } finally {
    await push?.close();
  }
}
