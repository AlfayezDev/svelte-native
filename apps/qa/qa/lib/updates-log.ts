import { findFaults, parseLaunchMarkers, parseLines } from "../parse/logcat.ts";

/** The bundle a process launched, as the `SvelteUpdates` module logs it at process start. */
export type RunningBundle =
	| { kind: "embedded"; builtAt: number }
	| { kind: "update"; id: string; createdAt: number };

/** How the check that runs after the first commit ended, as the client logs it (`checkOnLaunch` in `client.ts`). */
export type UpdateCheck =
	| { outcome: "downloaded"; id: string }
	| { outcome: "none"; reason: string }
	| { outcome: "rollback" }
	| { outcome: "failed" };

/** The `[Svelte QA updates]` line of the QA app (`update-probe.ts`): which bundle runs, and how the build is set up to update. */
export type UpdateProbe = {
	enabled: boolean;
	updateId: string | null;
	embedded: boolean;
	createdAt: number | null;
	runtimeVersion: string | null;
	channel: string | null;
	checkOnLaunch: string | null;
	marker: string | null;
};

/** What the logcat of one launch (cleared before it) shows of the updates flow. */
export type UpdateObservation = {
	running: RunningBundle | null;
	/** The host reached its first commit (`[Svelte boot]`). */
	booted: boolean;
	probe: UpdateProbe | null;
	check: UpdateCheck | null;
	/** Updates this start found marked as never having reached their first commit: the failed launch it recovered from. */
	failedIds: string[];
	/** Updates whose previous launch was never confirmed and recorded no fatal: forgiven once, they fail at the next such launch. */
	unconfirmedIds: string[];
	/** The QA app honoured a reset request at this start (`QaReset.kt`): the token, and how many downloaded updates it forgot. */
	reset: { token: string; forgotten: number } | null;
	crashes: number;
	jsErrors: number;
	displayMs: number | null;
};

const updateId = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const launchingUpdate = new RegExp(`^Launching update (${updateId}) \\(created (\\d+)\\)`);
const launchingEmbedded = /^Launching the embedded bundle \(built (\d+)\)/;
const qaReset = /^QA reset \(([^)]+)\): forgot (\d+) update\(s\)/;
// A failed update: the launch recorded a fatal error, or was the second in a row nobody confirmed (and, from builds before the healthy window, one that never reached its first commit).
const failedLaunch = new RegExp(`^Update (${updateId}) (?:recorded a fatal error before its launch was confirmed|did not confirm its launch \\d+ times in a row|did not reach its first commit)`);
// A launch nobody confirmed that is forgiven once: the update is launched again and fails at the next unconfirmed launch.
const unconfirmedLaunch = new RegExp(`^Update (${updateId}) did not confirm its launch \\(launch (\\d+) of (\\d+)`);
const downloaded = new RegExp(`^\\[Svelte updates\\] Update (${updateId}) downloaded; it launches on the next start`);
const noUpdate = /^\[Svelte updates\] No update to download \((\w+)\)/;
const rolledBack = /^\[Svelte updates\] Rolled back to the embedded bundle/;
// A failed check is a `console.warn` with the error as a second argument, which logcat prints with the first one quoted.
const checkFailed = /^'?\[Svelte updates\] Update check failed/;
const probeLine = "[Svelte QA updates] ";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProbe(json: string): UpdateProbe | null {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch {
		return null;
	}
	if (!isRecord(value)) return null;
	const text = (key: string) => (typeof value[key] === "string" ? value[key] : null);
	return {
		enabled: value.enabled === true,
		updateId: text("updateId"),
		embedded: value.embedded !== false,
		createdAt: typeof value.createdAt === "number" ? value.createdAt : null,
		runtimeVersion: text("runtimeVersion"),
		channel: text("channel"),
		checkOnLaunch: text("checkOnLaunch"),
		marker: text("marker"),
	};
}

/**
 * The updates flow of one launch from its logcat: the bundle the module chose (`SvelteUpdates` tag), the update ids it recovered from,
 * the app's own report of what runs, and how the check ended. The first line of each kind wins; the log is of a single process.
 */
export function parseUpdateObservation(text: string, packageName: string): UpdateObservation {
	let running: RunningBundle | null = null;
	let probe: UpdateProbe | null = null;
	let check: UpdateCheck | null = null;
	let booted = false;
	let reset: UpdateObservation["reset"] = null;
	const failedIds: string[] = [];
	const unconfirmedIds: string[] = [];
	for (const line of parseLines(text)) {
		if (line.tag === "SvelteUpdates") {
			const update = launchingUpdate.exec(line.message);
			const embedded = launchingEmbedded.exec(line.message);
			const failed = failedLaunch.exec(line.message);
			const forgot = qaReset.exec(line.message);
			const forgiven = unconfirmedLaunch.exec(line.message);
			if (forgiven?.[1] && !unconfirmedIds.includes(forgiven[1])) unconfirmedIds.push(forgiven[1]);
			if (forgot?.[1] && forgot[2] && reset === null) reset = { token: forgot[1], forgotten: Number(forgot[2]) };
			if (running === null && update?.[1] && update[2]) running = { kind: "update", id: update[1], createdAt: Number(update[2]) };
			else if (running === null && embedded?.[1]) running = { kind: "embedded", builtAt: Number(embedded[1]) };
			if (failed?.[1] && !failedIds.includes(failed[1])) failedIds.push(failed[1]);
			continue;
		}
		if (line.tag !== "ReactNativeJS") continue;
		if (line.message.includes("[Svelte boot]")) booted = true;
		if (line.message.startsWith(probeLine) && probe === null) probe = parseProbe(line.message.slice(probeLine.length).trim());
		if (check !== null) continue;
		const download = downloaded.exec(line.message);
		const none = noUpdate.exec(line.message);
		if (download?.[1]) check = { outcome: "downloaded", id: download[1] };
		else if (none?.[1]) check = { outcome: "none", reason: none[1] };
		else if (rolledBack.test(line.message)) check = { outcome: "rollback" };
		else if (checkFailed.test(line.message)) check = { outcome: "failed" };
	}
	const faults = findFaults(text, packageName);
	return {
		running,
		booted,
		probe,
		check,
		failedIds,
		unconfirmedIds,
		reset,
		crashes: faults.crashes.length,
		jsErrors: faults.jsErrors.length,
		displayMs: parseLaunchMarkers(text, packageName).displayMs,
	};
}

export type SettledBy = "check" | "boot" | "fault" | "timeout";

export type SettleOptions = {
	/** How long a launch may take in all (a download of the bundle included). */
	timeoutMs: number;
	/** After a fault in a bundle that has not booted, how long the log is read on: the fatal and the lines after it. */
	faultGraceMs: number;
	/** After the first commit of a build that does not check on launch. */
	bootGraceMs: number;
};

export const defaultSettle: SettleOptions = { timeoutMs: 90_000, faultGraceMs: 6_000, bootGraceMs: 4_000 };

/**
 * Whether a launch has shown everything it will, or null while it may still. A booted app that checks on launch is done when the
 * check ended (a download is part of it); one that does not check is done a moment after the host booted; a bundle that threw
 * before the first commit never boots, so it is done a moment after its fatal.
 */
export function launchSettled(observation: UpdateObservation, elapsedMs: number, options: SettleOptions = defaultSettle): SettledBy | null {
	if (observation.booted && observation.check !== null) return "check";
	if (observation.booted && observation.probe !== null && observation.probe.checkOnLaunch !== "ALWAYS" && elapsedMs >= options.bootGraceMs) return "boot";
	// A bundle that threw before its first commit never boots; one that threw after it did boot, and its host died before the check.
	if (observation.crashes > 0 && observation.check === null && elapsedMs >= options.faultGraceMs) return "fault";
	return elapsedMs >= options.timeoutMs ? "timeout" : null;
}

/** The id a launch ran, or null for the embedded bundle (or no `SvelteUpdates` line at all). */
export function runningId(observation: Pick<UpdateObservation, "running">): string | null {
	return observation.running?.kind === "update" ? observation.running.id : null;
}
