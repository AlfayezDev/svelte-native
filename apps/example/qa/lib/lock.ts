import { spawnSync } from "node:child_process";
import { emulatorLock } from "./paths.ts";

const heldVariable = "NATIVE_QA_LOCK_HELD";

/** Serials that reach the shared OVH emulator: the SSH tunnel on localhost, or a local emulator. */
export function isEmulatorSerial(serial: string): boolean {
	return /^(localhost|127\.0\.0\.1):\d+$/.test(serial) || /^emulator-\d+$/.test(serial);
}

export function lockFor(serial: string): string | null {
	return isEmulatorSerial(serial) ? emulatorLock : null;
}

/**
 * Runs the current command line again under `flock <lockfile>` and exits with its status. The
 * child sees NATIVE_QA_LOCK_HELD and continues. Returns when the lock is already held.
 */
export function reexecUnderLock(lockfile: string, argv: string[]): void {
	if (process.env[heldVariable]?.split(":").includes(lockfile)) return;
	const script = process.argv[1];
	if (!script) throw new Error("cannot determine the script path to re-run under flock");
	console.log(`waiting for ${lockfile}`);
	const held = [process.env[heldVariable], lockfile].filter(Boolean).join(":");
	const result = spawnSync(
		"flock",
		[lockfile, process.execPath, ...process.execArgv, script, ...argv],
		{
			stdio: "inherit",
			env: { ...process.env, [heldVariable]: held },
		},
	);
	if (result.error) throw result.error;
	process.exit(result.status ?? 1);
}

/**
 * One lock per EAS channel, taken for every device: two runs publishing to the same channel at once would each see the other's
 * updates as the channel's head and could leave it on a bad one. The name is a validated QA channel (`qaChannel`), so it is a safe file name.
 */
export function channelLock(channel: string): string {
	if (!/^qa(-[a-z0-9]+)*$/.test(channel)) throw new Error(`not a QA channel: ${JSON.stringify(channel)}`);
	return `/tmp/svelte-qa-channel-${channel}.lock`;
}
