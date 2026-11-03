import type { Gate, Role } from "./gates.ts";

/**
 * Who decided that a miss is accepted: `D1` (a platform floor: UIKit's bar re-layout, Reanimated's worklet runtime), `D9` (the
 * round-2 evidence of 3 Nov 2026: the Samsung's list mount, boot tail and first animation interval) or `1 Nov first touch` (the first
 * touch of a process on the Samsung: RNGH's first worklet run and class initialisation). The decisions are in the run log's `GOAL.md`.
 */
export const decisions = ["D1", "D9", "1 Nov first touch"] as const;
export type Decision = (typeof decisions)[number];

/**
 * A documented exception: the gate `gate` may miss its bar on `device` (a key of `devices`: the phone, the iPhone or the lab) and, for
 * a gate with `*` in its metric, only for the scenarios in `scenarios` (the names the `*` stands for). A miss it covers is judged
 * `exception`, with the decision, and never `pass`; a gate that passes stays `pass`, and one that was not measured stays
 * `not measured`. Anything else the gate misses (another scenario, another device, another platform) is still a failure.
 * `reason` is one line, `evidence` points at the SPEC section or the run file that holds the measurements.
 */
export type GateException = {
	gate: string;
	device: string;
	scenarios?: string[];
	decision: Decision;
	reason: string;
	evidence: string;
};

/** The exception that covers a gate's row for a device and, for a per-scenario gate, a scenario; undefined when none does. */
export function matchException(
	exceptions: readonly GateException[] | undefined,
	where: { gate: string; device: string | null; scenario: string | null },
): GateException | undefined {
	if (where.device === null) return undefined;
	return exceptions?.find(
		(entry) =>
			entry.gate === where.gate &&
			entry.device === where.device &&
			(entry.scenarios === undefined || (where.scenario !== null && entry.scenarios.includes(where.scenario))),
	);
}

type ExceptionTable = { devices: Record<string, { role: Role }>; gates: Gate[]; exceptions?: GateException[] };

/**
 * A malformed exception is an error, not a wider exemption: an unknown decision, a gate or device the file does not have, a device the
 * gate does not judge (an exception cannot turn the lab's informational row into anything), a per-scenario gate without its scenarios
 * (it would excuse every scenario) or a plain gate with them, an empty reason or evidence, and two entries that cover the same row.
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
		for (const scenario of entry.scenarios ?? [""]) {
			const key = `${entry.gate}\u0000${entry.device}\u0000${scenario}`;
			if (seen.has(key)) throw new Error(`${label}: ${scenario === "" ? "listed twice" : `scenario ${scenario} is covered twice`}`);
			seen.set(key, entry.decision);
		}
	}
}
