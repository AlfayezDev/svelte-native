import { summarize } from "../parse/stats.ts";
import { crashMetrics, soakMetrics } from "../soak/metrics.ts";
import { unattributedCount } from "./iphone/crash-reports.ts";
import { smokeMetrics, type SmokePins } from "./smoke.ts";
import { allScenarios, gesturesMetrics } from "./gestures.ts";
import { suiteMetrics, type SuiteFiles } from "./suite-metrics.ts";
import { updatesMetrics, type UpdatesFile } from "./updates.ts";
import type {
	BootFile,
	CrashesFile,
	CrashReportsRecord,
	DeviceInfo,
	GesturesFile,
	LabFile,
	LabRun,
	Launch,
	Metrics,
	Platform,
	SmokeFile,
	SoakFile,
} from "./types.ts";

const listScenario = "list-300-virtual";

function worst(values: (number | null)[], pick: (numbers: number[]) => number): number | null {
	if (values.length === 0 || values.some((value) => value === null)) return null;
	return pick(values as number[]);
}

const largest = (numbers: number[]) => Math.max(...numbers);
const smallest = (numbers: number[]) => Math.min(...numbers);
const total = (numbers: number[]) => numbers.reduce((sum, value) => sum + value, 0);

/**
 * Scenarios that must produce frame data: the pinned list of the full run, and every non-informational scenario the lab
 * ran or announced as complete.
 */
function measuredNames(runs: LabRun[], pinned: readonly string[]): string[] {
	const names = new Set<string>(pinned);
	for (const run of runs) {
		for (const scenario of run.scenarios)
			if (scenario.frames || scenario.verdict !== "info") names.add(scenario.name);
		for (const name of run.expectedScenarios) names.add(name);
	}
	return [...names];
}

/** The pinned scenarios that any of the runs lacks: a run that skipped them is not the full run. */
export function missingScenarios(runs: LabRun[], pinned: readonly string[]): string[] {
	return pinned.filter((name) =>
		runs.some((run) => !run.scenarios.some((scenario) => scenario.name === name)),
	);
}

/**
 * The JavaScript errors a run saw. Android counts the `E ReactNativeJS` lines of its log; an iOS app reports its own count, and
 * one that does not (an older build) has measured none, which is null and not zero.
 */
export function jsErrorsOf(platform: Platform, run: LabRun): number | null {
	if (run.jsErrorCount !== undefined) return run.jsErrorCount;
	return platform === "android" ? run.jsErrors.length : null;
}

/**
 * Crashes plus JavaScript errors. A run whose app did not report its JavaScript errors leaves the count unmeasured (null),
 * unless a crash already shows the fatals are not zero.
 */
function fatalCount(crashes: number, errors: (number | null)[]): number | null {
	if (crashes === 0 && errors.some((count) => count === null)) return null;
	return crashes + total(errors.map((count) => count ?? 0));
}

/** The fatals of one lab run: its crashes and its JavaScript errors (null when the app does not report them and nothing else is a fatal). */
export function runFatals(platform: Platform, run: LabRun): number | null {
	return fatalCount(run.crashes.length, [jsErrorsOf(platform, run)]);
}

/**
 * Lab measurements, worst case over the repeated runs: a gate on a metric passes only if every
 * run passed it, and a scenario missing from any run is a missing measurement. `pinned` is the
 * scenario list of the full `checks,quick` run for this platform (`gates.json`).
 */
export function labMetrics(file: LabFile, pinned: readonly string[]): Metrics {
	const runs = file.runs;
	if (runs.length === 0) return {};
	const jsErrors = runs.map((run) => jsErrorsOf(file.device.platform, run));
	const metrics: Metrics = {
		"lab.runs": runs.filter((run) => run.complete).length,
		"lab.incompleteRuns": runs.filter((run) => !run.complete).length,
		"lab.interruptedRuns": runs.filter((run) => run.interrupted).length,
		"lab.checks.passed": smallest(runs.map((run) => run.checks?.passed ?? 0)),
		"lab.checks.failed": largest(runs.map((run) => run.checks?.failed ?? 0)),
		"lab.scenarios.failed": largest(
			runs.map((run) => run.scenarios.filter((scenario) => scenario.verdict === "fail").length),
		),
		"lab.scenarios.missing": missingScenarios(runs, pinned).length,
		// The crash reports no run owns (iOS: a process the command did not launch) are fatals of the file all the same.
		"lab.fatals": fatalCount(total(runs.map((run) => run.crashes.length)) + unattributedCount(file.crashReports), jsErrors),
		"lab.engineWarnings": total(runs.map((run) => run.engineWarnings.length)),
	};
	for (const name of measuredNames(runs, pinned)) {
		const frames = runs.map(
			(run) => run.scenarios.find((scenario) => scenario.name === name)?.frames ?? null,
		);
		metrics[`frames.${name}.droppedPct`] = worst(
			frames.map((f) => f?.droppedPct ?? null),
			largest,
		);
		metrics[`frames.${name}.maxMs`] = worst(
			frames.map((f) => f?.max ?? null),
			largest,
		);
		metrics[`frames.${name}.maxPeriodRatio`] = worst(
			frames.map((f) => (f && f.periodMs > 0 ? f.max / f.periodMs : null)),
			largest,
		);
	}
	const mount = runs.map((run) => {
		const value = run.scenarios.find((scenario) => scenario.name === listScenario)?.detail?.mountMs;
		return typeof value === "number" ? value : null;
	});
	metrics["list.virtual300.mountMs"] = worst(mount, largest);
	return metrics;
}

function launchValues(launches: Launch[], pick: (launch: Launch) => number | null): number[] {
	return launches.map(pick).filter((value): value is number => value !== null);
}

function bootSeries(prefix: string, launches: Launch[]): Metrics {
	if (launches.length === 0) return {};
	const display = summarize(launchValues(launches, (launch) => launch.displayMs));
	const jsTotal = summarize(launchValues(launches, (launch) => launch.jsMarks?.total ?? null));
	const metrics: Metrics = {
		[`${prefix}.attempts`]: launches.length,
		[`${prefix}.samples`]: display.samples,
		[`${prefix}.failed`]: launches.length - display.samples,
		[`${prefix}.retried`]: launches.filter((launch) => (launch.attempts ?? 1) > 1).length,
		[`${prefix}.min`]: display.min,
		[`${prefix}.p50`]: display.p50,
		[`${prefix}.p90`]: display.p90,
		[`${prefix}.max`]: display.max,
		[`${prefix}.runningMain.p90`]: summarize(
			launchValues(launches, (launch) => launch.runningMainMs),
		).p90,
		[`${prefix}.totalTime.p90`]: summarize(launchValues(launches, (launch) => launch.totalTimeMs))
			.p90,
		[`${prefix}.jsTotal.samples`]: jsTotal.samples,
		[`${prefix}.jsTotal.p90`]: jsTotal.p90,
	};
	return metrics;
}

/** Boot measurements: the distribution of `Start proc` to `Displayed` over the warm and the cold launches. */
export function bootMetrics(file: BootFile): Metrics {
	const launches = [...file.warm, ...file.cold];
	return {
		...bootSeries("boot.warm", file.warm),
		...bootSeries("boot.cold", file.cold),
		"boot.fatals": fatalCount(
			total(launches.map((launch) => launch.crashes)) + unattributedCount(file.crashReports),
			launches.map((launch) => launch.jsErrors),
		),
		"boot.engineWarnings": total(launches.map((launch) => launch.engineWarnings)),
	};
}

type CrashRecorded = { device: DeviceInfo } & CrashReportsRecord;

/**
 * The reports the iPhone's crash log gained during the runs, over every iOS run file (lab, boot, parity, a11y), attributed or not. A
 * file whose pull failed, or that was recorded before the pull existed, measured nothing: that is null (not measured, which fails the
 * gate), never 0, unless another file already counted a report. Other platforms have no such metric.
 */
export function crashReportMetrics(files: CrashRecorded[]): Metrics {
	const ios = files.filter((file) => file.device.platform === "ios");
	if (ios.length === 0) return {};
	const measured = ios.filter((file) => file.crashReports !== undefined && file.crashReportsError === undefined);
	const found = total(measured.map((file) => file.crashReports?.length ?? 0));
	return { "log.crashReports": measured.length < ios.length && found === 0 ? null : found };
}

/** Device-level measurements from whichever runs exist, plus the faults seen across all of them. */
export function deviceMetrics(
	lab: LabFile | null,
	boot: BootFile | null,
	pinned: readonly string[],
	soak: SoakFile | null = null,
	crashes: CrashesFile | null = null,
	suites: SuiteFiles = { parity: null, a11y: null, resilience: null },
	smoke: { file: SmokeFile; pins: SmokePins } | null = null,
	gestures: GesturesFile | null = null,
	pinnedGestures: readonly string[] = allScenarios,
	updates: UpdatesFile | null = null,
): Metrics {
	const metrics: Metrics = {
		...(lab ? labMetrics(lab, pinned) : {}),
		...(boot ? bootMetrics(boot) : {}),
		...(soak ? soakMetrics(soak) : {}),
		...(crashes ? crashMetrics(crashes) : {}),
		...suiteMetrics(suites),
		...(smoke ? smokeMetrics(smoke.file, smoke.pins) : {}),
		...(gestures ? gesturesMetrics(gestures, pinnedGestures) : {}),
		...(updates ? updatesMetrics(updates) : {}),
		...crashReportMetrics([lab, boot, suites.parity, suites.a11y, gestures].filter((file) => file !== null)),
	};
	// A run that was made but measured nothing (null) leaves the sum unmeasured; a run that was not made adds nothing.
	const sum = (a: string, b: string) => {
		const parts = [a, b].filter((key) => key in metrics).map((key) => metrics[key]);
		if (parts.length === 0 || parts.some((value) => typeof value !== "number")) return null;
		return total(parts as number[]);
	};
	const fatals = sum("lab.fatals", "boot.fatals");
	const warnings = sum("lab.engineWarnings", "boot.engineWarnings");
	if (lab || boot) {
		metrics["log.fatals"] = fatals;
		metrics["log.engineWarnings"] = warnings;
	}
	return metrics;
}
