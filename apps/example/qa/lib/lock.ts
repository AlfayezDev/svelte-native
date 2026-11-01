import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { emulatorLock } from "./paths.ts";

const heldVariable = "NATIVE_QA_LOCK_HELD";

/**
 * Where the lock of the OVH emulator lives when more than one machine uses the emulator. The OVH host owns it: its own jobs
 * take it with `flock`, a machine that reaches the emulator through an SSH tunnel takes the same file over `ssh`. It is in a
 * directory of its own because `/tmp` is sticky and `fs.protected_regular` would refuse a second user the file.
 */
export const sharedLockDir = "/run/svelte-qa";
export const sharedLockFile = `${sharedLockDir}/emulator.lock`;

export type Lock = { kind: "local"; file: string } | { kind: "remote"; host: string; file: string };

/** Serials that reach the shared OVH emulator: the SSH tunnel on localhost, or a local emulator. */
export function isEmulatorSerial(serial: string): boolean {
	return /^(localhost|127\.0\.0\.1):\d+$/.test(serial) || /^emulator-\d+$/.test(serial);
}

const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * The SSH destination of a tunnel `ssh ... -L [bind:]<port>:<loopback>:<remote port> <destination>`, from the argument list of
 * the process that listens on `port`; null when the process forwards the port somewhere other than the destination's own
 * loopback (then the emulator is not on that host) or has no `-L` for it.
 */
export function forwardHost(argv: string[], port: number): string | null {
	const destination = argv[argv.length - 1];
	if (argv.length < 2 || destination === undefined || destination.startsWith("-")) return null;
	for (let index = 0; index < argv.length - 1; index++) {
		const part = argv[index] as string;
		// the destination is the last word; a forward spec that is the last word has no destination after it
		const spec = part === "-L" && index + 1 < argv.length - 1 ? argv[index + 1] : part.startsWith("-L") && part.length > 2 ? part.slice(2) : undefined;
		if (spec === undefined) continue;
		const fields = spec.split(":");
		// [bind:]port:host:hostport, the host of the IPv6 form in brackets
		const offset = fields.length >= 4 && !fields[0]?.match(/^\d+$/) ? 1 : 0;
		if (Number(fields[offset]) === port && loopback.has(fields[offset + 1] ?? "")) return destination;
	}
	return null;
}

type Run = (command: string, args: string[]) => string;
const runSync: Run = (command, args) => {
	const result = spawnSync(command, args, { encoding: "utf8", timeout: 5000 });
	return result.status === 0 ? result.stdout : "";
};

/** The host an `ssh -L <port>:...` listener on this machine forwards to, or null when nothing of the sort listens on `port`. Linux (`ss`, `/proc`). */
export function tunnelHost(port: number, run: Run = runSync, cmdline: (pid: string) => string = readCmdline): string | null {
	const listener = run("ss", ["-Hltnp", `sport = :${port}`]);
	const pid = /\("ssh",pid=(\d+)/.exec(listener)?.[1];
	if (pid === undefined) return null;
	return forwardHost(cmdline(pid).split("\0").filter(Boolean), port);
}

function readCmdline(pid: string): string {
	try {
		return readFileSync(`/proc/${pid}/cmdline`, "utf8");
	} catch {
		return "";
	}
}

export type LockEnvironment = Record<string, string | undefined>;

/**
 * Which lock a command on `serial` takes, or null for a device that is not the shared emulator.
 *
 * - `NATIVE_QA_LOCK_HOST=<ssh destination>`: the lock file is on that host and is taken over ssh.
 * - `NATIVE_QA_LOCK_HOST=local`: a local `flock`, whatever listens on the port.
 * - unset: `localhost:<port>` served by an `ssh -L <port>:127.0.0.1:...` tunnel on this machine is the OVH emulator, so the
 *   lock is that host's; otherwise it is local.
 * - `NATIVE_QA_LOCK_FILE` names the file (default `/run/svelte-qa/emulator.lock`; a local lock on a machine without that
 *   directory: `/tmp/svelte-qa-emulator.lock`, as before).
 */
export function resolveEmulatorLock(
	serial: string,
	env: LockEnvironment = process.env,
	findTunnel: (port: number) => string | null = tunnelHost,
	sharedDirExists: boolean = existsSync(sharedLockDir),
): Lock | null {
	if (!isEmulatorSerial(serial)) return null;
	const file = env.NATIVE_QA_LOCK_FILE?.trim() || undefined;
	const localFile = file ?? (sharedDirExists ? sharedLockFile : emulatorLock);
	const configured = env.NATIVE_QA_LOCK_HOST?.trim();
	if (configured === "local") return { kind: "local", file: localFile };
	if (configured) return { kind: "remote", host: configured, file: file ?? sharedLockFile };
	const port = /^(?:localhost|127\.0\.0\.1):(\d+)$/.exec(serial)?.[1];
	const host = port === undefined ? null : findTunnel(Number(port));
	return host === null ? { kind: "local", file: localFile } : { kind: "remote", host, file: file ?? sharedLockFile };
}

export function lockFor(serial: string): Lock | null {
	return resolveEmulatorLock(serial);
}

export function describeLock(lock: Lock): string {
	return lock.kind === "local" ? lock.file : `${lock.host}:${lock.file}`;
}

/** Locks are named in the held list by where they are, so a lock taken by a parent is never taken twice. */
export function lockKey(lock: Lock): string {
	return describeLock(lock);
}

export function isHeld(lock: Lock, env: LockEnvironment = process.env): boolean {
	return env[heldVariable]?.split("|").includes(lockKey(lock)) ?? false;
}

export type HoldOptions = {
	/** Seconds to wait for the lock; 0 or absent: until it is free. `NATIVE_QA_LOCK_WAIT` when absent. */
	wait?: number | undefined;
	env?: LockEnvironment | undefined;
	/** A remote lock is kept by a heartbeat on the ssh session; the other side lets go after this many seconds without one. */
	deadmanSeconds?: number | undefined;
	heartbeatMs?: number | undefined;
};

const waitExit = 75;

function waitSeconds(options: HoldOptions): number {
	const wait = options.wait ?? Number(process.env.NATIVE_QA_LOCK_WAIT ?? 0);
	return Number.isFinite(wait) && wait > 0 ? Math.floor(wait) : 0;
}

/** The environment a command under `lock` runs with: the lock is marked held, so its own `native-qa` calls do not take it again. */
function heldEnvironment(lock: Lock, env: LockEnvironment): NodeJS.ProcessEnv {
	const held = [env[heldVariable], lockKey(lock)].filter(Boolean).join("|");
	return { ...env, [heldVariable]: held };
}

function shellQuote(text: string): string {
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * What runs on the host that owns a remote lock. It opens the file read-only (so a second user can), takes `flock` on the
 * descriptor, says `LOCKED` and keeps it until the other end stops sending lines: the ssh session ending closes stdin and
 * `read` returns at once; a session that only went silent (a dead network) is let go after `$dead` seconds. No single quotes:
 * it is passed as one quoted word.
 */
const remoteHolder = `file=$1; wait=$2; dead=$3
dir=$(dirname "$file")
[ -d "$dir" ] || mkdir -p -m 2775 "$dir" 2>/dev/null
[ -e "$file" ] || { : > "$file" && chmod 0666 "$file"; } 2>/dev/null
exec 9<"$file" || { echo "cannot open $file" >&2; exit 74; }
flock -n 9 || echo WAITING
if [ "$wait" -gt 0 ]; then flock -w "$wait" 9 || exit ${waitExit}; else flock 9 || exit 74; fi
echo LOCKED
while IFS= read -r -t "$dead" _; do :; done
`;

/**
 * `ssh` arguments for the session that holds a remote lock. The user's ssh configuration applies as it is, a multiplexed
 * connection included (the channel closes with the command, and a master that dies takes the lock with it, which the harness notices).
 */
export function remoteArguments(lock: Extract<Lock, { kind: "remote" }>, wait: number, deadmanSeconds: number): string[] {
	const remote = ["bash", "-c", shellQuote(remoteHolder), "bash", shellQuote(lock.file), String(wait), String(deadmanSeconds)].join(" ");
	return [
		"-T",
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=15",
		"-o", "ServerAliveInterval=15",
		"-o", "ServerAliveCountMax=4",
		lock.host,
		remote,
	];
}

const signals = ["SIGINT", "SIGTERM"] as const;

function exitCode(code: number | null, signal: NodeJS.Signals | null): number {
	return code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
}

/** Runs `command` with no lock (a device that has none, or a lock a parent holds already), forwarding Ctrl-C and termination. */
export async function runPlain(command: string[], env: LockEnvironment = process.env): Promise<number> {
	const [program, ...args] = command;
	if (program === undefined) throw new Error("no command to run");
	const child = spawn(program, args, { stdio: "inherit", env });
	const forward = (signal: NodeJS.Signals) => child.kill(signal);
	for (const signal of signals) process.on(signal, forward);
	try {
		return await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (status, signal) => resolve(exitCode(status, signal)));
		});
	} finally {
		for (const signal of signals) process.off(signal, forward);
	}
}

/** Runs `command` while this process holds `lock`, and returns its exit status (1 when the lock was lost on the way). */
export async function runUnderLock(lock: Lock, command: string[], options: HoldOptions = {}): Promise<number> {
	const [program, ...args] = command;
	if (program === undefined) throw new Error("no command to run under the lock");
	const env = heldEnvironment(lock, options.env ?? process.env);
	const wait = waitSeconds(options);
	if (lock.kind === "local") {
		const flockArguments = wait > 0 ? ["-w", String(wait), "-E", String(waitExit)] : [];
		const child = spawn("flock", [...flockArguments, lock.file, program, ...args], { stdio: "inherit", env });
		const forward = (signal: NodeJS.Signals) => child.kill(signal);
		for (const signal of signals) process.on(signal, forward);
		try {
			const code = await new Promise<number>((resolve, reject) => {
				child.once("error", reject);
				child.once("close", (status, signal) => resolve(exitCode(status, signal)));
			});
			if (code === waitExit && wait > 0) throw new Error(`gave up waiting for ${describeLock(lock)} after ${wait} s`);
			return code;
		} finally {
			for (const signal of signals) process.off(signal, forward);
		}
	}
	return runUnderRemoteLock(lock, program, args, env, wait, options);
}

async function runUnderRemoteLock(
	lock: Extract<Lock, { kind: "remote" }>,
	program: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	wait: number,
	options: HoldOptions,
): Promise<number> {
	const deadman = options.deadmanSeconds ?? 300;
	const ssh = spawn("ssh", remoteArguments(lock, wait, deadman), { stdio: ["pipe", "pipe", "inherit"] });
	ssh.stdin.on("error", () => undefined);
	const closed = new Promise<number>((resolve) => ssh.once("close", (status, signal) => resolve(exitCode(status, signal))));
	let output = "";
	const locked = new Promise<void>((resolve, reject) => {
		ssh.once("error", (error) => reject(new Error(`cannot start ssh for the lock on ${lock.host}: ${error.message}`)));
		ssh.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			let newline = output.indexOf("\n");
			while (newline >= 0) {
				const line = output.slice(0, newline).trim();
				output = output.slice(newline + 1);
				if (line === "WAITING") console.log(`${describeLock(lock)} is held; waiting for it`);
				if (line === "LOCKED") resolve();
				newline = output.indexOf("\n");
			}
		});
		void closed.then((status) =>
			reject(
				new Error(
					status === waitExit
						? `gave up waiting for ${describeLock(lock)} after ${wait} s`
						: `ssh to ${lock.host} ended (${status}) before the lock on ${lock.file} was taken`,
				),
			),
		);
	});
	await locked;
	const beat = setInterval(() => ssh.stdin.write("hb\n"), options.heartbeatMs ?? 30_000);
	const child = spawn(program, args, { stdio: "inherit", env });
	const forward = (signal: NodeJS.Signals) => child.kill(signal);
	for (const signal of signals) process.on(signal, forward);
	let finished = false;
	let lost = false;
	void closed.then(() => {
		if (finished) return;
		lost = true;
		console.error(`the session that holds ${describeLock(lock)} ended while the command ran: the lock is lost, stopping the command`);
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
	});
	try {
		const code = await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (status, signal) => resolve(exitCode(status, signal)));
		});
		return lost ? 1 : code;
	} finally {
		finished = true;
		clearInterval(beat);
		for (const signal of signals) process.off(signal, forward);
		ssh.stdin.end();
		const timer = setTimeout(() => ssh.kill("SIGKILL"), 5000);
		await closed;
		clearTimeout(timer);
	}
}

/**
 * Runs the current command line again under `lock` and exits with its status. The child sees NATIVE_QA_LOCK_HELD and
 * continues. Returns when the lock is already held.
 */
export async function reexecUnderLock(lock: Lock | string, argv: string[]): Promise<void> {
	const resolved: Lock = typeof lock === "string" ? { kind: "local", file: lock } : lock;
	if (isHeld(resolved)) return;
	const script = process.argv[1];
	if (!script) throw new Error("cannot determine the script path to re-run under the lock");
	console.log(`waiting for ${describeLock(resolved)}`);
	process.exit(await runUnderLock(resolved, [process.execPath, ...process.execArgv, script, ...argv]));
}

/**
 * One lock per EAS channel, taken for every device: two runs publishing to the same channel at once would each see the other's
 * updates as the channel's head and could leave it on a bad one. The name is a validated QA channel (`qaChannel`), so it is a safe file name.
 */
export function channelLock(channel: string): string {
	if (!/^qa(-[a-z0-9]+)*$/.test(channel)) throw new Error(`not a QA channel: ${JSON.stringify(channel)}`);
	return `/tmp/svelte-qa-channel-${channel}.lock`;
}
