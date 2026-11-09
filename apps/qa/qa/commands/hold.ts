import { flagString, parseFlags, requireString } from "../lib/flags.ts";
import { describeLock, isHeld, lockFor, runPlain, runUnderLock } from "../lib/lock.ts";

/**
 * `native-qa hold --device <serial> [--wait <s>] -- <command...>`: runs a command that is several harness calls (a CI lane, an
 * agent's own sequence) while holding the emulator lock the way one `lab` does, so nobody else uses the device between them.
 * The calls inside see the lock as held and do not take it again. A device that is not the shared emulator has no lock: the
 * command just runs.
 */
export async function hold(argv: string[]): Promise<void> {
	const split = argv.indexOf("--");
	if (split < 0 || split === argv.length - 1) throw new Error("usage: native-qa hold --device <serial> [--wait <seconds>] -- <command...>");
	const { values } = parseFlags(argv.slice(0, split), { device: { type: "string" }, wait: { type: "string" } });
	const serial = requireString(values.device, "device");
	const command = argv.slice(split + 1);
	const wait = flagString(values.wait);
	const lock = lockFor(serial);
	if (lock === null || isHeld(lock)) process.exit(await runPlain(command));
	console.log(`waiting for ${describeLock(lock)}`);
	process.exit(await runUnderLock(lock, command, { wait: wait === undefined ? undefined : Number(wait) }));
}
