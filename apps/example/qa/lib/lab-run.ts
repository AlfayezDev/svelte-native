import type { LabRun } from "./types.ts";
import {
	findEngineWarnings,
	findFaults,
	parseLabChecks,
	parseStressComplete,
	parseStressScenarios,
	parseSvelteBoot,
} from "../parse/logcat.ts";

export type LabCapture = {
	text: string;
	matched: boolean;
	startedAt: Date;
	durationMs: number;
	logFile: string;
};

/** One lab run from the logcat captured while it ran. `matched` says whether the lab's last line appeared. */
export function labRunFrom(
	capture: LabCapture,
	packageName: string,
	stressRequested: boolean,
): LabRun {
	const { text } = capture;
	const completion = parseStressComplete(text);
	const faults = findFaults(text, packageName);
	return {
		startedAt: capture.startedAt.toISOString(),
		durationMs: capture.durationMs,
		complete: capture.matched && (!stressRequested || completion !== null),
		checks: parseLabChecks(text),
		boot: parseSvelteBoot(text),
		scenarios: parseStressScenarios(text),
		expectedScenarios: (completion?.results ?? [])
			.filter((result) => result.verdict !== "info")
			.map((result) => result.name),
		crashes: faults.crashes,
		jsErrors: faults.jsErrors,
		engineWarnings: findEngineWarnings(text),
		logFile: capture.logFile,
	};
}

export const stressRequested = (run: string) => run.split(",").some((part) => part && part !== "checks");

export function describeRun(run: LabRun): string[] {
	const lines = [
		`  complete ${run.complete} in ${(run.durationMs / 1000).toFixed(0)} s, checks ${run.checks ? `${run.checks.passed}/${run.checks.total}` : "none logged"}, fatals ${run.crashes.length + run.jsErrors.length}, engine warnings ${run.engineWarnings.length}`,
	];
	if (run.boot)
		lines.push(
			`  [Svelte boot] ${Object.entries(run.boot)
				.map(([key, value]) => `${key} ${value}`)
				.join(" · ")}`,
		);
	for (const scenario of run.scenarios) {
		const frames = scenario.frames;
		lines.push(
			`  ${scenario.name.padEnd(24)} ${scenario.verdict.padEnd(5)} ${frames ? `dropped ${frames.droppedPct.toFixed(1)} %  p95 ${frames.p95}  max ${frames.max} ms` : scenario.summary.slice(0, 80)}`,
		);
	}
	for (const fault of [...run.crashes, ...run.jsErrors].slice(0, 5))
		lines.push(`  fatal: ${fault.slice(0, 200)}`);
	return lines;
}
