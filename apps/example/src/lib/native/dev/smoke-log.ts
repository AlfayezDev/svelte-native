/**
 * The line format of the native module smoke test (SPEC.md, "Native modules (smoke test)"): one line per module,
 * `[Svelte smoke] <module> ok|fail|skip path=js|direct|js+direct|none ms=<n> <detail>`, then `[Svelte smoke] complete <json>`.
 * `qa/parse/smoke.ts` reads these lines out of logcat; `qa/test/smoke.test.ts` checks the two agree. No React Native import:
 * the harness's tests load this file.
 */
export type SmokeStatus = "ok" | "fail" | "skip";
export type Os = "android" | "ios";
/** The name of the error a check throws to say it does not apply (`skip` in smoke-checks.ts): tagged by name, not by class, because `instanceof` on a transpiled Error subclass is not dependable. */
export const skipName = "SmokeSkip";
/** `js`: the library's own JavaScript API. `direct`: its TurboModule or NativeModule by name, because its JavaScript needs React or reaches another module. `js+direct`: both. `none`: nothing ran (a skip). */
export type SmokePath = "js" | "direct" | "js+direct" | "none";

export type SmokeResult = { module: string; status: SmokeStatus; path: SmokePath; ms: number; detail: string };

export const smokePrefix = "[Svelte smoke]";
/** Logcat cuts a line near 4 KB; the lines of this test stay far below. */
const maxDetail = 300;

/** The detail on one line, bounded: a native error message can carry newlines and a whole stack. */
export function oneLine(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > maxDetail ? `${flat.slice(0, maxDetail - 1)}…` : flat;
}

export function formatSmokeLine(result: SmokeResult): string {
	return `${smokePrefix} ${result.module} ${result.status} path=${result.path} ms=${Math.round(result.ms)} ${oneLine(result.detail)}`.trimEnd();
}

export type SmokeSummary = { os: string; total: number; ok: number; fail: number; skip: number };

export function formatSmokeSummary(results: readonly SmokeResult[], os: string): string {
	const count = (status: SmokeStatus) => results.filter((result) => result.status === status).length;
	const summary: SmokeSummary = { os, total: results.length, ok: count("ok"), fail: count("fail"), skip: count("skip") };
	return `${smokePrefix} complete ${JSON.stringify(summary)}`;
}

/**
 * The `token` of the launch URL (`?token=`): the lab page sets it, and the results file echoes it, so a harness that reads files
 * (the iPhone's: `devicectl` cannot follow a log) can tell this launch's file from an earlier one. Null when the launch had none.
 */
export const smokeLaunch: { token: string | null } = { token: null };

/** `Documents/smoke-results.json`, written when a run ends. */
export type SmokeResultsFile = { token: string | null; finishedAt: string; os: string; results: SmokeResult[] };
