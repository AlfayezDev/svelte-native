import { runKinds, type RunKind } from "./runs.ts";
import type { Metric, Metrics, Platform } from "./types.ts";

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
	/** The `gestures-*` scenarios a full `native-qa gestures` run contains, per platform; absent: every scenario the lab has. */
	gestures?: Partial<Record<Platform, string[]>>;
	/** The native-view libraries a full `native-qa foreign` run reports, per platform (`foreign.<library>.failedChecks` is gated for each). */
	foreign?: { libraries: Record<Platform, string[]> };
	/**
	 * The signed-in screens (the `app-*` cases of `lib/screens.ts`) a parity run must compare and an accessibility run must dump, in
	 * every variant, per platform: a pinned screen the run lacks is `parity.signedIn.missing` / `a11y.signedIn.missing`, so a case
	 * removed from the matrix is a failing gate, not a smaller matrix. A platform without a list has none (the iPhone's lab does not
	 * sign in yet).
	 */
	signedIn?: Partial<Record<Platform, string[]>>;
	gates: Gate[];
};

/** `informational`: the gate is not for the device's role, or is of a run kind the device does not provide. The value is shown; the row is neither a pass nor a failure nor a gap. */
export type Verdict = "pass" | "fail" | "not measured" | "informational";

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
 * list, `gates --smoke` the second. The smoke app is another app (`io.rasheed.svelteqa.smoke`), so its run neither adds to nor
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
	for (const [platform, ids] of Object.entries(file.signedIn ?? {}))
		if (new Set(ids).size !== ids.length) throw new Error(`gates.json: signedIn names a screen twice for ${platform}`);
	for (const gate of file.gates) {
		if (gate.roles === undefined) continue;
		if (gate.roles.length === 0) throw new Error(`gates.json: gate ${gate.id} has an empty roles list (omit it to judge every role)`);
		for (const role of gate.roles)
			if (!known.has(role)) throw new Error(`gates.json: gate ${gate.id} names the unknown role ${JSON.stringify(role)}`);
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

function matcher(pattern: string): RegExp {
	const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
	return new RegExp(`^${escaped.join("[^.]+")}$`);
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
 * `*` in a metric matches one name segment and expands to one row per matching metric.
 */
export function evaluate(
	gates: Gate[],
	devices: Record<string, ReportDevice>,
	only?: Platform,
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
					verdict: "not measured",
				});
				continue;
			}
			for (const [serial, device] of platformDevices) {
				const role = device.role ?? null;
				const applies = appliesTo(gate, role, device.runs);
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
					const measured = device.metrics[key] ?? null;
					rows.push({
						...base,
						device: serial,
						role,
						metric: key,
						measured,
						verdict: applies ? judge(bar, measured) : "informational",
					});
				}
			}
		}
	}
	return rows;
}

export type RowGroup = {
	id: string;
	platform: Platform;
	device: string | null;
	role: Role | null;
	bar: Bar;
	unit: string;
	measured: Metric;
	worst: string;
	ok: number;
	total: number;
	verdict: Verdict;
};

/** Collapses the rows a wildcard gate expands to into one line per gate, platform and device: the worst value. */
export function groupRows(rows: GateRow[]): RowGroup[] {
	const groups = new Map<string, GateRow[]>();
	for (const row of rows) {
		const key = `${row.id}\u0000${row.platform}\u0000${row.device}`;
		groups.set(key, [...(groups.get(key) ?? []), row]);
	}
	return [...groups.values()].map((members) => {
		const first = members[0] as GateRow;
		const lowerIsWorse = first.bar.min !== undefined && first.bar.max === undefined;
		const numeric = members.filter((row) => typeof row.measured === "number");
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
			: first;
		const verdict: Verdict = members.every((row) => row.verdict === "informational")
			? "informational"
			: members.some((row) => row.verdict === "fail")
				? "fail"
				: members.some((row) => row.verdict === "not measured")
					? "not measured"
					: "pass";
		return {
			id: first.id,
			platform: first.platform,
			device: first.device,
			role: first.role,
			bar: first.bar,
			unit: first.unit,
			measured: worstRow.measured,
			worst: members.length > 1 ? worstRow.metric.split(".").slice(1, -1).join(".") : "",
			ok: members.filter((row) => row.verdict === "pass").length,
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

export function renderTable(rows: GateRow[], all: boolean): string {
	const lines: string[][] = [["gate", "platform", "device", "bar", "measured", "verdict"]];
	if (all) {
		for (const row of rows)
			lines.push([
				row.metric,
				row.platform,
				deviceCell(row.device, row.role),
				formatBar(row.bar, row.unit),
				formatValue(row.measured, row.bar),
				row.verdict,
			]);
	} else {
		for (const group of groupRows(rows)) {
			const measured =
				formatValue(group.measured, group.bar) + (group.worst ? ` (${group.worst})` : "");
			const verdict =
				group.total > 1 && group.verdict !== "informational"
					? `${group.verdict} ${group.ok}/${group.total}`
					: group.verdict;
			lines.push([
				group.id,
				group.platform,
				deviceCell(group.device, group.role),
				formatBar(group.bar, group.unit),
				measured,
				verdict,
			]);
		}
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

const markdownEscape = (cell: string): string => cell.replaceAll("|", "\\|");

const verdictMark: Record<Verdict, string> = { pass: "pass", fail: "**FAIL**", "not measured": "**NOT MEASURED**", informational: "informational" };

/**
 * The gate table as GitHub Markdown, for a job summary: the headline counts, then the gates that failed or were not measured,
 * then the passing ones, then the informational ones folded away. `title` heads it.
 */
export function renderMarkdown(rows: GateRow[], title: string): string {
	const { gates, informational, ok } = tally(rows);
	const groups = groupRows(rows);
	const line = (group: RowGroup): string => {
		const measured = formatValue(group.measured, group.bar) + (group.worst ? ` (${group.worst})` : "");
		const verdict = group.total > 1 && group.verdict !== "informational" ? `${verdictMark[group.verdict]} ${group.ok}/${group.total}` : verdictMark[group.verdict];
		return `| ${[group.id, deviceCell(group.device, group.role), formatBar(group.bar, group.unit), measured, verdict].map(markdownEscape).join(" | ")} |`;
	};
	const table = (members: RowGroup[]): string[] => ["| gate | device | bar | measured | verdict |", "| --- | --- | --- | --- | --- |", ...members.map(line)];
	const bad = groups.filter((group) => group.verdict === "fail" || group.verdict === "not measured");
	const good = groups.filter((group) => group.verdict === "pass");
	const info = groups.filter((group) => group.verdict === "informational");
	const out = [`### ${title}`, "", `${ok ? "PASS" : "FAIL"}: ${gates.pass} gates pass, ${gates.fail} fail, ${gates.notMeasured} not measured${informational > 0 ? `, ${informational} informational (not counted)` : ""}`, ""];
	if (bad.length > 0) out.push(`**Failed or not measured (${bad.length})**`, "", ...table(bad), "");
	if (good.length > 0) out.push(`<details><summary>Passing (${good.length})</summary>`, "", ...table(good), "", "</details>", "");
	if (info.length > 0) out.push(`<details><summary>Informational (${info.length}): the gate is not for this device's role or run kind</summary>`, "", ...table(info), "", "</details>", "");
	return out.join("\n");
}

export type Tally = { pass: number; fail: number; notMeasured: number };

function count(verdicts: Verdict[]): Tally {
	const of = (verdict: Verdict) => verdicts.filter((entry) => entry === verdict).length;
	return { pass: of("pass"), fail: of("fail"), notMeasured: of("not measured") };
}

const counted = (verdicts: Verdict[]): Verdict[] => verdicts.filter((verdict) => verdict !== "informational");

/**
 * Rows are the finest unit (one per scenario for a wildcard gate); gates are the lines the table prints. Informational
 * rows are in neither tally (`informational` is how many gate lines were left out): they are not a pass, a failure or a gap.
 */
export function tally(rows: GateRow[]): { rows: Tally; gates: Tally; informational: number; ok: boolean } {
	const judged = rows.filter((row) => row.verdict !== "informational");
	const groups = groupRows(rows).map((group) => group.verdict);
	return {
		rows: count(counted(rows.map((row) => row.verdict))),
		gates: count(counted(groups)),
		informational: groups.length - counted(groups).length,
		ok: judged.length > 0 && judged.every((row) => row.verdict === "pass"),
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
