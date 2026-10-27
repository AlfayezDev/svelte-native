import { describe, expect, test } from "bun:test";
import { labRunFrom } from "../lib/lab-run.ts";
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
	test("a scenario missing from one run is a missing measurement", () => {
		const partial = run();
		partial.scenarios = partial.scenarios.filter((scenario) => scenario.name !== "modal-8");
		expect(labMetrics(labFile(run(), partial), pinned)["frames.modal-8.droppedPct"]).toBeNull();
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
