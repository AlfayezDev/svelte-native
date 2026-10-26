import { describe, expect, test } from "bun:test";
import { labRunFrom } from "../lib/lab-run.ts";
import { bootMetrics, deviceMetrics, labMetrics } from "../lib/metrics.ts";
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
	return { schema: 1, kind: "lab", startedAt: "", finishedAt: "", source, device, app, runs };
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

describe("labMetrics", () => {
	const metrics = labMetrics(labFile(run()));
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
		const combined = labMetrics(labFile(run(), worse));
		expect(combined["lab.runs"]).toBe(2);
		expect(combined["frames.idle.droppedPct"]).toBe(2.5);
		expect(combined["frames.idle.maxMs"]).toBe(41);
		expect(combined["lab.engineWarnings"]).toBe(6);
	});
	test("a scenario missing from one run is a missing measurement", () => {
		const partial = run();
		partial.scenarios = partial.scenarios.filter((scenario) => scenario.name !== "modal-8");
		expect(labMetrics(labFile(run(), partial))["frames.modal-8.droppedPct"]).toBeNull();
	});
	test("a scenario the lab announced but never measured is null", () => {
		const crashed = run();
		crashed.scenarios = crashed.scenarios.filter((scenario) => scenario.name !== "input-120");
		expect(labMetrics(labFile(crashed))["frames.input-120.droppedPct"]).toBeNull();
	});
	test("a run with no checks line counts zero passed", () => {
		const noChecks = run();
		noChecks.checks = null;
		expect(labMetrics(labFile(noChecks))["lab.checks.passed"]).toBe(0);
	});
	test("no runs, no metrics", () => {
		expect(labMetrics(labFile())).toEqual({});
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

describe("deviceMetrics", () => {
	test("fatals and warnings combine the lab and the boot run", () => {
		const metrics = deviceMetrics(
			labFile(run()),
			bootFile([launch(1, 700, { engineWarnings: 2, crashes: 1 })], []),
		);
		expect(metrics["log.fatals"]).toBe(1);
		expect(metrics["log.engineWarnings"]).toBe(5);
	});
	test("with only a boot run there are no lab metrics", () => {
		const metrics = deviceMetrics(null, bootFile([launch(1, 700)], []));
		expect(metrics["lab.checks.passed"]).toBeUndefined();
		expect(metrics["log.fatals"]).toBe(0);
	});
	test("with nothing run there are no metrics", () => {
		expect(deviceMetrics(null, null)).toEqual({});
	});
});
