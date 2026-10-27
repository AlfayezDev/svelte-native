import { describe, expect, test } from "bun:test";
import {
	elapsedMs,
	findEngineWarnings,
	findFaults,
	findInterruption,
	parseLabChecks,
	parseLaunchMarkers,
	parseLine,
	parseStressComplete,
	parseStressScenarios,
	parseSvelteBoot,
} from "../parse/logcat.ts";
import { sample } from "./sample.ts";

const pkg = "io.rasheed.svelteqa";

describe("parseLine", () => {
	test("a threadtime line", () => {
		const line = parseLine(
			"10-25 20:23:10.902 19005 19021 I ReactNativeJS: [Svelte boot] init 1 · total 321 ms",
		);
		expect(line).toEqual({
			tsMs: ((20 * 60 + 23) * 60 + 10) * 1000 + 902,
			pid: 19005,
			tid: 19021,
			level: "I",
			tag: "ReactNativeJS",
			message: "[Svelte boot] init 1 · total 321 ms",
		});
	});
	test("tags are padded and messages may contain colons", () => {
		const line = parseLine(
			"10-25 17:51:59.589 17018 17036 F libc    : Fatal signal 11 (SIGSEGV), code 2",
		);
		expect(line?.tag).toBe("libc");
		expect(line?.message).toBe("Fatal signal 11 (SIGSEGV), code 2");
	});
	test("buffer headers and blank lines are not log lines", () => {
		expect(parseLine("--------- beginning of crash")).toBeNull();
		expect(parseLine("")).toBeNull();
	});
	test("elapsed time wraps at midnight", () => {
		expect(elapsedMs(1000, 1500)).toBe(500);
		expect(elapsedMs(86_399_900, 100)).toBe(200);
	});
});

describe("parseLaunchMarkers", () => {
	test("Start proc to Displayed, Running main and the reported time", () => {
		expect(parseLaunchMarkers(sample("boot-launch.log"), pkg)).toEqual({
			displayMs: 720,
			runningMainMs: 591,
			displayedReportedMs: 776,
		});
	});
	test("another package's launch is ignored", () => {
		expect(parseLaunchMarkers(sample("boot-launch.log"), "io.other.app")).toEqual({
			displayMs: null,
			runningMainMs: null,
			displayedReportedMs: null,
		});
	});
	test("a log with no Displayed line has no display time", () => {
		const text =
			"10-25 20:23:10.290   686   719 I ActivityManager: Start proc 19005:io.rasheed.svelteqa/u0a216 for next-top-activity {x}\n";
		expect(parseLaunchMarkers(text, pkg).displayMs).toBeNull();
	});
	test("Displayed with seconds", () => {
		const text = [
			"10-25 20:00:00.000   686   719 I ActivityManager: Start proc 1:io.rasheed.svelteqa/u0a1 for next-top-activity {x}",
			"10-25 20:00:01.500   686   707 I ActivityTaskManager: Displayed io.rasheed.svelteqa/.MainActivity for user 0: +1s480ms",
		].join("\n");
		expect(parseLaunchMarkers(text, pkg)).toEqual({
			displayMs: 1500,
			runningMainMs: null,
			displayedReportedMs: 1480,
		});
	});
});

describe("parseSvelteBoot", () => {
	test("the phase marks of the boot line", () => {
		expect(parseSvelteBoot(sample("boot-launch.log"))).toEqual({
			init: 1,
			polyfills: 2,
			rn: 158,
			expoCore: 47,
			svelte: 3,
			host: 0,
			fabric: 0,
			app: 88,
			firstCommit: 21,
			total: 321,
		});
	});
	test("the line as the lab run logs it", () => {
		expect(parseSvelteBoot(sample("lab-run.log"))?.total).toBe(201);
	});
	test("a log without the line", () => {
		expect(parseSvelteBoot('10-25 20:23:10.902 1 2 I ReactNativeJS: Running "main"\n')).toBeNull();
	});
});

describe("parseLabChecks", () => {
	test("28 of 28 from the checks line", () => {
		const checks = parseLabChecks(sample("lab-run.log"));
		expect(checks?.passed).toBe(28);
		expect(checks?.failed).toBe(0);
		expect(checks?.total).toBe(28);
		expect(checks?.finishedAt).toBe("2026-10-25T18:39:40.727Z");
	});
	test("failures are named", () => {
		const line = `10-25 18:39:40.729 17703 17722 I ReactNativeJS: '[native lab results]', '{"phase":"checks","checks":[{"name":"A","passed":true,"detail":""},{"name":"B \\"quoted\\"","passed":false,"detail":"x"}],"stress":[]}'`;
		const checks = parseLabChecks(line);
		expect(checks?.passed).toBe(1);
		expect(checks?.failures).toEqual(['B \\"quoted\\"']);
	});
	test("a line cut by logcat still counts its complete entries", () => {
		const full =
			sample("lab-run.log")
				.split("\n")
				.find((line) => line.includes('"phase":"checks"')) ?? "";
		const cut = full.slice(0, 1500);
		const checks = parseLabChecks(cut);
		expect(checks?.passed).toBe(19);
		expect(checks?.failed).toBe(0);
	});
	test("stress-phase result lines are not the checks line", () => {
		const stress = `10-25 18:39:45.396 1 2 I ReactNativeJS: '[native lab results]', '{"phase":"stress","checks":[{"name":"A","passed":false,"detail":""}]}'`;
		expect(parseLabChecks(stress)).toBeNull();
	});
});

describe("parseStressScenarios", () => {
	const scenarios = parseStressScenarios(sample("lab-run.log"));
	test("every scenario line, in order", () => {
		expect(scenarios.map((scenario) => scenario.name)).toEqual([
			"warm-up",
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
		]);
	});
	test("frame statistics and detail", () => {
		const idle = scenarios.find((scenario) => scenario.name === "idle");
		expect(idle?.verdict).toBe("pass");
		expect(idle?.frames).toEqual({
			periodMs: 16.666666666666668,
			durationMs: 2022,
			count: 123,
			p50: 17,
			p95: 17,
			p99: 17,
			max: 19,
			droppedPct: 0,
			smooth: true,
		});
		const list = scenarios.find((scenario) => scenario.name === "list-300-virtual");
		expect(list?.detail?.mountMs).toBeCloseTo(20.759318001568317, 6);
		expect(list?.periodMs).toBeCloseTo(16.6667, 3);
	});
	test("an informational scenario carries no frames", () => {
		const warmUp = scenarios.find((scenario) => scenario.name === "warm-up");
		expect(warmUp?.verdict).toBe("info");
		expect(warmUp?.frames).toBeNull();
	});
	test("a scenario that threw has no frames", () => {
		const failed = parseStressScenarios(sample("js-errors.log"));
		expect(failed.map((scenario) => [scenario.name, scenario.verdict, scenario.frames])).toEqual([
			["list-300-clipped", "fail", null],
			["list-300-raw", "fail", null],
		]);
	});
	test("a scenario line cut by logcat is an error, never a missing scenario", () => {
		const line = `10-25 18:39:47.427 1 2 I ReactNativeJS: '[Svelte stress]', '{"name":"idle","verdict":"pass","summary":"frame period 16.67 ms","frames":{"periodMs":16.6`;
		expect(() => parseStressScenarios(line)).toThrow(/malformed \[Svelte stress\] line/);
	});
});

describe("parseStressComplete", () => {
	test("the completion line lists every scenario with its verdict", () => {
		const complete = parseStressComplete(sample("lab-run.log"));
		expect(complete?.periodMs).toBeCloseTo(16.6667, 3);
		expect(complete?.results).toHaveLength(15);
		expect(complete?.results[0]).toEqual({ name: "warm-up", verdict: "info" });
		expect(complete?.results[14]).toEqual({ name: "navigation-8", verdict: "fail" });
	});
	test("a completion line cut by logcat is an error", () => {
		const line = `10-25 18:41:23.557 1 2 I ReactNativeJS: '[Svelte stress] complete', '{"periodMs":16.7,"results":[{"name":"warm-up","verdict":"inf`;
		expect(() => parseStressComplete(line)).toThrow(/malformed \[Svelte stress\] complete line/);
	});
	test("a run that never completed has none", () => {
		expect(
			parseStressComplete('10-25 18:39:47.427 1 2 I ReactNativeJS: Running "main"\n'),
		).toBeNull();
	});
});

describe("findFaults", () => {
	test("a Java crash of the package", () => {
		expect(findFaults(sample("crash-java.log"), pkg).crashes).toEqual([
			`FATAL EXCEPTION Process: ${pkg}, PID: 19924`,
		]);
	});
	test("a Java crash of another process is not ours", () => {
		expect(findFaults(sample("crash-java.log"), "io.other.app").crashes).toEqual([]);
	});
	test("a native crash is matched by the kernel's 15-character process name", () => {
		expect(findFaults(sample("crash-native.log"), pkg).crashes).toHaveLength(1);
		expect(findFaults(sample("crash-native.log"), "io.other.app").crashes).toEqual([]);
	});
	test("error-level JavaScript lines are fatals, info lines are not", () => {
		const faults = findFaults(sample("js-errors.log"), pkg);
		expect(faults.crashes).toEqual([]);
		expect(faults.jsErrors).toHaveLength(3);
		expect(faults.jsErrors[0]).toContain("TypeError: undefined is not a function");
	});
	test("an ANR in the package (AOSP ActivityManager format)", () => {
		const text = `10-25 20:31:00.000   686   900 E ActivityManager: ANR in ${pkg} (${pkg}/.MainActivity)\n10-25 20:31:00.001   686   900 E ActivityManager: PID: 4242\n`;
		expect(findFaults(text, pkg).crashes).toEqual([`ANR in ${pkg} (${pkg}/.MainActivity)`]);
	});
	test("a clean launch has no faults", () => {
		expect(findFaults(sample("boot-launch.log"), pkg)).toEqual({ crashes: [], jsErrors: [] });
	});
});

describe("findEngineWarnings", () => {
	test("W and E lines of the SvelteEngine tag", () => {
		expect(findEngineWarnings(sample("lab-run.log"))).toHaveLength(3);
		expect(findEngineWarnings(sample("lab-run.log"))[0]).toBe(
			"animated write for unknown tag 950 (registry size 79), ignored",
		);
	});
	test("info lines of the tag are not warnings", () => {
		expect(findEngineWarnings(sample("boot-launch.log"))).toEqual([]);
	});
	test("an error line counts", () => {
		expect(
			findEngineWarnings("10-25 20:00:00.000 1 2 E SvelteEngine: unknown op 99 at 3\n"),
		).toEqual(["unknown op 99 at 3"]);
	});
});

describe("findInterruption", () => {
	const cellBroadcast = "com.google.android.cellbroadcastreceiver/com.android.cellbroadcastreceiver.CellBroadcastAlertDialog";
	test("an emergency alert opening over the app is found at its first line, not at the window that preceded the start", () => {
		expect(findInterruption(sample("lab-interrupted.log"), pkg)).toEqual({ at: "10-27 14:49:13.668", by: cellBroadcast });
	});
	test("the START line alone, the Displayed line alone and a Transition requested with only the top activity are each enough", () => {
		const start = "10-27 14:48:19.415  2160  3194 I ActivityTaskManager: START u0 {act=android.intent.action.VIEW pkg=io.rasheed.svelteqa cmp=io.rasheed.svelteqa/.MainActivity} with LAUNCH_SINGLE_TASK from uid 2000 (com.android.shell) result code=0";
		const only = (line: string) => findInterruption(`${start}\n${line}\n`, pkg);
		expect(only("10-27 14:50:00.100  2160  5015 I ActivityTaskManager: START u0 {flg=0x10040000 cmp=com.android.settings/.Settings} with LAUNCH_SINGLE_TOP from uid 1000 result code=0")).toEqual({
			at: "10-27 14:50:00.100",
			by: "com.android.settings/.Settings",
		});
		expect(only("10-27 14:50:01.200  2160  2186 I ActivityTaskManager: Displayed com.android.dialer/.DialtactsActivity for user 0: +300ms")).toEqual({
			at: "10-27 14:50:01.200",
			by: "com.android.dialer/.DialtactsActivity",
		});
		expect(
			only("10-27 14:50:02.300  3028  3082 V WindowManagerShell: Transition requested (#9): x TransitionRequestInfo { type = OPEN, triggerTask = TaskInfo{taskId=5 baseIntent=Intent { flg=0x1 } topActivity=ComponentInfo{com.sec.android.app.launcher/.Home} origActivity=null}, flags = 0 }"),
		).toEqual({ at: "10-27 14:50:02.300", by: "com.sec.android.app.launcher/.Home" });
	});
	test("the app's own starts, a CLOSE transition, other apps' Start proc lines and a log without the app's start are not interruptions", () => {
		expect(findInterruption(sample("lab-run.log"), pkg)).toBeNull();
		expect(findInterruption(sample("boot-launch.log"), pkg)).toBeNull();
		const lines = sample("lab-interrupted.log").split("\n");
		const upToOwnStart = lines.slice(0, 4).join("\n");
		expect(findInterruption(upToOwnStart, pkg)).toBeNull();
		const withoutStart = lines.filter((line) => !line.includes("pkg=io.rasheed.svelteqa")).join("\n");
		expect(findInterruption(withoutStart, pkg)).toBeNull();
		const close = "10-27 14:50:02.300  3028  3082 V WindowManagerShell: Transition requested (#9): x TransitionRequestInfo { type = CLOSE, triggerTask = TaskInfo{ baseIntent=Intent { cmp=com.other/.A } }, flags = 0 }";
		expect(findInterruption(`${upToOwnStart}\n${close}\n10-27 14:50:03.000  1000  1000 I ActivityManager: Start proc 9:com.other/u0a1 for service\n`, pkg)).toBeNull();
	});
});
