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

export function sshArgs(mac: Mac, command: string): string[] {
	return [...sshOptions, mac.target, `${remotePath}; ${command}`];
}

/** A command line for the remote shell: each word quoted. */
export const words = (parts: readonly string[]): string => parts.map(shellQuote).join(" ");

export function remote(mac: Mac, command: string, options: ExecOptions = {}): Promise<ExecResult> {
	return mac.run("ssh", sshArgs(mac, command), options);
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
