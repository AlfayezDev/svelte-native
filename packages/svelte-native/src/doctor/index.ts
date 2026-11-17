import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { packageRoot } from "../package-root.ts";
import { runChecks, type Check, type Context, type Status } from "./checks.ts";
import { serverChecks, type ServerOptions } from "./server.ts";

export type { Check, Context, Status } from "./checks.ts";
export { runChecks } from "./checks.ts";

const USAGE = `Usage: svelte-native doctor [--json]
       svelte-native doctor --server [--app <bundle id>] [--json]

Checks, from the app's directory, that the setup the library needs is complete: Node and pnpm, the custom-renderer Svelte, the peer
dependencies, the patches applied to the installed packages, and the app's Metro and Expo configs; and, when the app has push (the
@alfayez/svelte-native-push package), its push setup: the package, the Google services file, the iOS entitlement and background mode. One
line per check; the exit status is 1 when a required check fails.

  --json          print the checks as JSON instead of text
  --server        check the push server's environment instead of the app: FCM_SERVICE_ACCOUNT (the service account key's JSON, or the path of
                  its file), APNS_KEY (the .p8's PEM, or the path of its file), APNS_KEY_ID and APNS_TEAM_ID must load as the keys they are,
                  and one request each goes to Google's token endpoint and to the APNs sandbox to see that they are accepted. A provider whose
                  variables are unset is skipped. FCM_BASE_URL, FCM_TOKEN_URL, APNS_PRODUCTION_URL and APNS_SANDBOX_URL replace the endpoints.
  --app <id>      with --server: the app's bundle id, the topic of the APNs request (default: a placeholder, which APNs may refuse as a topic)
`;

const WORDS: Record<Status, string> = { pass: "pass", fail: "FAIL", skip: "skip", unknown: "????" };
const COLORS: Record<Status, string> = { pass: "32", fail: "31", skip: "2", unknown: "33" };

/** The checks as the text `svelte-native doctor` prints: a line per check under its group, a failure's details and fix below it, and a summary. */
export function formatReport(checks: readonly Check[], { color = false, appRoot = "", title = "svelte-native doctor" }: { color?: boolean; appRoot?: string; title?: string } = {}): string {
  const paint = (status: Status) => (color ? `\u001b[${COLORS[status]}m${WORDS[status]}\u001b[0m` : WORDS[status]);
  const lines: string[] = [`${title}${appRoot ? `: ${appRoot}` : ""}`];
  let group: string | undefined;
  for (const check of checks) {
    if (check.group !== group) {
      group = check.group;
      lines.push("", group);
    }
    lines.push(`  ${paint(check.status)}  ${check.message}`);
    for (const detail of check.details ?? []) lines.push(`        ${detail}`);
    if (check.fix && (check.status === "fail" || check.status === "unknown")) lines.push(`        fix: ${check.fix}`);
  }
  const count = (status: Status) => checks.filter((check) => check.status === status).length;
  lines.push("", `${count("pass")} passed, ${count("fail")} failed, ${count("unknown")} could not tell, ${count("skip")} skipped`);
  return `${lines.join("\n")}\n`;
}

/** The Node the app's tools run on: the one running the doctor, or, on Bun, the `node` on the PATH (undefined when there is none). */
export function nodeVersion(): string | undefined {
  if (!process.versions.bun) return process.versions.node;
  const result = spawnSync("node", ["--version"], { encoding: "utf8", timeout: 15_000, shell: process.platform === "win32" });
  const version = result.status === 0 ? result.stdout.trim().replace(/^v/, "") : undefined;
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
}

/** The nearest directory at or above `directory` that has a pnpm-workspace.yaml: the root of the pnpm workspace it is in. */
function workspaceRoot(directory: string): string | undefined {
  for (let current = directory; ; current = dirname(current)) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
    if (dirname(current) === current) return undefined;
  }
}

/**
 * Whether the app is one of this repository's own (`apps/qa`, `apps/example`), which the repository's tools run: the library is `<repository>/packages/<name>` and the app is a
 * member of the pnpm workspace at `<repository>`. Any other app, however it installs the library (a tarball, a git dependency, a `link:` to a checkout) and even
 * `examples/minimal` inside the repository (a workspace root of its own), is judged by the Node an app needs.
 */
export function isRepositoryApp(appRoot: string, packageRoot: string): boolean {
  const packages = dirname(packageRoot);
  if (basename(packages) !== "packages") return false;
  try {
    const root = workspaceRoot(realpathSync(appRoot));
    return root !== undefined && root === realpathSync(dirname(packages));
  } catch {
    return false;
  }
}

/** The version `pnpm --version` prints in `directory`, or undefined when it cannot be run. */
export function pnpmVersion(directory: string): string | undefined {
  const result = spawnSync("pnpm", ["--version"], { cwd: directory, encoding: "utf8", timeout: 60_000, shell: process.platform === "win32" });
  const version = result.status === 0 ? result.stdout.trim().split(/\r?\n/).pop() : undefined;
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
}

export type Output = { write(text: string): unknown; isTTY?: boolean };

/** The arguments of `doctor`: its flags, or the first one it does not know (`problem`). */
function parseArguments(args: readonly string[]): { json: boolean; server: boolean; app?: string; problem?: string } {
  const parsed: { json: boolean; server: boolean; app?: string; problem?: string } = { json: false, server: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--json") parsed.json = true;
    else if (arg === "--server") parsed.server = true;
    else if (arg === "--app" || arg.startsWith("--app=")) {
      const value = arg === "--app" ? args[++index] : arg.slice("--app=".length);
      if (value === undefined || value === "" || value.startsWith("--")) return { ...parsed, problem: "--app needs the app's bundle id" };
      // The topic is sent as an HTTP/2 header: printable ASCII without spaces.
      if (!/^[\x21-\x7e]+$/.test(value)) return { ...parsed, problem: "--app must be the app's bundle id (printable ASCII, no spaces)" };
      parsed.app = value;
    } else return { ...parsed, problem: `Unknown argument ${arg}` };
  }
  if (parsed.app !== undefined && !parsed.server) return { ...parsed, problem: "--app goes with --server" };
  return parsed;
}

/**
 * `svelte-native doctor`: runs the checks for the app in `root`, prints them and returns the exit status (0 when no check failed, 1 when one
 * did, 2 for an argument it does not know). `unknown` checks (a config it can only read, not run) and skipped ones do not fail it.
 *
 * `--server` checks the server's push environment instead (`server.ts`), which makes requests to the providers: it returns a promise, and every other run returns the status itself.
 */
export function runDoctor(root: string, args: readonly string[], out: Output = process.stdout, context: Partial<Context> = {}, server: ServerOptions = {}): number | Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    out.write(USAGE);
    return 0;
  }
  const parsed = parseArguments(args);
  if (parsed.problem !== undefined) {
    out.write(`${parsed.problem}\n\n${USAGE}`);
    return 2;
  }
  const appRoot = resolve(root);
  const report = (checks: readonly Check[], options: { appRoot?: string; title?: string }): number => {
    const failed = checks.some((check) => check.status === "fail");
    if (parsed.json) out.write(`${JSON.stringify({ ok: !failed, ...(options.appRoot ? { appRoot: options.appRoot } : { server: true }), checks }, null, 2)}\n`);
    else out.write(formatReport(checks, { color: out.isTTY === true && !process.env.NO_COLOR, ...options }));
    return failed ? 1 : 0;
  };
  if (parsed.server) {
    return serverChecks({ cwd: appRoot, ...(parsed.app === undefined ? {} : { app: parsed.app }), ...server }).then((checks) => report(checks, { title: "svelte-native doctor --server" }));
  }
  return report(
    runChecks({
      appRoot,
      packageRoot,
      node: nodeVersion(),
      pnpm: () => pnpmVersion(appRoot),
      repository: isRepositoryApp(appRoot, packageRoot),
      ...context,
    }),
    { appRoot },
  );
}
