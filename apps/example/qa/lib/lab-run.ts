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
