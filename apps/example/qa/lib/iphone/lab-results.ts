import { frameStats, type LabChecks, type Scenario } from "../../parse/logcat.ts";
import type { LabRun } from "../types.ts";

/**
 * What the lab writes to `Documents/lab-results.json` on iOS (`routes/__dev/+mobile.svelte`, `saveResults`): the functional checks
 * and, once the stress scenarios have run, one entry per scenario in the shape of the `[Svelte stress]` lines Android logs.
 */

export type IosLabResults = {
	phase: string;
	/** The `token` of the launch URL, echoed so a file can be told from an older run's. */
	token: string | null;
	finishedAt: string;
	platform: string;
	osVersion: string;
	appVersion: string | null;
	checks: { name: string; passed: boolean; detail: string }[];
	stress: { name: string; verdict: string; summary: string; frames?: unknown; detail?: unknown }[];
	stressDone: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIosLabResults(text: string): IosLabResults {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`lab-results.json is not JSON: ${text.slice(0, 160)}`);
	}
	if (!isRecord(value) || typeof value.phase !== "string" || !Array.isArray(value.checks) || !Array.isArray(value.stress))
		throw new Error(`lab-results.json has an unexpected shape: ${text.slice(0, 160)}`);
	return {
		phase: value.phase,
		token: typeof value.token === "string" ? value.token : null,
		finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : "",
		platform: typeof value.platform === "string" ? value.platform : "unknown",
		osVersion: typeof value.osVersion === "string" ? value.osVersion : "unknown",
		appVersion: typeof value.appVersion === "string" ? value.appVersion : null,
		checks: value.checks.filter(isRecord).map((entry) => ({
			name: String(entry.name),
			passed: entry.passed === true,
			detail: typeof entry.detail === "string" ? entry.detail : "",
		})),
		stress: value.stress.filter(isRecord).map((entry) => ({
			name: String(entry.name),
			verdict: String(entry.verdict),
			summary: typeof entry.summary === "string" ? entry.summary : "",
			frames: entry.frames,
			detail: entry.detail,
		})),
		stressDone: value.stressDone === true,
	};
}

/** The run is over when the lab says so: after the stress scenarios, or after the checks when only they were requested. */
export function labFinished(results: IosLabResults, stressRequested: boolean): boolean {
	return stressRequested ? results.stressDone : results.phase === "done";
}

export function labChecks(results: IosLabResults): LabChecks | null {
	if (results.checks.length === 0) return null;
	const failures = results.checks.filter((check) => !check.passed).map((check) => check.name);
	return {
		passed: results.checks.length - failures.length,
		failed: failures.length,
		total: results.checks.length,
		failures,
		finishedAt: results.finishedAt || null,
	};
}

export function labScenarios(results: IosLabResults): Scenario[] {
	return results.stress.map((entry) => {
		const frames = frameStats(entry.frames);
		return {
			name: entry.name,
			verdict: entry.verdict,
			summary: entry.summary,
			periodMs: frames?.periodMs ?? null,
			frames,
			detail: isRecord(entry.detail) ? entry.detail : null,
		};
	});
}

export type IosLabCapture = {
	results: IosLabResults | null;
	startedAt: Date;
	durationMs: number;
	/** The app was gone before the lab finished. */
	died: string | null;
	logFile: string;
};

/** One lab run from the file the app wrote. A run whose results never completed, or whose app died, is incomplete. */
export function labRunFromIos(capture: IosLabCapture, stressRequested: boolean): LabRun {
	const { results } = capture;
	const complete = results !== null && labFinished(results, stressRequested) && capture.died === null;
	const scenarios = results ? labScenarios(results) : [];
	return {
		startedAt: capture.startedAt.toISOString(),
		durationMs: capture.durationMs,
		complete,
		checks: results ? labChecks(results) : null,
		boot: null,
		scenarios,
		expectedScenarios: scenarios.filter((scenario) => scenario.verdict !== "info").map((scenario) => scenario.name),
		crashes: capture.died ? [capture.died] : [],
		jsErrors: [],
		engineWarnings: [],
		logFile: capture.logFile,
	};
}
