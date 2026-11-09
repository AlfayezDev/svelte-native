import { exec, shellQuote, type ExecOptions, type ExecResult } from "../exec.ts";

/**
 * The iPhone is reached through the Mac it is paired with: `ssh <user@host>` runs `xcrun devicectl` there, `scp` brings files
 * back. Nothing here signs, builds or changes settings: the signed build is made by the GUI Terminal (`commands/ios-build.ts`).
 */

export type Run = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

export type Mac = {
	/** `user@host`, from `--mac` or `NATIVE_QA_MAC`. */
	target: string;
	run: Run;
};

export function macFrom(target: string | undefined, run: Run = exec): Mac {
	const chosen = target ?? process.env.NATIVE_QA_MAC;
	if (!chosen)
		throw new Error("--mac <user@host> (or NATIVE_QA_MAC) is required for --platform ios: the Mac the iPhone is paired with");
	return { target: chosen, run };
}

/** One shared connection for the many short commands a run sends (`ControlPersist` closes it after the run). */
const sshOptions = [
	"-o",
	"BatchMode=yes",
	"-o",
	"ConnectTimeout=15",
	"-o",
	"ControlMaster=auto",
	"-o",
	"ControlPath=/tmp/native-qa-ssh-%C",
	"-o",
	"ControlPersist=120",
];

const remotePath = "export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH";

/**
 * The line the remote shell prints last, with the command's exit status. ssh's own status cannot be trusted: the Mac's sshd runs
 * commands under `/usr/bin/login`, which exits 0 whatever the command did, so `ssh mac 'exit 3'` answers 0 there.
 */
const statusMarker = "__native_qa_status=";

const shellPrefix = "/bin/sh -c ";

/**
 * The command runs in a subshell, so an `exit` in it ends only the subshell and the status line still follows. The Mac's login shell is zsh,
 * which sshd hands the command line to: the script runs under an explicit `/bin/sh -c '<script>'`, so no special variable of zsh (`path` is tied to
 * `$PATH`, `status` is read-only) can reach it, whatever a script names its variables.
 */
export function sshArgs(mac: Mac, command: string): string[] {
	const script = `${remotePath}; (\n${command}\n); printf '\\n${statusMarker}%d\\n' $?`;
	return [...sshOptions, mac.target, `${shellPrefix}${shellQuote(script)}`];
}

/** The script inside the last argument `sshArgs` made (what the Mac's `/bin/sh` is given): for tests and logs that read what a call asked the Mac to run. */
export function scriptOf(remoteCommand: string): string {
	if (!remoteCommand.startsWith(`${shellPrefix}'`) || !remoteCommand.endsWith("'")) return remoteCommand;
	return remoteCommand.slice(shellPrefix.length + 1, -1).replaceAll("'\\''", "'");
}

/** A command line for the remote shell: each word quoted. */
export const words = (parts: readonly string[]): string => parts.map(shellQuote).join(" ");

/** A command line for the remote shell that the Mac itself ends after `seconds` (`perl`'s `alarm`; ssh's timeout ends only this side, and a hung call would go on holding the phone). */
export const boundedWords = (seconds: number, parts: readonly string[]): string => words(["perl", "-e", "alarm shift; exec @ARGV", String(Math.max(1, Math.floor(seconds))), ...parts]);

/** The command's own status from the status line, which is removed from the output. Without the line (ssh failed, or the run was cut off), a 0 from ssh is not believed. */
export function remoteStatus(result: ExecResult): ExecResult {
	const at = result.stdout.lastIndexOf(`\n${statusMarker}`);
	if (at < 0) return result.code === 0 ? { ...result, code: 255, stderr: `${result.stderr}${result.stderr ? "\n" : ""}the Mac sent no exit status` } : result;
	const code = Number.parseInt(result.stdout.slice(at + 1 + statusMarker.length), 10);
	return { ...result, code: Number.isNaN(code) ? 255 : code, stdout: result.stdout.slice(0, at) };
}

export async function remote(mac: Mac, command: string, options: ExecOptions = {}): Promise<ExecResult> {
	return remoteStatus(await mac.run("ssh", sshArgs(mac, command), options));
}

export async function remoteOk(mac: Mac, command: string, options: ExecOptions = {}): Promise<string> {
	const result = await remote(mac, command, options);
	if (result.code !== 0)
		throw new Error(`on ${mac.target}: ${command.slice(0, 200)} exited with ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 600)}`);
	return result.stdout;
}

/** Copies a file or directory from the Mac to `localPath` (a directory is copied into it as `localPath/<name>`). */
export async function scpFrom(mac: Mac, remoteFile: string, localPath: string, options: ExecOptions = {}): Promise<void> {
	const result = await mac.run("scp", ["-q", "-r", ...sshOptions, `${mac.target}:${remoteFile}`, localPath], options);
	if (result.code !== 0) throw new Error(`scp ${mac.target}:${remoteFile} exited with ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`);
}

/** Copies a file from here to the Mac. */
export async function scpTo(mac: Mac, localFile: string, remoteFile: string, options: ExecOptions = {}): Promise<void> {
	const result = await mac.run("scp", ["-q", ...sshOptions, localFile, `${mac.target}:${remoteFile}`], options);
	if (result.code !== 0) throw new Error(`scp to ${mac.target}:${remoteFile} exited with ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`);
}
