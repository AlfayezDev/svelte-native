import type { Metric, Metrics, Platform } from "./types.ts";

/** `max` and `min` bound a number (`round` decimals first); `equals` is for a measurement that is a text. */
export type Bar = { max?: number; min?: number; round?: number; equals?: string };
export type Gate = {
	id: string;
	title: string;
	unit: string;
	metric: string;
	bar: Partial<Record<Platform, Bar>>;
};
/** `scenarios` is the fixed list of scenarios a full `checks,quick` lab run produces, per platform: a run missing any is not that run. */
export type GatesFile = { version: 1; scenarios: Record<Platform, string[]>; gates: Gate[] };

export type Verdict = "pass" | "fail" | "not measured";

export type GateRow = {
	id: string;
	title: string;
	platform: Platform;
	device: string | null;
	metric: string;
	unit: string;
	bar: Bar;
	measured: Metric;
	verdict: Verdict;
};

export type ReportDevice = { platform: Platform; metrics: Metrics };

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
					metric: gate.metric,
					measured: null,
					verdict: "not measured",
				});
				continue;
			}
			for (const [serial, device] of platformDevices) {
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
						metric: gate.metric,
						measured: null,
						verdict: "not measured",
					});
					continue;
				}
				for (const key of keys) {
					const measured = device.metrics[key] ?? null;
					rows.push({
						...base,
						device: serial,
						metric: key,
						measured,
						verdict: judge(bar, measured),
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
		const verdict: Verdict = members.some((row) => row.verdict === "fail")
			? "fail"
			: members.some((row) => row.verdict === "not measured")
				? "not measured"
				: "pass";
		return {
			id: first.id,
			platform: first.platform,
			device: first.device,
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

export function renderTable(rows: GateRow[], all: boolean): string {
	const lines: string[][] = [["gate", "platform", "device", "bar", "measured", "verdict"]];
	if (all) {
		for (const row of rows)
			lines.push([
				row.metric,
				row.platform,
				row.device ?? "-",
				formatBar(row.bar, row.unit),
				formatValue(row.measured, row.bar),
				row.verdict,
			]);
	} else {
		for (const group of groupRows(rows)) {
			const measured =
				formatValue(group.measured, group.bar) + (group.worst ? ` (${group.worst})` : "");
			const verdict =
				group.total > 1 ? `${group.verdict} ${group.ok}/${group.total}` : group.verdict;
			lines.push([
				group.id,
				group.platform,
				group.device ?? "-",
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

export type Tally = { pass: number; fail: number; notMeasured: number };

function count(verdicts: Verdict[]): Tally {
	const of = (verdict: Verdict) => verdicts.filter((entry) => entry === verdict).length;
	return { pass: of("pass"), fail: of("fail"), notMeasured: of("not measured") };
}

/** Rows are the finest unit (one per scenario for a wildcard gate); gates are the lines the table prints. */
export function tally(rows: GateRow[]): { rows: Tally; gates: Tally; ok: boolean } {
	return {
		rows: count(rows.map((row) => row.verdict)),
		gates: count(groupRows(rows).map((group) => group.verdict)),
		ok: rows.length > 0 && rows.every((row) => row.verdict === "pass"),
	};
}
