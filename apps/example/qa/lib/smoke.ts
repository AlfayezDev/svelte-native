import { readFile } from "node:fs/promises";
import { checkGatesFile, evaluate, splitGates, type GateRow, type GatesFile } from "./gates.ts";
import { gatesPath } from "./paths.ts";
import type { Metrics, Platform, SmokeFile, SmokeModuleResult } from "./types.ts";

/** What `gates.json` pins for a platform: the modules a run must report, and the ones that may legitimately `skip` there (Huawei's library on a Samsung, an Android-only library on the iPhone). */
export type SmokePins = { modules: readonly string[]; skips: readonly string[] };

export async function loadGatesFile(): Promise<GatesFile> {
	const file = JSON.parse(await readFile(gatesPath, "utf8")) as GatesFile;
	checkGatesFile(file);
	return file;
}

export async function smokePins(platform: Platform): Promise<SmokePins> {
	const file = await loadGatesFile();
	return { modules: file.smoke.modules[platform], skips: file.smoke.skips[platform] };
}

/** The modules `gates.json` pins for a platform (`smoke.modules`): the ones a run must report. */
export async function pinnedModules(platform: Platform): Promise<string[]> {
	return [...(await smokePins(platform)).modules];
}

/**
 * The pinned modules no line of the run reports. A module that logged `fail` or `skip` reported; one that never logged anything
 * (the app crashed before it, the call never returned, the list in `gates.json` has a module the app does not know) is missing.
 */
export function missingModules(results: readonly SmokeModuleResult[], pinned: readonly string[]): string[] {
	const reported = new Set(results.map((result) => result.module));
	return pinned.filter((module) => !reported.has(module));
}

/** Modules the run reported that `gates.json` does not pin: the list and the app disagree. */
export function unpinnedModules(results: readonly SmokeModuleResult[], pinned: readonly string[]): string[] {
	const known = new Set(pinned);
	return results.map((result) => result.module).filter((module) => !known.has(module));
}

/** Pinned modules that skipped although the platform does not list them as skips: a library that should have answered and did not. */
export function unexpectedSkips(results: readonly SmokeModuleResult[], pins: SmokePins): string[] {
	return results.filter((result) => result.status === "skip" && pins.modules.includes(result.module) && !pins.skips.includes(result.module)).map((result) => result.module);
}

/**
 * What the gates read of a run. `smoke.failed` counts the modules that logged `fail`, `smoke.missing` the pinned ones that logged
 * nothing, `smoke.unexpectedSkips` the skips the platform does not list, `smoke.fatals` the crashes, ANRs and interruptions (not measured on iOS when the phone's crash log could not be read and no crash is counted already), and
 * `smoke.complete` is 1 for a run that logged its completion line, was not interrupted and did not crash. A run that did not complete
 * still counts what it saw. `smoke.unpinned` and `smoke.jsErrors` are reported, not gated.
 */
export function smokeMetrics(file: SmokeFile, pins: SmokePins): Metrics {
	const count = (status: SmokeModuleResult["status"]) => file.results.filter((result) => result.status === status && pins.modules.includes(result.module)).length;
	return {
		"smoke.modules": pins.modules.length,
		"smoke.ok": count("ok"),
		"smoke.failed": count("fail"),
		"smoke.skipped": count("skip"),
		"smoke.unexpectedSkips": unexpectedSkips(file.results, pins).length,
		"smoke.missing": missingModules(file.results, pins.modules).length,
		"smoke.unpinned": unpinnedModules(file.results, pins.modules).length,
		// An app that aborted after it wrote its results leaves only a crash report: a log that could not be read cannot say it did not, unless a crash is already counted.
		"smoke.fatals": file.crashReportsError !== undefined && file.crashes.length === 0 ? null : file.crashes.length,
		"smoke.jsErrors": file.jsErrorCount,
		"smoke.complete": file.complete ? 1 : 0,
	};
}

/** The lines `smoke` prints for a run: the counts, then every module that did not pass or skip as it should. */
export function describeSmoke(file: SmokeFile, pins: SmokePins): string[] {
	const missing = missingModules(file.results, pins.modules);
	const unexpected = new Set(unexpectedSkips(file.results, pins));
	const count = (status: SmokeModuleResult["status"]) => file.results.filter((result) => result.status === status).length;
	const lines = [
		`  complete ${file.complete} in ${(file.durationMs / 1000).toFixed(0)} s: ${count("ok")} ok, ${count("fail")} failed, ${count("skip")} skipped, ${missing.length} missing of ${pins.modules.length} pinned`,
	];
	for (const result of file.results.filter((entry) => entry.status === "fail")) lines.push(`  FAIL ${result.module} (${result.path}): ${result.detail}`);
	for (const result of file.results.filter((entry) => entry.status === "skip"))
		lines.push(`  ${unexpected.has(result.module) ? "UNEXPECTED SKIP" : "skip"} ${result.module}: ${result.detail}`);
	for (const module of missing) lines.push(`  MISSING ${module}`);
	for (const crash of file.crashes.slice(0, 5)) lines.push(`  fatal: ${crash.slice(0, 200)}`);
	if (!file.complete) lines.push("  the run did not complete (no completion line, a crash, or another app took the screen)");
	return lines;
}

/** The smoke gates of `gates.json` against this run, for the device it ran on: the verdict `gates --smoke` would give, so the command can fail the way the lane does. */
export async function judgeSmoke(file: SmokeFile, gatesFile?: GatesFile): Promise<{ rows: GateRow[]; ok: boolean; lines: string[] }> {
	const gates = gatesFile ?? (await loadGatesFile());
	const platform = file.device.platform;
	const serial = file.device.serial;
	const metrics = smokeMetrics(file, { modules: gates.smoke.modules[platform], skips: gates.smoke.skips[platform] });
	const rows = evaluate(splitGates(gates.gates).smoke, { [serial]: { platform, role: gates.devices[serial]?.role ?? null, runs: gates.devices[serial]?.runs ?? null, metrics } }, platform, gates.exceptions);
	const bad = rows.filter((row) => row.verdict === "fail" || row.verdict === "not measured");
	return {
		rows,
		ok: bad.length === 0,
		lines: bad.map((row) => `  gate ${row.id} ${row.verdict}: ${row.measured ?? "-"} (bar ${JSON.stringify(row.bar)})`),
	};
}
