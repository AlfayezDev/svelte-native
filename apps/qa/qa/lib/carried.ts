/**
 * The runs of a device that `report` compares for one build, by the label it gives them (`crash` is the crash volume, `accessibility`
 * the a11y suite). The smoke run is another app and the updates run installs the channel build, so neither is one of them.
 */
export const measuredRuns = ["lab", "boot", "soak", "crash", "parity", "accessibility", "resilience", "gestures", "foreign"] as const;
export type MeasuredRun = (typeof measuredRuns)[number];

/**
 * Runs carried from an earlier build (D14 in the run log's `GOAL.md`): after a fix only the suites its diff can affect run again on
 * the new build, and the others stand. The `runs` of `device` (a key of `devices`) measured the build `build`, its key as the report
 * prints it (`sha256 <12 hex>` for an APK, `main.jsbundle <12 hex>, CDHash <12 hex>` for an iOS app), made from `commit`; `reason`
 * says why the result stands for the final source: what the diff from `commit` changes, and why those runs cannot see it or which
 * runs on the final build measured it instead.
 *
 * A carried run is left out of the check that every run of a device measured one build and is listed instead, with its build and the
 * reason. A run an entry names that measured another build is compared as usual (and noted), so an entry never hides a run it does
 * not describe: the runs that are not carried must still agree on one build.
 */
export type CarriedRuns = { device: string; runs: MeasuredRun[]; build: string; commit: string; decision: "D14"; reason: string };

const buildKeyPattern = /^(sha256 [0-9a-f]{12}|main\.jsbundle [0-9a-f]{12}, CDHash [0-9a-f]{12})$/;

/**
 * A malformed entry is an error, not a wider carry: another decision than D14, a device `devices` does not list, no runs or a run label
 * the report does not compare, a run of a device carried twice (the report reads one file per run kind), a build that is not a build
 * key, a commit that is not an abbreviated hash, an empty reason.
 */
export function checkCarried(file: { devices: Record<string, unknown>; carried?: CarriedRuns[] }): void {
	const known = new Set<string>(measuredRuns);
	const seen = new Set<string>();
	for (const entry of file.carried ?? []) {
		const label = `gates.json: carried runs of ${entry.device}`;
		if (entry.decision !== "D14") throw new Error(`${label} have the decision ${JSON.stringify(entry.decision)}; runs are carried under D14 only`);
		if (!file.devices[entry.device]) throw new Error(`${label} name a device gates.json does not list`);
		if (entry.runs.length === 0) throw new Error(`${label} name no run`);
		for (const run of entry.runs) {
			if (!known.has(run)) throw new Error(`${label} name ${JSON.stringify(run)}, which is not a run the report compares (${measuredRuns.join(", ")})`);
			if (seen.has(`${entry.device}\u0000${run}`)) throw new Error(`${label} carry the ${run} run twice`);
			seen.add(`${entry.device}\u0000${run}`);
		}
		if (!buildKeyPattern.test(entry.build))
			throw new Error(`${label}: build ${JSON.stringify(entry.build)} is not a build key as the report prints it ("sha256 <12 hex>" or "main.jsbundle <12 hex>, CDHash <12 hex>")`);
		if (!/^[0-9a-f]{7,40}$/.test(entry.commit)) throw new Error(`${label}: commit ${JSON.stringify(entry.commit)} is not a commit hash`);
		if (entry.reason.trim() === "") throw new Error(`${label} have no reason`);
	}
}

/** The entry that carries the run `run` of `serial` when it measured `key`; undefined when none does (no entry, or one for another build). */
export function carriedEntry(carried: readonly CarriedRuns[], serial: string, run: string, key: string | null): CarriedRuns | undefined {
	if (key === null) return undefined;
	return carried.find((entry) => entry.device === serial && entry.build === key && (entry.runs as readonly string[]).includes(run));
}
