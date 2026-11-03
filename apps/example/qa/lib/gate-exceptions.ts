import type { Gate, Role } from "./gates.ts";
import type { Metric } from "./types.ts";

/**
 * Who decided that a miss is accepted: `D1` (a platform floor: UIKit's bar re-layout, Reanimated's worklet runtime), `D9` (the
 * round-2 evidence of 3 Nov 2026: the Samsung's list mount, boot tail and first animation interval), `D11` (the Samsung's `churn-static`
 * and `list-300-raw`: repeated short late intervals on its 90 Hz display, capped) or `1 Nov first touch` (the first touch of a process
 * on the Samsung: RNGH's first worklet run and class initialisation). The decisions are in the run log's `GOAL.md`.
 */
export const decisions = ["D1", "D9", "D11", "1 Nov first touch"] as const;
export type Decision = (typeof decisions)[number];

/**
 * A documented exception: the gate `gate` may miss its bar on `device` (a key of `devices`: the phone, the iPhone or the lab) and, for
 * a gate with `*` in its metric, only for the scenarios in `scenarios` (the names the `*` stands for). A miss it covers is judged
 * `exception`, with the decision, and never `pass`; a gate that passes stays `pass`, and one that was not measured stays
 * `not measured`. Anything else the gate misses (another scenario, another device, another platform) is still a failure.
 * `reason` is one line, `evidence` points at the SPEC section or the run file that holds the measurements.
 *
 * An entry may be capped to what its decision observed: `maxLateIntervals` (for the gates that read `*.lateIntervals`) is the most late
 * intervals it covers, and `maxMs` the longest frame: on a gate that reads `*.maxMs` it caps that gate's value, on a gate that reads
 * `*.lateIntervals` it is a condition, the scenario's longest frame must be within it too (a cap under a gate's own bar would cover
 * nothing, so a frame cap belongs on the late-interval gates). Both are judged values (the worst of the runs D10 keeps), and a row above
 * a cap is not covered and fails. A floor (D1: UIKit's bar, Reanimated's runtime) carries none: it is the platform's, whatever the run
 * measured.
 */
export type GateException = {
	gate: string;
	device: string;
	scenarios?: string[];
	maxLateIntervals?: number;
	maxMs?: number;
	decision: Decision;
	reason: string;
	evidence: string;
};

/** The cap an entry puts on the metric of a row: its late intervals or its longest frame; undefined for no cap (or a metric no cap is for). */
export function capOf(entry: Pick<GateException, "maxLateIntervals" | "maxMs">, metric: string): number | undefined {
	if (metric.endsWith(".lateIntervals")) return entry.maxLateIntervals;
	if (metric.endsWith(".maxMs")) return entry.maxMs;
	return undefined;
}

/** What an entry's cap says, for the lists: `up to 2 late intervals`, `up to 4 late intervals and 20 ms`; empty for an uncapped entry. */
export function capText(entry: Pick<GateException, "maxLateIntervals" | "maxMs">): string {
	const parts = [entry.maxLateIntervals === undefined ? null : `${entry.maxLateIntervals} late intervals`, entry.maxMs === undefined ? null : `${entry.maxMs} ms`].filter(Boolean);
	return parts.length === 0 ? "" : `up to ${parts.join(" and ")}`;
}

/**
 * The exception that covers a gate's row for a device and, for a per-scenario gate, a scenario; undefined when none does. A capped entry
 * covers the row only while its measured value (`metric` is the row's key) is within the cap: a value above it, or none, is not covered.
 * On a gate that reads late intervals an entry's `maxMs` is a condition on `longestMs`, the scenario's longest frame, which must be known
 * and within it.
 */
export function matchException(
	exceptions: readonly GateException[] | undefined,
	where: { gate: string; device: string | null; scenario: string | null; metric?: string; measured?: Metric; longestMs?: Metric },
): GateException | undefined {
	if (where.device === null) return undefined;
	return exceptions?.find((entry) => {
		if (entry.gate !== where.gate || entry.device !== where.device) return false;
		if (entry.scenarios !== undefined && (where.scenario === null || !entry.scenarios.includes(where.scenario))) return false;
		const cap = where.metric === undefined ? undefined : capOf(entry, where.metric);
		if (cap !== undefined && !(typeof where.measured === "number" && where.measured <= cap)) return false;
		const late = where.metric?.endsWith(".lateIntervals") === true;
		return !(late && entry.maxMs !== undefined && !(typeof where.longestMs === "number" && where.longestMs <= entry.maxMs));
	});
}

type ExceptionTable = { devices: Record<string, { role: Role }>; gates: Gate[]; exceptions?: GateException[] };

/**
 * A malformed exception is an error, not a wider exemption: an unknown decision, a gate or device the file does not have, a device the
 * gate does not judge (an exception cannot turn the lab's informational row into anything), a per-scenario gate without its scenarios
 * (it would excuse every scenario) or a plain gate with them, an empty reason or evidence, a cap on a gate it does not fit
 * (`maxLateIntervals` is for a gate that reads `*.lateIntervals`, `maxMs` for one that reads `*.lateIntervals` or `*.maxMs`; a whole or
 * a positive number), and two entries that cover the same row.
 */
export function checkExceptions(file: ExceptionTable): void {
	const known = new Set<string>(decisions);
	const seen = new Map<string, string>();
	for (const entry of file.exceptions ?? []) {
		const label = `gates.json: exception ${entry.gate} on ${entry.device}`;
		if (!known.has(entry.decision)) throw new Error(`${label} has the unknown decision ${JSON.stringify(entry.decision)}`);
		const gate = file.gates.find((candidate) => candidate.id === entry.gate);
		if (!gate) throw new Error(`${label} names a gate gates.json does not have`);
		const device = file.devices[entry.device];
		if (!device) throw new Error(`${label} names a device gates.json does not list`);
		if (gate.roles !== undefined && !gate.roles.includes(device.role))
			throw new Error(`${label}: the gate does not judge a ${device.role} (its row is informational there), so there is nothing to except`);
		if (entry.reason.trim() === "") throw new Error(`${label} has no reason`);
		if (entry.evidence.trim() === "") throw new Error(`${label} has no evidence pointer`);
		const perScenario = gate.metric.includes("*");
		if (perScenario && (entry.scenarios === undefined || entry.scenarios.length === 0))
			throw new Error(`${label}: the gate has a row per scenario (${gate.metric}), so the exception must name its scenarios`);
		if (!perScenario && entry.scenarios !== undefined) throw new Error(`${label}: the gate has no scenarios (${gate.metric})`);
		if (entry.scenarios && new Set(entry.scenarios).size !== entry.scenarios.length) throw new Error(`${label} names a scenario twice`);
		if (entry.maxLateIntervals !== undefined) {
			if (!gate.metric.endsWith(".lateIntervals")) throw new Error(`${label}: maxLateIntervals caps a gate that reads *.lateIntervals, not ${gate.metric}`);
			if (!Number.isInteger(entry.maxLateIntervals) || entry.maxLateIntervals < 0) throw new Error(`${label}: maxLateIntervals must be a whole number of intervals, not ${entry.maxLateIntervals}`);
		}
		if (entry.maxMs !== undefined) {
			if (!gate.metric.endsWith(".maxMs") && !gate.metric.endsWith(".lateIntervals")) throw new Error(`${label}: maxMs caps a gate that reads *.maxMs or *.lateIntervals, not ${gate.metric}`);
			if (!(entry.maxMs > 0)) throw new Error(`${label}: maxMs must be positive, not ${entry.maxMs}`);
		}
		for (const scenario of entry.scenarios ?? [""]) {
			const key = `${entry.gate}\u0000${entry.device}\u0000${scenario}`;
			if (seen.has(key)) throw new Error(`${label}: ${scenario === "" ? "listed twice" : `scenario ${scenario} is covered twice`}`);
			seen.set(key, entry.decision);
		}
	}
}
