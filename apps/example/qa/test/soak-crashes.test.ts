import { describe, expect, test } from "bun:test";
import { labRunFrom } from "../lib/lab-run.ts";
import {
	childArgs,
	chunkPlan,
	classifyStart,
	classifySuite,
	crashesDefinition,
} from "../soak/crashes.ts";
import { findFaults } from "../parse/logcat.ts";
import { sample } from "./sample.ts";

const pkg = "io.rasheed.svelteqa";

describe("classifyStart", () => {
	test("a clean launch: the host booted, the process is alive, nothing fatal", () => {
		const start = classifyStart(1, sample("boot-launch.log"), true, true, null, pkg);
		expect(start).toEqual({
			index: 1,
			reachedBoot: true,
			jsTotalMs: start.jsTotalMs,
			crash: false,
			anr: false,
			died: false,
			jsErrors: 0,
			error: null,
		});
		expect(typeof start.jsTotalMs).toBe("number");
	});
	test("a Java or JavaScript fatal is a crash, and so is a native signal", () => {
		expect(classifyStart(2, sample("crash-js.log"), false, false, null, pkg).crash).toBe(true);
		expect(classifyStart(3, sample("crash-java.log"), false, false, null, pkg).crash).toBe(true);
		expect(classifyStart(4, sample("crash-native.log"), true, false, null, pkg).crash).toBe(true);
	});
	test("a JavaScript fatal that destroys the React host is a crash although the process stays alive", () => {
		const start = classifyStart(10, sample("crash-js-host.log"), true, true, null, pkg);
		expect([start.crash, start.died]).toEqual([true, false]);
		expect(findFaults(sample("crash-js-host.log"), pkg).crashes).toEqual([
			'JS fatal: "Error: qa crash-js: uncaught error from a timer, stack:',
		]);
	});
	test("a crash of another app's process is not ours", () => {
		const other = [
			"10-26 12:40:00.130  9999  9999 E AndroidRuntime: FATAL EXCEPTION: main",
			"10-26 12:40:00.130  9999  9999 E AndroidRuntime: Process: com.example.other, PID: 9999",
		].join("\n");
		expect(classifyStart(5, other, true, true, null, pkg).crash).toBe(false);
	});
	test("an ANR is counted apart from a crash", () => {
		const anr =
			"10-26 13:00:00.100  1000  1100 E ActivityManager: ANR in io.rasheed.svelteqa (io.rasheed.svelteqa/.MainActivity)";
		const start = classifyStart(6, anr, true, true, null, pkg);
		expect([start.crash, start.anr]).toEqual([false, true]);
	});
	test("a process that is gone after the boot line died, with or without a fatal in the log", () => {
		expect(classifyStart(7, sample("boot-launch.log"), true, false, null, pkg).died).toBe(true);
	});
	test("a start that never printed the boot line, and the adb error that explains it", () => {
		const start = classifyStart(8, "", false, true, "adb shell am start exited with 1", pkg);
		expect([start.reachedBoot, start.jsTotalMs, start.error]).toEqual([
			false,
			null,
			"adb shell am start exited with 1",
		]);
	});
	test("error-level JavaScript lines are counted, not mistaken for crashes", () => {
		const start = classifyStart(9, sample("js-errors.log"), true, true, null, pkg);
		expect(start.crash).toBe(false);
		expect(start.jsErrors > 0).toBe(true);
	});
});

describe("classifySuite", () => {
	const run = (text: string, matched: boolean) =>
		labRunFrom(
			{
				text,
				matched,
				startedAt: new Date("2026-10-26T09:00:00Z"),
				durationMs: 170_000,
				logFile: "runs/x.log",
			},
			pkg,
			true,
		);
	test("a clean suite", () => {
		const record = classifySuite(1, run(sample("lab-run.log"), true), "runs/suite-1.log", pkg);
		expect(record).toEqual({
			index: 1,
			complete: true,
			durationMs: 170_000,
			checksPassed: 28,
			crashes: 0,
			anrs: 0,
			jsErrors: 0,
			logFile: "runs/suite-1.log",
			error: null,
		});
	});
	test("a suite whose log never reached the lab's last line is incomplete", () => {
		const record = classifySuite(2, run(sample("lab-run.log"), false), "runs/suite-2.log", pkg);
		expect([record.complete, record.crashes]).toEqual([false, 0]);
	});
	test("crash lines and ANR lines of a suite are counted apart", () => {
		const text = `${sample("lab-run.log")}\n${sample("crash-js.log")}\n10-26 13:00:00.100  1000  1100 E ActivityManager: ANR in io.rasheed.svelteqa (io.rasheed.svelteqa/.MainActivity)\n`;
		const record = classifySuite(3, run(text, true), "runs/suite-3.log", pkg);
		expect([record.crashes, record.anrs]).toEqual([1, 1]);
	});
});

describe("crashesDefinition", () => {
	test("states how a start crashes, dies or fails to boot, and what a suite is", () => {
		const text = crashesDefinition(2);
		for (const phrase of [
			"force-stop",
			"FATAL EXCEPTION",
			"ANR in",
			"pidof",
			"no boot",
			"checks,quick",
		])
			expect(text).toContain(phrase);
	});
});

describe("chunkPlan", () => {
	test("1000 starts and 100 suites in chunks of 300: each chunk at most 300 launches or 10 suites", () => {
		const plan = chunkPlan(1000, 100, 300);
		expect(plan.slice(0, 4)).toEqual([
			{ starts: 300, suites: 0 },
			{ starts: 600, suites: 0 },
			{ starts: 900, suites: 0 },
			{ starts: 1000, suites: 0 },
		]);
		expect(plan).toHaveLength(14);
		expect(plan[4]).toEqual({ starts: 1000, suites: 10 });
		expect(plan[13]).toEqual({ starts: 1000, suites: 100 });
	});
	test("a small chunk shrinks the suite chunk too, and a last chunk is the remainder", () => {
		expect(chunkPlan(12, 7, 5)).toEqual([
			{ starts: 5, suites: 0 },
			{ starts: 10, suites: 0 },
			{ starts: 12, suites: 0 },
			{ starts: 12, suites: 5 },
			{ starts: 12, suites: 7 },
		]);
	});
	test("no starts or no suites leave only the other series", () => {
		expect(chunkPlan(0, 3, 300)).toEqual([{ starts: 0, suites: 3 }]);
		expect(chunkPlan(3, 0, 300)).toEqual([{ starts: 3, suites: 0 }]);
		expect(chunkPlan(0, 0, 300)).toEqual([]);
	});
});

describe("childArgs", () => {
	const values = {
		device: "localhost:5555",
		apk: "qa/out/app-x86_64.apk",
		chunk: "300",
		gap: "20",
		starts: "1000",
		suites: "100",
		"inject-crash": undefined,
		resume: undefined,
		"no-install": false,
		map: "qa/out/app.map",
	};
	test("carries the caller's flags and the chunk's own counts, without the chunking flags", () => {
		expect(childArgs(values, 600, 0, false)).toEqual([
			"crashes",
			"--starts",
			"600",
			"--suites",
			"0",
			"--device",
			"localhost:5555",
			"--apk",
			"qa/out/app-x86_64.apk",
			"--map",
			"qa/out/app.map",
		]);
	});
	test("a continuing chunk resumes the file the first one wrote", () => {
		expect(childArgs(values, 600, 0, true).includes("--resume")).toBe(true);
	});
	test("boolean flags come through as bare flags", () => {
		expect(childArgs({ device: "x", "no-install": true }, 5, 0, false)).toEqual([
			"crashes",
			"--starts",
			"5",
			"--suites",
			"0",
			"--device",
			"x",
			"--no-install",
		]);
	});
});
