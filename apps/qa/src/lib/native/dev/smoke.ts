import Platform from "react-native/Libraries/Utilities/Platform";
import { formatSmokeLine, formatSmokeSummary, skipName, smokeLaunch, type Os, type SmokePath, type SmokeResult, type SmokeResultsFile } from "./smoke-log.ts";
import { qaModule } from "./qa.ts";
import { smokeModules } from "./smoke-rules.ts";
import type { Check } from "./smoke-checks.ts";

export { smokeModules };

/**
 * The native module smoke test's runner (SPEC.md, "Native modules (smoke test)"). The checks are in `smoke-checks.ts`, which only
 * the smoke app (`dev.alfayez.exposvelte.qa.smoke`) carries: the product and the QA app resolve it to a stub in Metro, and the lab that
 * runs this is off in the product (`nativeLabEnabled`) and refuses to in the QA app (`nativeSmokeEnabled`), so the checks are
 * never required there. The page lists the modules from `smokeModules`, which `qa/gates.json` pins and a test compares with the
 * checks.
 */
export type { Os };


const timeoutMs = 10_000;

function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A check that never settles (a native call that lost its promise) fails after `timeoutMs` instead of hanging the run. */
async function settled<T>(work: Promise<T> | T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`no answer after ${timeoutMs / 1000} s`)), timeoutMs);
	});
	try {
		return await Promise.race([Promise.resolve(work), limit]);
	} finally {
		clearTimeout(timer);
	}
}

const platform = (): Os => (Platform.OS === "ios" ? "ios" : "android");

async function runCheck(check: Check, os: Os): Promise<SmokeResult> {
	const started = Date.now();
	const result = (status: SmokeResult["status"], path: SmokePath, detail: string): SmokeResult => ({ module: check.module, status, path, ms: Date.now() - started, detail });
	if (check.only !== undefined && check.only !== os) return result("skip", "none", `${check.only === "android" ? "Android" : "iOS"} only: the library has no ${os === "ios" ? "iOS" : "Android"} code`);
	try {
		return result("ok", check.path, await settled(check.run(os)));
	} catch (error) {
		if (error instanceof Error && error.name === skipName) return result("skip", check.path, error.message);
		const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		return result("fail", check.path, detail);
	}
}

/** `Documents/smoke-results.json`: what an iPhone harness reads, since it cannot follow a log. The Android harness reads logcat and ignores it. */
async function saveResults(results: readonly SmokeResult[], os: Os): Promise<void> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
		const build = await qaModule?.buildIdentity().catch(() => null);
		const file: SmokeResultsFile = { token: smokeLaunch.token, finishedAt: new Date().toISOString(), os, build: build ?? null, results: [...results] };
		new File(Paths.document, "smoke-results.json").write(JSON.stringify(file));
	} catch (error) {
		console.error("[Svelte smoke] results file", error);
	}
}

/**
 * Runs every check in turn, logging one `[Svelte smoke]` line as each finishes and `[Svelte smoke] complete` at the end (what
 * `native-qa smoke` reads from logcat). `onResult` sees each result as it arrives; an aborted run stops between checks.
 */
export async function runSmoke(onResult?: (result: SmokeResult, all: readonly SmokeResult[]) => void, signal?: AbortSignal): Promise<SmokeResult[]> {
	const os = platform();
	const results: SmokeResult[] = [];
	// Required here, not at the top: only the smoke app has the checks.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { checks } = require("./smoke-checks.ts") as typeof import("./smoke-checks.ts");
	for (const check of checks) {
		if (signal?.aborted) break;
		const result = await runCheck(check, os);
		results.push(result);
		console.info(formatSmokeLine(result));
		onResult?.(result, results);
		await pause(0);
	}
	await saveResults(results, os);
	console.info(formatSmokeSummary(results, os));
	return results;
}
