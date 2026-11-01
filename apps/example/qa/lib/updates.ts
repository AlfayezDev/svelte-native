import { summarize, type Summary } from "../parse/stats.ts";
import { runningId, type SettledBy, type UpdateObservation } from "./updates-log.ts";
import type { AppInfo, DeviceInfo, Launch, Metrics, Source } from "./types.ts";

/** One launch of the run: what logcat showed, in which phase of the scenario it was started, and why the harness stopped reading it. */
export type UpdateLaunch = UpdateObservation & {
	/** 1-based, over the whole run. */
	index: number;
	phase: "baseline" | "head" | "apply" | "bad" | "rollback" | "settled" | "cleanup";
	settledBy: SettledBy;
};

/** `head`: the known-good update the run starts from, so whatever an earlier run left at the channel's head is not what the run measures. */
export type UpdateKind = "head" | "good" | "bad" | "cleanup";

/** The ways a bad update fails: it cannot load, or its first screen throws after the first commit (in `onMount`, in an `$effect`). */
export type BadFault = "boot" | "mount" | "effect";
export const badFaults: readonly BadFault[] = ["boot", "mount", "effect"];

/** An update the harness published: the id the device reports when it runs it, and the marker planted in its bundle. */
export type PublishedUpdate = {
	kind: UpdateKind;
	fault: BadFault | null;
	id: string;
	group: string;
	/** The branch `eas update` says it published to; the run requires the channel's own. */
	branch: string | null;
	marker: string;
	message: string;
	createdAt: string;
};

/** Every call to publish, whether or not eas-cli's answer could be read: the server may have taken the update either way. */
export type PublishAttempt = { kind: UpdateKind; fault: BadFault | null; outcome: "published" | "failed"; id: string | null; error: string | null };

/**
 * Everything the scenario needs from the world: an Android device with the channel build installed and an EAS channel. Behind this
 * interface the scenario logic runs against a model of the client in the unit tests, and against adb and eas-cli on a device.
 */
export interface UpdatesDriver {
	launch(phase: UpdateLaunch["phase"]): Promise<UpdateLaunch>;
	publish(kind: UpdateKind, fault?: BadFault): Promise<PublishedUpdate>;
	/** The warm launches of the channel build in the state the scenario left it in (`boot --warm`). */
	bootSeries(): Promise<Launch[]>;
}

export type ScenarioOptions = {
	/** Launches allowed for an update to start running, or for a bad one to be recovered from. */
	maxLaunches: number;
	/** Launches after the recovery, to see the bad update is not tried again. At least 1: without them nothing shows it is not. */
	settleLaunches: number;
	/** The first start should report that the QA app honoured a reset request (the run reset the store through the app, not by clearing data). */
	expectReset?: boolean;
	/** The bad updates to publish, in order; all of `badFaults` by default. */
	faults?: readonly BadFault[];
};

export type HeadPhase = { published: PublishedUpdate | null; launches: UpdateLaunch[]; verified: boolean };

export type GoodPhase = {
	published: PublishedUpdate | null;
	launches: UpdateLaunch[];
	/** Launches from the publish until the update ran (1 = the first start after publishing already ran it). */
	launchesToApply: number | null;
	applied: boolean;
	/** The running update's bundle reported the marker the harness planted in it: the bundle that executes is the published one. */
	markerSeen: boolean;
};

export type BadPhase = {
	fault: BadFault;
	published: PublishedUpdate | null;
	launches: UpdateLaunch[];
	/** The launch that ran the bad update; null when none did. */
	ran: number | null;
	/** The bad update did not reach its first commit, or threw after it, when it ran (its planted fault fired). */
	faultTriggered: boolean | null;
	rolledBack: boolean;
	/** `embedded`, or the id of the update the start after the bad one ran. */
	rolledBackTo: string | null;
	/** The id the start after the bad one reported as a failed launch. */
	failedIdReported: string | null;
	/** Launches after the bad one that ran it again, plus the ones that downloaded it again. */
	retried: number;
	/** Checks after the bad one that the client refused with `updatePreviouslyFailed`. */
	blockedChecks: number;
	launchesAfter: number;
	/** Every launch after the bad one was read to its end and its check was the client's refusal: only then does `retried: 0` say anything. */
	evidence: boolean;
};

export type CleanupPhase = { published: PublishedUpdate | null; launches: UpdateLaunch[]; healthy: boolean };

export type UpdatesScenario = {
	head: HeadPhase;
	baseline: UpdateLaunch | null;
	/** The first start after a clean install ran the bundle embedded in the app. */
	baselineEmbedded: boolean;
	good: GoodPhase;
	bads: BadPhase[];
	cleanup: CleanupPhase;
	/** Launches that crashed or logged a JavaScript error, other than the ones that ran a bad update; null when some launch was not read to its end, so none can be said to have been clean. */
	unexpectedFaults: number | null;
	/** The warm launches of the channel build, taken once the channel is healthy again. */
	bootEnabled: Launch[];
	attempts: PublishAttempt[];
	errors: string[];
	/** What a reader should know that is not a failure. */
	notes: string[];
};

const emptyGood = (): GoodPhase => ({ published: null, launches: [], launchesToApply: null, applied: false, markerSeen: false });
const emptyBad = (fault: BadFault): BadPhase => ({ fault, published: null, launches: [], ran: null, faultTriggered: null, rolledBack: false, rolledBackTo: null, failedIdReported: null, retried: 0, blockedChecks: 0, launchesAfter: 0, evidence: false });

const faulty = (launch: UpdateLaunch) => launch.crashes > 0 || launch.jsErrors > 0;
/** The log of the launch was read to its end: the module said what it launched, and the read ended on the check, the boot or the fatal, not on the timeout. */
const observed = (launch: UpdateLaunch) => launch.running !== null && launch.settledBy !== "timeout";

/** Launches until `reached` holds for one of them, at most `max`; the launch that satisfied it is the last of the list. */
async function launchUntil(driver: UpdatesDriver, phase: UpdateLaunch["phase"], max: number, reached: (launch: UpdateLaunch) => boolean): Promise<{ launches: UpdateLaunch[]; found: UpdateLaunch | null }> {
	const launches: UpdateLaunch[] = [];
	for (let count = 0; count < max; count++) {
		const launch = await driver.launch(phase);
		launches.push(launch);
		if (reached(launch)) return { launches, found: launch };
	}
	return { launches, found: null };
}

/** Publishes through the driver and records the attempt, so a publish whose answer was lost still counts as one that may have reached the channel. */
async function publish(driver: UpdatesDriver, result: UpdatesScenario, kind: UpdateKind, fault?: BadFault): Promise<PublishedUpdate> {
	const attempt: PublishAttempt = { kind, fault: fault ?? null, outcome: "failed", id: null, error: null };
	result.attempts.push(attempt);
	try {
		const published = await driver.publish(kind, fault);
		attempt.outcome = "published";
		attempt.id = published.id;
		return published;
	} catch (error) {
		attempt.error = error instanceof Error ? error.message : String(error);
		throw error;
	}
}

/** Publishes a known-good update first and starts the app until it runs: from here on the channel's head is something the run knows. */
async function prepareHead(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario): Promise<void> {
	result.head.published = await publish(driver, result, "head");
}

async function verifyHead(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario): Promise<void> {
	const head = result.head.published;
	if (!head) return;
	// The first start already downloaded it (the baseline's check); the next one runs it.
	const { launches, found } = await launchUntil(driver, "head", options.maxLaunches, (launch) => runningId(launch) === head.id && launch.booted);
	result.head.launches = launches;
	result.head.verified = found !== null && found.probe?.marker === head.marker;
	if (!result.head.verified) result.errors.push(`the starting update ${head.id} did not run with its marker within ${options.maxLaunches} launches: the channel's head is not known, so the measurements after it are not either`);
}

/** Publishes a good update and starts the app until the update runs with its marker: the policy is that one start downloads it and the next runs it. */
async function applyGood(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario): Promise<void> {
	const published = await publish(driver, result, "good");
	result.good.published = published;
	const { launches, found } = await launchUntil(driver, "apply", options.maxLaunches, (launch) => runningId(launch) === published.id && launch.booted);
	result.good.launches = launches;
	result.good.launchesToApply = found ? launches.length : null;
	result.good.markerSeen = found?.probe?.marker === published.marker;
	result.good.applied = found !== null && result.good.markerSeen;
	if (found && !result.good.markerSeen)
		result.errors.push(`update ${published.id} runs but reports the marker ${JSON.stringify(found.probe?.marker ?? null)}, not ${JSON.stringify(published.marker)}: the bundle that executes is not the one that was published`);
	if (!found) result.errors.push(`update ${published.id} did not run within ${options.maxLaunches} launches after it was published`);
}

/** Publishes an update that fails with `fault`, runs it, and watches the start after it and the ones after that. */
async function failBad(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario, fault: BadFault): Promise<void> {
	const bad = emptyBad(fault);
	result.bads.push(bad);
	const published = await publish(driver, result, "bad", fault);
	bad.published = published;
	const { launches, found } = await launchUntil(driver, "bad", options.maxLaunches, (launch) => runningId(launch) === published.id);
	bad.launches = launches;
	if (!found) {
		result.errors.push(`the ${fault} bad update ${published.id} never ran within ${options.maxLaunches} launches after it was published`);
		return;
	}
	bad.ran = found.index;
	// A `boot` fault never boots; the late ones boot and then throw, so what shows the fault fired is a fatal in that launch.
	bad.faultTriggered = fault === "boot" ? !found.booted : faulty(found);
	if (!bad.faultTriggered) result.errors.push(`the ${fault} bad update ${published.id} ran without failing: the fault planted in its bundle did not fire`);

	const after = await driver.launch("rollback");
	const later: UpdateLaunch[] = [];
	for (let count = 0; count < options.settleLaunches; count++) later.push(await driver.launch("settled"));
	bad.launches.push(after, ...later);
	const following = [after, ...later];
	bad.failedIdReported = after.failedIds.includes(published.id) ? published.id : (after.failedIds[0] ?? null);
	bad.rolledBackTo = after.running?.kind === "embedded" ? "embedded" : runningId(after);
	bad.rolledBack = bad.faultTriggered === true && after.failedIds.includes(published.id) && after.booted && runningId(after) !== published.id;
	bad.launchesAfter = following.length;
	bad.retried = following.filter((launch) => runningId(launch) === published.id).length + following.filter((launch) => launch.check?.outcome === "downloaded" && launch.check.id === published.id).length;
	bad.blockedChecks = following.filter((launch) => launch.check?.outcome === "none" && launch.check.reason === "updatePreviouslyFailed").length;
	for (const launch of following) {
		if (launch.settledBy === "timeout") result.errors.push(`launch ${launch.index} after the ${fault} bad update ended in the timeout: nothing shows what it ran`);
		else if (launch.check === null) result.errors.push(`launch ${launch.index} after the ${fault} bad update logged no check`);
		else if (launch.check.outcome === "failed") result.errors.push(`launch ${launch.index} after the ${fault} bad update could not check (offline?): it cannot show the bad update was refused`);
	}
	bad.evidence = bad.blockedChecks >= following.length && following.every(observed);
	if (!bad.rolledBack && bad.faultTriggered) result.errors.push(`the start after the ${fault} bad update did not recover: ran ${bad.rolledBackTo ?? "nothing"}, reported failed ids [${after.failedIds.join(", ")}], booted ${after.booted}`);
	if (bad.retried > 0) result.errors.push(`the ${fault} bad update ${published.id} was tried again ${bad.retried} time(s) after it failed`);
}

/** Publishes a good bundle (twice if the first publish fails) so the channel's newest update is healthy. */
async function publishCleanup(driver: UpdatesDriver, result: UpdatesScenario): Promise<PublishedUpdate | null> {
	for (let attempt = 1; attempt <= 2; attempt++) {
		try {
			return await publish(driver, result, "cleanup");
		} catch (error) {
			result.errors.push(`clean-up publish ${attempt} of 2: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const bad = result.attempts.filter((attempt) => attempt.kind === "bad").map((attempt) => attempt.id ?? "unknown id");
	result.errors.push(`the channel may end on an unhealthy update (bad updates published: ${bad.join(", ") || "none"}): publish a good one with eas update`);
	return null;
}

/** The clean-up update, then starts until it runs: the channel is healthy only once the device has run its newest update. */
async function cleanUp(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario): Promise<void> {
	const published = await publishCleanup(driver, result);
	result.cleanup.published = published;
	if (!published) return;
	const { launches, found } = await launchUntil(driver, "cleanup", options.maxLaunches, (launch) => runningId(launch) === published.id && launch.booted);
	result.cleanup.launches = launches;
	result.cleanup.healthy = found !== null && found.probe?.marker === published.marker;
	if (!result.cleanup.healthy) result.errors.push(`the clean-up update ${published.id} did not run with its marker within ${options.maxLaunches} launches`);
}

/**
 * What a run interrupted by a signal still owes the channel: a good update, published once. Safe to call while the scenario is
 * running (it only publishes) and after it (it does nothing when the clean-up already went out).
 */
export async function ensureHealthyChannel(driver: UpdatesDriver, result: UpdatesScenario): Promise<void> {
	if (result.attempts.length === 0 || result.cleanup.published !== null) return;
	result.cleanup.published = await publishCleanup(driver, result);
}

/**
 * The scenario of `native-qa updates`, over any driver. A known-good update is published first and must run, so the channel's head is
 * known; the first start after a clean install runs the embedded bundle; a published update is downloaded by one start and run by
 * the next; each kind of bad update (cannot load, throws in `onMount`, throws in an `$effect`) is recovered from on the next start
 * (the previous update or the embedded bundle runs, and the failed id is reported) and is not tried again, which only counts when
 * every start after it was read to its end and the client refused the bad update at each; the channel ends on a healthy update,
 * published right after the last bad one and verified on the device, whatever happened before.
 */
export async function runUpdatesScenario(driver: UpdatesDriver, options: ScenarioOptions, observe?: (live: UpdatesScenario) => void): Promise<UpdatesScenario> {
	if (options.settleLaunches < 1) throw new Error("settleLaunches must be at least 1: without launches after the bad update nothing shows it is not tried again");
	const result: UpdatesScenario = {
		head: { published: null, launches: [], verified: false },
		baseline: null,
		baselineEmbedded: false,
		good: emptyGood(),
		bads: [],
		cleanup: { published: null, launches: [], healthy: false },
		unexpectedFaults: null,
		bootEnabled: [],
		attempts: [],
		errors: [],
		notes: [],
	};
	observe?.(result);
	const step = async (title: string, run: () => Promise<void>) => {
		try {
			await run();
		} catch (error) {
			result.errors.push(`${title}: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	await step("starting update", () => prepareHead(driver, options, result));
	await step("baseline launch", async () => {
		result.baseline = await driver.launch("baseline");
		result.baselineEmbedded = result.baseline.running?.kind === "embedded";
		if (!result.baselineEmbedded) result.errors.push("the first start after a clean install did not run the embedded bundle");
		if (options.expectReset && result.baseline.reset === null && result.baselineEmbedded)
			result.notes.push("the first start reported no QA reset: the store was empty (nothing to forget), or the installed build does not honour the reset flag");
		const probe = result.baseline.probe;
		if (probe === null) result.errors.push("the app did not report its updates setup ([Svelte QA updates]): this is not the QA build");
		else if (!probe.enabled || probe.checkOnLaunch !== "ALWAYS" || probe.channel === null)
			result.errors.push(`the installed build does not check for updates (enabled ${probe.enabled}, check on launch ${probe.checkOnLaunch}, channel ${probe.channel}): build it with --updates-channel`);
	});
	await step("starting update launches", () => verifyHead(driver, options, result));
	await step("good update", () => applyGood(driver, options, result));
	for (const fault of options.faults ?? badFaults) await step(`${fault} bad update`, () => failBad(driver, options, result, fault));
	// The channel must end healthy even when the steps above failed: a bad update left newest would be served to every build of the channel.
	// It goes out before the long boot series, which runs on the healthy state.
	if (result.attempts.length > 0) await step("clean-up", () => cleanUp(driver, options, result));
	await step("boot series", async () => {
		result.bootEnabled = await driver.bootSeries();
	});
	const ran = new Set(result.bads.map((bad) => bad.ran));
	const all = [result.baseline, ...result.head.launches, ...result.good.launches, ...result.bads.flatMap((bad) => bad.launches), ...result.cleanup.launches].filter((launch): launch is UpdateLaunch => launch !== null);
	const others = all.filter((launch) => !ran.has(launch.index));
	result.unexpectedFaults = others.every(observed) ? others.filter(faulty).length : null;
	return result;
}

/* ---- the run file ---- */

export type BootSeriesSummary = { samples: number; p50: number | null; p90: number | null; jsTotalP90: number | null; failed: number };

export type UpdatesBoot = {
	/** The channel build, in the state the scenario left it in. */
	enabled: BootSeriesSummary | null;
	/** The same app built without a channel (it never checks); null when there was no such build to install. */
	baseline: BootSeriesSummary | null;
	baselineBuild: { sha256: string; commit: string; dirty: boolean } | null;
	/** Enabled minus baseline, ms; null when either series is missing. */
	delta: { p50: number | null; p90: number | null; jsTotalP90: number | null } | null;
	enabledLaunches: Launch[];
	baselineLaunches: Launch[];
};

/** What the channel looked like before the run published anything (`eas channel:view`): the branch it points at, and its head. */
export type ChannelInfo = {
	name: string;
	id: string;
	/** The branches the channel's mapping reaches; the run requires exactly one, named like the channel. */
	branches: string[];
	branch: string | null;
	head: { id: string; createdAt: string; message: string; platform: string } | null;
};

/** What the run left the device in. */
export type DeviceState = {
	/** `plain`: the plain QA build was installed over the channel build at the end. `channel`: it was not, and the channel build is still there. */
	finalBuild: "plain" | "channel";
	/** The reset setting was removed from the device (it is also removed as soon as the first launch reports the reset). */
	resetSettingRemoved: boolean;
	note: string | null;
};

export type UpdatesFile = {
	schema: 1;
	kind: "updates";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	channel: string;
	runtimeVersion: string | null;
	build: { commit: string; dirty: boolean; sha256: string; updatesChannel: string | null } | null;
	/** The name of the command that ran (never its arguments, which could carry a credential) and the version it reported. */
	eas: { command: string; version: string | null; environment: string };
	channelInfo: ChannelInfo | null;
	deviceState: DeviceState;
	options: ScenarioOptions;
	scenario: UpdatesScenario;
	boot: UpdatesBoot;
	/** What a reader of the numbers should know that is not a failure: the two builds compared were not made from the same source. */
	notes: string[];
	/** Everything the scenario and the boot series reported, in order. */
	logFile: string;
};

function numbers(launches: Launch[], pick: (launch: Launch) => number | null | undefined): number[] {
	return launches.map(pick).filter((value): value is number => typeof value === "number");
}

export function summarizeSeries(launches: Launch[]): BootSeriesSummary | null {
	if (launches.length === 0) return null;
	const display: Summary = summarize(numbers(launches, (launch) => launch.displayMs));
	const js: Summary = summarize(numbers(launches, (launch) => launch.jsMarks?.total));
	return { samples: display.samples, p50: display.p50, p90: display.p90, jsTotalP90: js.p90, failed: launches.filter((launch) => launch.error !== null).length };
}

const difference = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

/** The boot of the channel build against the same app without a channel. Informational: no gate reads the delta. */
export function bootComparison(enabledLaunches: Launch[], baselineLaunches: Launch[], baselineBuild: UpdatesBoot["baselineBuild"]): UpdatesBoot {
	const enabled = summarizeSeries(enabledLaunches);
	const baseline = summarizeSeries(baselineLaunches);
	return {
		enabled,
		baseline,
		baselineBuild,
		delta: enabled && baseline ? { p50: difference(enabled.p50, baseline.p50), p90: difference(enabled.p90, baseline.p90), jsTotalP90: difference(enabled.jsTotalP90, baseline.jsTotalP90) } : null,
		enabledLaunches,
		baselineLaunches,
	};
}

/**
 * The run's metrics. `applied`, `rolledBack` and `channelHealthy` are 1 or 0 (a step that did not run is 0, not unmeasured: the run
 * was made and the step failed), `badRetried` and `unexpectedFaults` are counts, the boot numbers are milliseconds and informational.
 */
export function updatesMetrics(file: UpdatesFile): Metrics {
	const { scenario, boot } = file;
	const faults = file.options.faults ?? badFaults;
	const ranAll = badFaults.every((fault) => scenario.bads.some((bad) => bad.fault === fault));
	// A gate that reads "none happened" says something only when it could have seen one: with no evidence it is unmeasured, not 0.
	const retried = scenario.bads.reduce((sum, bad) => sum + bad.retried, 0);
	const evidence = scenario.bads.length >= faults.length && scenario.bads.length > 0 && scenario.bads.every((bad) => bad.evidence);
	const metrics: Metrics = {
		"updates.applied": scenario.good.applied ? 1 : 0,
		"updates.launchesToApply": scenario.good.launchesToApply,
		// All the fault kinds, or the run did not measure rollback.
		"updates.rolledBack": ranAll ? (scenario.bads.every((bad) => bad.rolledBack) ? 1 : 0) : null,
		// A retry seen is a retry whatever else was seen; a count of 0 needs the evidence that the launches after the bad update could have shown one.
		"updates.badRetried": retried > 0 ? retried : evidence ? 0 : null,
		"updates.badBlockedChecks": scenario.bads.reduce((sum, bad) => sum + bad.blockedChecks, 0),
		"updates.unexpectedFaults": scenario.unexpectedFaults,
		"updates.channelHealthy": scenario.cleanup.healthy ? 1 : 0,
		"updates.headVerified": scenario.head.verified ? 1 : 0,
	};
	for (const bad of scenario.bads) metrics[`updates.rolledBack.${bad.fault}`] = bad.rolledBack ? 1 : 0;
	if (boot.enabled) {
		metrics["updates.boot.warm.samples"] = boot.enabled.samples;
		metrics["updates.boot.warm.p50"] = boot.enabled.p50;
		metrics["updates.boot.warm.p90"] = boot.enabled.p90;
		metrics["updates.boot.warm.jsTotal.p90"] = boot.enabled.jsTotalP90;
	}
	if (boot.baseline) {
		metrics["updates.boot.baseline.warm.p50"] = boot.baseline.p50;
		metrics["updates.boot.baseline.warm.p90"] = boot.baseline.p90;
	}
	if (boot.delta) {
		metrics["updates.boot.warm.p50Delta"] = boot.delta.p50;
		metrics["updates.boot.warm.p90Delta"] = boot.delta.p90;
		metrics["updates.boot.warm.jsTotalP90Delta"] = boot.delta.jsTotalP90;
	}
	return metrics;
}

/* ---- eas-cli ---- */

/**
 * The Android update `eas update --json` published. The output is an array with one entry per platform; the harness publishes
 * for Android only, and the entry's `id` is the update id a device reports (the manifest's `id`).
 */
export function parsePublished(stdout: string, kind: UpdateKind, marker: string, fault: BadFault | null = null): PublishedUpdate {
	const start = stdout.indexOf("[");
	const end = stdout.lastIndexOf("]");
	if (start < 0 || end < start) throw new Error(`eas update printed no JSON array: ${stdout.slice(0, 300)}`);
	let entries: unknown;
	try {
		entries = JSON.parse(stdout.slice(start, end + 1));
	} catch {
		throw new Error(`eas update printed malformed JSON: ${stdout.slice(start, start + 300)}`);
	}
	if (!Array.isArray(entries)) throw new Error("eas update printed JSON that is not an array");
	for (const entry of entries as unknown[]) {
		if (typeof entry !== "object" || entry === null) continue;
		const fields = entry as Record<string, unknown>;
		if (fields.platform !== "android") continue;
		if (typeof fields.id === "string" && typeof fields.group === "string")
			return {
				kind,
				fault,
				id: fields.id.toLowerCase(),
				group: fields.group,
				branch: typeof fields.branch === "string" ? fields.branch : null,
				marker,
				message: typeof fields.message === "string" ? fields.message : "",
				createdAt: typeof fields.createdAt === "string" ? fields.createdAt : "",
			};
	}
	throw new Error(`eas update published no Android update: ${stdout.slice(start, start + 300)}`);
}

/**
 * The channel as `eas channel:view --json` prints it (a text header, then one JSON object). The run publishes with `--channel`, so it
 * lands wherever the channel's mapping points: it must point at exactly one branch, with no rollout logic, named like the channel.
 */
export function parseChannelView(stdout: string, channel: string): ChannelInfo {
	const start = stdout.indexOf("{");
	if (start < 0) throw new Error(`eas channel:view printed no JSON: ${stdout.slice(0, 300)}`);
	let page: Record<string, unknown>;
	try {
		const parsed = JSON.parse(stdout.slice(start, stdout.lastIndexOf("}") + 1)) as Record<string, unknown>;
		page = (parsed.currentPage ?? parsed) as Record<string, unknown>;
	} catch {
		throw new Error(`eas channel:view printed malformed JSON: ${stdout.slice(start, start + 300)}`);
	}
	if (page.name !== channel || typeof page.id !== "string") throw new Error(`eas channel:view answered for ${JSON.stringify(page.name)}, not ${JSON.stringify(channel)}`);
	const branches = Array.isArray(page.updateBranches) ? (page.updateBranches as Record<string, unknown>[]) : [];
	const mapping = ((): unknown => {
		try {
			return typeof page.branchMapping === "string" ? JSON.parse(page.branchMapping) : page.branchMapping;
		} catch {
			return null;
		}
	})();
	const mapped = (mapping as { data?: { branchId?: string; branchMappingLogic?: unknown }[] } | null)?.data ?? [];
	const names = branches.map((branch) => String(branch.name));
	if (branches.length !== 1 || mapped.length !== 1 || mapped[0]?.branchId !== branches[0]?.id || mapped[0]?.branchMappingLogic !== "true")
		throw new Error(`channel ${channel} does not map to exactly one branch (branches ${JSON.stringify(names)}, mapping ${JSON.stringify(mapped)}): publishing to it could reach another branch`);
	if (names[0] !== channel) throw new Error(`channel ${channel} points at the branch ${JSON.stringify(names[0])}, not ${JSON.stringify(channel)}`);
	// The groups are newest first; a group has an entry per platform.
	const groups = (branches[0]?.updateGroups as Record<string, unknown>[][] | undefined) ?? [];
	const newest = groups[0]?.find((entry) => entry.platform === "android") ?? groups[0]?.[0];
	return {
		name: channel,
		id: page.id,
		branches: names,
		branch: names[0] ?? null,
		head: newest ? { id: String(newest.id), createdAt: String(newest.createdAt), message: String(newest.message), platform: String(newest.platform) } : null,
	};
}

/** The environment a published bundle is built in: the marker, the fault when it is a bad one, and the channel the app config is evaluated for. */
export function publishEnvironment(kind: UpdateKind, marker: string, channel: string, apiUrl: string, fault: BadFault | null = null): Record<string, string> {
	return {
		CI: "1",
		EXPO_NO_TELEMETRY: "1",
		EXPO_PUBLIC_API_URL: apiUrl,
		UPDATES_CHANNEL: channel,
		EXPO_PUBLIC_QA_UPDATE_MARKER: marker,
		// Always set, empty for a good bundle, so a variable of the calling shell never plants a fault.
		EXPO_PUBLIC_QA_UPDATE_FAULT: kind === "bad" && fault ? fault : "",
	};
}

/** The arguments of `eas update` for one publish. `--clear-cache`: Metro's cache is keyed by file content, not by the `EXPO_PUBLIC_*` values it inlines. */
export function publishArguments(channel: string, environment: string, message: string): string[] {
	return ["update", "--channel", channel, "--platform", "android", "--environment", environment, "--message", message, "--clear-cache", "--non-interactive", "--json"];
}

/** The two builds of the boot comparison should be one source tree; if they are not, or either was made from a dirty tree, the delta says less. */
export function comparisonNotes(channelBuild: { commit: string; dirty: boolean } | null, baselineBuild: { commit: string; dirty: boolean } | null): string[] {
	if (channelBuild === null || baselineBuild === null) return [];
	const notes: string[] = [];
	if (channelBuild.commit !== baselineBuild.commit)
		notes.push(`the channel build was made at ${channelBuild.commit} and the build without a channel at ${baselineBuild.commit}: the boot delta may include a change of the app`);
	else if (channelBuild.dirty || baselineBuild.dirty)
		notes.push(`the builds share commit ${channelBuild.commit}, but ${[channelBuild.dirty ? "the channel build" : null, baselineBuild.dirty ? "the build without a channel" : null].filter(Boolean).join(" and ")} came from a tree with uncommitted changes`);
	return notes;
}
