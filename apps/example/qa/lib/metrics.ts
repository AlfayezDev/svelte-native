import { summarize } from "../parse/stats.ts";
import { crashMetrics, soakMetrics } from "../soak/metrics.ts";
import { suiteMetrics, type SuiteFiles } from "./suite-metrics.ts";
import type { BootFile, CrashesFile, LabFile, LabRun, Launch, Metrics, SoakFile } from "./types.ts";

const listScenario = "list-300-virtual";

function worst(values: (number | null)[], pick: (numbers: number[]) => number): number | null {
	if (values.length === 0 || values.some((value) => value === null)) return null;
	return pick(values as number[]);
}

const largest = (numbers: number[]) => Math.max(...numbers);
const smallest = (numbers: number[]) => Math.min(...numbers);
const total = (numbers: number[]) => numbers.reduce((sum, value) => sum + value, 0);

/** Scenarios that must produce frame data: every non-informational scenario the lab ran or announced as complete. */
function measuredNames(runs: LabRun[]): string[] {
	const names = new Set<string>();
	for (const run of runs) {
		for (const scenario of run.scenarios)
			if (scenario.frames || scenario.verdict !== "info") names.add(scenario.name);
		for (const name of run.expectedScenarios) names.add(name);
	}
	return [...names];
}

/**
 * Lab measurements, worst case over the repeated runs: a gate on a metric passes only if every
 * run passed it, and a scenario missing from any run is a missing measurement.
 */
export function labMetrics(file: LabFile): Metrics {
	const runs = file.runs;
	if (runs.length === 0) return {};
	const metrics: Metrics = {
		"lab.runs": runs.filter((run) => run.complete).length,
		"lab.incompleteRuns": runs.filter((run) => !run.complete).length,
		"lab.checks.passed": smallest(runs.map((run) => run.checks?.passed ?? 0)),
		"lab.checks.failed": largest(runs.map((run) => run.checks?.failed ?? 0)),
		"lab.scenarios.failed": largest(
			runs.map((run) => run.scenarios.filter((scenario) => scenario.verdict === "fail").length),
		),
		"lab.fatals": total(runs.map((run) => run.crashes.length + run.jsErrors.length)),
		"lab.engineWarnings": total(runs.map((run) => run.engineWarnings.length)),
	};
	for (const name of measuredNames(runs)) {
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
	const metrics: Metrics = {
		[`${prefix}.attempts`]: launches.length,
		[`${prefix}.samples`]: display.samples,
		[`${prefix}.min`]: display.min,
		[`${prefix}.p50`]: display.p50,
		[`${prefix}.p90`]: display.p90,
		[`${prefix}.max`]: display.max,
		[`${prefix}.runningMain.p90`]: summarize(
			launchValues(launches, (launch) => launch.runningMainMs),
		).p90,
		[`${prefix}.totalTime.p90`]: summarize(launchValues(launches, (launch) => launch.totalTimeMs))
			.p90,
		[`${prefix}.jsTotal.p90`]: summarize(
			launchValues(launches, (launch) => launch.jsMarks?.total ?? null),
		).p90,
	};
	return metrics;
}

/** Boot measurements: the distribution of `Start proc` to `Displayed` over the warm and the cold launches. */
export function bootMetrics(file: BootFile): Metrics {
	const launches = [...file.warm, ...file.cold];
	return {
		...bootSeries("boot.warm", file.warm),
		...bootSeries("boot.cold", file.cold),
		"boot.fatals": total(launches.map((launch) => launch.crashes + launch.jsErrors)),
		"boot.engineWarnings": total(launches.map((launch) => launch.engineWarnings)),
	};
}

/** Device-level measurements from whichever runs exist, plus the faults seen across all of them. */
export function deviceMetrics(
	lab: LabFile | null,
	boot: BootFile | null,
	soak: SoakFile | null = null,
	crashes: CrashesFile | null = null,
	suites: SuiteFiles = { parity: null, a11y: null, resilience: null },
): Metrics {
	const metrics: Metrics = {
		...(lab ? labMetrics(lab) : {}),
		...(boot ? bootMetrics(boot) : {}),
		...(soak ? soakMetrics(soak) : {}),
		...(crashes ? crashMetrics(crashes) : {}),
		...suiteMetrics(suites),
	};
	const sum = (a: string, b: string) => {
		const parts = [metrics[a], metrics[b]].filter(
			(value): value is number => typeof value === "number",
		);
		return parts.length ? total(parts) : null;
	};
	const fatals = sum("lab.fatals", "boot.fatals");
	const warnings = sum("lab.engineWarnings", "boot.engineWarnings");
	if (fatals !== null) metrics["log.fatals"] = fatals;
	if (warnings !== null) metrics["log.engineWarnings"] = warnings;
	return metrics;
}
