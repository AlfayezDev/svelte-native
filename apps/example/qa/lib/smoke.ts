import { readFile } from "node:fs/promises";
import { gatesPath } from "./paths.ts";
import type { Metrics, Platform, SmokeFile, SmokeModuleResult } from "./types.ts";

/** The modules `gates.json` pins for a platform (`smoke.modules`): the ones a run must report. */
export async function pinnedModules(platform: Platform): Promise<string[]> {
	const file = JSON.parse(await readFile(gatesPath, "utf8")) as { smoke?: { modules?: Partial<Record<Platform, string[]>> } };
	const modules = file.smoke?.modules?.[platform];
	if (!modules || modules.length === 0) throw new Error(`gates.json pins no smoke modules for ${platform}`);
	return modules;
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

/**
 * `smoke.failed` counts the modules that logged `fail`, `smoke.missing` the pinned ones that logged nothing. A run that did not
 * complete still counts what it saw: its missing modules are what fail the gate. `smoke.unpinned` is not gated (it is reported).
 */
export function smokeMetrics(file: SmokeFile, pinned: readonly string[]): Metrics {
	const count = (status: SmokeModuleResult["status"]) => file.results.filter((result) => result.status === status && pinned.includes(result.module)).length;
	return {
		"smoke.modules": pinned.length,
		"smoke.ok": count("ok"),
		"smoke.failed": count("fail"),
		"smoke.skipped": count("skip"),
		"smoke.missing": missingModules(file.results, pinned).length,
		"smoke.unpinned": unpinnedModules(file.results, pinned).length,
		"smoke.complete": file.complete ? 1 : 0,
	};
}

/** The lines `smoke` prints for a run: the counts, then every module that did not pass or skip. */
export function describeSmoke(file: SmokeFile, pinned: readonly string[]): string[] {
	const missing = missingModules(file.results, pinned);
	const count = (status: SmokeModuleResult["status"]) => file.results.filter((result) => result.status === status).length;
	const lines = [
		`  complete ${file.complete} in ${(file.durationMs / 1000).toFixed(0)} s: ${count("ok")} ok, ${count("fail")} failed, ${count("skip")} skipped, ${missing.length} missing of ${pinned.length} pinned`,
	];
	for (const result of file.results.filter((entry) => entry.status === "fail")) lines.push(`  FAIL ${result.module} (${result.path}): ${result.detail}`);
	for (const result of file.results.filter((entry) => entry.status === "skip")) lines.push(`  skip ${result.module}: ${result.detail}`);
	for (const module of missing) lines.push(`  MISSING ${module}`);
	for (const crash of file.crashes.slice(0, 5)) lines.push(`  fatal: ${crash.slice(0, 200)}`);
	return lines;
}
