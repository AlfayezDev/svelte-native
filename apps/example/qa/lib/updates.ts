import { summarize, type Summary } from "../parse/stats.ts";
import { runningId, type SettledBy, type UpdateObservation } from "./updates-log.ts";
import type { AppInfo, DeviceInfo, Launch, Metrics, Source } from "./types.ts";

/** One launch of the run: what logcat showed, in which phase of the scenario it was started, and why the harness stopped reading it. */
export type UpdateLaunch = UpdateObservation & {
	/** 1-based, over the whole run. */
	index: number;
	phase: "baseline" | "apply" | "bad" | "rollback" | "settled" | "cleanup";
	settledBy: SettledBy;
};

export type UpdateKind = "good" | "bad" | "cleanup";

/** An update the harness published: the id the device reports when it runs it, and the marker planted in its bundle. */
export type PublishedUpdate = {
	kind: UpdateKind;
	id: string;
	group: string;
	marker: string;
	message: string;
	createdAt: string;
};

/**
 * Everything the scenario needs from the world: an Android device with the channel build installed and an EAS channel. Behind this
 * interface the scenario logic runs against a model of the client in the unit tests, and against adb and eas-cli on a device.
 */
export interface UpdatesDriver {
	launch(phase: UpdateLaunch["phase"]): Promise<UpdateLaunch>;
	publish(kind: UpdateKind): Promise<PublishedUpdate>;
	/** The warm launches of the channel build in the state the scenario left it in (`boot --warm`). */
	bootSeries(): Promise<Launch[]>;
}

export type ScenarioOptions = {
	/** Launches allowed for an update to start running, or for a bad one to be recovered from. */
	maxLaunches: number;
	/** Launches after the recovery, to see the bad update is not tried again. */
	settleLaunches: number;
};

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
	published: PublishedUpdate | null;
	launches: UpdateLaunch[];
	/** The launch that ran the bad update; null when none did. */
	ran: number | null;
	/** The bad update did not reach its first commit when it ran (its planted fault fired). */
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
};

export type CleanupPhase = { published: PublishedUpdate | null; launches: UpdateLaunch[]; healthy: boolean };

export type UpdatesScenario = {
	baseline: UpdateLaunch | null;
	/** The first start after a clean install ran the bundle embedded in the app. */
	baselineEmbedded: boolean;
	good: GoodPhase;
	bad: BadPhase;
	cleanup: CleanupPhase;
	/** Launches that crashed or logged a JavaScript error, other than the one that ran the bad update. */
	unexpectedFaults: number;
	/** The warm launches of the channel build, taken between the bad update and the clean-up. */
	bootEnabled: Launch[];
	errors: string[];
};

const emptyGood = (): GoodPhase => ({ published: null, launches: [], launchesToApply: null, applied: false, markerSeen: false });
const emptyBad = (): BadPhase => ({ published: null, launches: [], ran: null, faultTriggered: null, rolledBack: false, rolledBackTo: null, failedIdReported: null, retried: 0, blockedChecks: 0, launchesAfter: 0 });

const faulty = (launch: UpdateLaunch) => launch.crashes > 0 || launch.jsErrors > 0;

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

/** Publishes a good update and starts the app until the update runs with its marker: the policy is that one start downloads it and the next runs it. */
async function applyGood(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario): Promise<void> {
	const published = await driver.publish("good");
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

/** Publishes an update that throws while it loads, runs it, and watches the start after it and the ones after that. */
async function failBad(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario): Promise<void> {
	const bad = result.bad;
	const published = await driver.publish("bad");
	bad.published = published;
	const { launches, found } = await launchUntil(driver, "bad", options.maxLaunches, (launch) => runningId(launch) === published.id);
	bad.launches = launches;
	if (!found) {
		result.errors.push(`the bad update ${published.id} never ran within ${options.maxLaunches} launches after it was published`);
		return;
	}
	bad.ran = found.index;
	bad.faultTriggered = !found.booted;
	if (found.booted) result.errors.push(`the bad update ${published.id} booted: the fault planted in its bundle did not fire`);

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
	if (!bad.rolledBack && bad.faultTriggered) result.errors.push(`the start after the bad update did not recover: ran ${bad.rolledBackTo ?? "nothing"}, reported failed ids [${after.failedIds.join(", ")}], booted ${after.booted}`);
	if (bad.retried > 0) result.errors.push(`the bad update ${published.id} was tried again ${bad.retried} time(s) after it failed`);
}

/** Republishes a good bundle so the channel's newest update is healthy, and starts the app until it runs. */
async function cleanUp(driver: UpdatesDriver, options: ScenarioOptions, result: UpdatesScenario): Promise<void> {
	const published = await driver.publish("cleanup");
	result.cleanup.published = published;
	const { launches, found } = await launchUntil(driver, "cleanup", options.maxLaunches, (launch) => runningId(launch) === published.id && launch.booted);
	result.cleanup.launches = launches;
	result.cleanup.healthy = found !== null && found.probe?.marker === published.marker;
	if (!result.cleanup.healthy) result.errors.push(`the clean-up update ${published.id} did not run with its marker within ${options.maxLaunches} launches`);
}

/**
 * The scenario of `native-qa updates`, over any driver: the first start after a clean install runs the embedded bundle; a published
 * update is downloaded by one start and run by the next; an update that throws before its first commit is recovered from on the
 * next start (the previous update or the embedded bundle runs, and the failed id is reported) and is not tried again; the
 * channel ends on a healthy update, whatever happened before (the clean-up runs even when an earlier step failed).
 */
export async function runUpdatesScenario(driver: UpdatesDriver, options: ScenarioOptions): Promise<UpdatesScenario> {
	const result: UpdatesScenario = {
		baseline: null,
		baselineEmbedded: false,
		good: emptyGood(),
		bad: emptyBad(),
		cleanup: { published: null, launches: [], healthy: false },
		unexpectedFaults: 0,
		bootEnabled: [],
		errors: [],
	};
	const step = async (title: string, run: () => Promise<void>) => {
		try {
			await run();
		} catch (error) {
			result.errors.push(`${title}: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	await step("baseline launch", async () => {
		result.baseline = await driver.launch("baseline");
		result.baselineEmbedded = result.baseline.running?.kind === "embedded";
		if (!result.baselineEmbedded) result.errors.push("the first start after a clean install did not run the embedded bundle");
		const probe = result.baseline.probe;
		if (probe === null) result.errors.push("the app did not report its updates setup ([Svelte QA updates]): this is not the QA build");
		else if (!probe.enabled || probe.checkOnLaunch !== "ALWAYS" || probe.channel === null)
			result.errors.push(`the installed build does not check for updates (enabled ${probe.enabled}, check on launch ${probe.checkOnLaunch}, channel ${probe.channel}): build it with --updates-channel`);
	});
	await step("good update", () => applyGood(driver, options, result));
	await step("bad update", () => failBad(driver, options, result));
	await step("boot series", async () => {
		result.bootEnabled = await driver.bootSeries();
	});
	// The channel must end healthy even when the steps above failed: a bad update left newest would be served to every build of the channel.
	if (result.bad.published !== null || result.good.published !== null) await step("clean-up", () => cleanUp(driver, options, result));
	const all = [result.baseline, ...result.good.launches, ...result.bad.launches, ...result.cleanup.launches].filter((launch): launch is UpdateLaunch => launch !== null);
	result.unexpectedFaults = all.filter((launch) => faulty(launch) && launch.index !== result.bad.ran).length;
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
	eas: { command: string; environment: string };
	options: ScenarioOptions;
	scenario: UpdatesScenario;
	boot: UpdatesBoot;
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
	const metrics: Metrics = {
		"updates.applied": scenario.good.applied ? 1 : 0,
		"updates.launchesToApply": scenario.good.launchesToApply,
		"updates.rolledBack": scenario.bad.rolledBack ? 1 : 0,
		"updates.badRetried": scenario.bad.retried,
		"updates.badBlockedChecks": scenario.bad.blockedChecks,
		"updates.unexpectedFaults": scenario.unexpectedFaults,
		"updates.channelHealthy": scenario.cleanup.healthy ? 1 : 0,
	};
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
export function parsePublished(stdout: string, kind: UpdateKind, marker: string): PublishedUpdate {
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
				id: fields.id.toLowerCase(),
				group: fields.group,
				marker,
				message: typeof fields.message === "string" ? fields.message : "",
				createdAt: typeof fields.createdAt === "string" ? fields.createdAt : "",
			};
	}
	throw new Error(`eas update published no Android update: ${stdout.slice(start, start + 300)}`);
}

/** The environment a published bundle is built in: the marker, the fault when it is the bad one, and the channel the app config is evaluated for. */
export function publishEnvironment(kind: UpdateKind, marker: string, channel: string, apiUrl: string): Record<string, string> {
	return {
		CI: "1",
		EXPO_NO_TELEMETRY: "1",
		EXPO_PUBLIC_API_URL: apiUrl,
		UPDATES_CHANNEL: channel,
		EXPO_PUBLIC_QA_UPDATE_MARKER: marker,
		// Always set, empty for a good bundle, so a variable of the calling shell never plants a fault.
		EXPO_PUBLIC_QA_UPDATE_FAULT: kind === "bad" ? "boot" : "",
	};
}

/** The arguments of `eas update` for one publish. `--clear-cache`: Metro's cache is keyed by file content, not by the `EXPO_PUBLIC_*` values it inlines. */
export function publishArguments(channel: string, environment: string, message: string): string[] {
	return ["update", "--channel", channel, "--platform", "android", "--environment", environment, "--message", message, "--clear-cache", "--non-interactive", "--json"];
}
