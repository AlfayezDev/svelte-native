import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runsFlag } from "../commands/gates.ts";
import { join } from "node:path";
import {
	checkGatesFile,
	deviceRoles,
	deviceRuns,
	evaluate,
	formatBar,
	gateKinds,
	groupRows,
	judge,
	exceptGates,
	renderMarkdown,
	renderTable,
	restrictRuns,
	tally,
	tallyByDevice,
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
	test("an equality bar passes only the text it names; anything else, a number included, fails", () => {
		expect(judge({ equals: "checks,quick" }, "checks,quick")).toBe("pass");
		expect(judge({ equals: "checks,quick" }, "checks,list-300-virtual")).toBe("fail");
		expect(judge({ equals: "checks,quick" }, 3)).toBe("fail");
		expect(judge({ equals: "checks,quick" }, null)).toBe("not measured");
		expect(judge({ max: 5 }, "checks,quick")).toBe("fail");
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
			informational: 0,
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
			informational: 0,
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
		expect(formatBar({ equals: "checks,quick" }, "")).toBe('== "checks,quick"');
	});
	test("a text measurement shows in the table and fails an equality gate", () => {
		const equality: Gate[] = [{ id: "crashes.run", title: "Run", unit: "", metric: "crashes.run", bar: { android: { equals: "checks,quick" } } }];
		const rows = evaluate(equality, android({ "crashes.run": "checks,list-300-virtual" }), "android");
		expect(rows[0]?.verdict).toBe("fail");
		expect(renderTable(rows, false).split("\n")[1]).toMatch(/^crashes\.run\s+android\s+localhost:5555\s+== "checks,quick"\s+"checks,list-300-virtual"\s+fail$/);
		expect(tally(rows).ok).toBe(false);
		expect(tally(evaluate(equality, android({ "crashes.run": "checks,quick" }), "android")).ok).toBe(true);
	});
});

describe("device roles", () => {
	const frames: Gate = {
		id: "frames.droppedPct",
		title: "Dropped",
		unit: "%",
		metric: "frames.*.droppedPct",
		bar: { android: { max: 0, round: 1 } },
		roles: ["phone"],
	};
	const memory: Gate = {
		id: "memory.leakedViews",
		title: "Leaked",
		unit: "views",
		metric: "memory.leakedViews",
		bar: { android: { max: 0 } },
	};
	const metrics = { "frames.animation-48.droppedPct": 48.3, "frames.idle.droppedPct": 0, "memory.leakedViews": 2 };
	const device = (role: ReportDevice["role"]): Record<string, ReportDevice> => ({
		x: { platform: "android", role, metrics },
	});

	test("a gate not for the device's role is informational: the value shows, nothing fails", () => {
		const rows = evaluate([frames], device("lab"));
		expect(rows.map((row) => [row.metric, row.measured, row.verdict, row.role])).toEqual([
			["frames.animation-48.droppedPct", 48.3, "informational", "lab"],
			["frames.idle.droppedPct", 0, "informational", "lab"],
		]);
		const table = renderTable(rows, false).split("\n");
		expect(table[1]).toMatch(/^frames\.droppedPct\s+android\s+x \(lab\)\s+<= 0 %\s+48\.3 \(animation-48\)\s+informational$/);
		expect(tally(rows)).toEqual({
			rows: { pass: 0, fail: 0, notMeasured: 0 },
			gates: { pass: 0, fail: 0, notMeasured: 0 },
			informational: 1,
			ok: false,
		});
	});
	test("a phone is judged by the same gate", () => {
		const rows = evaluate([frames], device("phone"));
		expect(rows.map((row) => row.verdict)).toEqual(["fail", "pass"]);
		expect(tally(rows).gates).toEqual({ pass: 0, fail: 1, notMeasured: 0 });
	});
	test("a metric the lab never produced is informational too, never not measured", () => {
		const rows = evaluate([frames], { x: { platform: "android", role: "lab", metrics: {} } });
		expect(rows).toEqual([expect.objectContaining({ metric: "frames.*.droppedPct", measured: null, verdict: "informational" })]);
		expect(tally(rows).gates).toEqual({ pass: 0, fail: 0, notMeasured: 0 });
	});
	test("a device with no role, or one the table does not list, gets every gate", () => {
		for (const role of [null, undefined]) {
			const rows = evaluate([frames], device(role));
			expect(rows.map((row) => row.verdict)).toEqual(["fail", "pass"]);
		}
		const file = { devices: { a: { role: "lab", name: "A" } } } as unknown as GatesFile;
		expect(deviceRoles(file, ["a", "unknown"])).toEqual({ a: "lab", unknown: null });
	});
	test("a gate without roles is judged for every role", () => {
		for (const role of ["phone", "lab"] as const)
			expect(evaluate([memory], device(role)).map((row) => row.verdict)).toEqual(["fail"]);
	});
	test("a lab device's timing gates leave the summary; the others still count", () => {
		const rows = evaluate([frames, memory], device("lab"));
		expect(tally(rows)).toEqual({
			rows: { pass: 0, fail: 1, notMeasured: 0 },
			gates: { pass: 0, fail: 1, notMeasured: 0 },
			informational: 1,
			ok: false,
		});
		expect(tallyByDevice(rows)).toEqual([
			{ device: "x", role: "lab", gates: { pass: 0, fail: 1, notMeasured: 0 }, informational: 1 },
		]);
		const clean = evaluate([frames, memory], { x: { platform: "android", role: "lab", metrics: { ...metrics, "memory.leakedViews": 0 } } });
		expect(tally(clean).ok).toBe(true);
	});
	test("the same gate is informational on one device and a failure on another", () => {
		const rows = evaluate([frames], {
			"localhost:5555": { platform: "android", role: "lab", metrics },
			R58Y90KNGRP: { platform: "android", role: "phone", metrics },
		});
		expect(tallyByDevice(rows)).toEqual([
			{ device: "localhost:5555", role: "lab", gates: { pass: 0, fail: 0, notMeasured: 0 }, informational: 1 },
			{ device: "R58Y90KNGRP", role: "phone", gates: { pass: 0, fail: 1, notMeasured: 0 }, informational: 0 },
		]);
		expect(tally(rows).ok).toBe(false);
	});
	test("checkGatesFile refuses a role that would silently exempt a device", () => {
		const file = (patch: Partial<GatesFile> & { gates?: Gate[] }): GatesFile => ({ version: 1, devices: {}, scenarios: { android: [], ios: [] }, smoke: { modules: { android: ["a"], ios: ["a"] }, skips: { android: [], ios: [] } }, gates: [], ...patch });
		expect(() => checkGatesFile(file({ gates: [{ ...frames, roles: ["phones" as "phone"] }] }))).toThrow(/unknown role "phones"/);
		expect(() => checkGatesFile(file({ gates: [{ ...frames, roles: [] }] }))).toThrow(/empty roles list/);
		expect(() => checkGatesFile(file({ devices: { x: { role: "emulator" as "lab", name: "x", runs: ["lab"] } } }))).toThrow(/unknown role "emulator"/);
		expect(() => checkGatesFile(file({ devices: { x: { role: "lab", name: "x", runs: ["lab", "perf" as "lab"] } } }))).toThrow(/unknown run kind "perf"/);
		expect(() => checkGatesFile(file({ devices: { x: { role: "lab", name: "x", runs: [] } } }))).toThrow(/empty runs list/);
		expect(() => checkGatesFile(file({ devices: { x: { role: "lab", name: "x", runs: ["lab"] } }, gates: [frames, memory] }))).not.toThrow();
	});
});

describe("run kinds", () => {
	const gate = (metric: string): Gate => ({ id: metric, title: metric, unit: "", metric, bar: { android: { max: 0 } } });
	const device = (runs: ReportDevice["runs"], metrics: ReportDevice["metrics"] = {}): Record<string, ReportDevice> => ({
		x: { platform: "android", role: null, runs, metrics },
	});
	test("a gate maps to a run kind by its metric prefix", () => {
		const kinds = (metric: string) => gateKinds(gate(metric));
		expect(kinds("lab.runs")).toEqual(["lab"]);
		expect(kinds("lab.checks.passed")).toEqual(["lab"]);
		expect(kinds("frames.*.maxMs")).toEqual(["lab"]);
		expect(kinds("list.virtual300.mountMs")).toEqual(["lab"]);
		expect(kinds("boot.warm.p90")).toEqual(["boot"]);
		expect(kinds("log.fatals")).toEqual(["lab", "boot"]);
		expect(kinds("memory.leakedViews")).toEqual(["soak"]);
		expect(kinds("soak.minutes")).toEqual(["soak"]);
		for (const kind of ["crashes", "parity", "a11y", "resilience", "gestures", "foreign"]) expect(kinds(`${kind}.x`)).toEqual([kind]);
		expect(kinds("foreign.image.failedChecks")).toEqual(["foreign"]);
		expect(kinds("something.else")).toBeNull();
	});
	test("a kind the device does not provide is informational, with its value or a dash; one it provides but never measured is not measured", () => {
		const rows = evaluate([gate("crashes.coldStarts"), gate("parity.diffPixelsOutsideMasks")], device(["lab"], { "crashes.coldStarts": 15 }));
		expect(rows.map((row) => [row.metric, row.measured, row.verdict])).toEqual([
			["crashes.coldStarts", 15, "informational"],
			["parity.diffPixelsOutsideMasks", null, "informational"],
		]);
		expect(renderTable(rows, false).split("\n")[2]).toMatch(/\s-\s+informational$/);
		expect(evaluate([gate("parity.diffPixelsOutsideMasks")], device(["lab", "parity"])).map((row) => row.verdict)).toEqual(["not measured"]);
	});
	test("log gates count when either of lab and boot is provided", () => {
		for (const runs of [["lab"], ["boot"], ["lab", "boot"]] as const)
			expect(evaluate([gate("log.fatals")], device([...runs], { "log.fatals": 1 })).map((row) => row.verdict)).toEqual(["fail"]);
		expect(evaluate([gate("log.fatals")], device(["soak"], { "log.fatals": 1 })).map((row) => row.verdict)).toEqual(["informational"]);
	});
	test("a gate of no kind, and a device with no runs list, are always judged", () => {
		expect(evaluate([gate("something.else")], device(["lab"], { "something.else": 1 })).map((row) => row.verdict)).toEqual(["fail"]);
		for (const runs of [null, undefined])
			expect(evaluate([gate("crashes.coldStarts")], device(runs, { "crashes.coldStarts": 1 })).map((row) => row.verdict)).toEqual(["fail"]);
	});
	test("a role mismatch and a run-kind mismatch are both informational", () => {
		const frames: Gate = { ...gate("frames.*.maxMs"), roles: ["phone"] };
		const rows = evaluate([frames], { x: { platform: "android", role: "lab", runs: ["lab"], metrics: { "frames.idle.maxMs": 90 } } });
		expect(rows.map((row) => row.verdict)).toEqual(["informational"]);
	});
});

describe("a lane that ran some run kinds", () => {
	const gate = (metric: string): Gate => ({ id: metric, title: metric, unit: "", metric, bar: { android: { min: 1 } } });
	const lab = { role: "lab", platform: "android" } as const;
	test("--runs limits the kinds a device provides, so the others are informational and not 'not measured'", () => {
		expect(restrictRuns(["lab", "soak", "crashes", "parity"], ["lab", "parity"])).toEqual(["lab", "parity"]);
		expect(restrictRuns(null, ["lab"])).toEqual(["lab"]);
		expect(restrictRuns(["lab"], undefined)).toEqual(["lab"]);
		const gates = [gate("lab.checks.passed"), gate("crashes.coldStarts"), gate("soak.minutes")];
		const device = (runs: ReportDevice["runs"]): Record<string, ReportDevice> => ({ "localhost:5555": { ...lab, runs, metrics: { "lab.checks.passed": 28 } } });
		const everything = evaluate(gates, device(["lab", "soak", "crashes"]));
		expect(everything.map((row) => row.verdict)).toEqual(["pass", "not measured", "not measured"]);
		expect(tally(everything).ok).toBe(false);
		const lane = evaluate(gates, device(restrictRuns(["lab", "soak", "crashes"], ["lab"])));
		expect(lane.map((row) => row.verdict)).toEqual(["pass", "informational", "informational"]);
		expect(tally(lane).ok).toBe(true);
	});
	test("a gate of a kind the lane did run still fails when it was not measured", () => {
		const rows = evaluate([gate("lab.checks.passed")], { x: { ...lab, runs: restrictRuns(["lab", "soak"], ["lab"]), metrics: {} } });
		expect(rows.map((row) => row.verdict)).toEqual(["not measured"]);
	});
	test("--except turns the gate of a smaller sample into an informational row, and refuses a gate that does not exist", () => {
		const file = { gates: [gate("lab.runs"), gate("lab.checks.passed")] };
		const rows = evaluate(file.gates, { x: { ...lab, runs: ["lab"], metrics: { "lab.runs": 0, "lab.checks.passed": 28 } } });
		expect(rows.map((row) => row.verdict)).toEqual(["fail", "pass"]);
		const lane = exceptGates(rows, ["lab.runs"], file);
		expect(lane.map((row) => row.verdict)).toEqual(["informational", "pass"]);
		expect(tally(lane).ok).toBe(true);
		expect(() => exceptGates(rows, ["lab.run"], file)).toThrow("lab.run");
	});
	test("the flag names run kinds and nothing else", () => {
		expect(runsFlag(undefined)).toBeUndefined();
		expect(runsFlag("lab, parity,a11y")).toEqual(["lab", "parity", "a11y"]);
		expect(() => runsFlag("lab,pairty")).toThrow("pairty");
		expect(() => runsFlag(",")).toThrow("--runs");
	});
});

describe("the Markdown table of a job summary", () => {
	const gate = (id: string, metric: string, bar: { max?: number; min?: number }): Gate => ({ id, title: id, unit: "x", metric, bar: { android: bar } });
	const rows = evaluate(
		[gate("checks.passed", "lab.checks.passed", { min: 28 }), gate("lab.runs", "lab.runs", { min: 3 }), gate("crashes.coldStarts", "crashes.coldStarts", { min: 1000 }), gate("parity.a|b", "parity.x", { max: 0 })],
		{ "localhost:5555": { platform: "android", role: "lab", runs: ["lab", "parity"], metrics: { "lab.checks.passed": 27, "lab.runs": 3, "crashes.coldStarts": 4 } } },
	);
	const markdown = renderMarkdown(rows, "Gates, android");
	test("headline counts, then what failed first, passes and informational rows folded", () => {
		const lines = markdown.split("\n");
		expect(lines[0]).toBe("### Gates, android");
		expect(lines[2]).toBe("FAIL: 1 gates pass, 1 fail, 1 not measured, 1 informational (not counted)");
		expect(markdown).toContain("**Failed or not measured (2)**");
		expect(markdown).toContain("| checks.passed | localhost:5555 (lab) | >= 28 x | 27 | **FAIL** |");
		expect(markdown).toContain("| parity.a\\|b | localhost:5555 (lab) | <= 0 x | - | **NOT MEASURED** |");
		expect(markdown).toContain("<details><summary>Passing (1)</summary>");
		expect(markdown.indexOf("Failed or not measured")).toBeLessThan(markdown.indexOf("Passing"));
		expect(markdown).toContain("<details><summary>Informational (1)");
		expect(markdown).toContain("| crashes.coldStarts | localhost:5555 (lab) | >= 1000 x | 4 | informational |");
	});
	test("a table of passes says PASS and has no failure section", () => {
		const passing = evaluate([gate("lab.runs", "lab.runs", { min: 3 })], { x: { platform: "android", role: "lab", runs: ["lab"], metrics: { "lab.runs": 3 } } });
		const text = renderMarkdown(passing, "Gates");
		expect(text).toContain("PASS: 1 gates pass, 0 fail, 0 not measured");
		expect(text).not.toContain("Failed or not measured");
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
	test("devices: the Samsung and the iPhone are phones, the OVH emulator is the lab", () => {
		expect(file.devices).toEqual({
			R58Y90KNGRP: { role: "phone", name: "Samsung A16", runs: ["lab", "boot", "smoke", "gestures", "foreign"] },
			"E74A5608-BF8E-5806-8699-1605F82ADED9": { role: "phone", name: "iPhone SE 3", runs: ["lab", "boot", "parity", "a11y", "smoke", "gestures"] },
			"localhost:5555": { role: "lab", name: "OVH emulator, software GL", runs: ["lab", "soak", "crashes", "parity", "a11y", "resilience", "smoke", "gestures", "foreign", "updates", "product"] },
		});
		expect(() => checkGatesFile(file)).not.toThrow();
	});
	test("the timing gates are for phones only; everything else, memory and leaks included, is for both roles", () => {
		const timing = [
			"lab.scenarios.failed",
			"boot.warm.p90",
			"boot.cold.p90",
			"boot.warm.samples",
			"boot.cold.samples",
			"boot.warm.failed",
			"boot.cold.failed",
			"boot.warm.jsTotal.p90",
			"boot.js.samples",
			"frames.droppedPct",
			"frames.maxPeriodRatio",
			"frames.maxMs",
			"list.virtual300.mountMs",
			"gestures.frames.droppedPct",
			"gestures.frames.maxPeriodRatio",
			"gestures.frames.maxMs",
		];
		for (const gate of file.gates)
			expect([gate.id, gate.roles]).toEqual([gate.id, timing.includes(gate.id) ? ["phone"] : undefined]);
		for (const id of timing) expect(file.gates.some((gate) => gate.id === id)).toBe(true);
	});
	test("the emulator's frame gate reads informational, the Samsung's fails, a device nobody listed is judged", () => {
		const metrics = { "frames.animation-48-square.droppedPct": 48.3 };
		const judged = (serial: string, platform: "android" | "ios" = "android") =>
			evaluate(
				file.gates.filter((gate) => gate.id === "frames.droppedPct"),
				{ [serial]: { platform, role: deviceRoles(file, [serial])[serial] ?? null, metrics } },
				platform,
			).map((row) => row.verdict);
		expect(judged("localhost:5555")).toEqual(["informational"]);
		expect(judged("R58Y90KNGRP")).toEqual(["fail"]);
		expect(judged("emulator-5556")).toEqual(["fail"]);
	});
	test("the Samsung is judged on lab and boot only, the emulator on its lab runs, an unlisted device on everything", () => {
		const metrics = { "crashes.coldStarts": 15, "parity.diffPixelsOutsideMasks": 3, "lab.runs": 1, "boot.warm.p90": 900 };
		const judged = (serial: string) =>
			Object.fromEntries(
				evaluate(
					file.gates.filter((gate) => ["crashes.coldStarts", "parity.diffPixels", "lab.runs", "boot.warm.p90", "crashes.suites"].includes(gate.id)),
					{ [serial]: { platform: "android", role: deviceRoles(file, [serial])[serial], runs: deviceRuns(file, [serial])[serial], metrics } },
					"android",
				).map((row) => [row.id, row.verdict]),
			);
		expect(judged("R58Y90KNGRP")).toEqual({
			"crashes.coldStarts": "informational",
			"crashes.suites": "informational",
			"parity.diffPixels": "informational",
			"lab.runs": "fail",
			"boot.warm.p90": "fail",
		});
		expect(judged("localhost:5555")).toEqual({
			"crashes.coldStarts": "fail",
			"crashes.suites": "not measured",
			"parity.diffPixels": "fail",
			"lab.runs": "fail",
			"boot.warm.p90": "informational",
		});
		expect(judged("emulator-5556")).toEqual({
			"crashes.coldStarts": "fail",
			"crashes.suites": "not measured",
			"parity.diffPixels": "fail",
			"lab.runs": "fail",
			"boot.warm.p90": "fail",
		});
	});
	test("memory is gated, and with no measurement it fails as not measured", () => {
		const rows = evaluate(file.gates, android({}), "android").filter(
			(row) => row.id === "memory.heapGrowthPct",
		);
		expect(rows).toEqual([expect.objectContaining({ verdict: "not measured" })]);
	});
	test("the full run's scenarios are pinned per platform, and the lab gate on the ones missing is zero", () => {
		for (const platform of ["android", "ios"] as const) {
			expect(file.scenarios[platform]).toHaveLength(17);
			expect(file.scenarios[platform]).toContain("list-300-virtual");
			expect(file.scenarios[platform]).not.toContain("warm-up");
		}
		expect(bar("lab.scenarios.missing")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
	});
	test("the boot samples are gated: no failed launch of either series, 30 launches behind the JavaScript p90", () => {
		expect(bar("boot.warm.failed")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
		expect(bar("boot.cold.failed")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
		expect(bar("boot.js.samples")).toEqual({ android: { min: 30 }, ios: { min: 30 } });
		expect(file.gates.find((gate) => gate.id === "boot.js.samples")?.metric).toBe("boot.warm.jsTotal.samples");
	});
	test("the crash suites must have run the full lab, and the masks may cover a quarter of the screen", () => {
		expect(bar("crashes.run")).toEqual({ android: { equals: "checks,quick" }, ios: { equals: "checks,quick" } });
		expect(bar("parity.maskedPct")).toEqual({ android: { max: 25 }, ios: { max: 25 } });
	});
});
