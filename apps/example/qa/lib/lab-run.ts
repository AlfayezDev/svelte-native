import type { LabRun } from "./types.ts";
import {
	findEngineWarnings,
	findFaults,
	findInterruption,
	parseLabChecks,
	parseSvelteBoot,
	readStressComplete,
	readStressScenarios,
} from "../parse/logcat.ts";

export type LabCapture = {
	text: string;
	matched: boolean;
	startedAt: Date;
	durationMs: number;
	logFile: string;
};

/**
 * One lab run from the logcat captured while it ran. `matched` says whether the lab's last line appeared. A `[Svelte stress]` line that
 * cannot be read (logcat cut it, or it is quoted in a way nobody expected) does not stop the run being recorded: it is in `unparsedLines`,
 * which `lab.unparsedLines` fails, and the scenario it carried is absent.
 */
export function labRunFrom(
	capture: LabCapture,
	packageName: string,
	stressRequested: boolean,
): LabRun {
	const { text } = capture;
	const { completion, unparsed: completionUnparsed } = readStressComplete(text);
	const { scenarios, unparsed: scenariosUnparsed } = readStressScenarios(text);
	const unparsedLines = [...scenariosUnparsed, ...completionUnparsed];
	const faults = findFaults(text, packageName);
	const interrupted = findInterruption(text, packageName);
	return {
		startedAt: capture.startedAt.toISOString(),
		durationMs: capture.durationMs,
		complete: capture.matched && (!stressRequested || completion !== null) && interrupted === null,
		checks: parseLabChecks(text),
		boot: parseSvelteBoot(text),
		scenarios,
		expectedScenarios: (completion?.results ?? [])
			.filter((result) => result.verdict !== "info")
			.map((result) => result.name),
		crashes: faults.crashes,
		jsErrors: faults.jsErrors,
		jsErrorCount: faults.jsErrors.length,
		engineWarnings: findEngineWarnings(text),
		...(interrupted ? { interrupted } : {}),
		...(unparsedLines.length > 0 ? { unparsedLines } : {}),
		logFile: capture.logFile,
	};
}

export const stressRequested = (run: string) => run.split(",").some((part) => part && part !== "checks");

export function describeRun(run: LabRun): string[] {
	const jsErrors = run.jsErrorCount === undefined ? run.jsErrors.length : run.jsErrorCount;
	const fatals = jsErrors === null ? `${run.crashes.length} (JavaScript errors not reported by the app)` : run.crashes.length + jsErrors;
	const lines = [
		`  complete ${run.complete} in ${(run.durationMs / 1000).toFixed(0)} s, checks ${run.checks ? `${run.checks.passed}/${run.checks.total}` : "none logged"}, fatals ${fatals}, engine warnings ${run.engineWarnings.length}`,
	];
	if (run.interrupted) lines.push(`  interrupted by ${run.interrupted.by} at ${run.interrupted.at} (device clock)`);
	for (const unreadable of (run.unparsedLines ?? []).slice(0, 5)) lines.push(`  UNREADABLE LINE ${unreadable.slice(0, 400)}`);
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
