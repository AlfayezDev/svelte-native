import { stat, writeFile } from "node:fs/promises";
import { flagString, parseFlags } from "../lib/flags.ts";
import { evaluate, exceptGates, renderMarkdown, splitGates } from "../lib/gates.ts";
import { reportPath } from "../lib/paths.ts";
import { latestRunFiles, readJson, runKinds, slug, type RunKind } from "../lib/runs.ts";
import type { Platform } from "../lib/types.ts";
import { deviceNames, loadGates, printVerdict, reportDevices, type ReportFile } from "./report.ts";

/** A run file the report reads, with when it was last written and which platform's device made it. */
export type RunFileState = { file: string; modifiedAt: Date; platform: Platform };

/**
 * Why a report cannot be judged, or nothing: a run file of a device of this platform was written after the report was, so the
 * verdict would not be about the newest measurements, or the report itself warns (runs of different builds, of a
 * build nobody identified, or a suite that could not put its device back), so its numbers do not describe one build. The QA lane reads
 * `warnings`, the smoke lane (`smoke`) `smokeWarnings`.
 */
export function reportProblems(report: ReportFile, runs: RunFileState[], platform?: Platform, smoke = false): string[] {
	const generatedAt = new Date(report.generatedAt);
	const problems = runs
		.filter((run) => (platform === undefined || run.platform === platform) && run.modifiedAt > generatedAt)
		.map((run) => `${run.file} was written ${run.modifiedAt.toISOString()}, after the report (${report.generatedAt}): run \`native-qa report\` again`);
	// Each lane reads the warnings of its own runs: the smoke run is another app, so the QA lane does not fail on it nor the smoke lane on the QA runs.
	const laneWarnings = smoke ? (report.smokeWarnings ?? []) : report.warnings;
	const warnings = platform === undefined ? laneWarnings : laneWarnings.filter((warning) => concerns(report, warning, platform));
	for (const warning of warnings) problems.push(`the report warns: ${warning}`);
	return problems;
}

/** A warning belongs to the device whose serial starts it (`<serial>: ...`); one that names none concerns every platform. */
function concerns(report: ReportFile, warning: string, platform: Platform): boolean {
	const owner = Object.entries(report.devices).find(([serial]) => warning.startsWith(`${serial}:`));
	return owner === undefined || owner[1].platform === platform;
}

/** The newest run file of each kind (the smoke lane: of the smoke kind only) for each device, with its modification time: the files `report` would read now. */
async function newestRunFiles(report: ReportFile, smoke: boolean): Promise<RunFileState[]> {
	const platforms = new Map(Object.entries(report.devices).map(([serial, entry]) => [slug(serial), entry.platform]));
	const states: RunFileState[] = [];
	const latest = await latestRunFiles();
	const kinds: readonly RunKind[] = smoke ? ["smoke"] : runKinds.filter((kind) => kind !== "smoke");
	for (const kind of kinds) {
		for (const [device, path] of latest[kind]) {
			// A device the report does not list is read for its platform: a new phone's first run is newer than the report too.
			const platform = platforms.get(device) ?? (await readJson<{ device: { platform: Platform } }>(path)).device.platform;
			states.push({ file: path.slice(path.lastIndexOf("runs/")), modifiedAt: (await stat(path)).mtime, platform });
		}
	}
	return states;
}

/** `--runs lab,parity`: the run kinds a lane ran, so the gates of the others are informational instead of "not measured". */
export function runsFlag(value: string | boolean | undefined): RunKind[] | undefined {
	if (typeof value !== "string") return undefined;
	const kinds = value.split(",").map((kind) => kind.trim()).filter(Boolean);
	const unknown = kinds.filter((kind) => !(runKinds as readonly string[]).includes(kind));
	if (kinds.length === 0 || unknown.length > 0)
		throw new Error(`--runs must list run kinds (${runKinds.join(", ")}); not ${unknown.length > 0 ? unknown.join(", ") : "an empty list"}`);
	return kinds as RunKind[];
}

/**
 * Which build measured each run of the judged devices, as Markdown: one table per device that has runs, with the run, the build key,
 * its commit and, for a run carried from an earlier build (D14), the reason; empty when the report records none (written before).
 */
export function renderBuilds(report: ReportFile, platform: Platform | undefined, names: Record<string, string>): string[] {
	const out: string[] = [];
	for (const [serial, entry] of Object.entries(report.devices)) {
		if ((platform !== undefined && entry.platform !== platform) || !entry.measuredBuilds || entry.measuredBuilds.length === 0) continue;
		const carried = entry.measuredBuilds.filter((run) => run.carried !== null).length;
		out.push(
			`**Builds measured, ${names[serial] ?? serial}${carried > 0 ? ` (${carried} ${carried === 1 ? "run" : "runs"} carried from an earlier build under D14)` : ""}**`,
			"",
			"| run | build | commit | carried |",
			"| --- | --- | --- | --- |",
			...entry.measuredBuilds.map((run) => `| ${[run.run, run.build ?? "not identified", run.commit, run.carried ? `${run.carried.decision}: ${run.carried.reason}` : "-"].map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`),
			"",
		);
	}
	return out;
}

const age = (since: Date): string => {
	const minutes = Math.round((Date.now() - since.getTime()) / 60_000);
	return minutes < 90 ? `${minutes} min` : `${(minutes / 60).toFixed(1)} h`;
};

/**
 * Evaluates gates.json against the measurements in report.json and sets the exit code: 0 only if every gate passed or is a documented
 * exception (a miss that gates.json's `exceptions` accepts, counted apart), the report is newer than every run file it reads, and it
 * has no warnings. A failure or a gate that was not measured is exit 1. The QA gates and the smoke gates are two lanes: `gates` judges the
 * first (the QA app's boot, frames, parity, accessibility, crashes), `gates --smoke` the second (the smoke app's native modules).
 */
export async function gates(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		platform: { type: "string" },
		all: { type: "boolean" },
		smoke: { type: "boolean" },
		runs: { type: "string" },
		except: { type: "string" },
		markdown: { type: "string" },
	});
	const smoke = values.smoke === true;
	const platform = flagString(values.platform);
	if (platform !== undefined && platform !== "android" && platform !== "ios")
		throw new Error("--platform must be android or ios");
	const reportFile = await readJson<ReportFile>(reportPath).catch((error: unknown) => {
		throw new Error(
			`cannot read qa/report.json (run \`native-qa report\` first): ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	const problems = reportProblems(reportFile, await newestRunFiles(reportFile, smoke), platform, smoke);
	console.log(`report generated ${reportFile.generatedAt} (${age(new Date(reportFile.generatedAt))} ago)`);
	for (const problem of problems) console.log(`FAIL: ${problem}`);
	const gatesFile = await loadGates();
	const lanes = splitGates(gatesFile.gates);
	console.log(smoke ? "lane: the smoke app's native modules (smoke.* gates)" : "lane: the QA app (every gate but smoke.*; `--smoke` judges the smoke app)");
	const only = runsFlag(values.runs);
	if (only) console.log(`run kinds judged: ${only.join(", ")} (the gates of the others are informational)`);
	const except = (flagString(values.except) ?? "").split(",").map((id) => id.trim()).filter(Boolean);
	if (except.length > 0) console.log(`gates not judged by this lane (run at a smaller sample than the bar's): ${except.join(", ")}`);
	const rows = exceptGates(evaluate(smoke ? lanes.smoke : lanes.standard, reportDevices(reportFile, gatesFile, only), platform, gatesFile.exceptions), except, gatesFile);
	const ok = printVerdict(rows, values.all === true, deviceNames(gatesFile));
	for (const [serial, entry] of Object.entries(reportFile.devices))
		for (const run of entry.measuredBuilds ?? [])
			if (run.carried && (platform === undefined || entry.platform === platform))
				console.log(`carried (${run.carried.decision}): the ${run.run} run of ${deviceNames(gatesFile)[serial] ?? serial} measured ${run.build} (${run.commit}): ${run.carried.reason}`);
	if (problems.length > 0) console.log(`\n${problems.length} problem(s) with the report itself: the verdict above is not one that can pass`);
	const markdown = flagString(values.markdown);
	if (markdown !== undefined) {
		const title = `${smoke ? "Smoke gates" : "Gates"}${platform ? `, ${platform}` : ""}`;
		const problemLines = problems.length > 0 ? ["**Problems with the report itself** (the verdict cannot pass):", "", ...problems.map((problem) => `- ${problem}`), ""] : [];
		await writeFile(markdown, `${[renderMarkdown(rows, title, deviceNames(gatesFile)), ...renderBuilds(reportFile, platform, deviceNames(gatesFile)), ...problemLines].join("\n")}\n`);
	}
	process.exitCode = ok && problems.length === 0 ? 0 : 1;
}
