import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, type GatesFile } from "../lib/gates.ts";
import { deviceMetrics } from "../lib/metrics.ts";
import { latestRunFiles } from "../lib/runs.ts";
import type {
	AppInfo,
	ColdStart,
	CrashesFile,
	DeviceInfo,
	JsSample,
	MemSample,
	SoakFile,
	SuiteRun,
} from "../lib/types.ts";
import { parseSoakSamples } from "../soak/log.ts";
import { crashMetrics, idleFloors, soakMetrics } from "../soak/metrics.ts";
import { sample } from "./sample.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

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
	package: "io.rasheed.svelteqa",
	versionName: "0.1.0",
	versionCode: 1,
	lastUpdateTime: null,
	installedSha256: null,
	apk: null,
};
const source = { commit: "abc1234", dirty: false };

function mem(
	tag: MemSample["tag"],
	atMs: number,
	nativeAllocKb: number,
	extra: Partial<MemSample> = {},
): MemSample {
	return {
		tag,
		atMs,
		pid: 4197,
		nativePssKb: nativeAllocKb + 4000,
		nativeAllocKb,
		nativeSizeKb: nativeAllocKb + 9000,
		dalvikPssKb: 6000,
		dalvikAllocKb: 5000,
		totalPssKb: 100000,
		views: 60,
		viewRootImpls: 1,
		activities: 1,
		appContexts: 5,
		...extra,
	};
}

/** The captured series (JS heap 5.76 MB at both windows, 93 views alive, 128 pooled) with process samples for each window. */
function soakFile(overrides: Partial<SoakFile> = {}): SoakFile {
	return {
		schema: 1,
		kind: "soak",
		startedAt: "2026-10-26T09:03:00Z",
		finishedAt: "2026-10-26T09:05:00Z",
		source,
		device,
		app,
		definition: "",
		minutesRequested: 1,
		parts: [],
		complete: true,
		js: parseSoakSamples(sample("soak-run.log")),
		memory: [
			mem("baseline", 40_000, 50_000),
			mem("baseline", 42_000, 50_400),
			mem("baseline", 44_000, 50_200),
			mem("series", 60_000, 70_000),
			mem("final", 90_000, 51_000),
			mem("final", 92_000, 51_400),
			mem("final", 94_000, 51_200),
		],
		crashes: [],
		jsErrors: [],
		engineWarnings: [],
		metrics: {},
		logFile: "runs/x.log",
		...overrides,
	};
}

function withJs(edit: (samples: JsSample[]) => void): JsSample[] {
	const samples = parseSoakSamples(sample("soak-run.log"));
	edit(samples);
	return samples;
}

describe("soakMetrics", () => {
	const metrics = soakMetrics(soakFile());
	test("JS growth is the final window's heap over the baseline window's, both collected", () => {
		expect(metrics["memory.js.growthPct"]).toBe(0);
	});
	test("native growth uses live malloc bytes, medians of three, and heap growth is the worse of JS and native", () => {
		// medians: 50200 -> 51200 = +1.99 %
		expect(metrics["memory.native.growthPct"]).toBeCloseTo(1.99, 2);
		expect(metrics["memory.heapGrowthPct"]).toBeCloseTo(1.99, 2);
		expect(metrics["memory.native.pssGrowthPct"]).toBeCloseTo(
			((55_200 - 54_200) / 54_200) * 100,
			1,
		);
	});
	test("the worse of the two wins when the JS heap grew", () => {
		const grown = withJs((samples) => {
			for (const entry of samples)
				if (entry.phase === "final" && entry.heap)
					entry.heap = { ...entry.heap, allocated: entry.heap.allocated * 1.1 };
		});
		const result = soakMetrics(soakFile({ js: grown }));
		expect(result["memory.js.growthPct"]).toBeCloseTo(10, 4);
		expect(result["memory.heapGrowthPct"]).toBeCloseTo(10, 4);
	});
	test("the idle floors over time give a slope: the baseline, each two-minute checkpoint and the final window", () => {
		// 50.2 MB at 42 s, 51.2 MB at 92 s: 1000 KB over 50 s
		expect(metrics["memory.native.slopeKbPerMin"]).toBeCloseTo(1200, 0);
		const checkpoints = soakMetrics(
			soakFile({
				memory: [
					mem("baseline", 40_000, 50_000),
					mem("baseline", 42_000, 50_400),
					mem("baseline", 44_000, 50_200),
					mem("series", 100_000, 70_000),
					mem("checkpoint", 160_000, 51_000),
					mem("checkpoint", 162_000, 51_200),
					mem("checkpoint", 164_000, 51_100),
					mem("checkpoint", 280_000, 51_100),
					mem("checkpoint", 282_000, 51_000),
					mem("checkpoint", 284_000, 51_200),
					mem("final", 400_000, 51_000),
					mem("final", 402_000, 51_200),
					mem("final", 404_000, 51_100),
				],
			}),
		);
		// floors: 50.2 @ 0.7 min, 51.1 @ 2.7, 51.1 @ 4.7, 51.1 @ 6.7: a rise that levels off
		expect(checkpoints["memory.native.slopeKbPerMin"]).toBeCloseTo(135, 0);
		expect(idleFloors(soakFile().memory)).toHaveLength(2);
	});
	test("the worklet runtime's heap counts only when it was collected, and the worst of the three growths is the heap growth", () => {
		expect(metrics["memory.ui.growthPct"]).toBeNull();
		const ui = (allocated: number, collected = 1) => ({ collected, allocated });
		const grown = withJs((samples) => {
			for (const entry of samples) {
				if (entry.phase === "baseline") entry.ui = ui(400_000);
				if (entry.phase === "final") entry.ui = ui(460_000);
			}
		});
		const result = soakMetrics(soakFile({ js: grown }));
		expect(result["memory.ui.growthPct"]).toBeCloseTo(15, 4);
		expect(result["memory.heapGrowthPct"]).toBeCloseTo(15, 4);
		const uncollected = withJs((samples) => {
			for (const entry of samples) {
				if (entry.phase === "baseline") entry.ui = ui(400_000, 0);
				if (entry.phase === "final") entry.ui = ui(460_000, 0);
			}
		});
		expect(soakMetrics(soakFile({ js: uncollected }))["memory.ui.growthPct"]).toBeNull();
	});
	test("emitters kept by the C++ delegate past the baseline are a leak; builds that do not log them leave the metric not measured", () => {
		expect(metrics["memory.leakedEmitters"]).toBeNull();
		const counted = withJs((samples) => {
			for (const entry of samples)
				if (entry.engine)
					entry.engine = {
						...entry.engine,
						emitters: entry.phase === "final" ? entry.engine.alive + 7 : entry.engine.alive,
					};
		});
		expect(soakMetrics(soakFile({ js: counted }))["memory.leakedEmitters"]).toBe(7);
	});
	test("fewer than two windows leave the slope not measured", () => {
		expect(
			soakMetrics(soakFile({ memory: [mem("baseline", 40_000, 50_000)] }))["memory.native.slopeKbPerMin"],
		).toBeNull();
	});
	test("views alive at the end minus at the baseline; fewer is not a leak", () => {
		expect(metrics["memory.leakedViews"]).toBe(0);
		const leaky = withJs((samples) => {
			for (const entry of samples)
				if (entry.phase === "final" && entry.engine)
					entry.engine = { ...entry.engine, alive: entry.engine.alive + 4 };
		});
		expect(soakMetrics(soakFile({ js: leaky }))["memory.leakedViews"]).toBe(4);
		const fewer = withJs((samples) => {
			for (const entry of samples)
				if (entry.phase === "final" && entry.engine)
					entry.engine = { ...entry.engine, alive: entry.engine.alive - 3 };
		});
		expect(soakMetrics(soakFile({ js: fewer }))["memory.leakedViews"]).toBe(0);
	});
	test("dead-tag writes count writes outliving the node by over a second, never claimed or dropped; late ones are reported apart", () => {
		expect(metrics["memory.deadTagWrites"]).toBe(0);
		expect(metrics["memory.lateTagWrites"]).toBe(2576 - 48);
		const dead = withJs((samples) => {
			for (const entry of samples)
				if (entry.phase === "final" && entry.engine)
					entry.engine = { ...entry.engine, staleWrites: 2, expiredWrites: 1, overflowWrites: 3 };
		});
		expect(soakMetrics(soakFile({ js: dead }))["memory.deadTagWrites"]).toBe(6);
	});
	test("soak minutes run from the start sample to the last final sample", () => {
		expect(metrics["soak.minutes"]).toBe(1.58);
	});
	test("object counts of the last final sample, and the Android view count growth", () => {
		expect(metrics["memory.viewRootImpls"]).toBe(1);
		expect(metrics["memory.activities"]).toBe(1);
		expect(metrics["memory.androidViews.growth"]).toBe(0);
	});
	test("crashes are the number of crash lines", () => {
		expect(metrics["soak.crashes"]).toBe(0);
		expect(
			soakMetrics(soakFile({ crashes: ["Fatal signal 11", "ANR in io.rasheed.svelteqa"] }))[
				"soak.crashes"
			],
		).toBe(2);
	});
	test("a window that was not sampled is not measured, never zero growth", () => {
		const noFinalProcess = soakMetrics(
			soakFile({ memory: soakFile().memory.filter((entry) => entry.tag !== "final") }),
		);
		expect(noFinalProcess["memory.native.growthPct"]).toBeNull();
		expect(noFinalProcess["memory.heapGrowthPct"]).toBeNull();
		expect(noFinalProcess["memory.js.growthPct"]).toBe(0);
		const noEngine = soakMetrics(
			soakFile({
				js: withJs((samples) => {
					for (const entry of samples) entry.engine = null;
				}),
			}),
		);
		expect(noEngine["memory.leakedViews"]).toBeNull();
		expect(noEngine["memory.deadTagWrites"]).toBeNull();
	});
	test("a heap that was not collected before its sample is not derived", () => {
		const uncollected = withJs((samples) => {
			for (const entry of samples) entry.collected = null;
		});
		const result = soakMetrics(soakFile({ js: uncollected }));
		expect(result["memory.js.growthPct"]).toBeNull();
		expect(result["memory.heapGrowthPct"]).toBeNull();
	});
	test("an empty series measures nothing", () => {
		const empty = soakMetrics(soakFile({ js: [], memory: [], complete: false }));
		expect(empty["memory.heapGrowthPct"]).toBeNull();
		expect(empty["soak.minutes"]).toBeNull();
		expect(empty["soak.complete"]).toBe(0);
	});
});

function start(index: number, extra: Partial<ColdStart> = {}): ColdStart {
	return {
		index,
		reachedBoot: true,
		jsTotalMs: 140,
		crash: false,
		anr: false,
		died: false,
		jsErrors: 0,
		error: null,
		...extra,
	};
}
function suite(index: number, extra: Partial<SuiteRun> = {}): SuiteRun {
	return {
		index,
		complete: true,
		durationMs: 170_000,
		checksPassed: 28,
		crashes: 0,
		anrs: 0,
		jsErrors: 0,
		logFile: "runs/x.log",
		error: null,
		...extra,
	};
}
function crashesFile(coldStarts: ColdStart[], suites: SuiteRun[]): CrashesFile {
	return {
		schema: 1,
		kind: "crashes",
		startedAt: "",
		finishedAt: "",
		source,
		device,
		app,
		definition: "",
		coldStarts,
		suites,
		signatures: [],
		logFile: "",
	};
}

describe("crashMetrics", () => {
	test("clean series", () => {
		const metrics = crashMetrics(crashesFile([start(1), start(2)], [suite(1)]));
		expect(metrics).toEqual({
			"crashes.coldStarts": 2,
			"crashes.coldStartCrashes": 0,
			"crashes.coldStartsNoBoot": 0,
			"crashes.suites": 1,
			"crashes.suiteCrashes": 0,
			"crashes.suitesIncomplete": 0,
			"crashes.anrs": 0,
			"crashes.signatures": 0,
		});
	});
	test("crashed and died starts are crashes, a hang without boot is counted apart, an ANR on either series is an ANR", () => {
		const metrics = crashMetrics(
			crashesFile(
				[
					start(1, { crash: true, reachedBoot: false }),
					start(2, { died: true }),
					start(3, { reachedBoot: false }),
					start(4, { anr: true }),
					start(5),
				],
				[
					suite(1, { crashes: 1 }),
					suite(2, { complete: false }),
					suite(3, { anrs: 2 }),
					suite(4, { complete: false, error: "malformed" }),
				],
			),
		);
		expect(metrics["crashes.coldStartCrashes"]).toBe(2);
		expect(metrics["crashes.coldStartsNoBoot"]).toBe(1);
		expect(metrics["crashes.suiteCrashes"]).toBe(1);
		expect(metrics["crashes.suitesIncomplete"]).toBe(2);
		expect(metrics["crashes.anrs"]).toBe(3);
	});
});

describe("the soak and crash gates", () => {
	const file = JSON.parse(
		readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8"),
	) as GatesFile;
	const ids = [
		"memory.heapGrowthPct",
		"memory.leakedViews",
		"memory.deadTagWrites",
		"soak.minutes",
		"soak.crashes",
		"crashes.coldStarts",
		"crashes.coldStartCrashes",
		"crashes.coldStartsNoBoot",
		"crashes.suites",
		"crashes.suiteCrashes",
		"crashes.suitesIncomplete",
		"crashes.anrs",
	];
	const verdicts = (metrics: Record<string, number | null>) =>
		Object.fromEntries(
			evaluate(
				file.gates.filter((gate) => ids.includes(gate.id)),
				{ "localhost:5555": { platform: "android", metrics } },
				"android",
			).map((row) => [row.id, row.verdict]),
		);
	test("the bar of PLAN.md step 8", () => {
		const bar = (id: string) => file.gates.find((gate) => gate.id === id)?.bar.android;
		expect(bar("memory.heapGrowthPct")).toEqual({ max: 5 });
		expect(bar("memory.leakedViews")).toEqual({ max: 0 });
		expect(bar("memory.deadTagWrites")).toEqual({ max: 0 });
		expect(bar("soak.minutes")).toEqual({ min: 10 });
		expect(bar("soak.crashes")).toEqual({ max: 0 });
		expect(bar("crashes.coldStarts")).toEqual({ min: 1000 });
		expect(bar("crashes.suites")).toEqual({ min: 100 });
		expect(bar("crashes.anrs")).toEqual({ max: 0 });
	});
	test("every gate is measured by a metric the runners write, and nothing measured is not measured", () => {
		const all = {
			...soakMetrics(soakFile()),
			...crashMetrics(
				crashesFile(
					Array.from({ length: 1000 }, (_, i) => start(i + 1)),
					Array.from({ length: 100 }, (_, i) => suite(i + 1)),
				),
			),
		};
		const result = verdicts({ ...all, "soak.minutes": 10.4 });
		expect(Object.keys(result).sort()).toEqual([...ids].sort());
		expect(Object.values(result).every((verdict) => verdict === "pass")).toBe(true);
	});
	test("a short run passes nothing it did not measure: 200 starts and 5 suites fail the counts", () => {
		const result = verdicts({
			...crashMetrics(
				crashesFile(
					Array.from({ length: 200 }, (_, i) => start(i + 1)),
					Array.from({ length: 5 }, (_, i) => suite(i + 1)),
				),
			),
		});
		expect(result["crashes.coldStarts"]).toBe("fail");
		expect(result["crashes.suites"]).toBe("fail");
		expect(result["crashes.coldStartCrashes"]).toBe("pass");
		expect(result["memory.heapGrowthPct"]).toBe("not measured");
		expect(result["soak.minutes"]).toBe("not measured");
	});
	test("growth over 5 %, a leaked view and a dead-tag write each fail", () => {
		const result = verdicts({
			"memory.heapGrowthPct": 5.4,
			"memory.leakedViews": 1,
			"memory.deadTagWrites": 1,
			"soak.crashes": 1,
		});
		expect(result["memory.heapGrowthPct"]).toBe("fail");
		expect(result["memory.leakedViews"]).toBe("fail");
		expect(result["memory.deadTagWrites"]).toBe("fail");
		expect(result["soak.crashes"]).toBe("fail");
	});
});

describe("deviceMetrics", () => {
	test("merges the soak and the crash runs next to the lab and the boot", () => {
		const metrics = deviceMetrics(null, null, soakFile(), crashesFile([start(1)], [suite(1)]));
		expect(metrics["memory.heapGrowthPct"]).toBeCloseTo(1.99, 2);
		expect(metrics["crashes.coldStarts"]).toBe(1);
		expect(metrics["lab.runs"]).toBeUndefined();
	});
});

describe("latestRunFiles", () => {
	test("picks the newest file of each kind for each device, soak and crashes included", async () => {
		const dir = mkdtempSync(join(tmpdir(), "native-qa-runs-"));
		for (const name of [
			"soak-localhost_5555-20261026T100000Z.json",
			"soak-localhost_5555-20261026T120000Z.json",
			"soak-localhost_5555-20261026T110000Z.json",
			"crashes-localhost_5555-20261026T090000Z.json",
			"crashes-R58Y90KNGRP-20261026T090000Z.json",
			"lab-localhost_5555-20261026T090000Z.json",
			"soak-localhost_5555-20261026T120000Z.log",
			"soak-notes.json",
		])
			writeFileSync(join(dir, name), "{}");
		const files = await latestRunFiles(dir);
		expect([...files.soak]).toEqual([
			["localhost_5555", join(dir, "soak-localhost_5555-20261026T120000Z.json")],
		]);
		expect([...files.crashes.keys()].sort()).toEqual(["R58Y90KNGRP", "localhost_5555"]);
		expect([...files.lab.keys()]).toEqual(["localhost_5555"]);
		expect([...files.boot.keys()]).toEqual([]);
	});
});
