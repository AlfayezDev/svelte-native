import { checkCarried, type CarriedRuns } from "./carried.ts";
import { capText, checkExceptions, matchException, type GateException } from "./gate-exceptions.ts";
import { runKinds, type RunKind } from "./runs.ts";
import type { Metric, Metrics, Platform } from "./types.ts";

export { decisions, type Decision, type GateException } from "./gate-exceptions.ts";

/** `max` and `min` bound a number (`round` decimals first); `equals` is for a measurement that is a text. */
export type Bar = { max?: number; min?: number; round?: number; equals?: string };
/**
 * What a device is for. A `phone` is real hardware: its frame, boot and list timings are the production numbers. A `lab` is a
 * device that exists for the engine checks, crash volume, soak, parity pixels, accessibility, resilience and gesture counters (the OVH emulator
 * under software GL): its timings say nothing about production.
 */
export type Role = "phone" | "lab";
export const roles: readonly Role[] = ["phone", "lab"];

export type Gate = {
	id: string;
	title: string;
	unit: string;
	metric: string;
	bar: Partial<Record<Platform, Bar>>;
	/** The roles the gate judges; for a device of another role the row is `informational`. Absent: every role. */
	roles?: Role[];
	/**
	 * A second measurement shown beside the gate's own and never judged: the same `*` stands for the same scenario (`frames.*.lateIntervals`
	 * is judged and `frames.*.droppedPct` shown with it, in `unit`), so a row reads `3 late intervals, 3.7 %`.
	 */
	also?: { metric: string; unit: string };
	/**
	 * For a count of scenarios the lab itself marked `fail` (`lab.scenarios.failed`): the scenarios whose failure is a frame failure and whose
	 * frame misses, on the gates in `gates`, are all covered by documented exceptions on the device are not counted. `runs` is the metric (a
	 * JSON text, `labMetrics`) that lists, for each run, the scenarios that failed on frames and how many failed otherwise.
	 */
	excusing?: { runs: string; gates: string[] };
	/**
	 * D10, for the frame gates of a lab of repeated runs: a scenario passes when all but one of its runs meet the rule, so the one worst
	 * run is set aside and the gate is judged on the others, and the run is shown beside the value, never hidden. `runs` is the metric (a
	 * JSON text, `labMetrics`) with each run's `lateIntervals`, `maxMs`, `droppedPct` and `maxPeriodRatio`; `late` and `long` are the
	 * gates whose bars (`max`) say what a bad run is (more late intervals, a longer frame); `min` is how many runs earn the allowance:
	 * fewer, or a run without an exact record, and the worst run is judged.
	 */
	allowance?: { runs: string; min: number; late: string; long: string };
	/**
	 * Why the gate is informational on every device (a decision, in one line): its value is shown and nothing counts, whoever measured it.
	 */
	informational?: string;
};
/** `runs` are the run kinds the device is meant to provide: a gate of another kind is informational for it. */
export type DeviceRole = { role: Role; name: string; runs: RunKind[] };
/**
 * `scenarios` is the fixed list of scenarios a full `checks,quick` lab run produces, per platform: a run missing any is not that run.
 * `smoke.modules` is the fixed list of native modules the smoke test reports, per platform, and `smoke.skips` the ones that may skip.
 * `devices` maps a serial to its role and the run kinds it provides; a serial not listed has no role, provides every kind, and
 * every gate judges it.
 */
export type GatesFile = {
	version: 1;
	devices: Record<string, DeviceRole>;
	scenarios: Record<Platform, string[]>;
	/**
	 * `smoke.modules`: per platform, the native modules every smoke run must report (a pinned module no line reports is `smoke.missing`).
	 * `smoke.skips`: the ones that may `skip` there; any other skip is `smoke.unexpectedSkips`, and `smoke.ok` is gated at the rest.
	 */
	smoke: { modules: Record<Platform, string[]>; skips: Record<Platform, string[]> };
	/**
	 * The accepted misses (`GateException`): a gate that misses its bar on the device and scenario an entry names is judged `exception`,
	 * counted apart from passes and failures. Nothing else is excused, and an entry that excuses more than it names is an error.
	 */
	exceptions?: GateException[];
	/** Runs carried from an earlier build (D14, `CarriedRuns`): left out of the check that a device's runs measured one build, and listed with their build and reason. */
	carried?: CarriedRuns[];
	/** The `gestures-*` scenarios a full `native-qa gestures` run contains, per platform; absent: every scenario the lab has. */
	gestures?: Partial<Record<Platform, string[]>>;
	/**
	 * The native-view libraries a full `native-qa foreign` run reports, per platform (`foreign.<library>.failedChecks`, `.checks` and `.skipped` are gated for each, with a `bar` of that
	 * platform). `ios` says, for each library whose iPhone count of checks or skips is not Android's, why (`checkForeign`): the checks Android alone can make, the checks only iOS has,
	 * the ones that need a finger.
	 */
	foreign?: { libraries: Record<Platform, string[]>; ios?: Record<string, string> };
	gates: Gate[];
};

/**
 * `exception`: the gate missed its bar and a documented exception of `gates.json` covers that device and scenario; it is neither a
 * pass nor a failure and is counted apart. `informational`: the gate is not for the device's role, or is of a run kind the device
 * does not provide. The value is shown; the row is neither a pass nor a failure nor a gap.
 */
export type Verdict = "pass" | "exception" | "fail" | "not measured" | "informational";

export type GateRow = {
	id: string;
	title: string;
	platform: Platform;
	device: string | null;
	/** The device's role; null for a device with none (or no device). */
	role: Role | null;
	metric: string;
	unit: string;
	bar: Bar;
	measured: Metric;
	verdict: Verdict;
	/** What `*` stood for in the metric (the scenario); absent for a gate without one. */
	scenario?: string;
	/** The gate's `also` measurement for this row, absent when the gate has none or the device did not produce it. */
	also?: { value: number; unit: string };
	/** The exception that covers this row; present exactly when the verdict is `exception`. */
	exception?: GateException;
	/** D10: the run that was set aside (the value above is the rest's worst); its late intervals, its longest frame and its place among the runs, from 1. */
	worstRun?: { run: number; lateIntervals: number; maxMs: number };
};

export type ReportDevice = {
	platform: Platform;
	role?: Role | null;
	/** The run kinds the device provides; null or absent: every kind. */
	runs?: RunKind[] | null;
	metrics: Metrics;
};

/** The run kinds a gate's metric comes from, by its prefix; null for a metric that belongs to no kind (every kind). */
export function gateKinds(gate: Gate): RunKind[] | null {
	const prefix = gate.metric.split(".")[0] as string;
	switch (prefix) {
		case "lab":
		case "checks":
		case "frames":
		case "list":
			return ["lab"];
		case "boot":
			return ["boot"];
		case "log":
			return ["lab", "boot"];
		case "memory":
		case "soak":
			return ["soak"];
		case "crashes":
		case "parity":
		case "a11y":
		case "resilience":
		case "smoke":
		case "gestures":
		case "foreign":
		case "updates":
		case "product":
			return [prefix];
		default:
			return null;
	}
}

/**
 * The smoke gates (`smoke.*`) judge the smoke app's run and nothing else, and the QA gates leave them out: `gates` judges the first
 * list, `gates --smoke` the second. The smoke app is another app (`dev.alfayez.exposvelte.qa.smoke`), so its run neither adds to nor
 * fails the lane that measures the QA app: its gates, its run files (`gates.ts` command: only smoke run files can make the smoke
 * report stale) and its report warnings (`smokeWarnings`) are the smoke lane's, the QA runs' the other's.
 */
export function splitGates(gates: Gate[]): { standard: Gate[]; smoke: Gate[] } {
	const isSmoke = (gate: Gate) => gateKinds(gate)?.every((kind) => kind === "smoke") ?? false;
	return { standard: gates.filter((gate) => !isSmoke(gate)), smoke: gates.filter(isSmoke) };
}

/** A malformed table is an error, not a silent exemption: an unknown role in `roles` would make every device informational. */
export function checkGatesFile(file: GatesFile): void {
	const known = new Set<string>(roles);
	for (const [serial, entry] of Object.entries(file.devices))
		if (!known.has(entry.role)) throw new Error(`gates.json: device ${serial} has the unknown role ${JSON.stringify(entry.role)}`);
	const kinds = new Set<string>(runKinds);
	for (const [serial, entry] of Object.entries(file.devices)) {
		if (entry.runs.length === 0) throw new Error(`gates.json: device ${serial} has an empty runs list (every gate would be informational)`);
		for (const kind of entry.runs)
			if (!kinds.has(kind)) throw new Error(`gates.json: device ${serial} has the unknown run kind ${JSON.stringify(kind)}`);
	}
	for (const platform of ["android", "ios"] as const) {
		const modules = file.smoke?.modules?.[platform];
		if (!modules || modules.length === 0) throw new Error(`gates.json: smoke.modules pins no module for ${platform}`);
		if (new Set(modules).size !== modules.length) throw new Error(`gates.json: smoke.modules names a module twice for ${platform}`);
		const skips = file.smoke.skips?.[platform];
		if (!skips) throw new Error(`gates.json: smoke.skips lists no skips (an empty list is fine) for ${platform}`);
		const unknown = skips.filter((module) => !modules.includes(module));
		if (unknown.length > 0) throw new Error(`gates.json: smoke.skips names ${unknown.join(", ")}, which smoke.modules does not pin for ${platform}`);
	}
	for (const platform of ["android", "ios"] as const) {
		const libraries = file.foreign?.libraries[platform];
		if (file.foreign && (!libraries || libraries.length === 0)) throw new Error(`gates.json: foreign.libraries pins no library for ${platform}`);
		if (libraries && new Set(libraries).size !== libraries.length) throw new Error(`gates.json: foreign.libraries names a library twice for ${platform}`);
	}
	checkForeign(file);
	for (const gate of file.gates) {
		if (gate.informational !== undefined && gate.informational.trim() === "") throw new Error(`gates.json: gate ${gate.id} is informational without saying why`);
		if (gate.also && stars(gate.also.metric) !== stars(gate.metric))
			throw new Error(`gates.json: gate ${gate.id} shows ${gate.also.metric} beside ${gate.metric}, which must have as many \`*\` to take the scenario from`);
		if (gate.allowance) checkAllowance(file, gate, gate.allowance);
		for (const id of gate.excusing?.gates ?? [])
			if (!file.gates.some((candidate) => candidate.id === id)) throw new Error(`gates.json: gate ${gate.id} excuses by ${id}, which is not a gate`);
		if (gate.roles === undefined) continue;
		if (gate.roles.length === 0) throw new Error(`gates.json: gate ${gate.id} has an empty roles list (omit it to judge every role)`);
		for (const role of gate.roles)
			if (!known.has(role)) throw new Error(`gates.json: gate ${gate.id} names the unknown role ${JSON.stringify(role)}`);
	}
	checkExceptions(file);
	checkCarried(file);
}

/**
 * The foreign gates of each pinned library are judged on each platform that pins the library: a gate with no `bar` for a platform is never evaluated there (`evaluate` walks the bars),
 * so a missing one would read as a clean run. Where the iPhone's bar of `checks` or `skipped` is not Android's, `foreign.ios` says why, and a reason for a library whose counts are
 * Android's is stale.
 */
function checkForeign(file: GatesFile): void {
	if (!file.foreign) return;
	const gateOf = (library: string, field: string) => file.gates.find((gate) => gate.metric === `foreign.${library}.${field}`);
	for (const platform of ["android", "ios"] as const)
		for (const library of file.foreign.libraries[platform])
			for (const field of ["failedChecks", "checks", "skipped"])
				if (!gateOf(library, field)?.bar[platform]) throw new Error(`gates.json: foreign.${library}.${field} has no ${platform} bar, so a ${platform} run of ${library} would never be judged on it`);
	const reasons = file.foreign.ios ?? {};
	for (const [library, why] of Object.entries(reasons)) {
		if (!file.foreign.libraries.ios.includes(library)) throw new Error(`gates.json: foreign.ios explains ${library}, which foreign.libraries does not pin for ios`);
		if (why.trim() === "") throw new Error(`gates.json: foreign.ios says nothing for ${library}`);
	}
	for (const library of file.foreign.libraries.ios) {
		const differs = ["checks", "skipped"].some((field) => JSON.stringify(gateOf(library, field)?.bar.ios) !== JSON.stringify(gateOf(library, field)?.bar.android));
		if (differs && reasons[library] === undefined) throw new Error(`gates.json: the iPhone's counts of ${library} (checks or skipped) are not Android's and foreign.ios gives no reason`);
		if (!differs && reasons[library] !== undefined) throw new Error(`gates.json: foreign.ios gives a reason for ${library}, whose counts on the iPhone are Android's`);
	}
}

const stars = (metric: string): number => metric.split("*").length - 1;

/** The fields of a run record (`frames.<scenario>.runs`): a gate's metric and its `also` name one by their last segment. */
const judgedFields = ["lateIntervals", "maxMs"] as const;
const shownFields = ["droppedPct", "maxPeriodRatio"] as const;
const lastSegment = (metric: string): string => metric.slice(metric.lastIndexOf(".") + 1);

function checkAllowance(file: Pick<GatesFile, "gates">, gate: Gate, allowance: NonNullable<Gate["allowance"]>): void {
	const label = `gates.json: gate ${gate.id} has an allowance`;
	if (stars(allowance.runs) !== 1 || stars(gate.metric) !== 1) throw new Error(`${label} that needs one \`*\` in the run list (${allowance.runs}) and in its metric (${gate.metric})`);
	if (!(judgedFields as readonly string[]).includes(lastSegment(gate.metric))) throw new Error(`${label} on ${gate.metric}, which is not a late interval or longest-frame metric of a run`);
	if (gate.also && !(shownFields as readonly string[]).includes(lastSegment(gate.also.metric))) throw new Error(`${label} but shows ${gate.also.metric}, which a run record does not hold`);
	if (!Number.isInteger(allowance.min) || allowance.min < 2) throw new Error(`${label} that needs at least 2 runs, not ${allowance.min}`);
	for (const id of [allowance.late, allowance.long]) {
		const named = file.gates.find((candidate) => candidate.id === id);
		if (!named) throw new Error(`${label} that takes its bar from ${id}, which is not a gate`);
		if (Object.values(named.bar).some((bar) => bar.max === undefined)) throw new Error(`${label} that takes its bar from ${id}, which has no \`max\``);
	}
}

/** The role of each device a gates file names, for the devices of a report. */
export function deviceRoles(file: GatesFile, serials: string[]): Record<string, Role | null> {
	return Object.fromEntries(serials.map((serial) => [serial, file.devices[serial]?.role ?? null]));
}

/**
 * The run kinds a lane judges: the ones a device provides, limited to `only` (a lane that did not run the soak does not fail
 * the soak gates); with `only` and no list for the device, `only` itself. A gate of a kind outside the result is informational.
 */
export function restrictRuns(runs: RunKind[] | null, only?: readonly RunKind[]): RunKind[] | null {
	if (only === undefined) return runs;
	return runs === null ? [...only] : runs.filter((kind) => only.includes(kind));
}

/**
 * `--except lab.runs`: gates a lane does not judge because it ran them at a smaller sample than the bar's (a push lane's 3 lab
 * repeats against the production 10). Their rows stay in the table as `informational`. A gate id the file does not have is an
 * error, so a renamed gate cannot silently stop being judged.
 */
export function exceptGates(rows: GateRow[], ids: readonly string[], file: Pick<GatesFile, "gates">): GateRow[] {
	const known = new Set(file.gates.map((gate) => gate.id));
	const unknown = ids.filter((id) => !known.has(id));
	if (unknown.length > 0) throw new Error(`--except names no gate of gates.json: ${unknown.join(", ")}`);
	return rows.map((row) => (ids.includes(row.id) ? { ...row, verdict: "informational" as const } : row));
}

/** The run kinds each device of a gates file provides; null for a serial it does not list (every kind). */
export function deviceRuns(file: GatesFile, serials: string[]): Record<string, RunKind[] | null> {
	return Object.fromEntries(serials.map((serial) => [serial, file.devices[serial]?.runs ?? null]));
}

/**
 * A gate applies to a device with no role, and to one whose role the gate lists (no list: every role); and to a device
 * that provides a run kind the gate's metric comes from (`runs` null: every kind; a gate of no kind: always).
 */
export function appliesTo(gate: Gate, role: Role | null | undefined, runs?: RunKind[] | null): boolean {
	if (gate.roles !== undefined && role !== null && role !== undefined && !gate.roles.includes(role)) return false;
	const kinds = gateKinds(gate);
	return kinds === null || runs === null || runs === undefined || kinds.some((kind) => runs.includes(kind));
}

/** The pattern of a metric with `*`: each star is one name segment, captured, so a row knows which scenario it is. */
function matcher(pattern: string): RegExp {
	const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`^${escaped.join("([^.]+)")}$`);
}

/** `pattern` with its stars replaced, in order, by the names a row captured. */
function fill(pattern: string, names: readonly string[]): string {
	let index = 0;
	return pattern.replace(/\*/g, () => names[index++] ?? "*");
}

export function judge(bar: Bar, measured: Metric): Verdict {
	if (measured === null || (typeof measured === "number" && Number.isNaN(measured)))
		return "not measured";
	if (bar.equals !== undefined) return measured === bar.equals ? "pass" : "fail";
	if (typeof measured === "string") return "fail";
	const value = bar.round === undefined ? measured : Number(measured.toFixed(bar.round));
	if (bar.max !== undefined && value > bar.max) return "fail";
	if (bar.min !== undefined && value < bar.min) return "fail";
	return "pass";
}

/**
 * Every gate against every device of each platform it names. A platform with no device in the
 * report, or a metric the device never produced, is "not measured", which fails: nothing is skipped.
 * A gate whose `roles` leave out the role of a device is still evaluated for it, but its verdict is
 * "informational": the value is shown and nothing counts. A device with no role gets every gate.
 * `*` in a metric matches one name segment and expands to one row per matching metric. A row that misses its bar and is covered by
 * one of `exceptions` (its gate, its device, its scenario) is an `exception` and carries the entry; a pass stays a pass and a gap a gap.
 */
export function evaluate(
	gates: Gate[],
	devices: Record<string, ReportDevice>,
	only?: Platform,
	exceptions?: readonly GateException[],
): GateRow[] {
	const rows: GateRow[] = [];
	for (const gate of gates) {
		for (const [name, bar] of Object.entries(gate.bar) as [Platform, Bar][]) {
			if (only && name !== only) continue;
			const platformDevices = Object.entries(devices).filter(
				([, device]) => device.platform === name,
			);
			const base = { id: gate.id, title: gate.title, platform: name, unit: gate.unit, bar };
			if (platformDevices.length === 0) {
				rows.push({
					...base,
					device: null,
					role: null,
					metric: gate.metric,
					measured: null,
					verdict: gate.informational === undefined ? "not measured" : "informational",
				});
				continue;
			}
			for (const [serial, device] of platformDevices) {
				const role = device.role ?? null;
				const applies = gate.informational === undefined && appliesTo(gate, role, device.runs);
				const pattern = matcher(gate.metric);
				const keys = gate.metric.includes("*")
					? Object.keys(device.metrics)
							.filter((key) => pattern.test(key))
							.sort()
					: [gate.metric];
				if (keys.length === 0) {
					rows.push({
						...base,
						device: serial,
						role,
						metric: gate.metric,
						measured: null,
						verdict: applies ? "not measured" : "informational",
					});
					continue;
				}
				for (const key of keys) {
					const names = gate.metric.includes("*") ? (pattern.exec(key)?.slice(1) ?? []) : [];
					const scenario = names[0];
					const allowed = applies && gate.allowance ? allowWorstRun(gate, gate.allowance, gates, name, device.metrics, names, key) : null;
					const measured = allowed?.measured ?? device.metrics[key] ?? null;
					const verdict = applies ? judge(bar, measured) : "informational";
					// The longest frame of the scenario as the row is judged (the runs D10 keeps), for an exception that caps it beside the late intervals.
					const longestMs = key.endsWith(".maxMs") ? measured : (allowed?.longestMs ?? device.metrics[`${key.slice(0, key.lastIndexOf("."))}.maxMs`]);
					const exception = verdict === "fail" ? matchException(exceptions, { gate: gate.id, device: serial, scenario: scenario ?? null, metric: key, measured, longestMs }) : undefined;
					const alongside = allowed ? allowed.also : gate.also ? device.metrics[fill(gate.also.metric, names)] : undefined;
					rows.push({
						...base,
						device: serial,
						role,
						metric: key,
						measured,
						verdict: exception ? "exception" : verdict,
						...(scenario === undefined ? {} : { scenario }),
						...(gate.also && typeof alongside === "number" ? { also: { value: alongside, unit: gate.also.unit } } : {}),
						...(exception ? { exception } : {}),
						...(allowed ? { worstRun: allowed.worstRun } : {}),
					});
				}
			}
		}
	}
	return gates.reduce((all, gate) => (gate.excusing ? excuseCovered(all, gate, gate.excusing, devices) : all), rows);
}

type RunRecord = Record<(typeof judgedFields)[number] | (typeof shownFields)[number], number>;

/** The per-run records `labMetrics` writes for a scenario; null for a metric that is not a full list (a run without an exact count makes none of it usable). */
function parseRunRecords(value: Metric | undefined): RunRecord[] | null {
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return null;
		const fields = [...judgedFields, ...shownFields];
		const records = parsed.map((entry: unknown): RunRecord | null => {
			if (typeof entry !== "object" || entry === null) return null;
			const record = entry as Record<string, unknown>;
			return fields.every((field) => typeof record[field] === "number" && Number.isFinite(record[field])) ? (record as RunRecord) : null;
		});
		return records.every((record) => record !== null) ? (records as RunRecord[]) : null;
	} catch {
		return null;
	}
}

/**
 * D10 for one row of a frame gate: with at least `allowance.min` runs, every one with an exact record, the run that overshoots the rule
 * most (more late intervals than `late`'s bar allows, or a longer frame than `long`'s) is set aside and the row is judged on the
 * worst of the others, so a scenario passes when all but one of its runs meet the rule and a second bad run fails it. No bad run,
 * too few runs or an unreadable record: null, the worst run is judged. The value shown beside the judged one is the run that set aside.
 */
function allowWorstRun(
	gate: Gate,
	allowance: NonNullable<Gate["allowance"]>,
	gates: Gate[],
	platform: Platform,
	metrics: Metrics,
	names: readonly string[],
	key: string,
): { measured: number; longestMs: number; also: number | undefined; worstRun: NonNullable<GateRow["worstRun"]> } | null {
	const runs = parseRunRecords(metrics[fill(allowance.runs, names)]);
	if (runs === null || runs.length < allowance.min) return null;
	const limit = (id: string) => gates.find((candidate) => candidate.id === id)?.bar[platform]?.max;
	const [lateLimit, longLimit] = [limit(allowance.late), limit(allowance.long)];
	if (lateLimit === undefined || longLimit === undefined) return null;
	// How far a run is past the rule, in late intervals and in time over the bar together, so the run set aside is the one that missed most.
	const overshoot = (run: RunRecord) => Math.max(0, (run.lateIntervals - lateLimit) / Math.max(lateLimit, 1)) + Math.max(0, (run.maxMs - longLimit) / longLimit);
	let setAside = -1;
	runs.forEach((run, index) => {
		if (overshoot(run) > 0 && (setAside < 0 || overshoot(run) > overshoot(runs[setAside] as RunRecord))) setAside = index;
	});
	if (setAside < 0) return null;
	const field = lastSegment(key) as (typeof judgedFields)[number];
	const rest = runs.filter((_, index) => index !== setAside);
	const judged = rest.reduce((a, b) => (b[field] > a[field] ? b : a));
	const bad = runs[setAside] as RunRecord;
	return {
		measured: judged[field],
		longestMs: Math.max(...rest.map((run) => run.maxMs)),
		also: gate.also ? judged[lastSegment(gate.also.metric) as (typeof shownFields)[number]] : undefined,
		worstRun: { run: setAside + 1, lateIntervals: bad.lateIntervals, maxMs: bad.maxMs },
	};
}

type FailedRun = { frame: string[]; other: number };

/** The per-run list `labMetrics` writes (`[{"frame":["churn-animated"],"other":0}, ...]`); null for a metric that is not one. */
function parseFailedRuns(value: Metric | undefined): FailedRun[] | null {
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return null;
		const runs = parsed.map((entry: unknown): FailedRun | null => {
			if (typeof entry !== "object" || entry === null) return null;
			const { frame, other } = entry as { frame?: unknown; other?: unknown };
			return Array.isArray(frame) && frame.every((name) => typeof name === "string") && typeof other === "number" ? { frame: frame as string[], other } : null;
		});
		return runs.every((run) => run !== null) ? (runs as FailedRun[]) : null;
	} catch {
		return null;
	}
}

/**
 * The count of scenarios the lab marked `fail`, without the failures the frame gates do not hold against the scenario: a scenario
 * whose rows on the frame gates all pass or are exceptions is left out in the runs where the lab failed it when it has an exception
 * row (every failing run is covered) or when the run is the one D10 set aside (the only run that broke the rule). It counts the rest
 * as before: the worst run's failures that are not frame failures plus its frame failures that are not left out. A run list the
 * metric cannot give leaves the raw count, and the raw count shows beside the adjusted one when they differ.
 */
function excuseCovered(rows: GateRow[], gate: Gate, excusing: NonNullable<Gate["excusing"]>, devices: Record<string, ReportDevice>): GateRow[] {
	return rows.map((row) => {
		if (row.id !== gate.id || row.device === null || row.verdict === "informational" || typeof row.measured !== "number") return row;
		const runs = parseFailedRuns(devices[row.device]?.metrics[excusing.runs]);
		if (runs === null || runs.length === 0) return row;
		const own = rows.filter((candidate) => candidate.device === row.device && candidate.platform === row.platform && excusing.gates.includes(candidate.id));
		const heldAgainst = (name: string, run: number): boolean => {
			const scenario = own.filter((candidate) => candidate.scenario === name);
			const passes = scenario.length > 0 && scenario.every((candidate) => candidate.verdict === "pass" || candidate.verdict === "exception");
			const covered = scenario.some((candidate) => candidate.verdict === "exception");
			const setAside = scenario.some((candidate) => candidate.worstRun?.run === run);
			return !(passes && (covered || setAside));
		};
		const measured = Math.max(...runs.map((run, index) => run.other + run.frame.filter((name) => heldAgainst(name, index + 1)).length));
		if (measured === row.measured) return row;
		return { ...row, measured, verdict: judge(row.bar, measured), also: { value: row.measured, unit: "before exceptions and allowed runs" } };
	});
}

export type RowGroup = {
	id: string;
	platform: Platform;
	device: string | null;
	role: Role | null;
	bar: Bar;
	unit: string;
	measured: Metric;
	/** The gate's `also` figure of the worst row, in its unit (`3.7 %`); empty when the gate has none. */
	also: string;
	/** D10: the run set aside on the worst row, as `worst run: 20 late, 38 ms, run 2`; empty when none was. */
	worstRun: string;
	worst: string;
	ok: number;
	/** Rows covered by a documented exception. */
	excepted: number;
	/** The decisions that cover them (`D1`, `D9`), once each. */
	decisions: string[];
	total: number;
	verdict: Verdict;
};

/** A group's verdict: a failure beats a gap beats an exception beats a pass; nothing but informational rows is informational. */
function groupVerdict(members: GateRow[]): Verdict {
	const has = (verdict: Verdict) => members.some((row) => row.verdict === verdict);
	if (members.every((row) => row.verdict === "informational")) return "informational";
	if (has("fail")) return "fail";
	if (has("not measured")) return "not measured";
	return has("exception") ? "exception" : "pass";
}

const trimmed = (value: number): string => String(Number(value.toFixed(2)));

/** The run D10 set aside, never hidden: `worst run: 20 late, 38 ms, run 2`. */
function worstRunText(worst: NonNullable<GateRow["worstRun"]>): string {
	return `worst run: ${worst.lateIntervals} late, ${trimmed(worst.maxMs)} ms, run ${worst.run}`;
}

/** Collapses the rows a wildcard gate expands to into one line per gate, platform and device: the worst value of the rows that decide its verdict. */
export function groupRows(rows: GateRow[]): RowGroup[] {
	const groups = new Map<string, GateRow[]>();
	for (const row of rows) {
		const key = `${row.id}\u0000${row.platform}\u0000${row.device}`;
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	return [...groups.values()].map((members) => {
		const first = members[0] as GateRow;
		const lowerIsWorse = first.bar.min !== undefined && first.bar.max === undefined;
		const verdict = groupVerdict(members);
		// The value shown is the worst of the rows that make the verdict: a failing gate shows a failing row, not the larger value of an excused one.
		const deciding = verdict === "pass" || verdict === "informational" ? members : members.filter((row) => row.verdict === verdict);
		const numeric = deciding.filter((row) => typeof row.measured === "number");
		const worstRow = numeric.length
			? numeric.reduce((a, b) =>
					(
						lowerIsWorse
							? (b.measured as number) < (a.measured as number)
							: (b.measured as number) > (a.measured as number)
					)
						? b
						: a,
				)
			: (deciding[0] as GateRow);
		const excepted = members.filter((row) => row.verdict === "exception");
		return {
			id: first.id,
			platform: first.platform,
			device: first.device,
			role: first.role,
			bar: first.bar,
			unit: first.unit,
			measured: worstRow.measured,
			also: worstRow.also ? `${trimmed(worstRow.also.value)} ${worstRow.also.unit}` : "",
			worstRun: worstRow.worstRun ? worstRunText(worstRow.worstRun) : "",
			worst: members.length > 1 ? worstRow.metric.split(".").slice(1, -1).join(".") : "",
			ok: members.filter((row) => row.verdict === "pass").length,
			excepted: excepted.length,
			decisions: [...new Set(excepted.map((row) => (row.exception as GateException).decision))],
			total: members.length,
			verdict,
		};
	});
}

export function formatBar(bar: Bar, unit: string): string {
	const parts = [
		bar.max !== undefined ? `<= ${bar.max}` : null,
		bar.min !== undefined ? `>= ${bar.min}` : null,
		bar.equals !== undefined ? `== ${JSON.stringify(bar.equals)}` : null,
	].filter(Boolean);
	return `${parts.join(" and ")} ${unit}`.trim();
}

export function formatValue(value: Metric, bar: Bar): string {
	if (value === null) return "-";
	if (typeof value === "string") return JSON.stringify(value);
	const digits = bar.round ?? (Number.isInteger(value) ? 0 : 1);
	return value.toFixed(digits);
}

/** The serial, and the role of a device that has one: `localhost:5555 (lab)`. */
function deviceCell(device: string | null, role: Role | null): string {
	return device === null ? "-" : role === null ? device : `${device} (${role})`;
}

/** The value of a group as the table prints it: the number, the scenario it is the worst of, the gate's `also` figure. */
function measuredCell(group: RowGroup): string {
	return formatValue(group.measured, group.bar) + (group.worst ? ` (${group.worst})` : "") + (group.also ? `, ${group.also}` : "") + (group.worstRun ? `; ${group.worstRun}` : "");
}

/** The verdict of a group: the passes of a wildcard gate (`fail 3/17`), the decisions behind its exceptions (`exception (D1) 15/17`), the exceptions beside a failure (`fail 3/17 (+2 exception)`). */
function verdictCell(group: RowGroup, mark: (verdict: Verdict) => string): string {
	if (group.verdict === "informational") return mark(group.verdict);
	const decided = group.verdict === "exception" ? ` (${group.decisions.join(", ")})` : "";
	const passes = group.total > 1 ? ` ${group.ok}/${group.total}` : "";
	const beside = group.verdict !== "exception" && group.excepted > 0 ? ` (+${group.excepted} exception)` : "";
	return `${mark(group.verdict)}${decided}${passes}${beside}`;
}

export function renderTable(rows: GateRow[], all: boolean): string {
	const lines: string[][] = [["gate", "platform", "device", "bar", "measured", "verdict"]];
	if (all) {
		for (const row of rows)
			lines.push([
				// Two gates can read one metric (the late intervals feed the dropped-frame and the period gate), so a row that shows a second figure names its gate.
				row.also ? `${row.id} (${row.scenario ?? row.metric})` : row.metric,
				row.platform,
				deviceCell(row.device, row.role),
				formatBar(row.bar, row.unit),
				formatValue(row.measured, row.bar) + (row.also ? `, ${trimmed(row.also.value)} ${row.also.unit}` : "") + (row.worstRun ? `; ${worstRunText(row.worstRun)}` : ""),
				row.exception ? `exception (${row.exception.decision})` : row.verdict,
			]);
	} else {
		for (const group of groupRows(rows))
			lines.push([
				group.id,
				group.platform,
				deviceCell(group.device, group.role),
				formatBar(group.bar, group.unit),
				measuredCell(group),
				verdictCell(group, (verdict) => verdict),
			]);
	}
	const widths = (lines[0] as string[]).map((_, column) =>
		Math.max(...lines.map((line) => (line[column] as string).length)),
	);
	return lines
		.map((line) =>
			line
				.map((cell, column) => cell.padEnd(widths[column] as number))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

/** The decision of an exception with the cap it is limited to: `D9 (up to 2 late intervals)`. */
function decisionText(entry: GateException): string {
	const cap = capText(entry);
	return cap === "" ? entry.decision : `${entry.decision} (${cap})`;
}

/** What a row measured, for the exception lists: the value in the gate's unit, and the `also` figure. */
function measuredText(row: GateRow): string {
	return `${formatValue(row.measured, row.bar)} ${row.unit}`.trim() + (row.also ? `, ${trimmed(row.also.value)} ${row.also.unit}` : "") + (row.worstRun ? `; ${worstRunText(row.worstRun)}` : "");
}

/** The rows an exception covers, one line each for the console: the gate, where, the measured value against the bar, and the decision with its reason and evidence. */
export function renderExceptions(rows: GateRow[], devices: Record<string, string> = {}): string[] {
	return rows
		.filter((row): row is GateRow & { exception: GateException } => row.verdict === "exception" && row.exception !== undefined)
		.map((row) => {
			const where = `${row.device === null ? "-" : (devices[row.device] ?? row.device)}${row.scenario === undefined ? "" : `, ${row.scenario}`}`;
			return `  ${row.id} (${where}): ${measuredText(row)} against ${formatBar(row.bar, row.unit)}; ${decisionText(row.exception)}: ${row.exception.reason} [${row.exception.evidence}]`;
		});
}

type SetAside = { device: string; scenario: string; worst: NonNullable<GateRow["worstRun"]>; rows: GateRow[] };

/** The runs D10 set aside, once per device and scenario with the rows they were set aside for: the list that keeps a spared run in view whichever row the grouped table prints. */
export function setAsideRuns(rows: GateRow[]): SetAside[] {
	const found = new Map<string, SetAside>();
	for (const row of rows) {
		if (!row.worstRun || row.device === null || row.scenario === undefined || row.verdict === "informational") continue;
		const key = `${row.device}\u0000${row.scenario}\u0000${row.worstRun.run}`;
		const entry = found.get(key) ?? { device: row.device, scenario: row.scenario, worst: row.worstRun, rows: [] };
		entry.rows.push(row);
		found.set(key, entry);
	}
	return [...found.values()];
}

/** What the other runs of a set-aside scenario read: `frames.droppedPct 1 pass, frames.maxMs 20 pass`. */
function judgedOn(entry: SetAside): string {
	return entry.rows.map((row) => `${row.id} ${formatValue(row.measured, row.bar)} ${row.verdict === "exception" ? `exception (${row.exception?.decision})` : row.verdict}`).join(", ");
}

/** One console line per run D10 set aside: where, which run and what it measured, and what the other runs gave. */
export function renderSetAside(rows: GateRow[], names: Record<string, string> = {}): string[] {
	return setAsideRuns(rows).map((entry) => `  ${entry.scenario} (${names[entry.device] ?? entry.device}): run ${entry.worst.run} set aside, ${entry.worst.lateIntervals} late intervals and ${trimmed(entry.worst.maxMs)} ms; the other runs: ${judgedOn(entry)}`);
}

const markdownEscape = (cell: string): string => cell.replaceAll("|", "\\|");

const verdictMark: Record<Verdict, string> = { pass: "pass", exception: "exception", fail: "**FAIL**", "not measured": "**NOT MEASURED**", informational: "informational" };

/**
 * The gate table as GitHub Markdown, for a job summary: the headline counts, then the gates that failed or were not measured, then
 * the documented exceptions with the measured value and the decision, then the passing ones, then the informational ones folded away.
 * `title` heads it; `names` maps a serial to the device's name for the exception list.
 */
export function renderMarkdown(rows: GateRow[], title: string, names: Record<string, string> = {}): string {
	const { gates, informational, ok } = tally(rows);
	const groups = groupRows(rows);
	const line = (group: RowGroup): string =>
		`| ${[group.id, deviceCell(group.device, group.role), formatBar(group.bar, group.unit), measuredCell(group), verdictCell(group, (verdict) => verdictMark[verdict])].map(markdownEscape).join(" | ")} |`;
	const table = (members: RowGroup[]): string[] => ["| gate | device | bar | measured | verdict |", "| --- | --- | --- | --- | --- |", ...members.map(line)];
	const bad = groups.filter((group) => group.verdict === "fail" || group.verdict === "not measured");
	const excepted = rows.filter((row): row is GateRow & { exception: GateException } => row.verdict === "exception" && row.exception !== undefined);
	const good = groups.filter((group) => group.verdict === "pass");
	const info = groups.filter((group) => group.verdict === "informational");
	const out = [
		`### ${title}`,
		"",
		`${ok ? "PASS" : "FAIL"}: ${gates.pass} gates pass, ${gates.exception} exception, ${gates.fail} fail, ${gates.notMeasured} not measured${informational > 0 ? `, ${informational} informational (not counted)` : ""}`,
		"",
	];
	if (bad.length > 0) out.push(`**Failed or not measured (${bad.length})**`, "", ...table(bad), "");
	if (excepted.length > 0) {
		const gateCount = new Set(excepted.map((row) => `${row.id}\u0000${row.device}`)).size;
		out.push(
			`**Documented exceptions (${excepted.length} ${excepted.length === 1 ? "row" : "rows"} in ${gateCount} ${gateCount === 1 ? "gate" : "gates"}): the bar was missed and a decision accepts it; not a pass**`,
			"",
			"| gate | device | scenario | bar | measured | decision | reason | evidence |",
			"| --- | --- | --- | --- | --- | --- | --- | --- |",
			...excepted.map(
				(row) =>
					`| ${[row.id, row.device === null ? "-" : (names[row.device] ?? row.device), row.scenario ?? "-", formatBar(row.bar, row.unit), measuredText(row), decisionText(row.exception), row.exception.reason, row.exception.evidence].map(markdownEscape).join(" | ")} |`,
			),
			"",
		);
	}
	const spared = setAsideRuns(rows);
	if (spared.length > 0)
		out.push(
			`**Worst runs set aside (D10, ${spared.length}): the scenario is judged on its other runs, the run is shown here and counted nowhere else**`,
			"",
			"| scenario | device | run | late intervals | longest frame | the other runs |",
			"| --- | --- | --- | --- | --- | --- |",
			...spared.map((entry) => `| ${[entry.scenario, names[entry.device] ?? entry.device, String(entry.worst.run), String(entry.worst.lateIntervals), `${trimmed(entry.worst.maxMs)} ms`, judgedOn(entry)].map(markdownEscape).join(" | ")} |`),
			"",
		);
	if (good.length > 0) out.push(`<details><summary>Passing (${good.length})</summary>`, "", ...table(good), "", "</details>", "");
	if (info.length > 0) out.push(`<details><summary>Informational (${info.length}): the gate is not for this device's role or run kind</summary>`, "", ...table(info), "", "</details>", "");
	return out.join("\n");
}

export type Tally = { pass: number; exception: number; fail: number; notMeasured: number };

function count(verdicts: Verdict[]): Tally {
	const of = (verdict: Verdict) => verdicts.filter((entry) => entry === verdict).length;
	return { pass: of("pass"), exception: of("exception"), fail: of("fail"), notMeasured: of("not measured") };
}

const counted = (verdicts: Verdict[]): Verdict[] => verdicts.filter((verdict) => verdict !== "informational");

/**
 * Rows are the finest unit (one per scenario for a wildcard gate); gates are the lines the table prints. Informational
 * rows are in neither tally (`informational` is how many gate lines were left out): they are not a pass, a failure or a gap.
 * `ok` (the exit status) holds when every judged row passed or is a documented exception: only a failure or a gap makes it false.
 */
export function tally(rows: GateRow[]): { rows: Tally; gates: Tally; informational: number; ok: boolean } {
	const judged = rows.filter((row) => row.verdict !== "informational");
	const groups = groupRows(rows).map((group) => group.verdict);
	return {
		rows: count(counted(rows.map((row) => row.verdict))),
		gates: count(counted(groups)),
		informational: groups.length - counted(groups).length,
		ok: judged.length > 0 && judged.every((row) => row.verdict === "pass" || row.verdict === "exception"),
	};
}

export type DeviceTally = { device: string; role: Role | null; gates: Tally; informational: number };

/** The gate counts of each device, in the order the devices first appear in the rows. A row with no device is left out. */
export function tallyByDevice(rows: GateRow[]): DeviceTally[] {
	const devices = new Map<string, GateRow[]>();
	for (const row of rows)
		if (row.device !== null) devices.set(row.device, [...(devices.get(row.device) ?? []), row]);
	return [...devices].map(([device, own]) => {
		const { gates, informational } = tally(own);
		return { device, role: (own[0] as GateRow).role, gates, informational };
	});
}
