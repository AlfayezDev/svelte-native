import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";

export type ExecResult = { code: number; stdout: string; stderr: string };
/** `env` is added to the caller's environment, or with `exactEnv` it is the child's whole environment. */
export type ExecOptions = { cwd?: string; env?: Record<string, string>; timeoutMs?: number; exactEnv?: boolean };

const maxBuffer = 512 * 1024 * 1024;

/** Runs a command to completion. A non-zero exit is a result; a missing binary or a timeout rejects. */
export function exec(
	command: string,
	args: string[],
	options: ExecOptions = {},
): Promise<ExecResult> {
	const timeoutMs = options.timeoutMs ?? 120_000;
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{
				cwd: options.cwd,
				env: options.exactEnv ? options.env : { ...process.env, ...options.env },
				timeout: timeoutMs,
				maxBuffer,
				encoding: "utf8",
			},
			(error, stdout, stderr) => {
				if (!error) return resolve({ code: 0, stdout, stderr });
				if (error.killed)
					return reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs} ms`));
				if (typeof error.code === "number") return resolve({ code: error.code, stdout, stderr });
				reject(new Error(`${command} ${args.join(" ")}: ${error.message}`));
			},
		);
	});
}

export async function execOk(
	command: string,
	args: string[],
	options: ExecOptions = {},
): Promise<string> {
	const result = await exec(command, args, options);
	if (result.code !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited with ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 600)}`,
		);
	}
	return result.stdout;
}

/** Single-quotes a value for a remote POSIX shell, as `adb shell` hands its arguments to one. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Runs a long command with stdout and stderr appended to a log file; resolves with the exit code. */
export function execToFile(
	command: string,
	args: string[],
	logPath: string,
	options: ExecOptions = {},
): Promise<number> {
	const timeoutMs = options.timeoutMs ?? 1_800_000;
	return new Promise((resolve, reject) => {
		const log = openSync(logPath, "a");
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["ignore", log, log],
		});
		const deadline = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		child.on("error", (error) => {
			clearTimeout(deadline);
			closeSync(log);
			reject(error);
		});
		child.on("close", (code, signal) => {
			clearTimeout(deadline);
			closeSync(log);
			if (code === null)
				reject(
					new Error(
						`${command} ${args.join(" ")} was stopped by ${signal ?? "a signal"} (timeout ${timeoutMs} ms)`,
					),
				);
			else resolve(code);
		});
	});
}
