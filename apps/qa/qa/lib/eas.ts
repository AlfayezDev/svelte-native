import { basename } from "node:path";

/**
 * What the harness lets eas-cli see. The child gets the variables a command-line tool needs to run and to find its login (and a
 * token, when the machine uses one), plus the ones the harness sets for the bundle; not the whole environment of the caller, which on
 * a development machine carries every other credential.
 */
const passed = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SHELL", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "EXPO_TOKEN", "EXPO_STAGING", "EXPO_LOCAL"];

export function easEnvironment(source: NodeJS.ProcessEnv, extra: Record<string, string>): Record<string, string> {
	const environment: Record<string, string> = {};
	for (const name of passed) {
		const value = source[name];
		if (value !== undefined) environment[name] = value;
	}
	return { ...environment, ...extra };
}

/** Names whose values are credentials, wherever they appear in output. */
const secretName = /(?:TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_?KEY)/i;

/**
 * Output of eas-cli and error messages built from it are written to the run's log and file. A line that names a credential
 * (`EXPO_TOKEN=…`, `--token …`, an `Authorization`/`Bearer` header) loses its value, and so does any value in `source` whose variable
 * name looks like a credential, wherever it shows up.
 */
export function redact(text: string, source: NodeJS.ProcessEnv = process.env): string {
	let result = text;
	for (const [name, value] of Object.entries(source))
		if (value && value.length >= 6 && secretName.test(name)) result = result.split(value).join("<redacted>");
	return result
		.replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_?KEY)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, "$1=<redacted>")
		.replace(/(--(?:token|password|secret)[= ])\S+/gi, "$1<redacted>")
		.replace(/(authorization:\s*)(?:bearer\s+)?\S+/gi, "$1<redacted>")
		.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <redacted>");
}

/** The last `lines` lines of a command's output, redacted, for a log or an error. */
export function tail(text: string, lines: number, source: NodeJS.ProcessEnv = process.env): string {
	return redact(text.split("\n").slice(-lines).join("\n"), source);
}

export type Eas = { command: string; args: string[] };

/** The command line to run (kept in memory only) and what may be recorded about it: the program's name. */
export function easCommand(value: string | undefined, source: NodeJS.ProcessEnv = process.env): Eas {
	const [command, ...args] = (value ?? source.NATIVE_QA_EAS ?? "npx -y eas-cli@27.2.0").trim().split(/\s+/);
	if (!command) throw new Error("--eas is empty");
	return { command, args };
}

export const easName = (eas: Eas): string => basename(eas.command);
