import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./paths.ts";

/**
 * The QA account the signed-in phase of `parity` and `a11y` signs in as. Its address is a secret of the machine running the harness: it
 * is read from `RASHEED_QA_EMAIL` in the environment, else from that one key of the repository's `.env.local` (gitignored, mode 600),
 * when the phase starts. It is never printed, logged, written to a run file, a report, a reference or a file name; the functions of this
 * file are how it stays that way (`redact`, `assertClean`), and `native-qa leakcheck` looks for it in what is about to be committed.
 *
 * The one-time code of a development database is public (it is in AGENTS.md); the address is not. A database that is not in
 * development mode emails its codes, which no harness can read: it can instead be published with a fixed code for one dedicated QA address
 * (`QA_SIGNIN_EMAIL` and `QA_SIGNIN_CODE`, apps/database/module/src/identity.rs). That code is a credential of the account like the address is:
 * `RASHEED_QA_CODE`, read the same way (environment, else `.env.local`), is kept out of every message and file the same way, and is
 * `000000` only when none is set.
 */
export const developmentCode = "000000";
export const variable = "RASHEED_QA_EMAIL";
export const codeVariable = "RASHEED_QA_CODE";
/** What stands for the address wherever a message, a label of the accessibility tree or a finding would have carried it. */
export const placeholder = "<qa-account>";

let override: { email: string | null; code: string | null } | null = null;
let cached: string | null | undefined;
let cachedCode: string | null | undefined;

/** The value of one key of a dotenv file, or null: only that key is looked at, the rest of the file is never read into the process. */
export function envFileValue(text: string, key: string): string | null {
	for (const line of text.split(/\r?\n/)) {
		const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (match?.[1] !== key) continue;
		const raw = match[2] ?? "";
		const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(raw);
		const value = (quoted ? quoted[2] : raw.replace(/\s+#.*$/, "")) ?? "";
		return value.length > 0 ? value : null;
	}
	return null;
}

/** One setting, from the environment, else from that one key of `.env.local`; trimmed, null when it is not there. */
function setting(name: string): string | null {
	const fromEnvironment = process.env[name]?.trim();
	if (fromEnvironment) return fromEnvironment;
	try {
		return envFileValue(readFileSync(join(repoRoot, ".env.local"), "utf8"), name)?.trim() || null;
	} catch {
		return null;
	}
}

function read(): string | null {
	return setting(variable)?.toLowerCase() ?? null;
}

const sixDigits = /^\d{6}$/;

/** The fixed code configured for the account (`RASHEED_QA_CODE`, six digits), or null when none is set. A value that is not six digits is an error that never quotes it. */
export function configuredCode(): string | null {
	if (override) return override.code;
	if (cachedCode === undefined) {
		const value = setting(codeVariable);
		if (value !== null && !sixDigits.test(value)) throw new Error(`${codeVariable} must be six digits`);
		cachedCode = value;
	}
	return cachedCode;
}

/** The code the sign-in types: the configured one, else the development database's. */
export function qaCode(): string {
	return configuredCode() ?? developmentCode;
}

/** The account's address (lower case, as the server keeps it), or null when none is configured. Tests set one with `useAccount`. */
export function accountEmail(): string | null {
	if (override) return override.email;
	if (cached === undefined) cached = read();
	return cached;
}

/** Tests: use this address (and fixed code, or none) instead of the environment's until `useAccount(undefined)`. */
export function useAccount(email: string | null | undefined, code: string | null = null): void {
	override = email === undefined ? null : { email: email === null ? null : email.toLowerCase(), code };
}

/** The fixed code as a pattern that matches it only as a whole number (six digits inside a longer number are not it); null when there is none worth hiding (the public development code). */
function codePattern(): RegExp | null {
	const code = configuredCode();
	return code === null || code === developmentCode ? null : new RegExp(`(?<!\\d)${code}(?!\\d)`, "g");
}

/** What the address looks like once it has gone through a URL, a shell or an XML attribute: all of them are looked for. */
function needles(email: string, extra: readonly string[] = []): string[] {
	const forms = new Set<string>([email, encodeURIComponent(email), email.replaceAll("@", "&#64;"), email.replaceAll("@", "%40"), ...extra]);
	return [...forms].filter((form) => form.length > 0);
}

/** `text` with the address (any case, any of its encodings), the fixed code and every extra needle replaced by the placeholder. */
export function redact(text: string, extra: readonly string[] = []): string {
	const email = accountEmail();
	let result = text;
	for (const needle of email === null ? extra.filter((form) => form.length > 0) : needles(email, extra))
		result = result.replace(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), placeholder);
	const code = codePattern();
	return code === null ? result : result.replace(code, placeholder);
}

/** Whether the text contains the address (any case, any of its encodings) or the fixed code (as a whole number). */
export function containsAccount(text: string): boolean {
	const email = accountEmail();
	if (codePattern()?.test(text)) return true;
	if (email === null) return false;
	const lower = text.toLowerCase();
	return needles(email).some((form) => lower.includes(form.toLowerCase()));
}

/** A copy of any JSON value with the address redacted from every string, key and value alike. */
export function redactDeep<T>(value: T): T {
	if (typeof value === "string") return redact(value) as T;
	if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
	if (value !== null && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactDeep(item)])) as T;
	return value;
}

/**
 * Throws, without the text, when a file about to be written contains the address. The suites redact what they take from the screen
 * (`redactDeep`); this is the check behind it, at the one place every run file passes through.
 */
export function assertClean(text: string, what: string): void {
	if (containsAccount(text))
		throw new Error(`refusing to write ${what}: it contains the QA account's address (${variable}) or its sign-in code (${codeVariable}); the harness must redact it first`);
}

/** The address, or an error that names the variable and where it is looked for (never its value). */
export function requireAccount(): string {
	const email = accountEmail();
	if (email === null)
		throw new Error(`the signed-in phase needs the QA account: set ${variable} in the environment or in .env.local at the repository root`);
	return email;
}
