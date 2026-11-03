import {
	findEngineWarnings,
	findFaults,
	findInterruption,
	lateIntervals,
	parseStressComplete,
	parseStressScenarios,
	type Scenario,
} from "../parse/logcat.ts";
import { findScenario, scenarioNames, scenarios, viewsLeft, type ScenarioSpec } from "../../src/lib/native/dev/gestures-lab.ts";
import { unattributedCount } from "./iphone/crash-reports.ts";
import type {
	GestureCheck,
	GestureInjection,
	GestureInput,
	GestureLaunch,
	GestureResult,
	GesturesFile,
	Metrics,
	Platform,
} from "./types.ts";

/**
 * The gestures run (SPEC.md, "Gestures"): the lab's `gestures-*` stress scenarios, driven by `adb input` (one pointer, the real input
 * pipeline), by the app's own injector (every scenario, frame paced) or by an XCUITest on the iPhone, and what comes of them: the results
 * as the lab logged them, the metrics the `gestures.*` gates read, and whether two ways of driving one scenario agree.
 */

const prefix = "gestures-";

/** The scenario names a `--run` list asks for: short names (`box`) or full ones (`gestures-box`); nothing asks for all of them. */
export function scenarioNamesFrom(list: string | undefined): string[] {
	if (list === undefined || list.trim() === "") return [...scenarioNames];
	const names = list.split(",").map((part) => part.trim()).filter(Boolean).map((part) => (part.startsWith(prefix) ? part : `${prefix}${part}`));
	const unknown = names.filter((name) => !scenarioNames.includes(name));
	if (unknown.length > 0) throw new Error(`unknown gestures scenario ${unknown.join(", ")} (they are: ${scenarioNames.map((name) => name.slice(prefix.length)).join(", ")})`);
	return [...new Set(names)];
}

/** Whether a way of driving can perform a scenario's input: `adb input` moves one pointer; the in-app injector and an XCUITest do any. */
export function supports(spec: ScenarioSpec, input: GestureInput): boolean {
	return input === "xctest" ? true : spec.inputs.includes(input);
}

/** The names a launch driven by `input` is given: those it can perform. */
export function namesFor(names: readonly string[], input: GestureInput): string[] {
	return names.filter((name) => {
		const spec = findScenario(name);
		return spec !== undefined && supports(spec, input);
	});
}

/** The `run` value of the lab's URL for a launch: the scenario names, then who injects. */
export function runValue(names: readonly string[], input: GestureInput): string {
	return `${names.join(",")},drive:${input}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function checksOf(detail: Record<string, unknown> | null): GestureCheck[] {
	const list = detail?.checks;
	if (!Array.isArray(list)) return [];
	return list.flatMap((entry): GestureCheck[] =>
		Array.isArray(entry) && typeof entry[0] === "string" ? [{ name: entry[0], ok: entry[1] === 1, value: entry[2] === undefined ? null : String(entry[2]) }] : [],
	);
}

function observedFrames(detail: Record<string, unknown> | null): GestureResult["observedFrames"] {
	const observed = isRecord(detail?.observed) ? detail.observed.frames : undefined;
	if (!isRecord(observed)) return null;
	const { periodMs, p50, p95, max, droppedPct } = observed;
	return [periodMs, p50, p95, max, droppedPct].every((value) => typeof value === "number")
		? { periodMs: periodMs as number, p50: p50 as number, p95: p95 as number, max: max as number, droppedPct: droppedPct as number }
		: null;
}

/** One scenario of the lab's `[Svelte stress]` lines as a result; `injections` are what the injecting side did for it. */
export function resultFrom(scenario: Scenario, injections: GestureInjection[] = []): GestureResult {
	const detail = scenario.detail;
	const checks = checksOf(detail);
	const threw = scenario.verdict === "fail" && checks.length === 0;
	const counters = Array.isArray(detail?.counters) ? (detail.counters as Record<string, number[]>[]) : null;
	const marks = Array.isArray(detail?.marks) ? (detail.marks as Record<string, number>[]) : null;
	return {
		name: scenario.name,
		verdict: scenario.verdict,
		summary: scenario.summary,
		frames: scenario.frames,
		observedFrames: observedFrames(detail),
		checks,
		counters,
		marks,
		timedOut: typeof detail?.timedOut === "string" || /TIMED OUT/.test(scenario.summary),
		error: threw ? scenario.summary : null,
		injections,
	};
}

export type LaunchCapture = {
	input: GestureInput;
	asked: string[];
	/** The whole logcat of the launch. */
	text: string;
	/** The lab's completion line appeared. */
	matched: boolean;
	startedAt: Date;
	durationMs: number;
	logFile: string;
	packageName: string;
	injections: Record<string, GestureInjection[]>;
	harnessErrors: string[];
};

/** The scenarios the lab printed, as results; an `asked` scenario with no line is absent (and the launch is incomplete). */
export function resultsFrom(text: string, injections: Record<string, GestureInjection[]>): GestureResult[] {
	return parseStressScenarios(text)
		.filter((scenario) => scenario.name.startsWith(prefix))
		.map((scenario) => resultFrom(scenario, injections[scenario.name] ?? []));
}

/** One Android launch from its logcat. */
export function launchFromLogcat(capture: LaunchCapture): GestureLaunch {
	const { text } = capture;
	const scenarios = resultsFrom(text, capture.injections);
	const faults = findFaults(text, capture.packageName);
	const interrupted = findInterruption(text, capture.packageName);
	const completion = parseStressComplete(text);
	const announced = new Set((completion?.results ?? []).map((result) => result.name));
	const complete = capture.matched && capture.asked.every((name) => announced.has(name) && scenarios.some((scenario) => scenario.name === name)) && interrupted === null;
	return {
		input: capture.input,
		asked: capture.asked,
		startedAt: capture.startedAt.toISOString(),
		durationMs: capture.durationMs,
		complete,
		scenarios,
		crashes: faults.crashes,
		jsErrors: faults.jsErrors,
		engineWarnings: findEngineWarnings(text),
		harnessErrors: capture.harnessErrors,
		...(interrupted ? { interrupted } : {}),
		logFile: capture.logFile,
	};
}

export const failedChecks = (result: GestureResult): number => result.checks.filter((entry) => !entry.ok).length + (result.timedOut ? 1 : 0) + (result.error !== null ? 1 : 0);

/** One line per scenario for the console. */
export function describeLaunch(launch: GestureLaunch): string[] {
	const lines = [`  ${launch.input}: complete ${launch.complete} in ${(launch.durationMs / 1000).toFixed(0)} s, ${launch.scenarios.length} of ${launch.asked.length} scenarios, fatals ${launch.crashes.length + launch.jsErrors.length}, engine warnings ${launch.engineWarnings.length}`];
	if (launch.interrupted) lines.push(`  interrupted by ${launch.interrupted.by} at ${launch.interrupted.at} (device clock)`);
	for (const result of launch.scenarios) {
		const frames = result.frames ?? result.observedFrames;
		const dropped = frames ? ` dropped ${frames.droppedPct.toFixed(1)} %  max ${Math.round(frames.max)} ms` : "";
		lines.push(`  ${result.name.padEnd(26)} ${result.verdict.padEnd(5)}${dropped}  ${result.summary.slice(0, 160)}`);
	}
	for (const name of launch.asked) if (!launch.scenarios.some((result) => result.name === name)) lines.push(`  ${name.padEnd(26)} no result`);
	for (const error of launch.harnessErrors.slice(0, 5)) lines.push(`  harness: ${error.slice(0, 200)}`);
	for (const fault of [...launch.crashes, ...launch.jsErrors].slice(0, 5)) lines.push(`  fatal: ${fault.slice(0, 200)}`);
	return lines;
}

/* ---- two ways of driving one scenario must agree ---- */

const COUNTS_THAT_AGREE = [0, 1, 3, 4, 5, 6];

/**
 * Where the first launch driven by one way and the first driven by another disagree on a scenario both ran: a check that held in one and
 * not in the other, or a recogniser whose begin, start, end, success, finalize or finalize-success count differs (the number of updates
 * differs by design: `adb input` moves as fast as the shell can, the injector once per frame, and the checks bound it). A scenario the lab
 * records and does not judge is left out.
 */
export function agreement(launches: readonly GestureLaunch[]): string[] {
	const byInput = new Map<GestureInput, GestureLaunch>();
	for (const launch of launches) if (launch.complete && !byInput.has(launch.input)) byInput.set(launch.input, launch);
	const [first, second] = [...byInput.values()];
	if (!first || !second) return [];
	const mismatches: string[] = [];
	for (const a of first.scenarios) {
		const b = second.scenarios.find((entry) => entry.name === a.name);
		if (!b || a.verdict === "info" || b.verdict === "info") continue;
		for (const check of a.checks) {
			const other = b.checks.find((entry) => entry.name === check.name);
			if (!other || other.ok !== check.ok) mismatches.push(`${a.name}: "${check.name}" ${check.ok ? "held" : "failed"} by ${first.input} and ${other ? (other.ok ? "held" : "failed") : "was not checked"} by ${second.input}`);
		}
		if (!a.counters || !b.counters) continue;
		a.counters.forEach((round, index) => {
			const other = b.counters?.[index] ?? {};
			for (const handler of new Set([...Object.keys(round), ...Object.keys(other)])) {
				const x = round[handler];
				const y = other[handler];
				if (!x || !y) { mismatches.push(`${a.name} round ${index}: ${handler} reported by ${x ? first.input : second.input} only`); continue; }
				for (const position of COUNTS_THAT_AGREE)
					if (x[position] !== y[position]) mismatches.push(`${a.name} round ${index}: ${handler} counted ${x[position]} by ${first.input} and ${y[position]} by ${second.input} (begin, start, update, end, endOk, finalize, finalizeOk: position ${position})`);
			}
		});
	}
	return mismatches;
}

/* ---- metrics ---- */

const largest = (numbers: number[]) => Math.max(...numbers);
const total = (numbers: number[]) => numbers.reduce((sum, value) => sum + value, 0);
const shortName = (name: string) => name.slice(prefix.length);

/** The worst of a per-launch value, or null when a launch that ran the scenario has none (the scenario was asked and not measured). */
function worst(values: (number | null)[]): number | null {
	if (values.length === 0 || values.some((value) => value === null)) return null;
	return largest(values as number[]);
}

/**
 * What the churn scenario left behind: records, native handlers, UI registrations and engine views above the baseline; null when it did
 * not report, and on Android when it did not count the engine's views (`viewsLeft`).
 */
export function leaked(result: GestureResult, platform: Platform): number | null {
	const marks = result.marks?.[0];
	if (!marks) return null;
	const left = [marks.records, marks.handlers, marks.eventHandlers];
	if (left.some((value) => typeof value !== "number")) return null;
	const views = viewsLeft(marks, platform);
	if (views === null) return null;
	return total((left as number[]).map((value) => (value < 0 ? 1 : value))) + Math.max(0, views);
}

/**
 * The numbers the `gestures.*` gates read, worst case over the launches and repeats. A scenario asked for and missing from a launch, or
 * one that timed out or threw, is a failed check (or `null`, not measured); frames are judged only where the scenario says so
 * (`frames` on its line: the box, the busy box, the pinch) and the gates for them are the phone's. `pinned` is the scenario list the
 * full run must contain (`gestures` in `gates.json`).
 */
export function gesturesMetrics(file: GesturesFile, pinned: readonly string[]): Metrics {
	const launches = file.launches;
	if (launches.length === 0) return {};
	const asked = (name: string) => launches.filter((launch) => launch.asked.includes(name));
	const resultsOf = (name: string) => launches.flatMap((launch) => launch.scenarios.filter((result) => result.name === name));
	const names = [...new Set([...pinned, ...launches.flatMap((launch) => launch.asked)])];
	const missing = pinned.filter((name) => asked(name).length === 0 || asked(name).some((launch) => !launch.scenarios.some((result) => result.name === name)));
	const metrics: Metrics = {
		"gestures.launches": launches.filter((launch) => launch.complete).length,
		"gestures.incompleteLaunches": launches.filter((launch) => !launch.complete).length,
		"gestures.scenarios.missing": missing.length,
		"gestures.fatals": total(launches.map((launch) => launch.crashes.length + launch.jsErrors.length)) + unattributedCount(file.crashReports),
		"gestures.engineWarnings": total(launches.map((launch) => launch.engineWarnings.length)),
		"gestures.harnessErrors": total(launches.map((launch) => launch.harnessErrors.length)),
	};
	for (const name of names) {
		const results = resultsOf(name);
		const missingSomewhere = asked(name).length === 0 || asked(name).length > results.length;
		const judged = results.filter((result) => result.verdict !== "info");
		const short = shortName(name);
		if (results.length > 0 && judged.length === 0) {
			// Recorded, not judged: the lab says `info`, so there is no gate on it, only the number.
			metrics[`gestures.${short}.observedFailedChecks`] = largest(results.map(failedChecks));
			continue;
		}
		metrics[`gestures.${short}.failedChecks`] = missingSomewhere || judged.length === 0 ? null : largest(judged.map(failedChecks));
		const framed = judged.filter((result) => result.frames !== null);
		if (framed.length > 0) {
			const complete = framed.length === judged.length;
			const frames = (pick: (result: GestureResult) => number) => (complete ? worst(framed.map((result) => pick(result))) : null);
			metrics[`gestures.${short}.droppedPct`] = frames((result) => (result.frames as NonNullable<GestureResult["frames"]>).droppedPct);
			// The late intervals the phones' gesture-frame gates judge (D9: at most one per launch); null when the record cannot give the exact count.
			metrics[`gestures.${short}.lateIntervals`] = complete ? worst(framed.map((result) => lateIntervals(result.frames as NonNullable<GestureResult["frames"]>))) : null;
			metrics[`gestures.${short}.maxMs`] = frames((result) => (result.frames as NonNullable<GestureResult["frames"]>).max);
			metrics[`gestures.${short}.maxPeriodRatio`] = frames((result) => {
				const f = result.frames as NonNullable<GestureResult["frames"]>;
				return f.periodMs > 0 ? f.max / f.periodMs : Number.POSITIVE_INFINITY;
			});
		}
		if (name === "gestures-churn") metrics["gestures.churn.leaked"] = missingSomewhere ? null : worst(judged.map((result) => leaked(result, file.device.platform)));
	}
	// Two ways of driving agree only when two ways were run; on a platform with one (the iPhone's XCUITest) the gate is not asked for.
	const inputs = new Set(launches.filter((launch) => launch.complete).map((launch) => launch.input));
	if (inputs.size >= 2) metrics["gestures.agreement.mismatches"] = agreement(launches).length;
	return metrics;
}

/** The scenarios of the full run, for the report: `gates.json`'s list, or every scenario the lab has. */
export const allScenarios: readonly string[] = scenarios.map((spec) => spec.name);
