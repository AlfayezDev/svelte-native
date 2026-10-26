import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	evaluate,
	formatBar,
	groupRows,
	judge,
	renderTable,
	tally,
	type Gate,
	type GatesFile,
	type ReportDevice,
} from "../lib/gates.ts";

const gates: Gate[] = [
	{
		id: "boot.warm.p90",
		title: "Warm boot",
		unit: "ms",
		metric: "boot.warm.p90",
		bar: { android: { max: 350 }, ios: { max: 250 } },
	},
	{
		id: "frames.droppedPct",
		title: "Dropped",
		unit: "%",
		metric: "frames.*.droppedPct",
		bar: { android: { max: 0, round: 1 } },
	},
	{
		id: "checks.passed",
		title: "Checks",
		unit: "checks",
		metric: "lab.checks.passed",
		bar: { android: { min: 28 } },
	},
];

const android = (metrics: ReportDevice["metrics"]): Record<string, ReportDevice> => ({
	"localhost:5555": { platform: "android", metrics },
});

describe("judge", () => {
	test("max and min are inclusive", () => {
		expect(judge({ max: 350 }, 350)).toBe("pass");
		expect(judge({ max: 350 }, 350.1)).toBe("fail");
		expect(judge({ min: 28 }, 28)).toBe("pass");
		expect(judge({ min: 28 }, 27)).toBe("fail");
	});
	test("rounding to the displayed precision before comparing", () => {
		expect(judge({ max: 0, round: 1 }, 0.04)).toBe("pass");
		expect(judge({ max: 0, round: 1 }, 0.06)).toBe("fail");
		expect(judge({ max: 0 }, 0.04)).toBe("fail");
	});
	test("no value is not measured", () => {
		expect(judge({ max: 350 }, null)).toBe("not measured");
		expect(judge({ max: 350 }, Number.NaN)).toBe("not measured");
	});
});

describe("evaluate", () => {
	test("a platform with no device in the report is not measured", () => {
		const rows = evaluate(gates, android({ "boot.warm.p90": 300 }));
		const ios = rows.filter((row) => row.platform === "ios");
		expect(ios).toEqual([
			expect.objectContaining({
				id: "boot.warm.p90",
				device: null,
				measured: null,
				verdict: "not measured",
			}),
		]);
	});
	test("a metric the device never produced is not measured", () => {
		const rows = evaluate(gates, android({}));
		expect(rows.filter((row) => row.platform === "android").map((row) => row.verdict)).toEqual([
			"not measured",
			"not measured",
			"not measured",
		]);
	});
	test("a wildcard expands to one row per matching metric", () => {
		const rows = evaluate(
			gates,
			android({
				"frames.idle.droppedPct": 0,
				"frames.modal-8.droppedPct": 3.3,
				"frames.idle.maxMs": 19,
			}),
		);
		const frames = rows.filter((row) => row.id === "frames.droppedPct");
		expect(frames.map((row) => [row.metric, row.verdict])).toEqual([
			["frames.idle.droppedPct", "pass"],
			["frames.modal-8.droppedPct", "fail"],
		]);
	});
	test("a wildcard matching nothing is one not-measured row", () => {
		const rows = evaluate(gates, android({ "frames.idle.maxMs": 19 }));
		expect(rows.filter((row) => row.id === "frames.droppedPct")).toEqual([
			expect.objectContaining({ metric: "frames.*.droppedPct", verdict: "not measured" }),
		]);
	});
	test("a null metric (measured and absent from a run) is not measured", () => {
		const rows = evaluate(gates, android({ "frames.idle.droppedPct": null }));
		expect(rows.find((row) => row.id === "frames.droppedPct")?.verdict).toBe("not measured");
	});
	test("the platform filter keeps only that platform's rows", () => {
		expect(
			evaluate(gates, android({ "boot.warm.p90": 300 }), "android").every(
				(row) => row.platform === "android",
			),
		).toBe(true);
	});
	test("every device of a platform is judged", () => {
		const devices: Record<string, ReportDevice> = {
			a: { platform: "android", metrics: { "boot.warm.p90": 300 } },
			b: { platform: "android", metrics: { "boot.warm.p90": 400 } },
		};
		const rows = evaluate([gates[0] as Gate], devices, "android");
		expect(rows.map((row) => [row.device, row.verdict])).toEqual([
			["a", "pass"],
			["b", "fail"],
		]);
	});
});

describe("tally and rendering", () => {
	test("ok only when every row passes; not measured counts against it", () => {
		const rows = evaluate([gates[0] as Gate], android({ "boot.warm.p90": 300 }));
		expect(tally(rows)).toEqual({
			rows: { pass: 1, fail: 0, notMeasured: 1 },
			gates: { pass: 1, fail: 0, notMeasured: 1 },
			ok: false,
		});
		expect(tally(rows.filter((row) => row.platform === "android")).ok).toBe(true);
		expect(tally([]).ok).toBe(false);
	});
	test("a wildcard gate is one gate in the tally and many rows", () => {
		const rows = evaluate(
			gates,
			android({ "frames.a.droppedPct": 0, "frames.b.droppedPct": 2, "frames.c.droppedPct": 3 }),
			"android",
		).filter((row) => row.id === "frames.droppedPct");
		expect(tally(rows)).toEqual({
			rows: { pass: 1, fail: 2, notMeasured: 0 },
			gates: { pass: 0, fail: 1, notMeasured: 0 },
			ok: false,
		});
	});
	test("wildcard rows collapse to the worst value", () => {
		const rows = evaluate(
			gates,
			android({
				"frames.idle.droppedPct": 0,
				"frames.modal-8.droppedPct": 3.3,
				"frames.churn.droppedPct": 1.2,
			}),
			"android",
		);
		const group = groupRows(rows).find((entry) => entry.id === "frames.droppedPct");
		expect(group).toEqual(
			expect.objectContaining({
				measured: 3.3,
				worst: "modal-8",
				ok: 1,
				total: 3,
				verdict: "fail",
			}),
		);
	});
	test("lower-is-worse gates pick the minimum", () => {
		const rows = evaluate(
			[{ id: "x", title: "x", unit: "n", metric: "m.*.n", bar: { android: { min: 10 } } }],
			android({ "m.a.n": 12, "m.b.n": 4 }),
			"android",
		);
		expect(groupRows(rows)[0]?.measured).toBe(4);
	});
	test("table text", () => {
		const rows = evaluate(
			gates,
			android({ "boot.warm.p90": 612, "lab.checks.passed": 28 }),
			"android",
		);
		const table = renderTable(rows, false).split("\n");
		expect(table[0]).toMatch(/^gate\s+platform\s+device\s+bar\s+measured\s+verdict$/);
		expect(table[1]).toMatch(
			/^boot\.warm\.p90\s+android\s+localhost:5555\s+<= 350 ms\s+612\s+fail$/,
		);
		expect(table[3]).toMatch(
			/^checks\.passed\s+android\s+localhost:5555\s+>= 28 checks\s+28\s+pass$/,
		);
	});
	test("bar text", () => {
		expect(formatBar({ max: 1.5 }, "x period")).toBe("<= 1.5 x period");
	});
});

describe("gates.json", () => {
	const file = JSON.parse(
		readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8"),
	) as GatesFile;
	const bar = (id: string) => file.gates.find((gate) => gate.id === id)?.bar;
	test("ids are unique and every gate names a metric and a platform", () => {
		expect(new Set(file.gates.map((gate) => gate.id)).size).toBe(file.gates.length);
		for (const gate of file.gates) {
			expect(gate.metric.length > 0).toBe(true);
			expect(Object.keys(gate.bar).length > 0).toBe(true);
		}
	});
	test("holds the production bar of PLAN.md", () => {
		expect(bar("boot.warm.p90")).toEqual({ android: { max: 350 }, ios: { max: 250 } });
		expect(bar("boot.cold.p90")).toEqual({ android: { max: 350 }, ios: { max: 250 } });
		expect(bar("frames.droppedPct")).toEqual({
			android: { max: 0, round: 1 },
			ios: { max: 0, round: 1 },
		});
		expect(bar("frames.maxPeriodRatio")).toEqual({ android: { max: 1.5 }, ios: { max: 1.5 } });
		expect(bar("frames.maxMs")).toEqual({ android: { max: 33 }, ios: { max: 33 } });
		expect(bar("list.virtual300.mountMs")).toEqual({ android: { max: 10 }, ios: { max: 15 } });
		expect(bar("checks.passed")).toEqual({ android: { min: 28 }, ios: { min: 28 } });
		expect(bar("log.fatals")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
		expect(bar("log.engineWarnings")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
	});
	test("memory is gated, and with no measurement it fails as not measured", () => {
		const rows = evaluate(file.gates, android({}), "android").filter(
			(row) => row.id === "memory.heapGrowthPct",
		);
		expect(rows).toEqual([expect.objectContaining({ verdict: "not measured" })]);
	});
});
