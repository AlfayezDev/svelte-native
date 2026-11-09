import { foreignCheckOf, foreignSkipOf } from "../../parse/foreign.ts";
import type { ForeignCheck, ForeignSkip } from "../types.ts";
import type { IosLabResults } from "./lab-results.ts";

/**
 * What the foreign lab leaves for the iPhone's harness. The Android run reads one logcat line per check; an iPhone run has no log to follow (`devicectl` cannot), so the
 * lab (`foreign-libraries-lab.ts`) puts every check and every skip it recorded into the `detail` of its scenario's entry in `Documents/lab-results.json`, next to the
 * counts per library the entry always had. This reads them back into the records `foreign.ts` judges.
 */

export type IosForeignRecords = {
	checks: ForeignCheck[];
	skips: ForeignSkip[];
	/** Entries of the lists that are not a check or a skip: each fails the run (`foreign.unparsedLines`), the way an unreadable log line does on Android. */
	unparsed: string[];
	/** Whether the results hold the scenario's entry at all (a launch that died before it finished has none). */
	present: boolean;
};

export type ForeignScenario = "foreign-libraries" | "foreign-leftovers";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The checks and skips of a scenario of the foreign lab, from the results the app wrote. */
export function foreignRecords(results: Pick<IosLabResults, "stress"> | null, scenario: ForeignScenario): IosForeignRecords {
	const out: IosForeignRecords = { checks: [], skips: [], unparsed: [], present: false };
	const entry = results?.stress.find((item) => item.name === scenario);
	if (!entry) return out;
	out.present = true;
	if (!isRecord(entry.detail)) {
		out.unparsed.push(`${scenario}: the scenario's detail is not an object`);
		return out;
	}
	for (const [key, read] of [["checks", foreignCheckOf], ["skips", foreignSkipOf]] as const) {
		const list = entry.detail[key];
		// The leftovers scenario has no skips and records none: there an absent list is an empty one. In the libraries scenario both lists are always written.
		if (list === undefined && key === "skips" && scenario === "foreign-leftovers") continue;
		if (!Array.isArray(list)) {
			out.unparsed.push(`${scenario}: detail.${key} is not a list`);
			continue;
		}
		for (const item of list) {
			const value = read(item);
			if (!value) out.unparsed.push(`${scenario}: ${JSON.stringify(item).slice(0, 200)}`);
			else if (key === "checks") out.checks.push(value as ForeignCheck);
			else out.skips.push(value as ForeignSkip);
		}
	}
	return out;
}

/**
 * `Documents/foreign-progress.json`, which the lab rewrites after every place (`foreign-libraries-lab.ts`): what a launch that died in the middle had recorded. Null when the text is not
 * that file or belongs to another launch (its token is not [token]). The records are read the way the finished scenario's are.
 */
export function foreignProgress(text: string | null, token: string): (IosForeignRecords & { finished: string }) | null {
	if (text === null) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(value) || value.token !== token || typeof value.finished !== "string") return null;
	const parsed = foreignRecords({ stress: [{ name: "foreign-libraries", verdict: "info", summary: "", detail: { checks: value.checks, skips: value.skips } }] }, "foreign-libraries");
	return { ...parsed, finished: value.finished };
}
