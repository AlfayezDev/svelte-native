import { stat } from "node:fs/promises";
import { flagString, parseFlags } from "../lib/flags.ts";
import { evaluate } from "../lib/gates.ts";
import { reportPath } from "../lib/paths.ts";
import { latestRunFiles, readJson, runKinds, slug } from "../lib/runs.ts";
import type { Platform } from "../lib/types.ts";
import { loadGates, printVerdict, reportDevices, type ReportFile } from "./report.ts";

/** A run file the report reads, with when it was last written and which platform's device made it. */
export type RunFileState = { file: string; modifiedAt: Date; platform: Platform };

/**
 * Why a report cannot be judged, or nothing: a run file of a device of this platform was written after the report was, so the
 * verdict would not be about the newest measurements, or the report itself warns (runs of different builds or commits, or of a
 * build nobody identified), so its numbers do not describe one build.
 */
export function reportProblems(report: ReportFile, runs: RunFileState[], platform?: Platform): string[] {
	const generatedAt = new Date(report.generatedAt);
	const problems = runs
		.filter((run) => (platform === undefined || run.platform === platform) && run.modifiedAt > generatedAt)
		.map((run) => `${run.file} was written ${run.modifiedAt.toISOString()}, after the report (${report.generatedAt}): run \`native-qa report\` again`);
	const warnings = platform === undefined ? report.warnings : report.warnings.filter((warning) => concerns(report, warning, platform));
	for (const warning of warnings) problems.push(`the report warns: ${warning}`);
	return problems;
}

/** A warning belongs to the device whose serial starts it (`<serial>: ...`); one that names none concerns every platform. */
function concerns(report: ReportFile, warning: string, platform: Platform): boolean {
	const owner = Object.entries(report.devices).find(([serial]) => warning.startsWith(`${serial}:`));
	return owner === undefined || owner[1].platform === platform;
}

/** The newest run file of each kind for each device, with its modification time: the files `report` would read now. */
async function newestRunFiles(report: ReportFile): Promise<RunFileState[]> {
	const platforms = new Map(Object.entries(report.devices).map(([serial, entry]) => [slug(serial), entry.platform]));
	const states: RunFileState[] = [];
	const latest = await latestRunFiles();
	for (const kind of runKinds) {
		for (const [device, path] of latest[kind]) {
			// A device the report does not list is read for its platform: a new phone's first run is newer than the report too.
			const platform = platforms.get(device) ?? (await readJson<{ device: { platform: Platform } }>(path)).device.platform;
			states.push({ file: path.slice(path.lastIndexOf("runs/")), modifiedAt: (await stat(path)).mtime, platform });
		}
	}
	return states;
}

const age = (since: Date): string => {
	const minutes = Math.round((Date.now() - since.getTime()) / 60_000);
	return minutes < 90 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`;
};

/**
 * Evaluates gates.json against the measurements in report.json and sets the exit code: 0 only if every gate passed, the report is
 * newer than every run file it reads, and it has no warnings.
 */
export async function gates(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { platform: { type: "string" }, all: { type: "boolean" } });
	const platform = flagString(values.platform);
	if (platform !== undefined && platform !== "android" && platform !== "ios")
		throw new Error("--platform must be android or ios");
	const reportFile = await readJson<ReportFile>(reportPath).catch((error: unknown) => {
		throw new Error(
			`cannot read qa/report.json (run \`native-qa report\` first): ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	const problems = reportProblems(reportFile, await newestRunFiles(reportFile), platform);
	console.log(`report generated ${reportFile.generatedAt} (${age(new Date(reportFile.generatedAt))} ago)`);
	for (const problem of problems) console.log(`FAIL: ${problem}`);
	const rows = evaluate((await loadGates()).gates, reportDevices(reportFile), platform);
	const ok = printVerdict(rows, values.all === true);
	if (problems.length > 0) console.log(`\n${problems.length} problem(s) with the report itself: the verdict above is not one that can pass`);
	process.exitCode = ok && problems.length === 0 ? 0 : 1;
}
