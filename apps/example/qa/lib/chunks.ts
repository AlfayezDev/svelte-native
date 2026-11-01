import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { assertOnline } from "./adb.ts";
import { lockFor, type LockEnvironment } from "./lock.ts";
import { qaDir } from "./paths.ts";

/**
 * Chunks of a matrix run (`parity`, `a11y`): the same design as `crashes --chunk` (soak/crashes.ts), for suites whose result is a list of cases.
 *
 * - `--limit <n>` runs at most `n` new cases, writes the run file and ends with status [limitReached] when cases are left.
 * - `--resume` continues the device's newest run file of the kind: the cases it holds are done, the others are run, and the file keeps its name.
 * - `--fresh` restarts the emulator once the lock is held, before the run ([restartEmulator]).
 * - `--chunk <n>` is the parent: several commands of `--limit n` one after the other, each continuing the file of the one before, on a fresh
 *   emulator (the emulator's graphics stack leaks host memory with every app launch, so a matrix of hundreds of cases outgrows one instance);
 *   each takes and releases the emulator lock on its own, so the other agents get the device between chunks.
 */
export const chunkOptions = {
	resume: { type: "boolean" },
	limit: { type: "string" },
	fresh: { type: "boolean" },
	chunk: { type: "string" },
} as const;

/** What a run that stopped at its `--limit` with cases left ends with: not a failure, and not done. */
export const limitReached = 3;

/** Where the cases of a run are ordered: the names, in the order the run takes them. */
export type Plan = {
	/** The cases this run takes, in order. */
	run: ReadonlySet<string>;
	/** Cases the run file lacks and this run leaves for the next one. */
	left: number;
};

/** The first [limit] cases of [ordered] that [done] does not hold (all of them when [limit] is 0). */
export function planCases(ordered: readonly string[], done: ReadonlySet<string>, limit: number): Plan {
	const pending = ordered.filter((name) => !done.has(name));
	const taken = limit > 0 ? pending.slice(0, limit) : pending;
	return { run: new Set(taken), left: pending.length - taken.length };
}

/**
 * Why a run file cannot be continued by this command, or null when it can: its cases must all be ones this run selects (the same
 * `--filter` and `--quick`), it must be the same kind of run (`mode`: a check is not continued by an update) and have measured the
 * installed build. A file whose build could not be identified, or a build that could not be hashed now, cannot prove it, so it is refused too.
 */
export function resumeMismatch(
	resumed: { names: readonly string[]; mode?: string; installedSha256: string | null },
	current: { selected: ReadonlySet<string>; mode?: string; installedSha256: string | null },
): string | null {
	const differences: string[] = [];
	const stray = resumed.names.filter((name) => !current.selected.has(name));
	if (stray.length > 0) differences.push(`${stray.length} of its cases are not selected now (${stray.slice(0, 3).join(", ")}${stray.length > 3 ? ", ..." : ""}): another --filter or --quick`);
	if (resumed.mode !== current.mode) differences.push(`mode ${JSON.stringify(resumed.mode ?? null)} in the file, ${JSON.stringify(current.mode ?? null)} now`);
	if (resumed.installedSha256 === null || current.installedSha256 === null) differences.push("the installed build could not be identified on one side");
	else if (resumed.installedSha256.slice(0, 12) !== current.installedSha256.slice(0, 12)) differences.push(`installed build ${resumed.installedSha256.slice(0, 12)} in the file, ${current.installedSha256.slice(0, 12)} now`);
	return differences.length === 0 ? null : differences.join("; ");
}

export type ChunkFlags = Record<string, string | boolean | undefined>;

/**
 * The flags of a chunk's command: everything the caller passed except those that describe the chunking, then this chunk's own. A chunk
 * after the first continues the file (`--resume`) on a fresh emulator (`--fresh`) and does not install the build again: the emulator keeps
 * its userdata, and a file continued with another build is refused.
 */
export function chunkArgs(command: string, values: ChunkFlags, chunk: number, index: number): string[] {
	const skipped = new Set(["chunk", "limit", "resume", "fresh", ...(index > 0 ? ["apk", "no-install"] : [])]);
	const args = [command, "--limit", String(chunk)];
	if (index > 0 || values.resume === true) args.push("--resume");
	if (index > 0 || values.fresh === true) args.push("--fresh");
	if (index > 0) args.push("--no-install");
	for (const [name, value] of Object.entries(values)) {
		if (skipped.has(name) || value === undefined || value === false) continue;
		args.push(`--${name}`);
		if (typeof value === "string") args.push(value);
	}
	return args;
}

/** What the parent does with the status a chunk ended with: go on, stop, or fail with the hint to continue. */
export type ChunkStep = (args: string[], index: number) => number;

/**
 * Runs chunks until one ends with status 0 (the matrix is done) and returns how many it took. A chunk that ends with [limitReached] is followed
 * by the next; any other status stops the run with the command to continue it. [maxChunks] bounds a loop whose chunks stop making progress.
 */
export function runChunks(command: string, values: ChunkFlags, chunk: number, step: ChunkStep, maxChunks = 10_000): number {
	for (let index = 0; index < maxChunks; index++) {
		const args = chunkArgs(command, values, chunk, index);
		console.log(`chunk ${index + 1}: ${args.slice(1).join(" ")}`);
		const status = step(args, index);
		if (status === 0) return index + 1;
		if (status !== limitReached) throw new Error(`chunk ${index + 1} ended with status ${status}; continue with the same command plus --resume`);
	}
	throw new Error(`${maxChunks} chunks and the matrix is not done: continue with the same command plus --resume`);
}

/** The chunks as child processes of this same script, with the caller's stdio. */
export function spawnChunk(args: string[]): number {
	const script = process.argv[1];
	if (!script) throw new Error("cannot determine the script path to run the chunks");
	const result = spawnSync(process.execPath, [...process.execArgv, script, ...args], { stdio: "inherit" });
	if (result.error) throw result.error;
	return result.status ?? 1;
}

/**
 * The script that restarts the emulator (`restart <reason>`, the contract of `qa/ci/emulator.sh`): `QA_EMULATOR_SH`, else `qa/ci/emulator-remote.sh`
 * for an emulator behind an ssh tunnel (its lock is on the host) and `qa/ci/emulator.sh` for one on this machine. Null for a device that is not the
 * shared emulator.
 */
export function emulatorScript(serial: string, env: LockEnvironment = process.env, lock = lockFor(serial)): string | null {
	const configured = env.QA_EMULATOR_SH?.trim();
	if (configured) return configured;
	if (lock === null) return null;
	return join(qaDir, "ci", lock.kind === "remote" ? "emulator-remote.sh" : "emulator.sh");
}

/**
 * A fresh emulator: the script's `restart`, which returns once the guest has booted and adb answers. Called with the emulator lock held, so nobody
 * is hurt by it. A device that is not the shared emulator (a phone) has nothing to restart, and `--fresh` on it is an error.
 */
export async function restartEmulator(
	serial: string,
	reason: string,
	steps: { script?: string | null; run?: (script: string, reason: string) => Promise<number>; online?: (serial: string) => Promise<void> } = {},
): Promise<void> {
	const script = steps.script === undefined ? emulatorScript(serial) : steps.script;
	if (script === null) throw new Error(`--fresh restarts the shared emulator; ${serial} is not one`);
	console.log(`fresh emulator: bash ${script} restart`);
	const status = await (steps.run ?? runScript)(script, reason);
	if (status !== 0) throw new Error(`${script} restart ended with status ${status}`);
	await (steps.online ?? assertOnline)(serial);
}

function runScript(script: string, reason: string): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const child = spawn("bash", [script, "restart", reason], { stdio: "inherit" });
		child.once("error", reject);
		child.once("close", (status) => resolve(status ?? 1));
	});
}
