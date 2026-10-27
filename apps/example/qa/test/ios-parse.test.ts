import { describe, expect, test } from "bun:test";
import { parseBootBody } from "../parse/logcat.ts";
import { launchFromReport, parseBootReport, parseDeviceDetails, parseInstalledApp, parseLaunch, parseProcesses } from "../parse/ios.ts";
import { labFinished, labRunFromIos, parseIosLabResults } from "../lib/iphone/lab-results.ts";
import { labMetrics } from "../lib/metrics.ts";
import type { LabFile } from "../lib/types.ts";
import { sample } from "./sample.ts";

const devices = JSON.stringify({
	result: {
		devices: [
			{ identifier: "E74A5608", connectionProperties: { tunnelState: "connected" }, deviceProperties: { osVersionNumber: "26.6", name: "physical" }, hardwareProperties: { marketingName: "iPhone SE (3rd generation)", productType: "iPhone14,6", udid: "00008110-001E" } },
			{ identifier: "8395CF89", connectionProperties: { tunnelState: "unavailable" }, deviceProperties: { osVersionNumber: "18.0" }, hardwareProperties: { marketingName: "iPhone 13 Pro Max", udid: "00008110-AAAA" } },
		],
	},
});

describe("devicectl output as Xcode prints it", () => {
	test("the real device list and app listing parse", () => {
		const info = parseDeviceDetails(sample("ios-devicectl-devices.json"), "E74A5608-BF8E-5806-8699-1605F82ADED9");
		expect(info.model).toBe("iPhone SE (3rd generation)");
		expect(info.osVersion).toBe("26.6");
		expect(parseDeviceDetails(sample("ios-devicectl-devices.json"), "00008110-001E10593410401E").platform).toBe("ios");
		const app = parseInstalledApp(sample("ios-devicectl-apps.json"), "io.rasheed.svelteqa");
		expect(app.version).toBe("0.1.0");
		expect(app.bundleUrl).toMatch(/RasheedSvelteQA\.app\/$/);
	});
});

describe("devicectl output", () => {
	test("the device is found by identifier or hardware UDID and described like an Android device", () => {
		const info = parseDeviceDetails(devices, "E74A5608");
		expect(info).toEqual({ serial: "E74A5608", platform: "ios", kind: "device", model: "iPhone SE (3rd generation)", osVersion: "26.6", sdk: null, abi: "arm64", refreshHz: null });
		expect(parseDeviceDetails(devices, "00008110-001E").serial).toBe("00008110-001E");
	});

	test("an unavailable or unknown device is an error that says so", () => {
		expect(() => parseDeviceDetails(devices, "8395CF89")).toThrow("unavailable");
		expect(() => parseDeviceDetails(devices, "nope")).toThrow("does not list");
		expect(() => parseDeviceDetails("not json", "x")).toThrow("did not print JSON");
	});

	test("the installed app, the launch and the processes", () => {
		const apps = JSON.stringify({ result: { apps: [{ bundleIdentifier: "io.rasheed.svelteqa", name: "Rasheed Svelte QA", version: "0.1.0", bundleVersion: "1", url: "file:///private/var/containers/Bundle/Application/ABC/RasheedSvelteQA.app/" }] } });
		const app = parseInstalledApp(apps, "io.rasheed.svelteqa");
		expect(app.version).toBe("0.1.0");
		expect(() => parseInstalledApp(apps, "io.other")).toThrow("not installed");
		expect(parseLaunch(JSON.stringify({ result: { process: { processIdentifier: 99 } } }))).toEqual({ pid: 99 });
		expect(() => parseLaunch(JSON.stringify({ result: {} }))).toThrow("no process id");
		const processes = JSON.stringify({ result: { runningProcesses: [{ processIdentifier: 5, executable: `${app.bundleUrl}RasheedSvelteQA` }, { processIdentifier: 6, executable: "file:///usr/libexec/x" }] } });
		expect(parseProcesses(processes, app.bundleUrl)).toEqual([5]);
	});
});

describe("boot report", () => {
	const report = {
		pid: 321,
		processStartMs: 1_000_000,
		launchedMs: 1_000_080,
		contentAppearedMs: 1_000_190,
		displayedMs: 1_000_207.5,
		javaScript: "init 5 · polyfills 3 · host 40 · first commit 20 · total 98 ms",
		osVersion: "26.6",
	};

	test("the launch is measured from the kernel's start of the process", () => {
		const launch = launchFromReport(parseBootReport(JSON.stringify(report)));
		expect(launch.displayMs).toBe(207.5);
		expect(launch.contentMs).toBe(190);
		expect(launch.launchedMs).toBe(80);
		expect(launch.jsMarks).toEqual({ init: 5, polyfills: 3, host: 40, firstCommit: 20, total: 98 });
	});

	test("a report with a missing field is refused, not read as zero", () => {
		const partial = { ...report, displayedMs: undefined }; // JSON.stringify leaves an undefined field out
		expect(() => parseBootReport(JSON.stringify(partial))).toThrow("displayedMs");
	});

	test("the phases of a [Svelte boot] line parse the same from a body", () => {
		expect(parseBootBody("init 2 · total 9 ms")).toEqual({ init: 2, total: 9 });
		expect(parseBootBody("nothing here")).toBeNull();
	});
});

describe("lab results", () => {
	const text = sample("ios-lab-results.json");

	test("the file the lab writes on the iPhone becomes a lab run like the Android log's", () => {
		const results = parseIosLabResults(text);
		expect(results.stressDone).toBe(true);
		expect(labFinished(results, true)).toBe(true);
		const run = labRunFromIos({ results, startedAt: new Date("2026-10-26T19:50:00Z"), durationMs: 200_000, died: null, logFile: "runs/x.log" }, true);
		expect(run.complete).toBe(true);
		expect(run.checks).toEqual(expect.objectContaining({ passed: 28, failed: 0, total: 28 }));
		const navigation = run.scenarios.find((scenario) => scenario.name === "navigation-8");
		expect(navigation?.frames?.droppedPct).toBeGreaterThan(0);
		expect(run.expectedScenarios).toContain("navigation-8");
		expect(run.expectedScenarios).not.toContain("warm-up");
	});

	test("a run whose app died is incomplete, even with results", () => {
		const results = parseIosLabResults(text);
		const run = labRunFromIos({ results, startedAt: new Date(), durationMs: 1, died: "the app (pid 5) was not running", logFile: "x" }, true);
		expect(run.complete).toBe(false);
		expect(run.crashes).toHaveLength(1);
	});

	test("the metrics the gates read come out of an iOS run unchanged", () => {
		const results = parseIosLabResults(text);
		const run = labRunFromIos({ results, startedAt: new Date(), durationMs: 1, died: null, logFile: "x" }, true);
		const file = { schema: 1, kind: "lab", device: { platform: "ios" }, runs: [run] } as unknown as LabFile;
		const metrics = labMetrics(file);
		expect(metrics["lab.checks.passed"]).toBe(28);
		expect(typeof metrics["frames.navigation-8.droppedPct"]).toBe("number");
		expect(metrics["frames.idle.droppedPct"]).toBe(0);
	});

	test("an unexpected file is refused", () => {
		expect(() => parseIosLabResults("{}")).toThrow("unexpected shape");
		expect(() => parseIosLabResults("nope")).toThrow("not JSON");
	});
});
