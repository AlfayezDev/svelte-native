import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { packageRoot } from "../package-root.ts";
import { runChecks, type Check, type Context, type Status } from "./checks.ts";

export type { Check, Context, Status } from "./checks.ts";
export { runChecks } from "./checks.ts";

const USAGE = `Usage: svelte-native doctor [--json]

Checks, from the app's directory, that the setup the library needs is complete: Node and pnpm, the custom-renderer Svelte, the peer
dependencies, the patches applied to the installed packages, and the app's Metro and Expo configs. One line per check; the exit status is
1 when a required check fails.

  --json   print the checks as JSON instead of text
`;

const WORDS: Record<Status, string> = { pass: "pass", fail: "FAIL", skip: "skip", unknown: "????" };
const COLORS: Record<Status, string> = { pass: "32", fail: "31", skip: "2", unknown: "33" };

/** The checks as the text `svelte-native doctor` prints: a line per check under its group, a failure's details and fix below it, and a summary. */
export function formatReport(checks: readonly Check[], { color = false, appRoot = "" }: { color?: boolean; appRoot?: string } = {}): string {
  const paint = (status: Status) => (color ? `\u001b[${COLORS[status]}m${WORDS[status]}\u001b[0m` : WORDS[status]);
  const lines: string[] = [`svelte-native doctor${appRoot ? `: ${appRoot}` : ""}`];
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

/** The version `pnpm --version` prints in `directory`, or undefined when it cannot be run. */
export function pnpmVersion(directory: string): string | undefined {
  const result = spawnSync("pnpm", ["--version"], { cwd: directory, encoding: "utf8", timeout: 60_000, shell: process.platform === "win32" });
  const version = result.status === 0 ? result.stdout.trim().split(/\r?\n/).pop() : undefined;
  return version && /^\d+\.\d+\.\d+/.test(version) ? version : undefined;
}

export type Output = { write(text: string): unknown; isTTY?: boolean };

/**
 * `svelte-native doctor`: runs the checks for the app in `root`, prints them and returns the exit status (0 when no check failed, 1 when one
 * did, 2 for an argument it does not know). `unknown` checks (a config it can only read, not run) and skipped ones do not fail it.
 */
export function runDoctor(root: string, args: readonly string[], out: Output = process.stdout, context: Partial<Context> = {}): number {
  if (args.includes("--help") || args.includes("-h")) {
    out.write(USAGE);
    return 0;
  }
  const unknown = args.find((arg) => arg !== "--json");
  if (unknown !== undefined) {
    out.write(`Unknown argument ${unknown}\n\n${USAGE}`);
    return 2;
  }
  const appRoot = resolve(root);
  const checks = runChecks({
    appRoot,
    packageRoot,
    node: nodeVersion(),
    pnpm: () => pnpmVersion(appRoot),
    ...context,
  });
  const failed = checks.some((check) => check.status === "fail");
  if (args.includes("--json")) out.write(`${JSON.stringify({ ok: !failed, appRoot, checks }, null, 2)}\n`);
  else out.write(formatReport(checks, { color: out.isTTY === true && !process.env.NO_COLOR, appRoot }));
  return failed ? 1 : 0;
}
