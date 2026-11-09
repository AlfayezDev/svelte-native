import { describe, expect, test } from "bun:test";
import { describeRun, labRunFrom } from "../lib/lab-run.ts";
import { bootMetrics, deviceMetrics, labMetrics, missingScenarios } from "../lib/metrics.ts";
import { evaluate, type GatesFile } from "../lib/gates.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppInfo, BootFile, DeviceInfo, LabFile, LabRun, Launch } from "../lib/types.ts";
import { sample } from "./sample.ts";

const pkg = "io.rasheed.svelteqa";
const device: DeviceInfo = {
	serial: "localhost:5555",
	platform: "android",
	kind: "emulator",
	model: "sdk_gphone64_x86_64",
	osVersion: "16",
	sdk: 36,
	abi: "x86_64",
	refreshHz: 60,
};
const app: AppInfo = {
	package: pkg,
	versionName: "0.1.0",
	versionCode: 1,
	lastUpdateTime: null,
	installedSha256: null,
	apk: null,
};
const source = { commit: "abc1234", dirty: false };

/** The scenarios of the full run as the sample log has them (the names `gates.json` pins for a real device). */
const pinned = [
	"idle",
	"animation-48",
	"animation-48-square",
	"animation-48-translate",
	"animation-48-css",
	"churn-static",
	"churn-animated",
	"list-300",
	"list-300-clipped",
	"list-300-raw",
	"list-300-virtual",
	"input-120",
	"modal-8",
	"navigation-8",
];

function run(text = sample("lab-run.log")): LabRun {
	return labRunFrom(
		{
			text,
			matched: true,
			startedAt: new Date("2026-10-25T18:39:00Z"),
			durationMs: 150_000,
			logFile: "runs/x.log",
		},
		pkg,
		true,
	);
}

function labFile(...runs: LabRun[]): LabFile {
	return { schema: 1, kind: "lab", startedAt: "", finishedAt: "", source, device, app, run: "checks,quick", runs };
}

describe("labRunFrom", () => {
	test("assembles checks, scenarios, expected names and faults from one capture", () => {
		const result = run();
		expect(result.complete).toBe(true);
		expect(result.checks?.passed).toBe(28);
		expect(result.scenarios).toHaveLength(15);
		expect(result.expectedScenarios).toHaveLength(14);
		expect(result.engineWarnings).toHaveLength(3);
		expect(result.boot?.total).toBe(201);
	});
	test("a run another app interrupted is incomplete even when the lab's last line was logged, and says by whom", () => {
		const completed = `${sample("lab-run.log")}\n${sample("lab-interrupted.log")}`;
		const result = run(completed);
		expect(result.complete).toBe(false);
		expect(result.interrupted?.by).toBe("com.google.android.cellbroadcastreceiver/com.android.cellbroadcastreceiver.CellBroadcastAlertDialog");
		expect(result.interrupted?.at).toBe("10-27 14:49:13.668");
		expect(describeRun(result).some((line) => line.includes("interrupted by com.google.android.cellbroadcastreceiver"))).toBe(true);
		expect(run().interrupted).toBeUndefined();
		const metrics = labMetrics(labFile(run(), result), []);
		expect(metrics["lab.runs"]).toBe(1);
		expect(metrics["lab.incompleteRuns"]).toBe(1);
		expect(metrics["lab.interruptedRuns"]).toBe(1);
	});
	test("a lab whose completion line never came is incomplete", () => {
		const result = labRunFrom(
			{
				text: sample("lab-run.log"),
				matched: false,
				startedAt: new Date(),
				durationMs: 1,
				logFile: "x",
			},
			pkg,
			true,
		);
		expect(result.complete).toBe(false);
	});
});

const gatesFile = JSON.parse(readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8")) as GatesFile;
const ios: DeviceInfo = { ...device, serial: "E74A", platform: "ios", kind: "device", model: "iPhone SE (3rd generation)", sdk: null, abi: "arm64" };
const verdictOf = (id: string, platform: "android" | "ios", metrics: Record<string, number | string | null>) =>
	evaluate(
		gatesFile.gates.filter((gate) => gate.id === id),
		{ device: { platform, metrics } },
		platform,
	)[0]?.verdict;

describe("a [Svelte stress] line logcat cut", () => {
	/** The sample log with the line of `list-300-virtual` replaced by one logcat cut at 4045 characters of the message (26 October's lab logs hold such lines). */
	const cutLog = () => {
		const lines = sample("lab-run.log").split("\n");
		const index = lines.findIndex((entry) => entry.includes("'[Svelte stress]', '") && entry.includes('"name":"list-300-virtual"'));
		const rows = Array.from({ length: 500 }, (_, row) => [`row ${row}`, row, row % 2]);
		const whole = `10-25 18:39:47.427  4242  4290 I ReactNativeJS: '[Svelte stress]', '${JSON.stringify({ name: "list-300-virtual", verdict: "pass", summary: "300 rows", detail: { rows } })}'`;
		lines[index] = whole.slice(0, whole.indexOf("'[Svelte stress]'") + 4045);
		return lines.join("\n");
	};

	test("the run is still recorded: the cut line is on the run, the other scenarios are read, and nothing throws", () => {
		const result = run(cutLog());
		expect(result.scenarios).toHaveLength(14);
		expect(result.scenarios.some((scenario) => scenario.name === "list-300-virtual")).toBe(false);
		expect(result.complete).toBe(true);
		expect(result.unparsedLines).toHaveLength(1);
		expect(result.unparsedLines?.[0]).toContain("the message is 4045 characters");
		expect(result.unparsedLines?.[0]).toContain('"name":"list-300-virtual"');
		expect(result.unparsedLines?.[0]).toContain(" [...] ");
		expect(describeRun(result).filter((entry) => entry.includes("UNREADABLE LINE"))).toHaveLength(1);
		expect(run().unparsedLines).toBeUndefined();
	});
	test("a completion line that is cut leaves the run incomplete and says so", () => {
		const lines = sample("lab-run.log").split("\n");
		const index = lines.findIndex((entry) => entry.includes("'[Svelte stress] complete'"));
		lines[index] = (lines[index] ?? "").slice(0, 200);
		const result = run(lines.join("\n"));
		expect(result.complete).toBe(false);
		expect(result.unparsedLines).toHaveLength(1);
		expect(result.unparsedLines?.[0]).toMatch(/^malformed \[Svelte stress\] complete line/);
	});
	test("the gates read fail, not a file that was never written: unread lines, and the scenario they carried missing", () => {
		const metrics = labMetrics(labFile(run(cutLog())), pinned);
		expect(metrics["lab.unparsedLines"]).toBe(1);
		expect(verdictOf("lab.unparsed", "android", metrics)).toBe("fail");
		expect(metrics["lab.scenarios.missing"]).toBe(1);
		expect(verdictOf("lab.scenarios.missing", "android", metrics)).toBe("fail");
		expect(metrics["frames.list-300-virtual.droppedPct"]).toBeNull();
		const clean = labMetrics(labFile(run()), pinned);
		expect(clean["lab.unparsedLines"]).toBe(0);
		expect(verdictOf("lab.unparsed", "android", clean)).toBe("pass");
		expect(verdictOf("lab.unparsed", "ios", clean)).toBe("pass");
	});
	test("a lab file recorded before the field has none, and the repeated runs add up", () => {
		const old = run();
		expect(labMetrics(labFile(old), pinned)["lab.unparsedLines"]).toBe(0);
		expect(labMetrics(labFile(run(cutLog()), run(cutLog()), old), pinned)["lab.unparsedLines"]).toBe(2);
	});
});

describe("the pinned scenarios of the full run", () => {
	const only = (...names: string[]) => {
		const partial = run();
		partial.scenarios = partial.scenarios.filter((scenario) => names.includes(scenario.name));
		partial.expectedScenarios = partial.expectedScenarios.filter((name) => names.includes(name));
		return partial;
	};
	test("`lab --run checks,list-300-virtual` is not the full run: the scenarios it never ran are missing, and its frame gates cannot pass without them", () => {
		const metrics = labMetrics(labFile(only("list-300-virtual")), gatesFile.scenarios.android);
		expect(metrics["lab.scenarios.missing"]).toBe(16);
		expect(verdictOf("lab.scenarios.missing", "android", metrics)).toBe("fail");
		expect(metrics["frames.animation-48.droppedPct"]).toBeNull();
		expect(verdictOf("frames.maxMs", "android", metrics)).toBe("not measured");
		// the same file with nothing pinned is what satisfied every lab gate before
		expect(labMetrics(labFile(only("list-300-virtual")), [])["lab.scenarios.missing"]).toBe(0);
	});
	test("a run with every pinned scenario passes the gate, and one missing from any of the repeated runs fails it", () => {
		const everything = pinned;
		expect(labMetrics(labFile(run()), everything)["lab.scenarios.missing"]).toBe(0);
		expect(verdictOf("lab.scenarios.missing", "android", labMetrics(labFile(run()), everything))).toBe("pass");
		const lacking = run();
		lacking.scenarios = lacking.scenarios.filter((scenario) => scenario.name !== "modal-8");
		expect(missingScenarios([run(), lacking], everything)).toEqual(["modal-8"]);
		expect(labMetrics(labFile(run(), lacking), everything)["lab.scenarios.missing"]).toBe(1);
	});
	test("a pinned scenario no run has still gets frame metrics, as null, so the wildcard gates see it", () => {
		const metrics = labMetrics(labFile(run()), [...pinned, "tabs-8"]);
		expect(metrics["frames.tabs-8.droppedPct"]).toBeNull();
		expect(metrics["lab.scenarios.missing"]).toBe(1);
	});
	test("no lab file, no metric: the gate is not measured", () => {
		expect(verdictOf("lab.scenarios.missing", "android", deviceMetrics(null, null, pinned))).toBe("not measured");
	});
});

describe("labMetrics", () => {
	const metrics = labMetrics(labFile(run()), pinned);
	test("checks, runs, failures and log counts", () => {
		expect(metrics["lab.runs"]).toBe(1);
		expect(metrics["lab.incompleteRuns"]).toBe(0);
		expect(metrics["lab.checks.passed"]).toBe(28);
		expect(metrics["lab.checks.failed"]).toBe(0);
		expect(metrics["lab.scenarios.failed"]).toBe(11);
		expect(metrics["lab.fatals"]).toBe(0);
		expect(metrics["lab.engineWarnings"]).toBe(3);
	});
	test("frame metrics per scenario, none for the informational warm-up", () => {
		expect(metrics["frames.idle.droppedPct"]).toBe(0);
		expect(metrics["frames.idle.maxMs"]).toBe(19);
		expect(metrics["frames.animation-48.droppedPct"]).toBeCloseTo(16.2304, 3);
		expect(metrics["frames.animation-48-translate.maxPeriodRatio"]).toBeCloseTo(
			77 / 16.666666666666668,
			6,
		);
		expect(Object.keys(metrics).filter((key) => key.startsWith("frames.warm-up"))).toEqual([]);
		expect(Object.keys(metrics).filter((key) => key.endsWith(".droppedPct"))).toHaveLength(14);
	});
	test("the virtual list's mount to layout", () => {
		expect(metrics["list.virtual300.mountMs"]).toBeCloseTo(20.7593, 3);
	});
	test("the window and hot mounts are null until a run reports them, then the worst of the runs", () => {
		expect(metrics["list.virtual300.windowMs"]).toBeNull();
		expect(metrics["list.virtual300.hotMountMs"]).toBeNull();
		const first = run();
		const second = run();
		for (const [file, window, hot] of [[first, 17.2, 2.4], [second, 19.9, 3.1]] as const) {
			const list = file.scenarios.find((scenario) => scenario.name === "list-300-virtual");
			if (!list) throw new Error("sample has no list-300-virtual");
			list.detail = { ...list.detail, windowMs: window, hotMountMs: hot };
		}
		const combined = labMetrics(labFile(first, second), pinned);
		expect(combined["list.virtual300.windowMs"]).toBe(19.9);
		expect(combined["list.virtual300.hotMountMs"]).toBe(3.1);
		expect(combined["list.virtual300.coldMountMs"]).toBeNull();
	});
	test("the teardown of a list is reported per scenario, as the worst of the runs", () => {
		const first = run();
		const second = run();
		for (const [file, value] of [[first, 38], [second, 52]] as const) {
			const list = file.scenarios.find((scenario) => scenario.name === "list-300");
			if (!list) throw new Error("sample has no list-300");
			list.detail = { ...list.detail, teardownMaxMs: value };
		}
		const combined = labMetrics(labFile(first, second), pinned);
		expect(combined["teardown.list-300.maxFrameMs"]).toBe(52);
		expect(Object.keys(combined).filter((key) => key.startsWith("teardown."))).toEqual(["teardown.list-300.maxFrameMs"]);
	});
	test("repeated runs report the worst of each", () => {
		const worse = run();
		const idle = worse.scenarios.find((scenario) => scenario.name === "idle");
		if (!idle?.frames) throw new Error("sample has no idle frames");
		idle.frames = { ...idle.frames, droppedPct: 2.5, max: 41 };
		const combined = labMetrics(labFile(run(), worse), pinned);
		expect(combined["lab.runs"]).toBe(2);
		expect(combined["frames.idle.droppedPct"]).toBe(2.5);
		expect(combined["frames.idle.maxMs"]).toBe(41);
		expect(combined["lab.engineWarnings"]).toBe(6);
	});
	test("the late intervals of a scenario are the worst run's, counted exactly from the recorded count and percentage", () => {
		const withLate = (late: number | null) => {
			const copy = run();
			const idle = copy.scenarios.find((scenario) => scenario.name === "idle");
			if (!idle?.frames) throw new Error("sample has no idle frames");
			// The lab records 100 * dropped / count unrounded; a rounded percentage (an older record) holds no exact count.
			idle.frames = { ...idle.frames, count: 183, droppedPct: late === null ? 0.5 : (100 * late) / 183 };
			return copy;
		};
		expect(labMetrics(labFile(withLate(0)), pinned)["frames.idle.lateIntervals"]).toBe(0);
		expect(labMetrics(labFile(withLate(1), withLate(0)), pinned)["frames.idle.lateIntervals"]).toBe(1);
		expect(labMetrics(labFile(withLate(1), withLate(2), withLate(0)), pinned)["frames.idle.lateIntervals"]).toBe(2);
		expect(labMetrics(labFile(withLate(1), withLate(null)), pinned)["frames.idle.lateIntervals"]).toBeNull();
	});
	test("every run's figures are listed per scenario for D10, and a run the record cannot count exactly leaves the list out", () => {
		const withLate = (late: number, max: number) => {
			const copy = run();
			const idle = copy.scenarios.find((scenario) => scenario.name === "idle");
			if (!idle?.frames) throw new Error("sample has no idle frames");
			idle.frames = { ...idle.frames, count: 183, droppedPct: (100 * late) / 183, max, periodMs: 11.11 };
			return copy;
		};
		const listed = labMetrics(labFile(withLate(1, 21), withLate(0, 14), withLate(3, 40)), pinned)["frames.idle.runs"] as string;
		expect(JSON.parse(listed)).toEqual([
			{ lateIntervals: 1, maxMs: 21, droppedPct: 100 / 183, maxPeriodRatio: 21 / 11.11 },
			{ lateIntervals: 0, maxMs: 14, droppedPct: 0, maxPeriodRatio: 14 / 11.11 },
			{ lateIntervals: 3, maxMs: 40, droppedPct: 300 / 183, maxPeriodRatio: 40 / 11.11 },
		]);
		// the worst-run metrics stay what they were
		expect(labMetrics(labFile(withLate(1, 21), withLate(0, 14), withLate(3, 40)), pinned)["frames.idle.lateIntervals"]).toBe(3);
		expect(labMetrics(labFile(withLate(1, 21), withLate(0, 14), withLate(3, 40)), pinned)["frames.idle.maxMs"]).toBe(40);
		const inexact = withLate(1, 21);
		const idle = inexact.scenarios.find((scenario) => scenario.name === "idle");
		if (!idle?.frames) throw new Error("sample has no idle frames");
		idle.frames = { ...idle.frames, droppedPct: 0.5 };
		expect(labMetrics(labFile(withLate(1, 21), inexact), pinned)["frames.idle.runs"]).toBeNull();
		const partial = run();
		partial.scenarios = partial.scenarios.filter((scenario) => scenario.name !== "idle");
		expect(labMetrics(labFile(withLate(1, 21), partial), pinned)["frames.idle.runs"]).toBeNull();
	});
	test("which scenarios each run's lab marked failed are listed, split into frame failures and the rest", () => {
		const base = run();
		const failedRuns = (file: LabFile): { frame: string[]; other: number }[] => JSON.parse(labMetrics(file, pinned)["lab.scenarios.failedRuns"] as string);
		const [first] = failedRuns(labFile(base));
		expect((first?.frame.length ?? 0) + (first?.other ?? 0)).toBe(labMetrics(labFile(base), pinned)["lab.scenarios.failed"] as number);
		const changed = run();
		for (const scenario of changed.scenarios) if (scenario.verdict === "fail") scenario.verdict = "pass";
		const churn = changed.scenarios.find((scenario) => scenario.name === "churn-static");
		const tiles = changed.scenarios.find((scenario) => scenario.name === "animation-48");
		if (!churn?.frames || !tiles?.frames) throw new Error("sample lacks scenarios");
		churn.verdict = "fail";
		churn.frames = { ...churn.frames, smooth: false };
		tiles.verdict = "fail";
		tiles.frames = { ...tiles.frames, smooth: true };
		const scrolling = changed.scenarios.find((scenario) => scenario.name === "list-300");
		if (!scrolling) throw new Error("sample lacks list-300");
		// a failure with no frame record at all is not a frame failure either
		scrolling.verdict = "fail";
		scrolling.frames = null;
		const runs = failedRuns(labFile(changed, run()));
		expect(runs[0]?.frame).toEqual(["churn-static"]);
		expect(runs[0]?.other).toBe(2);
		expect(runs).toHaveLength(2);
		expect(labMetrics(labFile(changed), pinned)["lab.scenarios.failed"]).toBe(3);
	});
	test("a scenario missing from one run is a missing measurement", () => {
		const partial = run();
		partial.scenarios = partial.scenarios.filter((scenario) => scenario.name !== "modal-8");
		expect(labMetrics(labFile(run(), partial), pinned)["frames.modal-8.droppedPct"]).toBeNull();
		expect(labMetrics(labFile(run(), partial), pinned)["frames.modal-8.lateIntervals"]).toBeNull();
	});
	test("a scenario the lab announced but never measured is null", () => {
		const crashed = run();
		crashed.scenarios = crashed.scenarios.filter((scenario) => scenario.name !== "input-120");
		expect(labMetrics(labFile(crashed), pinned)["frames.input-120.droppedPct"]).toBeNull();
	});
	test("a run with no checks line counts zero passed", () => {
		const noChecks = run();
		noChecks.checks = null;
		expect(labMetrics(labFile(noChecks), pinned)["lab.checks.passed"]).toBe(0);
	});
	test("no runs, no metrics", () => {
		expect(labMetrics(labFile(), pinned)).toEqual({});
	});
});

function launch(index: number, displayMs: number | null, extra: Partial<Launch> = {}): Launch {
	return {
		index,
		displayMs,
		runningMainMs: displayMs === null ? null : displayMs - 100,
		displayedReportedMs: displayMs,
		totalTimeMs: displayMs === null ? null : displayMs + 40,
		jsMarks: displayMs === null ? null : { total: 150 },
		crashes: 0,
		jsErrors: 0,
		engineWarnings: 0,
		error: displayMs === null ? "no pair" : null,
		...extra,
	};
}

function bootFile(warm: Launch[], cold: Launch[]): BootFile {
	return {
		schema: 1,
		kind: "boot",
		startedAt: "",
		finishedAt: "",
		source,
		device,
		app,
		definition: { warm: "", cold: "", coldIdleSeconds: 20 },
		warm,
		cold,
		logFile: "",
	};
}

describe("bootMetrics", () => {
	const warm = [700, 720, 710, 690, 730, 705, 715, 725, 695, 900].map((ms, index) =>
		launch(index + 1, ms),
	);
	const cold = [800, 820].map((ms, index) => launch(index + 1, ms));
	const metrics = bootMetrics(bootFile(warm, cold));
	test("distribution of Start proc to Displayed", () => {
		expect(metrics["boot.warm.samples"]).toBe(10);
		expect(metrics["boot.warm.p50"]).toBe(710);
		expect(metrics["boot.warm.p90"]).toBe(730);
		expect(metrics["boot.warm.max"]).toBe(900);
		expect(metrics["boot.cold.p90"]).toBe(820);
		expect(metrics["boot.warm.jsTotal.p90"]).toBe(150);
	});
	test("a launch that failed to produce a pair counts as an attempt, not a sample", () => {
		const withFailure = bootMetrics(bootFile([launch(1, 700), launch(2, null)], []));
		expect(withFailure["boot.warm.attempts"]).toBe(2);
		expect(withFailure["boot.warm.samples"]).toBe(1);
	});
	test("launches without a display time are counted as failed, per series, and gated", () => {
		const metrics = bootMetrics(bootFile([launch(1, 700), launch(2, null), launch(3, null)], [launch(1, 800)]));
		expect([metrics["boot.warm.failed"], metrics["boot.cold.failed"]]).toEqual([2, 0]);
		expect(verdictOf("boot.warm.failed", "ios", metrics)).toBe("fail");
		expect(verdictOf("boot.cold.failed", "ios", metrics)).toBe("pass");
		expect(verdictOf("boot.warm.failed", "android", bootMetrics(bootFile([], [])))).toBe("not measured");
	});
	test("the [Svelte boot] total has its own sample count: launches that logged it", () => {
		const thin = [...Array.from({ length: 29 }, (_, index) => launch(index + 1, 700)), launch(30, 700, { jsMarks: null })];
		const metrics = bootMetrics(bootFile(thin, []));
		expect(metrics["boot.warm.samples"]).toBe(30);
		expect(metrics["boot.warm.jsTotal.samples"]).toBe(29);
		expect(verdictOf("boot.js.samples", "android", metrics)).toBe("fail");
		const enough = bootMetrics(bootFile(Array.from({ length: 30 }, (_, index) => launch(index + 1, 700)), []));
		expect(verdictOf("boot.js.samples", "ios", enough)).toBe("pass");
	});
	test("a series that was not run has no keys, so its gates are not measured", () => {
		expect(
			Object.keys(bootMetrics(bootFile(warm, []))).filter((key) => key.startsWith("boot.cold")),
		).toEqual([]);
	});
	test("faults and warnings add up across every launch", () => {
		const noisy = bootMetrics(
			bootFile(
				[launch(1, 700, { crashes: 1, jsErrors: 2, engineWarnings: 3 })],
				[launch(1, 800, { engineWarnings: 1 })],
			),
		);
		expect(noisy["boot.fatals"]).toBe(3);
		expect(noisy["boot.engineWarnings"]).toBe(4);
	});
});

describe("JavaScript errors on iOS", () => {
	const iosLab = (jsErrorCount: number | null | undefined, crashes: string[] = []): LabFile => {
		const entry = run();
		entry.jsErrors = [];
		entry.crashes = crashes;
		if (jsErrorCount === undefined) delete entry.jsErrorCount;
		else entry.jsErrorCount = jsErrorCount;
		return { ...labFile(entry), device: ios };
	};
	test("the app's reported count is counted into the fatals the way Android counts its log lines", () => {
		expect(labMetrics(iosLab(3), pinned)["lab.fatals"]).toBe(3);
		expect(labMetrics(iosLab(0), pinned)["lab.fatals"]).toBe(0);
		expect(labMetrics(iosLab(2, ["the app was not running"]), pinned)["lab.fatals"]).toBe(3);
	});
	test("an app that reports none leaves the fatals not measured, not zero", () => {
		expect(labMetrics(iosLab(null), pinned)["lab.fatals"]).toBeNull();
		expect(labMetrics(iosLab(undefined), pinned)["lab.fatals"]).toBeNull();
		expect(verdictOf("log.fatals", "ios", deviceMetrics(iosLab(null), null, pinned))).toBe("not measured");
	});
	test("a dead app is a fatal whether or not it reported", () => {
		expect(labMetrics(iosLab(null, ["the app was not running"]), pinned)["lab.fatals"]).toBe(1);
	});
	test("Android's count still comes from its log lines, and a lab file from before the count was recorded keeps working", () => {
		const entry = run();
		entry.jsErrors = ["a", "b"];
		delete entry.jsErrorCount;
		expect(labMetrics(labFile(entry), pinned)["lab.fatals"]).toBe(2);
	});
	test("the sum of the lab and the boot run is not measured when either is not, and a run that was not made adds nothing", () => {
		const reported = iosLab(0);
		const silent = bootFile([launch(1, 150, { jsErrors: null })], []);
		expect(deviceMetrics(reported, silent, pinned)["log.fatals"]).toBeNull();
		const counted = bootFile([launch(1, 150, { jsErrors: 1 })], []);
		expect(deviceMetrics(reported, counted, pinned)["log.fatals"]).toBe(1);
		expect(deviceMetrics(null, counted, pinned)["log.fatals"]).toBe(1);
		expect(deviceMetrics(null, silent, pinned)["log.fatals"]).toBeNull();
	});
	test("boot launches count the reported errors, and a launch that crashed counts even without a report", () => {
		expect(bootMetrics(bootFile([launch(1, 150, { jsErrors: 2 })], []))["boot.fatals"]).toBe(2);
		expect(bootMetrics(bootFile([launch(1, null, { jsErrors: null, crashes: 1 })], []))["boot.fatals"]).toBe(1);
		expect(bootMetrics(bootFile([launch(1, null, { jsErrors: null })], []))["boot.fatals"]).toBeNull();
	});
});

describe("deviceMetrics", () => {
	test("fatals and warnings combine the lab and the boot run", () => {
		const metrics = deviceMetrics(
			labFile(run()),
			bootFile([launch(1, 700, { engineWarnings: 2, crashes: 1 })], []),
			pinned,
		);
		expect(metrics["log.fatals"]).toBe(1);
		expect(metrics["log.engineWarnings"]).toBe(5);
	});
	test("with only a boot run there are no lab metrics", () => {
		const metrics = deviceMetrics(null, bootFile([launch(1, 700)], []), pinned);
		expect(metrics["lab.checks.passed"]).toBeUndefined();
		expect(metrics["log.fatals"]).toBe(0);
	});
	test("with nothing run there are no metrics", () => {
		expect(deviceMetrics(null, null, pinned)).toEqual({});
	});
});
