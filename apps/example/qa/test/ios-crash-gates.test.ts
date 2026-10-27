import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { labRunsWithCrashes, launchesWithCrashes, readCrashReport } from "../lib/iphone/crash-reports.ts";
import { labRunFromIos, parseIosLabResults } from "../lib/iphone/lab-results.ts";
import { evaluate, type GatesFile } from "../lib/gates.ts";
import { bootMetrics, crashReportMetrics, deviceMetrics, labMetrics } from "../lib/metrics.ts";
import type { BootFile, CrashReport, DeviceInfo, LabFile, Launch, ParityFile } from "../lib/types.ts";
import { sample } from "./sample.ts";

const options = { bundleId: "io.rasheed.svelteqa" };
const objcName = "RasheedSvelteQA-2026-10-27-090359.ips";
const objc = sample("ios-crash-objc-exception.ips");

function must(report: CrashReport | null): CrashReport {
	if (!report) throw new Error("expected a report");
	return report;
}

const gatesFile = JSON.parse(readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8")) as GatesFile;
const ios = { serial: "E74A", platform: "ios", kind: "device", model: "iPhone SE (3rd generation)", osVersion: "26.6", sdk: null, abi: "arm64", refreshHz: null } satisfies DeviceInfo;
const verdictOf = (id: string, platform: "android" | "ios", metrics: Record<string, number | string | null>) =>
	evaluate(
		gatesFile.gates.filter((gate) => gate.id === id),
		{ device: { platform, metrics } },
		platform,
	)[0]?.verdict;

describe("the metrics and gates for crash reports", () => {
	const crash = must(readCrashReport(objcName, objc, options));
	// The app of the sample does not report its JavaScript errors; this one does, and has none.
	const cleanRun = { ...labRunFromIos({ results: parseIosLabResults(sample("ios-lab-results.json")), startedAt: new Date("2026-10-27T06:01:40Z"), durationMs: 120_000, died: null, pid: 2958, logFile: "x" }, true), jsErrorCount: 0 };
	const pinned = cleanRun.scenarios.filter((scenario) => scenario.verdict !== "info").map((scenario) => scenario.name);
	const labFile = (fields: Partial<LabFile> & { runs: LabFile["runs"] }): LabFile => ({ schema: 1, kind: "lab", device: ios, run: "checks,quick", ...fields }) as LabFile;

	test("an abort after the results makes the run incomplete and a fatal, and fails both gates", () => {
		const marked = labRunsWithCrashes([cleanRun], [crash]);
		const metrics = deviceMetrics(labFile({ runs: marked.runs, crashReports: marked.reports }), null, pinned);
		expect(metrics["lab.runs"]).toBe(0);
		expect(metrics["lab.incompleteRuns"]).toBe(1);
		expect(metrics["lab.fatals"]).toBe(1);
		expect(metrics["log.fatals"]).toBe(1);
		expect(metrics["log.crashReports"]).toBe(1);
		expect(verdictOf("log.fatals", "ios", metrics)).toBe("fail");
		expect(verdictOf("log.crashReports", "ios", metrics)).toBe("fail");
	});

	test("without the crash reports the same run reads complete: the gap these gates close", () => {
		const metrics = labMetrics(labFile({ runs: [cleanRun], crashReports: [] }), pinned);
		expect(metrics["lab.runs"]).toBe(1);
		expect(metrics["lab.fatals"]).toBe(0);
	});

	test("a report no run owns counts as a fatal of the lab file all the same", () => {
		const marked = labRunsWithCrashes([{ ...cleanRun, pid: 1 }], [crash]);
		expect(marked.runs[0]?.complete).toBe(true);
		const metrics = labMetrics(labFile({ runs: marked.runs, crashReports: marked.reports }), pinned);
		expect(metrics["lab.incompleteRuns"]).toBe(0);
		expect(metrics["lab.fatals"]).toBe(1);
	});

	test("the same goes for a boot file", () => {
		const launch: Launch = { index: 1, displayMs: 200, runningMainMs: 190, displayedReportedMs: null, totalTimeMs: 80, jsMarks: null, crashes: 0, jsErrors: 0, engineWarnings: 0, error: null, pid: 1 };
		const file = { schema: 1, kind: "boot", device: ios, warm: [launch], cold: [], crashReports: launchesWithCrashes({ warm: [launch], cold: [] }, [crash]).reports } as unknown as BootFile;
		expect(bootMetrics(file)["boot.fatals"]).toBe(1);
	});

	test("crash reports sum over the lab, boot, parity and a11y files of the phone", () => {
		const one = { device: ios, crashReports: [crash] };
		const none = { device: ios, crashReports: [] };
		expect(crashReportMetrics([one, none, one])["log.crashReports"]).toBe(2);
		expect(crashReportMetrics([none])["log.crashReports"]).toBe(0);
		expect(verdictOf("log.crashReports", "ios", crashReportMetrics([none]))).toBe("pass");
	});

	test("a pull that failed is not measured, never 0, and a gate that was not measured fails", () => {
		const failed = { device: ios, crashReportsError: "after the run: No device found" };
		const metrics = crashReportMetrics([{ device: ios, crashReports: [] }, failed]);
		expect(metrics["log.crashReports"]).toBeNull();
		expect(verdictOf("log.crashReports", "ios", metrics)).toBe("not measured");
	});

	test("a file recorded before the crash log was read is not measured either", () => {
		expect(crashReportMetrics([{ device: ios }])["log.crashReports"]).toBeNull();
		const parity = { schema: 1, kind: "parity", device: ios, mode: "check", cases: [], notCovered: [], matrixSize: 0, screenPixels: 1, aborted: null } as unknown as ParityFile;
		expect(deviceMetrics(labFile({ runs: [cleanRun], crashReports: [] }), null, pinned, null, null, { parity, a11y: null, resilience: null })["log.crashReports"]).toBeNull();
	});

	test("one that did count a report stays positive next to one that could not be read", () => {
		const metrics = crashReportMetrics([{ device: ios, crashReports: [crash] }, { device: ios, crashReportsError: "x" }]);
		expect(metrics["log.crashReports"]).toBe(1);
		expect(verdictOf("log.crashReports", "ios", metrics)).toBe("fail");
	});

	test("Android has no such metric, and the gate names only iOS", () => {
		expect(crashReportMetrics([{ device: { ...ios, platform: "android" } }])).toEqual({});
		expect(verdictOf("log.crashReports", "android", {})).toBeUndefined();
		expect(gatesFile.gates.find((gate) => gate.id === "log.crashReports")?.bar).toEqual({ ios: { max: 0 } });
	});
});
