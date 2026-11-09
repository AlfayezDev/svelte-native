import type { AmStart } from "../parse/adb.ts";
import {
	findEngineWarnings,
	findFaults,
	parseLaunchMarkers,
	parseSvelteBoot,
} from "../parse/logcat.ts";
import type { Launch } from "./types.ts";

export const missingPairError = "no Start proc to Displayed pair in logcat";

/** One launch from the logcat it left and the `am start -W` output. */
export function launchFrom(index: number, text: string, am: AmStart, packageName: string): Launch {
	const markers = parseLaunchMarkers(text, packageName);
	const faults = findFaults(text, packageName);
	return {
		index,
		displayMs: markers.displayMs,
		runningMainMs: markers.runningMainMs,
		displayedReportedMs: markers.displayedReportedMs,
		totalTimeMs: am.totalTimeMs,
		jsMarks: parseSvelteBoot(text),
		crashes: faults.crashes.length,
		jsErrors: faults.jsErrors.length,
		engineWarnings: findEngineWarnings(text).length,
		error:
			markers.displayMs === null
				? missingPairError
				: am.status === "ok"
					? null
					: `am start status ${am.status}`,
		attempts: 1,
	};
}

/**
 * Whether a launch is run again at once: its `Start proc` to `Displayed` pair is missing while the app process is alive and
 * the log shows no fault, so the read of logcat, not the app, is what failed. It is tried once more, never twice; a launch
 * that crashed or whose process is gone is a real failure and is kept as it is.
 */
export function shouldRetry(launch: Launch, processAlive: boolean): boolean {
	return (launch.attempts ?? 1) < 2 && launch.displayMs === null && launch.crashes === 0 && processAlive;
}

/** The launch that fills the slot after a retry: the second attempt, which says it was the second. A second miss is the failure it was. */
export function afterRetry(second: Launch): Launch {
	return { ...second, attempts: 2 };
}
