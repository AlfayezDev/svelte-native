import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { printVerdict } from "../commands/report.ts";
import { checkExceptions, decisions, matchException, type GateException } from "../lib/gate-exceptions.ts";
import {
	checkGatesFile,
	evaluate,
	groupRows,
	renderExceptions,
	renderMarkdown,
	renderSetAside,
	renderTable,
	setAsideRuns as setAsideRunsOf,
	tally,
	tallyByDevice,
	type Gate,
	type GatesFile,
	type GateRow,
	type ReportDevice,
} from "../lib/gates.ts";
import { lateIntervals } from "../parse/logcat.ts";

const file = JSON.parse(readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8")) as GatesFile;
const SAMSUNG = "R58Y90KNGRP";
const IPHONE = "E74A5608-BF8E-5806-8699-1605F82ADED9";
const EMULATOR = "localhost:5555";
const exceptions = file.exceptions ?? [];

describe("the late intervals of a frame window", () => {
	test("are counted exactly from the recorded count and the unrounded percentage the lab writes", () => {
		// The lab's own arithmetic (frames.ts summarizeFrames): 100 * dropped / count, kept as a double in the run file.
		for (const count of [149, 183, 720, 723, 1000, 4800, 12000])
			for (const dropped of [0, 1, 2, 3, 20, 25]) expect(lateIntervals({ count, droppedPct: (100 * dropped) / count })).toBe(dropped);
		expect(lateIntervals({ count: 183, droppedPct: 0.546448087431694 })).toBe(1);
		expect(lateIntervals({ count: 723, droppedPct: 0.13831258644536654 })).toBe(1);
	});
	test("are never guessed from a percentage rounded to a tenth, from a window with no interval, or from nonsense", () => {
		expect(lateIntervals({ count: 183, droppedPct: 0.5 })).toBeNull();
		expect(lateIntervals({ count: 723, droppedPct: 0.1 })).toBeNull();
		expect(lateIntervals({ count: 723, droppedPct: 0.14 })).toBeNull();
		expect(lateIntervals({ count: 0, droppedPct: 100 })).toBeNull();
		expect(lateIntervals({ count: 183.5, droppedPct: 0 })).toBeNull();
		expect(lateIntervals({ count: 183, droppedPct: Number.NaN })).toBeNull();
		expect(lateIntervals({ count: 183, droppedPct: -0.546448087431694 })).toBeNull();
		expect(lateIntervals({ count: 10, droppedPct: 110 })).toBeNull();
	});
	test("a rounded percentage that happens to be exact for its count still reads right", () => {
		// 1 late of 1000 is exactly 0.1: the percentage is not a rounding of anything else.
		expect(lateIntervals({ count: 1000, droppedPct: 0.1 })).toBe(1);
	});
});

/** The metrics of one scenario's frames as a lab run produces them. */
const frames = (scenario: string, late: number, maxMs: number, periodMs = 11.11): Record<string, number> => ({
	[`frames.${scenario}.lateIntervals`]: late,
	[`frames.${scenario}.droppedPct`]: (100 * late) / 723,
	[`frames.${scenario}.maxMs`]: maxMs,
	[`frames.${scenario}.maxPeriodRatio`]: maxMs / periodMs,
});

const frameGates = file.gates.filter((gate) => gate.id.startsWith("frames."));
function judge(serial: string, platform: "android" | "ios", metrics: ReportDevice["metrics"], gates: Gate[] = frameGates, excepting = true): GateRow[] {
	const entry = file.devices[serial];
	return evaluate(gates, { [serial]: { platform, role: entry?.role ?? null, runs: entry?.runs ?? null, metrics } }, platform, excepting ? exceptions : undefined);
}
const verdicts = (rows: GateRow[]) => Object.fromEntries(rows.map((row) => [`${row.id}:${row.scenario}`, row.verdict]));

describe("D9: a phone scenario passes with at most one late interval per run and no frame over 33 ms", () => {
	for (const [serial, platform] of [[SAMSUNG, "android"], [IPHONE, "ios"]] as const) {
		test(`${serial}: 0 and 1 late intervals pass every frames gate, 2 fail the dropped-frame and period gates`, () => {
			const rows = judge(serial, platform, { ...frames("idle", 0, 14), ...frames("tabs-8", 1, 19), ...frames("navigation-8", 2, 21) });
			expect(verdicts(rows)).toEqual({
				"frames.droppedPct:idle": "pass",
				"frames.droppedPct:navigation-8": "fail",
				"frames.droppedPct:tabs-8": "pass",
				"frames.maxPeriodRatio:idle": "pass",
				"frames.maxPeriodRatio:navigation-8": "fail",
				"frames.maxPeriodRatio:tabs-8": "pass",
				"frames.maxMs:idle": "pass",
				"frames.maxMs:navigation-8": "pass",
				"frames.maxMs:tabs-8": "pass",
			});
		});
		test(`${serial}: a 34 ms frame fails frames.maxMs outside the D1 scenarios, a 33 ms one passes, and the single late interval still passes the count`, () => {
			const rows = judge(serial, platform, { ...frames("sheet-8", 1, 34), ...frames("modal-8", 1, 33) });
			expect(verdicts(rows)).toEqual({
				"frames.droppedPct:modal-8": "pass",
				"frames.droppedPct:sheet-8": "pass",
				"frames.maxPeriodRatio:modal-8": "pass",
				"frames.maxPeriodRatio:sheet-8": "pass",
				"frames.maxMs:modal-8": "pass",
				"frames.maxMs:sheet-8": "fail",
			});
		});
	}
	test("the measured value on a row is the late count, with the dropped share beside it", () => {
		const rows = judge(SAMSUNG, "android", frames("navigation-8", 2, 21), frameGates.filter((gate) => gate.id === "frames.droppedPct"));
		expect(rows[0]?.measured).toBe(2);
		expect(rows[0]?.also).toEqual({ value: (100 * 2) / 723, unit: "%" });
		expect(renderTable(rows, false)).toContain("2, 0.28 %");
		const ratio = judge(SAMSUNG, "android", frames("navigation-8", 2, 21), frameGates.filter((gate) => gate.id === "frames.maxPeriodRatio"));
		expect(ratio[0]?.also?.unit).toBe("x period");
	});
	test("`--all` names the gate of a row whose metric two gates read", () => {
		const rows = judge(SAMSUNG, "android", frames("navigation-8", 2, 21), frameGates.filter((gate) => gate.id !== "frames.maxMs"));
		const lines = renderTable(rows, true).split("\n");
		expect(lines[1]).toMatch(/^frames\.droppedPct \(navigation-8\)\s+android\s+R58Y90KNGRP \(phone\)\s+<= 1 late intervals\s+2, 0\.28 %\s+fail$/);
		expect(lines[2]).toMatch(/^frames\.maxPeriodRatio \(navigation-8\)\s.*2, 1\.89 x period\s+fail$/);
	});
	test("a window the record cannot count exactly is not measured, which fails", () => {
		const rows = judge(SAMSUNG, "android", { "frames.idle.lateIntervals": null, "frames.idle.droppedPct": 0.5, "frames.idle.maxMs": 22, "frames.idle.maxPeriodRatio": 2 });
		expect(rows.filter((row) => row.id !== "frames.maxMs").map((row) => row.verdict)).toEqual(["not measured", "not measured"]);
		expect(tally(rows).ok).toBe(false);
	});
	test("the emulator keeps its rules: its frame gates stay informational, whatever it measures", () => {
		const rows = judge(EMULATOR, "android", { ...frames("animation-48", 350, 90), ...frames("idle", 0, 14) });
		expect(new Set(rows.map((row) => row.verdict))).toEqual(new Set(["informational"]));
		expect(tally(rows).gates).toEqual({ pass: 0, exception: 0, fail: 0, notMeasured: 0 });
	});
	test("the gestures gates take the same rule on the phones", () => {
		const gestureGates = file.gates.filter((gate) => gate.id.startsWith("gestures.frames."));
		const metrics = (late: number, maxMs: number) => ({ "gestures.pinch-rotate.lateIntervals": late, "gestures.pinch-rotate.droppedPct": (100 * late) / 240, "gestures.pinch-rotate.maxMs": maxMs, "gestures.pinch-rotate.maxPeriodRatio": maxMs / 16.67 });
		const of = (late: number, maxMs: number, serial = SAMSUNG, platform: "android" | "ios" = "android") => verdicts(judge(serial, platform, metrics(late, maxMs), gestureGates));
		for (const late of [0, 1])
			expect(of(late, 30)).toEqual({ "gestures.frames.droppedPct:pinch-rotate": "pass", "gestures.frames.maxPeriodRatio:pinch-rotate": "pass", "gestures.frames.maxMs:pinch-rotate": "pass" });
		expect(of(2, 30)).toEqual({ "gestures.frames.droppedPct:pinch-rotate": "fail", "gestures.frames.maxPeriodRatio:pinch-rotate": "fail", "gestures.frames.maxMs:pinch-rotate": "pass" });
		expect(of(1, 34)["gestures.frames.maxMs:pinch-rotate"]).toBe("fail");
		// D13: on the iPhone the gesture frames come through XCUITest and are a documented exception, not judged
		expect(of(2, 30, IPHONE, "ios")["gestures.frames.droppedPct:pinch-rotate"]).toBe("exception");
		expect(judge(IPHONE, "ios", metrics(2, 30), gestureGates).find((row) => row.exception)?.exception?.decision).toBe("D13");
	});
});

describe("documented exceptions", () => {
	test("a miss an exception covers is `exception`, with its decision, and never a pass or a failure", () => {
		const rows = judge(IPHONE, "ios", frames("header-8", 17, 37, 16.67));
		expect(verdicts(rows)).toEqual({ "frames.droppedPct:header-8": "exception", "frames.maxPeriodRatio:header-8": "exception", "frames.maxMs:header-8": "exception" });
		const row = rows[0] as GateRow;
		expect(row.measured).toBe(17);
		expect(row.exception).toEqual(exceptions.find((entry) => entry.gate === "frames.droppedPct" && entry.device === IPHONE));
		expect(row.exception?.decision).toBe("D1");
		expect(tally(rows)).toEqual({
			rows: { pass: 0, exception: 3, fail: 0, notMeasured: 0 },
			gates: { pass: 0, exception: 3, fail: 0, notMeasured: 0 },
			informational: 0,
			ok: true,
		});
	});
	test("without the exceptions the same rows fail: the verdict comes from the file, not from the scenario's name", () => {
		const rows = judge(IPHONE, "ios", frames("header-8", 17, 37, 16.67), frameGates, false);
		expect(rows.map((row) => row.verdict)).toEqual(["fail", "fail", "fail"]);
	});
	test("an uncovered miss on the same device is still a failure", () => {
		const rows = judge(IPHONE, "ios", { ...frames("header-8", 17, 37, 16.67), ...frames("navigation-8", 3, 25, 16.67), ...frames("animation-48-square", 1, 70, 16.67) });
		expect(verdicts(rows)).toEqual({
			"frames.droppedPct:animation-48-square": "pass",
			"frames.droppedPct:header-8": "exception",
			"frames.droppedPct:navigation-8": "fail",
			"frames.maxPeriodRatio:animation-48-square": "pass",
			"frames.maxPeriodRatio:header-8": "exception",
			"frames.maxPeriodRatio:navigation-8": "fail",
			"frames.maxMs:animation-48-square": "fail",
			"frames.maxMs:header-8": "exception",
			"frames.maxMs:navigation-8": "pass",
		});
		expect(tally(rows).ok).toBe(false);
	});
	test("a device outside the exception's scope fails: the D1 floors are one phone each", () => {
		const samsungHeader = judge(SAMSUNG, "android", frames("header-8", 17, 37));
		expect(samsungHeader.map((row) => row.verdict)).toEqual(["fail", "fail", "fail"]);
		const iphoneChurn = judge(IPHONE, "ios", frames("churn-animated", 25, 52, 16.67));
		expect(iphoneChurn.map((row) => row.verdict)).toEqual(["fail", "fail", "fail"]);
		const samsungChurn = judge(SAMSUNG, "android", frames("churn-animated", 25, 52));
		expect(samsungChurn.map((row) => row.verdict)).toEqual(["exception", "exception", "exception"]);
	});
	test("the lab is never excused by an exception of a phone: its rows are informational and stay so", () => {
		const rows = judge(EMULATOR, "android", { ...frames("header-8", 17, 37), ...frames("churn-animated", 25, 52), ...frames("animation-48", 20, 38) });
		expect(new Set(rows.map((row) => row.verdict))).toEqual(new Set(["informational"]));
		expect(rows.every((row) => row.exception === undefined)).toBe(true);
	});
	test("an exception covers the gate it names and no other gate of the scenario or device", () => {
		const samsung = judge(SAMSUNG, "android", { "boot.warm.p90": 405, "boot.cold.p90": 394, "boot.warm.jsTotal.p90": 140, "list.virtual300.mountMs": 32.6 }, file.gates.filter((gate) => ["boot.warm.p90", "boot.cold.p90", "boot.warm.jsTotal.p90", "list.virtual300.mountMs"].includes(gate.id)));
		expect(Object.fromEntries(samsung.map((row) => [row.id, row.verdict]))).toEqual({
			"boot.warm.p90": "exception",
			"boot.cold.p90": "exception",
			"boot.warm.jsTotal.p90": "fail",
			"list.virtual300.mountMs": "exception",
		});
		expect(samsung.filter((row) => row.verdict === "exception").map((row) => row.exception?.decision)).toEqual(["D9", "D9", "D9"]);
		// the iPhone's boot and list bars are its own: the Samsung's exceptions do not carry over
		const iphone = judge(IPHONE, "ios", { "boot.warm.p90": 405, "boot.cold.p90": 394, "list.virtual300.mountMs": 32.6 }, file.gates.filter((gate) => ["boot.warm.p90", "boot.cold.p90", "list.virtual300.mountMs"].includes(gate.id)));
		expect(iphone.map((row) => row.verdict)).toEqual(["fail", "fail", "fail"]);
	});
	test("D9: the animation-48 family on the Samsung only, capped to the first interval; the other animation scenarios are judged", () => {
		// the first interval (1 late) plus the allowance every scenario has (1): 2 late intervals are the cap; its 19 to 27 ms never exceeds the 33 ms bar
		const rows = judge(SAMSUNG, "android", { ...frames("animation-48", 2, 27), ...frames("animation-48-square", 2, 30), ...frames("animation-48-translate", 1, 28), ...frames("animation-48-css", 2, 18) });
		expect(verdicts(rows)).toEqual({
			"frames.droppedPct:animation-48": "exception",
			"frames.droppedPct:animation-48-css": "fail",
			"frames.droppedPct:animation-48-square": "exception",
			"frames.droppedPct:animation-48-translate": "pass",
			"frames.maxPeriodRatio:animation-48": "exception",
			"frames.maxPeriodRatio:animation-48-css": "fail",
			"frames.maxPeriodRatio:animation-48-square": "exception",
			"frames.maxPeriodRatio:animation-48-translate": "pass",
			"frames.maxMs:animation-48": "pass",
			"frames.maxMs:animation-48-css": "pass",
			"frames.maxMs:animation-48-square": "pass",
			"frames.maxMs:animation-48-translate": "pass",
		});
		const iphone = judge(IPHONE, "ios", frames("animation-48-square", 1, 70, 16.67));
		expect(verdicts(iphone)["frames.maxMs:animation-48-square"]).toBe("fail");
	});
	test("the cap is real: the Samsung's animation-48 run with 20 late intervals and a 38 ms frame is not covered", () => {
		const rows = judge(SAMSUNG, "android", frames("animation-48", 20, 38));
		expect(verdicts(rows)).toEqual({ "frames.droppedPct:animation-48": "fail", "frames.maxPeriodRatio:animation-48": "fail", "frames.maxMs:animation-48": "fail" });
		expect(rows.every((row) => row.exception === undefined)).toBe(true);
		expect(tally(rows).ok).toBe(false);
	});
	test("a cap is inclusive: 2 late intervals are covered, 3 are not, and a 34 ms frame has no exception to hide behind", () => {
		const of = (late: number, maxMs: number) => verdicts(judge(SAMSUNG, "android", frames("animation-48", late, maxMs)));
		expect(of(2, 30)).toEqual({ "frames.droppedPct:animation-48": "exception", "frames.maxPeriodRatio:animation-48": "exception", "frames.maxMs:animation-48": "pass" });
		expect(of(3, 20)["frames.droppedPct:animation-48"]).toBe("fail");
		expect(of(3, 20)["frames.maxPeriodRatio:animation-48"]).toBe("fail");
		expect(of(1, 34)["frames.maxMs:animation-48"]).toBe("fail");
	});
	test("1 Nov first touch: the Samsung's `box` gesture frames only", () => {
		const gestureGates = file.gates.filter((gate) => gate.id.startsWith("gestures.frames."));
		const metrics = { "gestures.box.lateIntervals": 1, "gestures.box.droppedPct": 0.67, "gestures.box.maxMs": 41, "gestures.box.maxPeriodRatio": 3.7, "gestures.box-busy.lateIntervals": 3, "gestures.box-busy.droppedPct": 2, "gestures.box-busy.maxMs": 41, "gestures.box-busy.maxPeriodRatio": 3.7 };
		const rows = judge(SAMSUNG, "android", metrics, gestureGates);
		expect(verdicts(rows)).toEqual({
			"gestures.frames.droppedPct:box": "pass",
			"gestures.frames.droppedPct:box-busy": "fail",
			"gestures.frames.maxPeriodRatio:box": "pass",
			"gestures.frames.maxPeriodRatio:box-busy": "fail",
			"gestures.frames.maxMs:box": "exception",
			"gestures.frames.maxMs:box-busy": "fail",
		});
		expect(rows.find((row) => row.exception)?.exception?.decision).toBe("1 Nov first touch");
		const iphone = judge(IPHONE, "ios", metrics, gestureGates);
		// the first-touch entry is the Samsung's; the iPhone's gesture frames are D13's
		expect(iphone.find((row) => row.id === "gestures.frames.maxMs" && row.scenario === "box")?.exception?.decision).toBe("D13");
	});
	test("a gate that passes stays a pass, and one that was never measured is not turned into an exception", () => {
		const rows = judge(SAMSUNG, "android", { ...frames("churn-animated", 0, 20), "frames.header-8.lateIntervals": null, "frames.header-8.droppedPct": null, "frames.header-8.maxMs": null, "frames.header-8.maxPeriodRatio": null });
		expect(verdicts(rows)["frames.droppedPct:churn-animated"]).toBe("pass");
		const gap = judge(IPHONE, "ios", { "frames.header-8.lateIntervals": null, "frames.header-8.maxMs": null });
		expect(gap.filter((row) => row.scenario === "header-8").map((row) => row.verdict)).toEqual(["not measured", "not measured", "not measured"]);
		expect(tally(gap).ok).toBe(false);
	});
});

describe("counting and the exit status", () => {
	const mixed = judge(SAMSUNG, "android", { ...frames("churn-animated", 25, 52), ...frames("idle", 1, 22), ...frames("list-300", 4, 19) });
	test("the tally and the group line count passes, exceptions, failures and gaps apart", () => {
		const groups = groupRows(mixed);
		expect(groups.map((group) => [group.id, group.verdict, group.ok, group.excepted, group.total])).toEqual([
			["frames.droppedPct", "fail", 1, 1, 3],
			["frames.maxPeriodRatio", "fail", 1, 1, 3],
			["frames.maxMs", "exception", 2, 1, 3],
		]);
		expect(tally(mixed).gates).toEqual({ pass: 0, exception: 1, fail: 2, notMeasured: 0 });
		expect(tally(mixed).rows).toEqual({ pass: 4, exception: 3, fail: 2, notMeasured: 0 });
		expect(tallyByDevice(mixed)[0]?.gates).toEqual({ pass: 0, exception: 1, fail: 2, notMeasured: 0 });
	});
	test("a failing gate shows a failing row's value, not the larger value of an excused one", () => {
		const group = groupRows(mixed)[0];
		expect(group?.worst).toBe("list-300");
		expect(group?.measured).toBe(4);
		const line = renderTable(mixed, false).split("\n")[1] as string;
		expect(line).toMatch(/4 \(list-300\), 0\.55 %\s+fail 1\/3 \(\+1 exception\)$/);
	});
	/** What `printVerdict` prints and returns (its result is the exit status of `gates`). */
	function printed(rows: GateRow[], names: Record<string, string> = {}): { ok: boolean; text: string } {
		const lines: string[] = [];
		const original = console.log;
		console.log = (...args: unknown[]) => void lines.push(args.join(" "));
		try {
			return { ok: printVerdict(rows, false, names), text: lines.join("\n") };
		} finally {
			console.log = original;
		}
	}
	test("exit status: exceptions alone are ok, a failure or a gap is not", () => {
		const excused = judge(SAMSUNG, "android", frames("churn-animated", 25, 52));
		expect(excused.every((row) => row.verdict === "exception")).toBe(true);
		expect(tally(excused).ok).toBe(true);
		expect(printed(excused).ok).toBe(true);
		expect(printed([...excused, ...judge(SAMSUNG, "android", frames("idle", 3, 20))]).ok).toBe(false);
		const gap = judge(SAMSUNG, "android", { "frames.idle.lateIntervals": null });
		expect(printed([...excused, ...gap]).ok).toBe(false);
		expect(printed([...excused, ...judge(SAMSUNG, "android", frames("idle", 1, 20))]).ok).toBe(true);
	});
	test("the summary line counts pass / exception / fail / not measured separately, per device too, and lists the exceptions with their decision", () => {
		const { text } = printed(mixed, { [SAMSUNG]: "Samsung A16" });
		expect(text).toContain("0 gates pass, 1 exception, 2 fail, 0 not measured");
		expect(text).toContain(`${SAMSUNG} (phone): 0 pass, 1 exception, 2 fail, 0 not measured`);
		expect(text).toContain("documented exceptions");
		expect(text).toMatch(/frames\.droppedPct \(Samsung A16, churn-animated\): 25 late intervals, 3\.46 % against <= 1 late intervals; D1: Reanimated/);
		expect(text).toContain("SPEC.md");
	});
	test("the Markdown headline counts exceptions apart and lists them with the measured value and the decision", () => {
		const markdown = renderMarkdown(mixed, "Gates, android", { [SAMSUNG]: "Samsung A16" });
		expect(markdown).toContain("FAIL: 0 gates pass, 1 exception, 2 fail, 0 not measured");
		expect(markdown).toContain("**Failed or not measured (2)**");
		expect(markdown).toContain("**Documented exceptions (3 rows in 3 gates)");
		expect(markdown).not.toContain("<details><summary>Passing");
		expect(markdown).toMatch(/\| frames\.droppedPct \| Samsung A16 \| churn-animated \| <= 1 late intervals \| 25 late intervals, 3\.46 % \| D1 \| Reanimated/);
		expect(markdown).toMatch(/\| frames\.maxMs \| Samsung A16 \| churn-animated \| <= 33 ms \| 52 ms \| D1 \|/);
		const clean = renderMarkdown(excusedOnly(), "Gates");
		expect(clean).toContain("PASS: 0 gates pass, 3 exception, 0 fail, 0 not measured");
		expect(clean).not.toContain("Failed or not measured");
	});
	test("renderExceptions is empty when nothing is excused", () => {
		expect(renderExceptions(judge(SAMSUNG, "android", frames("idle", 0, 14)))).toEqual([]);
	});
});

/**
 * The metrics of a scenario's lab runs as `labMetrics` writes them: the worst run's figures and the per-run list D10 reads. `runs` is
 * `[late intervals, longest frame ms]` for each run; 90 Hz (11.11 ms) and 723 intervals a window unless said.
 */
function labRuns(scenario: string, runs: [number, number][], periodMs = 11.11): Record<string, number | string> {
	const records = runs.map(([late, ms]) => ({ lateIntervals: late, maxMs: ms, droppedPct: (100 * late) / 723, maxPeriodRatio: ms / periodMs }));
	const worstLate = Math.max(...runs.map(([late]) => late));
	const worstMs = Math.max(...runs.map(([, ms]) => ms));
	return {
		[`frames.${scenario}.lateIntervals`]: worstLate,
		[`frames.${scenario}.droppedPct`]: (100 * worstLate) / 723,
		[`frames.${scenario}.maxMs`]: worstMs,
		[`frames.${scenario}.maxPeriodRatio`]: worstMs / periodMs,
		[`frames.${scenario}.runs`]: JSON.stringify(records),
	};
}
const tenRuns = (bad: Record<number, [number, number]> = {}, clean: [number, number] = [1, 19]): [number, number][] => Array.from({ length: 10 }, (_, index) => bad[index + 1] ?? clean);

describe("D11 (amended 9 Nov 2026; churn-static to D18 on 11 Nov): the Samsung's list-300-raw capped at 4 late intervals, list-300 and list-300-clipped at 2, all at 23 ms", () => {
	const of = (scenario: string, runs: [number, number][], serial = SAMSUNG, platform: "android" | "ios" = "android") => verdicts(judge(serial, platform, labRuns(scenario, runs, platform === "ios" ? 16.67 : 11.11)));
	test("up to 4 late intervals with no frame over 23 ms are exceptions on both late-interval gates, and the longest-frame gate passes on its own", () => {
		for (const scenario of ["list-300-raw"])
			expect(of(scenario, tenRuns({ 2: [4, 19], 6: [3, 22] }, [1, 18]))).toEqual({
				[`frames.droppedPct:${scenario}`]: "exception",
				[`frames.maxPeriodRatio:${scenario}`]: "exception",
				[`frames.maxMs:${scenario}`]: "pass",
			});
		const row = judge(SAMSUNG, "android", labRuns("list-300-raw", tenRuns({ 2: [4, 19], 6: [3, 20] }, [1, 18])))[0] as GateRow;
		expect(row.exception?.decision).toBe("D11");
		// the 4-late run is the one D10 sets aside: the judged value is the next worst
		expect(row.measured).toBe(3);
		expect(row.worstRun).toEqual({ run: 2, lateIntervals: 4, maxMs: 19 });
	});
	test("above the late-interval cap, or with a frame over the frame cap, the row fails: 5 late intervals, or 4 with a 24 ms frame, in two runs", () => {
		expect(of("list-300-raw", tenRuns({ 2: [5, 19], 6: [5, 18] }, [1, 18]))["frames.droppedPct:list-300-raw"]).toBe("fail");
		expect(of("list-300-raw", tenRuns({ 2: [5, 19], 6: [5, 18] }, [1, 18]))["frames.maxPeriodRatio:list-300-raw"]).toBe("fail");
		const tall = of("list-300-raw", tenRuns({ 2: [4, 24], 6: [4, 24] }, [1, 18]));
		expect(tall["frames.droppedPct:list-300-raw"]).toBe("fail");
		expect(tall["frames.maxPeriodRatio:list-300-raw"]).toBe("fail");
		// a 24 ms frame is still under the 33 ms bar, so the longest-frame gate has nothing to say
		expect(tall["frames.maxMs:list-300-raw"]).toBe("pass");
		// no frame length at all is not a frame within the cap
		const noLength = evaluate(frameGates, { [SAMSUNG]: { platform: "android", role: "phone", runs: file.devices[SAMSUNG]?.runs ?? null, metrics: { "frames.list-300-raw.lateIntervals": 3, "frames.list-300-raw.droppedPct": 0.4, "frames.list-300-raw.maxPeriodRatio": 1.5 } } }, "android", exceptions);
		expect(noLength.find((row) => row.id === "frames.droppedPct")?.verdict).toBe("fail");
	});
	test("the caps apply to the judged runs, as for D9: the run D10 sets aside is not held to them, the next worst is", () => {
		// run 2 (9 late, 30 ms) is set aside; the others reach 4 late and 19 ms
		const inside = of("list-300-raw", tenRuns({ 2: [9, 30], 5: [4, 19] }, [1, 18]));
		expect(inside).toEqual({ "frames.droppedPct:list-300-raw": "exception", "frames.maxPeriodRatio:list-300-raw": "exception", "frames.maxMs:list-300-raw": "pass" });
		const rows = judge(SAMSUNG, "android", labRuns("list-300-raw", tenRuns({ 2: [9, 30], 5: [4, 19] }, [1, 18])));
		expect(rows[0]?.worstRun).toEqual({ run: 2, lateIntervals: 9, maxMs: 30 });
		// the next worst run is held to the caps: 3 late intervals but a 24 ms frame
		const outside = of("list-300-raw", tenRuns({ 2: [9, 30], 5: [3, 24] }, [1, 18]));
		expect(outside["frames.droppedPct:list-300-raw"]).toBe("fail");
		// and so is a second run past the late-interval cap
		expect(of("list-300-raw", tenRuns({ 2: [9, 30], 5: [5, 19] }, [1, 18]))["frames.droppedPct:list-300-raw"]).toBe("fail");
		// nine runs: nothing is set aside, so the 9-late run is judged and fails
		expect(of("list-300-raw", tenRuns({ 2: [9, 30], 5: [4, 19] }, [1, 18]).slice(0, 9))["frames.droppedPct:list-300-raw"]).toBe("fail");
	});
	test("the two lists are covered up to 2 late intervals, not 3: the 9 Nov spread (13 of 158 runs at 2 late), no more", () => {
		for (const scenario of ["list-300", "list-300-clipped"]) {
			expect(of(scenario, tenRuns({ 2: [2, 19], 6: [2, 22] }, [1, 18]))[`frames.droppedPct:${scenario}`]).toBe("exception");
			expect(of(scenario, tenRuns({ 2: [3, 19], 6: [3, 19] }, [1, 18]))[`frames.droppedPct:${scenario}`]).toBe("fail");
			expect(of(scenario, tenRuns({ 2: [2, 24], 6: [2, 24] }, [1, 18]))[`frames.droppedPct:${scenario}`]).toBe("fail");
		}
	});
	test("only on the Samsung and only for its three scenarios", () => {
		expect(of("list-300-virtual", tenRuns({ 2: [3, 19], 6: [3, 19] }, [1, 18]))["frames.droppedPct:list-300-virtual"]).toBe("fail");
		expect(of("input-120", tenRuns({ 2: [3, 19], 6: [3, 19] }, [1, 18]))["frames.droppedPct:input-120"]).toBe("fail");
		expect(of("list-300-raw", tenRuns({ 2: [3, 19], 6: [3, 19] }, [1, 18]), IPHONE, "ios")["frames.droppedPct:list-300-raw"]).toBe("fail");
		const emulator = judge(EMULATOR, "android", labRuns("list-300-raw", tenRuns({ 2: [3, 19], 6: [3, 19] }, [1, 18])));
		expect(new Set(emulator.map((row) => row.verdict))).toEqual(new Set(["informational"]));
	});
	test("a frame cap is a condition on a late-interval entry: matchException needs the scenario's longest frame", () => {
		const entry: GateException = { gate: "late", device: "phone", scenarios: ["a"], maxLateIntervals: 4, maxMs: 20, decision: "D11", reason: "one line of why", evidence: "SPEC.md, a section" };
		const at = (measured: number, longestMs: number | null | undefined) => matchException([entry], { gate: "late", device: "phone", scenario: "a", metric: "f.a.lateIntervals", measured, longestMs });
		expect(at(4, 20)).toBe(entry);
		expect(at(4, 20.5)).toBeUndefined();
		expect(at(5, 10)).toBeUndefined();
		expect(at(4, null)).toBeUndefined();
		expect(at(4, undefined)).toBeUndefined();
	});
});

describe("D18 (11 Nov 2026): the Samsung's churn-static capped at 6 late intervals and input-120 at 2, both at 23 ms", () => {
	const of = (scenario: string, runs: [number, number][], serial = SAMSUNG, platform: "android" | "ios" = "android") => verdicts(judge(serial, platform, labRuns(scenario, runs, platform === "ios" ? 16.67 : 11.11)));
	test("churn-static: up to 6 late intervals with no frame over 23 ms are exceptions, 7 or a 24 ms frame fail", () => {
		expect(of("churn-static", tenRuns({ 2: [6, 18], 6: [6, 18] }, [1, 18]))).toEqual({
			"frames.droppedPct:churn-static": "exception",
			"frames.maxPeriodRatio:churn-static": "exception",
			"frames.maxMs:churn-static": "pass",
		});
		const row = judge(SAMSUNG, "android", labRuns("churn-static", tenRuns({ 2: [6, 18], 6: [6, 18] }, [1, 18])))[0] as GateRow;
		expect(row.exception?.decision).toBe("D18");
		expect(of("churn-static", tenRuns({ 2: [7, 18], 6: [7, 18] }, [1, 18]))["frames.droppedPct:churn-static"]).toBe("fail");
		expect(of("churn-static", tenRuns({ 2: [6, 24], 6: [6, 24] }, [1, 18]))["frames.droppedPct:churn-static"]).toBe("fail");
	});
	test("input-120: 2 late intervals are an exception, 3 fail", () => {
		expect(of("input-120", tenRuns({ 2: [2, 19], 6: [2, 19] }, [1, 18]))["frames.droppedPct:input-120"]).toBe("exception");
		expect(of("input-120", tenRuns({ 2: [2, 19], 6: [2, 19] }, [1, 18]))["frames.maxPeriodRatio:input-120"]).toBe("exception");
		expect(of("input-120", tenRuns({ 2: [3, 19], 6: [3, 19] }, [1, 18]))["frames.droppedPct:input-120"]).toBe("fail");
	});
	test("not on the iPhone", () => {
		expect(of("churn-static", tenRuns({ 2: [3, 19], 6: [3, 19] }, [1, 16]), IPHONE, "ios")["frames.droppedPct:churn-static"]).toBe("fail");
		expect(of("input-120", tenRuns({ 2: [2, 19], 6: [2, 19] }, [1, 16]), IPHONE, "ios")["frames.droppedPct:input-120"]).toBe("fail");
	});
});

describe("D10: a phone's lab scenario passes when all but one of its ten runs meet the rule", () => {
	test("one bad run passes, and the run is shown with its figures, never hidden", () => {
		for (const [serial, platform] of [[SAMSUNG, "android"], [IPHONE, "ios"]] as const) {
			const rows = judge(serial, platform, labRuns("input-120", tenRuns({ 4: [5, 27] })));
			expect(rows.map((row) => row.verdict)).toEqual(["pass", "pass", "pass"]);
			expect(rows.map((row) => row.measured)).toEqual([1, 1, 19]);
			for (const row of rows) expect(row.worstRun).toEqual({ run: 4, lateIntervals: 5, maxMs: 27 });
			expect(tally(rows).ok).toBe(true);
			const cell = renderTable(rows.slice(0, 1), false);
			expect(cell).toContain("1, 0.14 %; worst run: 5 late, 27 ms, run 4");
		}
	});
	test("a run over 33 ms alone is one bad run too: frames.maxMs passes on the others and shows the 40 ms run", () => {
		const rows = judge(SAMSUNG, "android", labRuns("tabs-8", tenRuns({ 7: [1, 40] })));
		expect(verdicts(rows)).toEqual({ "frames.droppedPct:tabs-8": "pass", "frames.maxPeriodRatio:tabs-8": "pass", "frames.maxMs:tabs-8": "pass" });
		expect(rows.find((row) => row.id === "frames.maxMs")?.worstRun).toEqual({ run: 7, lateIntervals: 1, maxMs: 40 });
		expect(rows.find((row) => row.id === "frames.maxMs")?.measured).toBe(19);
	});
	test("two bad runs fail, and the worst of them is still shown", () => {
		const rows = judge(SAMSUNG, "android", labRuns("input-120", tenRuns({ 2: [6, 30], 8: [3, 25] })));
		expect(verdicts(rows)).toEqual({ "frames.droppedPct:input-120": "fail", "frames.maxPeriodRatio:input-120": "fail", "frames.maxMs:input-120": "pass" });
		expect(rows[0]?.measured).toBe(3);
		expect(rows[0]?.worstRun).toEqual({ run: 2, lateIntervals: 6, maxMs: 30 });
		expect(tally(rows).ok).toBe(false);
		const frameRuns = judge(SAMSUNG, "android", labRuns("input-120", tenRuns({ 2: [1, 36], 8: [1, 40] })));
		expect(frameRuns.find((row) => row.id === "frames.maxMs")?.verdict).toBe("fail");
		expect(frameRuns.find((row) => row.id === "frames.maxMs")?.measured).toBe(36);
	});
	test("two different kinds of bad run fail too: one late-interval run and one long-frame run are two bad runs", () => {
		const rows = judge(IPHONE, "ios", labRuns("tabs-8", tenRuns({ 3: [4, 20], 9: [1, 40] }), 16.67));
		expect(rows.some((row) => row.verdict === "fail")).toBe(true);
	});
	test("nine runs get no allowance: the worst run is judged", () => {
		const nine = tenRuns({ 4: [5, 27] }).slice(0, 9);
		expect(nine).toHaveLength(9);
		const rows = judge(SAMSUNG, "android", labRuns("input-120", nine));
		expect(verdicts(rows)).toEqual({ "frames.droppedPct:input-120": "fail", "frames.maxPeriodRatio:input-120": "fail", "frames.maxMs:input-120": "pass" });
		expect(rows[0]?.measured).toBe(5);
		expect(rows.every((row) => row.worstRun === undefined)).toBe(true);
		const ten = judge(SAMSUNG, "android", labRuns("input-120", tenRuns({ 4: [5, 27] })));
		expect(ten[0]?.verdict).toBe("pass");
	});
	test("a record that cannot be read gives no allowance: the worst run is judged", () => {
		const metrics = labRuns("input-120", tenRuns({ 4: [5, 27] }));
		for (const runs of [undefined, "not json", "{}", JSON.stringify(tenRuns({ 4: [5, 27] }).map(([late, ms]) => ({ lateIntervals: late, maxMs: ms, droppedPct: 0, maxPeriodRatio: null })))]) {
			const unreadable: Record<string, number | string> = { ...metrics, "frames.input-120.runs": runs ?? "" };
			if (runs === undefined) delete unreadable["frames.input-120.runs"];
			const rows = judge(SAMSUNG, "android", unreadable);
			expect(rows[0]?.verdict).toBe("fail");
			expect(rows[0]?.worstRun).toBeUndefined();
		}
	});
	test("a lab with no bad run is judged as before and shows no set-aside run", () => {
		const rows = judge(SAMSUNG, "android", labRuns("idle", tenRuns()));
		expect(rows.map((row) => row.verdict)).toEqual(["pass", "pass", "pass"]);
		expect(rows.every((row) => row.worstRun === undefined)).toBe(true);
	});
	test("exceptions and their caps still apply to the judged value", () => {
		// animation-48 (D9, capped at 2 late intervals): the others' worst is 2, the set-aside run had 20
		const covered = judge(SAMSUNG, "android", labRuns("animation-48", tenRuns({ 2: [20, 38], 5: [2, 25] })));
		expect(verdicts(covered)).toEqual({ "frames.droppedPct:animation-48": "exception", "frames.maxPeriodRatio:animation-48": "exception", "frames.maxMs:animation-48": "pass" });
		expect(covered[0]?.worstRun).toEqual({ run: 2, lateIntervals: 20, maxMs: 38 });
		// above the cap on the judged value: fails, whatever was set aside
		const above = judge(SAMSUNG, "android", labRuns("animation-48", tenRuns({ 2: [20, 38], 5: [3, 25] })));
		expect(above.find((row) => row.id === "frames.droppedPct")?.verdict).toBe("fail");
		// the D1 floors are uncapped
		const header = judge(IPHONE, "ios", labRuns("header-8", Array.from({ length: 10 }, (_, index): [number, number] => [16 + (index % 2), 36 + index]), 16.67));
		expect(verdicts(header)).toEqual({ "frames.droppedPct:header-8": "exception", "frames.maxPeriodRatio:header-8": "exception", "frames.maxMs:header-8": "exception" });
		expect(header.find((row) => row.id === "frames.maxMs")?.measured).toBe(44);
		expect(header.find((row) => row.id === "frames.maxMs")?.worstRun?.maxMs).toBe(45);
		// a scenario with one bad run does not need the Samsung's exception: the allowance passes it
		const spared = judge(SAMSUNG, "android", labRuns("animation-48", tenRuns({ 2: [20, 38] })));
		expect(spared.map((row) => row.verdict)).toEqual(["pass", "pass", "pass"]);
	});
	test("the gestures gates keep the D9 rule per launch: no allowance, whatever a run list says", () => {
		const gestureGates = file.gates.filter((gate) => gate.id.startsWith("gestures.frames."));
		expect(gestureGates.every((gate) => gate.allowance === undefined)).toBe(true);
		const rows = judge(SAMSUNG, "android", { "gestures.pinch-rotate.lateIntervals": 2, "gestures.pinch-rotate.droppedPct": 0.8, "gestures.pinch-rotate.maxMs": 30, "gestures.pinch-rotate.maxPeriodRatio": 2.7, "gestures.pinch-rotate.runs": JSON.stringify(tenRuns()) }, gestureGates);
		expect(rows.find((row) => row.id === "gestures.frames.droppedPct")?.verdict).toBe("fail");
	});
	test("the emulator's rows stay informational and show the worst run", () => {
		const rows = judge(EMULATOR, "android", labRuns("animation-48", tenRuns({ 2: [350, 90] })));
		expect(new Set(rows.map((row) => row.verdict))).toEqual(new Set(["informational"]));
		expect(rows[0]?.measured).toBe(350);
		expect(setAsideRunsOf(rows)).toEqual([]);
	});
	test("the list of set-aside runs names each once, with what the other runs gave", () => {
		const rows = judge(SAMSUNG, "android", { ...labRuns("input-120", tenRuns({ 4: [5, 27] })), ...labRuns("tabs-8", tenRuns({ 7: [1, 40] })), ...labRuns("idle", tenRuns()) });
		const lines = renderSetAside(rows, { [SAMSUNG]: "Samsung A16" });
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe("  input-120 (Samsung A16): run 4 set aside, 5 late intervals and 27 ms; the other runs: frames.droppedPct 1 pass, frames.maxPeriodRatio 1 pass, frames.maxMs 19 pass");
		expect(lines[1]).toContain("tabs-8 (Samsung A16): run 7 set aside, 1 late intervals and 40 ms");
		const markdown = renderMarkdown(rows, "Gates", { [SAMSUNG]: "Samsung A16" });
		expect(markdown).toContain("**Worst runs set aside (D10, 2)");
		expect(markdown).toMatch(/\| input-120 \| Samsung A16 \| 4 \| 5 \| 27 ms \|/);
	});
	test("the real gates.json gives the three lab frame gates the allowance of ten runs, and nothing else", () => {
		for (const gate of file.gates)
			expect([gate.id, gate.allowance]).toEqual([gate.id, ["frames.droppedPct", "frames.maxPeriodRatio", "frames.maxMs"].includes(gate.id) ? { runs: "frames.*.runs", min: 10, late: "frames.droppedPct", long: "frames.maxMs" } : undefined]);
	});
	test("checkGatesFile refuses an allowance that cannot work", () => {
		const gate = (allowance: NonNullable<Gate["allowance"]>, metric = "f.*.lateIntervals"): GatesFile => ({
			version: 1,
			devices: {},
			scenarios: { android: [], ios: [] },
			smoke: { modules: { android: ["a"], ios: ["a"] }, skips: { android: [], ios: [] } },
			gates: [
				{ id: "late", title: "x", unit: "n", metric, bar: { android: { max: 1 } }, allowance },
				{ id: "long", title: "x", unit: "ms", metric: "f.*.maxMs", bar: { android: { max: 33 } } },
			],
		});
		const ok = { runs: "f.*.runs", min: 10, late: "late", long: "long" };
		expect(() => checkGatesFile(gate(ok))).not.toThrow();
		expect(() => checkGatesFile(gate({ ...ok, runs: "f.runs" }))).toThrow(/one `\*`/);
		expect(() => checkGatesFile(gate(ok, "f.*.other"))).toThrow(/not a late interval or longest-frame metric/);
		expect(() => checkGatesFile(gate({ ...ok, min: 1 }))).toThrow(/at least 2 runs/);
		expect(() => checkGatesFile(gate({ ...ok, late: "nope" }))).toThrow(/nope, which is not a gate/);
	});
});

describe("lab.scenarios.failed leaves out the scenarios whose frame misses the exceptions cover", () => {
	const labGates = file.gates.filter((gate) => gate.id === "lab.scenarios.failed" || frameGates.some((frame) => frame.id === gate.id));
	const failedRuns = (...runs: { frame: string[]; other?: number }[]) => JSON.stringify(runs.map((run) => ({ frame: run.frame, other: run.other ?? 0 })));
	const lab = (serial: string, platform: "android" | "ios", raw: number, runs: string | null, metrics: Record<string, number>) =>
		judge(serial, platform, { "lab.scenarios.failed": raw, ...(runs === null ? {} : { "lab.scenarios.failedRuns": runs }), ...metrics }, labGates);
	const failed = (rows: GateRow[]) => rows.find((row) => row.id === "lab.scenarios.failed") as GateRow;

	test("the Samsung: churn-animated (D1) and a first-interval animation-48 are covered, so the gate counts none of them", () => {
		const rows = lab(SAMSUNG, "android", 2, failedRuns({ frame: ["churn-animated", "animation-48"] }), { ...frames("churn-animated", 28, 52), ...frames("animation-48", 2, 27) });
		expect(failed(rows).measured).toBe(0);
		expect(failed(rows).verdict).toBe("pass");
		expect(failed(rows).also).toEqual({ value: 2, unit: "before exceptions and allowed runs" });
		expect(renderTable([failed(rows)], false)).toContain("0, 2 before exceptions and allowed runs");
	});
	/** The per-run list for a lab of `length` runs in which the lab failed the named scenarios in the given runs (from 1). */
	const failedIn = (length: number, failures: Record<number, string[]>) => failedRuns(...Array.from({ length }, (_, index) => ({ frame: failures[index + 1] ?? [] })));

	test("D10: a scenario whose only failing run is the one set aside is not counted", () => {
		const rows = lab(SAMSUNG, "android", 1, failedIn(10, { 4: ["input-120"] }), labRuns("input-120", tenRuns({ 4: [5, 27] })) as Record<string, number>);
		expect(failed(rows).measured).toBe(0);
		expect(failed(rows).verdict).toBe("pass");
		expect(failed(rows).also).toEqual({ value: 1, unit: "before exceptions and allowed runs" });
		expect(renderTable([failed(rows)], false)).toContain("0, 1 before exceptions and allowed runs");
	});
	test("D10: two bad runs fail the scenario and both failures count, one run at a time", () => {
		const rows = lab(SAMSUNG, "android", 1, failedIn(10, { 2: ["input-120"], 8: ["input-120"] }), labRuns("input-120", tenRuns({ 2: [6, 30], 8: [3, 25] })) as Record<string, number>);
		expect(failed(rows).measured).toBe(1);
		expect(failed(rows).verdict).toBe("fail");
	});
	test("D10: a failure in a run other than the one set aside still counts", () => {
		// the lab failed run 5, but the run the rule set aside is run 4
		const rows = lab(SAMSUNG, "android", 1, failedIn(10, { 5: ["input-120"] }), labRuns("input-120", tenRuns({ 4: [5, 27] })) as Record<string, number>);
		expect(failed(rows).measured).toBe(1);
		expect(failed(rows).verdict).toBe("fail");
	});
	test("D10: with nine runs nothing is set aside, so the failing run counts", () => {
		const rows = lab(SAMSUNG, "android", 1, failedIn(9, { 4: ["input-120"] }), labRuns("input-120", tenRuns({ 4: [5, 27] }).slice(0, 9)) as Record<string, number>);
		expect(failed(rows).measured).toBe(1);
		expect(failed(rows).verdict).toBe("fail");
	});
	test("D10: a set-aside run and a failure of another kind in the same run both keep their weight", () => {
		const rows = lab(SAMSUNG, "android", 2, failedRuns(...Array.from({ length: 10 }, (_, index) => ({ frame: index === 3 ? ["input-120"] : [], other: index === 3 ? 1 : 0 }))), labRuns("input-120", tenRuns({ 4: [5, 27] })) as Record<string, number>);
		expect(failed(rows).measured).toBe(1);
	});
	test("a scenario with a frame miss no exception covers still counts: the animation-48 run with 20 late intervals and 38 ms", () => {
		const rows = lab(SAMSUNG, "android", 2, failedRuns({ frame: ["churn-animated", "animation-48"] }), { ...frames("churn-animated", 28, 52), ...frames("animation-48", 20, 38) });
		expect(failed(rows).measured).toBe(1);
		expect(failed(rows).verdict).toBe("fail");
	});
	test("a miss on one frame gate is enough to count it, even if the others are covered", () => {
		// 2 late intervals are covered; the 38 ms frame has no exception for animation-48 (its first interval is 19 to 27 ms)
		const rows = lab(SAMSUNG, "android", 1, failedRuns({ frame: ["animation-48"] }), frames("animation-48", 2, 38));
		expect(verdicts(rows.filter((row) => row.id !== "lab.scenarios.failed"))["frames.maxMs:animation-48"]).toBe("fail");
		expect(failed(rows).measured).toBe(1);
		expect(failed(rows).verdict).toBe("fail");
	});
	test("a scenario that failed for another reason counts, and the worst run decides as before", () => {
		const metrics = { ...frames("churn-animated", 28, 52), ...frames("input-120", 3, 25), ...frames("tabs-8", 0, 14) };
		expect(failed(lab(SAMSUNG, "android", 1, failedRuns({ frame: ["churn-animated"], other: 1 }), metrics)).measured).toBe(1);
		const twoRuns = failedRuns({ frame: ["churn-animated", "input-120"] }, { frame: ["input-120", "tabs-8"] });
		// run 1: input-120 counts (3 late, not covered); run 2: input-120 and tabs-8 (a frame failure with no frame miss) count
		expect(failed(lab(SAMSUNG, "android", 2, twoRuns, metrics)).measured).toBe(2);
		expect(failed(lab(SAMSUNG, "android", 1, failedRuns({ frame: ["churn-animated"] }, { frame: ["input-120"] }), metrics)).measured).toBe(1);
	});
	test("a frame failure with no frame miss on the gates is not covered by anything", () => {
		const rows = lab(SAMSUNG, "android", 1, failedRuns({ frame: ["tabs-8"] }), frames("tabs-8", 0, 14));
		expect(failed(rows).measured).toBe(1);
		expect(failed(rows).also).toBeUndefined();
	});
	test("a metric that is missing or unreadable leaves the raw count", () => {
		for (const runs of [null, "not json", "{}", "[{\"frame\":1}]", "[]"])
			expect(failed(lab(SAMSUNG, "android", 2, runs, frames("churn-animated", 28, 52))).measured).toBe(2);
		expect(failed(lab(SAMSUNG, "android", 2, null, frames("churn-animated", 28, 52))).verdict).toBe("fail");
	});
	test("the iPhone: header-8 (D1) is covered, animation-48-square with a 70 ms frame is not", () => {
		const header = lab(IPHONE, "ios", 1, failedRuns({ frame: ["header-8"] }), frames("header-8", 17, 37, 16.67));
		expect(failed(header).measured).toBe(0);
		expect(failed(header).verdict).toBe("pass");
		const square = lab(IPHONE, "ios", 2, failedRuns({ frame: ["header-8", "animation-48-square"] }), { ...frames("header-8", 17, 37, 16.67), ...frames("animation-48-square", 1, 70, 16.67) });
		expect(failed(square).measured).toBe(1);
		expect(failed(square).verdict).toBe("fail");
	});
	test("a scenario is covered on the device the exception names: the Samsung's churn-animated still counts on the iPhone", () => {
		const rows = lab(IPHONE, "ios", 1, failedRuns({ frame: ["churn-animated"] }), frames("churn-animated", 28, 52, 16.67));
		expect(failed(rows).measured).toBe(1);
		expect(failed(rows).verdict).toBe("fail");
	});
	test("the emulator's count is informational and stays the lab's own", () => {
		const rows = judge(EMULATOR, "android", { "lab.scenarios.failed": 5, "lab.scenarios.failedRuns": failedRuns({ frame: ["a", "b", "c", "d", "e"] }) }, labGates);
		expect(failed(rows).verdict).toBe("informational");
		expect(failed(rows).measured).toBe(5);
	});
	test("the gate of gates.json names the frame gates and the metric that lists the runs", () => {
		const gate = file.gates.find((candidate) => candidate.id === "lab.scenarios.failed");
		expect(gate?.excusing).toEqual({ runs: "lab.scenarios.failedRuns", gates: ["frames.droppedPct", "frames.maxPeriodRatio", "frames.maxMs"] });
	});
	test("checkGatesFile refuses an excusing list naming a gate that is not there", () => {
		const table: GatesFile = { version: 1, devices: {}, scenarios: { android: [], ios: [] }, smoke: { modules: { android: ["a"], ios: ["a"] }, skips: { android: [], ios: [] } }, gates: [{ id: "x", title: "x", unit: "n", metric: "m", bar: { android: { max: 0 } }, excusing: { runs: "m.runs", gates: ["nope"] } }] };
		expect(() => checkGatesFile(table)).toThrow(/excuses by nope, which is not a gate/);
	});
});

function excusedOnly(): GateRow[] {
	return judge(SAMSUNG, "android", frames("churn-animated", 25, 52));
}

describe("the exceptions of gates.json", () => {
	test("hold the decisions of D1, D9, D11, D13, D18 and the first touch, for the devices and scenarios they name", () => {
		const of = (decision: string) => exceptions.filter((entry) => entry.decision === decision);
		const key = (entry: GateException) => `${entry.gate}@${entry.device === SAMSUNG ? "samsung" : entry.device === IPHONE ? "iphone" : entry.device}${entry.scenarios ? `:${entry.scenarios.join("+")}` : ""}`;
		expect(of("D1").map(key)).toEqual([
			"frames.droppedPct@iphone:header-8",
			"frames.maxPeriodRatio@iphone:header-8",
			"frames.maxMs@iphone:header-8",
			"frames.droppedPct@samsung:churn-animated",
			"frames.maxPeriodRatio@samsung:churn-animated",
			"frames.maxMs@samsung:churn-animated",
		]);
		expect(of("D9").map(key)).toEqual([
			"list.virtual300.mountMs@samsung",
			"boot.warm.p90@samsung",
			"boot.cold.p90@samsung",
			"frames.droppedPct@samsung:animation-48+animation-48-square+animation-48-translate",
			"frames.maxPeriodRatio@samsung:animation-48+animation-48-square+animation-48-translate",
		]);
		expect(of("D11").map(key)).toEqual([
			"frames.droppedPct@samsung:list-300-raw",
			"frames.droppedPct@samsung:list-300+list-300-clipped",
			"frames.maxPeriodRatio@samsung:list-300-raw",
			"frames.maxPeriodRatio@samsung:list-300+list-300-clipped",
		]);
		expect(of("D18").map(key)).toEqual([
			"frames.droppedPct@samsung:churn-static",
			"frames.droppedPct@samsung:input-120",
			"frames.maxPeriodRatio@samsung:churn-static",
			"frames.maxPeriodRatio@samsung:input-120",
		]);
		expect(of("1 Nov first touch").map(key)).toEqual([
			"gestures.frames.droppedPct@samsung:box",
			"gestures.frames.maxPeriodRatio@samsung:box",
			"gestures.frames.maxMs@samsung:box",
		]);
		expect(of("D13").map(key)).toEqual([
			"gestures.frames.droppedPct@iphone:box+box-busy+pinch-rotate",
			"gestures.frames.maxPeriodRatio@iphone:box+box-busy+pinch-rotate",
			"gestures.frames.maxMs@iphone:box+box-busy+pinch-rotate",
		]);
		expect(exceptions).toHaveLength(25);
		for (const entry of exceptions) {
			expect(entry.reason.length).toBeGreaterThan(20);
			expect(entry.reason).not.toContain("\n");
			expect(entry.evidence).toMatch(/SPEC\.md|qa\/runs\//);
		}
	});
	test("the animation-48 family is capped to the first interval, the D1 floors are not", () => {
		const capOfEntry = (entry: GateException) => entry.maxLateIntervals ?? entry.maxMs ?? null;
		for (const entry of exceptions) {
			if (entry.scenarios?.includes("animation-48")) expect([entry.gate, capOfEntry(entry)]).toEqual([entry.gate, 2]);
			else if (entry.decision === "D1") expect([entry.gate, capOfEntry(entry)]).toEqual([entry.gate, null]);
		}
		// the frame cap is a condition on the late-interval entries; no entry caps the longest-frame gate (a cap under its 33 ms bar covers nothing)
		expect(exceptions.filter((entry) => entry.maxMs !== undefined).map((entry) => [entry.gate, entry.decision, entry.maxMs])).toEqual([
			["frames.droppedPct", "D11", 23],
			["frames.droppedPct", "D11", 23],
			["frames.maxPeriodRatio", "D11", 23],
			["frames.maxPeriodRatio", "D11", 23],
			["frames.droppedPct", "D18", 23],
			["frames.droppedPct", "D18", 23],
			["frames.maxPeriodRatio", "D18", 23],
			["frames.maxPeriodRatio", "D18", 23],
		]);
		expect(exceptions.filter((entry) => entry.decision === "D11").map((entry) => [entry.gate, entry.maxLateIntervals, entry.maxMs, entry.device])).toEqual([
			["frames.droppedPct", 4, 23, SAMSUNG],
			["frames.droppedPct", 2, 23, SAMSUNG],
			["frames.maxPeriodRatio", 4, 23, SAMSUNG],
			["frames.maxPeriodRatio", 2, 23, SAMSUNG],
		]);
	});
	test("none is for the emulator", () => {
		expect(exceptions.some((entry) => entry.device === EMULATOR)).toBe(false);
	});
	test("the file is well formed", () => {
		expect(() => checkGatesFile(file)).not.toThrow();
		expect(decisions).toEqual(["D1", "D9", "D11", "D13", "D18", "1 Nov first touch"]);
	});
});

describe("checkExceptions refuses an exception that would excuse more than it names", () => {
	const gates: Gate[] = [
		{ id: "per.scenario", title: "x", unit: "n", metric: "m.*.n", bar: { android: { max: 1 } }, roles: ["phone"] },
		{ id: "plain", title: "x", unit: "n", metric: "m.plain", bar: { android: { max: 1 } } },
	];
	const devices = { phone: { role: "phone" as const }, lab: { role: "lab" as const } };
	const base = { decision: "D9" as const, reason: "one line of why", evidence: "SPEC.md, a section" };
	const check = (exceptions: GateException[]) => checkExceptions({ devices, gates, exceptions });
	test("a well formed table is fine, and no table is fine", () => {
		expect(() => check([{ ...base, gate: "per.scenario", device: "phone", scenarios: ["a", "b"] }, { ...base, gate: "plain", device: "lab" }])).not.toThrow();
		expect(() => checkExceptions({ devices, gates })).not.toThrow();
	});
	test("refuses an unknown decision, gate or device", () => {
		expect(() => check([{ ...base, gate: "plain", device: "phone", decision: "D8" as "D9" }])).toThrow(/unknown decision "D8"/);
		expect(() => check([{ ...base, gate: "nope", device: "phone" }])).toThrow(/gate gates.json does not have/);
		expect(() => check([{ ...base, gate: "plain", device: "tablet" }])).toThrow(/device gates.json does not list/);
	});
	test("refuses a device the gate does not judge", () => {
		expect(() => check([{ ...base, gate: "per.scenario", device: "lab", scenarios: ["a"] }])).toThrow(/does not judge a lab/);
	});
	test("refuses a per-scenario gate without scenarios and a plain gate with them", () => {
		expect(() => check([{ ...base, gate: "per.scenario", device: "phone" }])).toThrow(/must name its scenarios/);
		expect(() => check([{ ...base, gate: "per.scenario", device: "phone", scenarios: [] }])).toThrow(/must name its scenarios/);
		expect(() => check([{ ...base, gate: "plain", device: "phone", scenarios: ["a"] }])).toThrow(/has no scenarios/);
	});
	test("refuses a missing reason or evidence, and a row covered twice", () => {
		expect(() => check([{ ...base, gate: "plain", device: "phone", reason: " " }])).toThrow(/no reason/);
		expect(() => check([{ ...base, gate: "plain", device: "phone", evidence: "" }])).toThrow(/no evidence/);
		expect(() => check([{ ...base, gate: "plain", device: "phone" }, { ...base, gate: "plain", device: "phone" }])).toThrow(/listed twice/);
		expect(() => check([{ ...base, gate: "per.scenario", device: "phone", scenarios: ["a"] }, { ...base, gate: "per.scenario", device: "phone", scenarios: ["b", "a"] }])).toThrow(/scenario a is covered twice/);
		expect(() => check([{ ...base, gate: "per.scenario", device: "phone", scenarios: ["a", "a"] }])).toThrow(/names a scenario twice/);
	});
	test("a cap fits the metric its gate reads, and is a whole number or a positive time", () => {
		const capped: Gate[] = [
			{ id: "late", title: "x", unit: "n", metric: "f.*.lateIntervals", bar: { android: { max: 1 } }, roles: ["phone"] },
			{ id: "long", title: "x", unit: "ms", metric: "f.*.maxMs", bar: { android: { max: 33 } }, roles: ["phone"] },
		];
		const ok = (entry: Partial<GateException>) => checkExceptions({ devices, gates: capped, exceptions: [{ ...base, gate: "late", device: "phone", scenarios: ["a"], ...entry }] });
		expect(() => ok({ maxLateIntervals: 2 })).not.toThrow();
		expect(() => ok({ gate: "long", maxMs: 40 })).not.toThrow();
		// a frame cap on a late-interval gate is a condition on the scenario's longest frame
		expect(() => ok({ maxMs: 40 })).not.toThrow();
		expect(() => ok({ gate: "long", maxLateIntervals: 2 })).toThrow(/maxLateIntervals caps a gate that reads \*\.lateIntervals/);
		expect(() => ok({ maxLateIntervals: 1.5 })).toThrow(/whole number/);
		expect(() => ok({ maxLateIntervals: -1 })).toThrow(/whole number/);
		expect(() => ok({ gate: "long", maxMs: 0 })).toThrow(/positive/);
		expect(() => checkExceptions({ devices, gates, exceptions: [{ ...base, gate: "plain", device: "phone", maxMs: 5 }] })).toThrow(/maxMs caps a gate that reads \*\.maxMs or \*\.lateIntervals/);
	});
	test("a capped entry covers a row only while the measured value is within the cap, and a missing value is not covered", () => {
		const entry: GateException = { ...base, gate: "late", device: "phone", scenarios: ["a"], maxLateIntervals: 2 };
		const at = (measured: number | null, metric = "f.a.lateIntervals") => matchException([entry], { gate: "late", device: "phone", scenario: "a", metric, measured });
		expect(at(2)).toBe(entry);
		expect(at(3)).toBeUndefined();
		expect(at(null)).toBeUndefined();
		// a cap is for the metric it names: another metric of the same gate is uncapped
		expect(at(99, "f.a.other")).toBe(entry);
		const timed: GateException = { ...base, gate: "long", device: "phone", scenarios: ["a"], maxMs: 40 };
		expect(matchException([timed], { gate: "long", device: "phone", scenario: "a", metric: "f.a.maxMs", measured: 40 })).toBe(timed);
		expect(matchException([timed], { gate: "long", device: "phone", scenario: "a", metric: "f.a.maxMs", measured: 41 })).toBeUndefined();
	});
	test("a frame cap on the longest frame covers a miss up to it: 34 to 40 ms, not 41", () => {
		const long: Gate = { id: "long", title: "x", unit: "ms", metric: "f.*.maxMs", bar: { android: { max: 33 } }, roles: ["phone"] };
		const timed: GateException = { ...base, gate: "long", device: "phone", scenarios: ["a"], maxMs: 40 };
		const at = (ms: number) => evaluate([long], { phone: { platform: "android", role: "phone", metrics: { "f.a.maxMs": ms } } }, "android", [timed]).map((row) => row.verdict);
		expect(at(33)).toEqual(["pass"]);
		expect(at(34)).toEqual(["exception"]);
		expect(at(40)).toEqual(["exception"]);
		expect(at(41)).toEqual(["fail"]);
	});
	test("matchException needs the gate, the device and, for a per-scenario gate, the scenario", () => {
		const entry: GateException = { ...base, gate: "per.scenario", device: "phone", scenarios: ["a"] };
		expect(matchException([entry], { gate: "per.scenario", device: "phone", scenario: "a" })).toBe(entry);
		expect(matchException([entry], { gate: "per.scenario", device: "phone", scenario: "b" })).toBeUndefined();
		expect(matchException([entry], { gate: "per.scenario", device: "phone", scenario: null })).toBeUndefined();
		expect(matchException([entry], { gate: "per.scenario", device: "lab", scenario: "a" })).toBeUndefined();
		expect(matchException([entry], { gate: "plain", device: "phone", scenario: "a" })).toBeUndefined();
		expect(matchException([entry], { gate: "per.scenario", device: null, scenario: "a" })).toBeUndefined();
		expect(matchException(undefined, { gate: "plain", device: "phone", scenario: null })).toBeUndefined();
	});
	test("checkGatesFile runs the same checks and the `also` star count check", () => {
		const table = (patch: Partial<GatesFile>): GatesFile => ({ version: 1, devices: { phone: { role: "phone", name: "P", runs: ["lab"] } }, scenarios: { android: [], ios: [] }, smoke: { modules: { android: ["a"], ios: ["a"] }, skips: { android: [], ios: [] } }, gates, ...patch });
		expect(() => checkGatesFile(table({ exceptions: [{ ...base, gate: "per.scenario", device: "phone" }] }))).toThrow(/must name its scenarios/);
		expect(() => checkGatesFile(table({ gates: [{ ...(gates[0] as Gate), also: { metric: "m.plain", unit: "%" } }] }))).toThrow(/as many `\*`/);
		expect(() => checkGatesFile(table({ exceptions: [{ ...base, gate: "per.scenario", device: "phone", scenarios: ["a"] }] }))).not.toThrow();
	});
});
