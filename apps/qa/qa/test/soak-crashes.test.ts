import { describe, expect, test } from "bun:test";
import { labRunFrom } from "../lib/lab-run.ts";
import {
	childArgs,
	chunkPlan,
	pendingSteps,
	classifyStart,
	classifySuite,
	crashesDefinition,
	resumeMismatch,
	type RunIdentity,
} from "../soak/crashes.ts";
import { findFaults } from "../parse/logcat.ts";
import type { CrashesFile } from "../lib/types.ts";
import { sample } from "./sample.ts";

const pkg = "io.example.svelteqa";

describe("resuming a crashes file", () => {
	const sha = "d089db0466db".repeat(5).slice(0, 64);
	const file = (fields: Partial<CrashesFile> = {}, installedSha256: string | null = sha): CrashesFile => ({
		schema: 1,
		kind: "crashes",
		startedAt: "2026-10-26T09:00:00Z",
		finishedAt: "2026-10-26T10:00:00Z",
		source: { commit: "abc1234", dirty: false },
		device: { serial: "localhost:5555", platform: "android", kind: "emulator", model: "sdk", osVersion: "16", sdk: 36, abi: "x86_64", refreshHz: 60 },
		app: { package: pkg, versionName: "0.1.0", versionCode: 1, lastUpdateTime: null, installedSha256, apk: null },
		definition: "",
		run: "checks,quick",
		idleSeconds: 2,
		packageName: pkg,
		coldStarts: [],
		suites: [],
		signatures: [],
		logFile: "runs/x.log",
		...fields,
	});
	const now = (fields: Partial<RunIdentity> = {}): RunIdentity => ({ run: "checks,quick", idleSeconds: 2, packageName: pkg, installedSha256: sha, ...fields });

	test("the same suites, idle gap, package and build continue the file", () => {
		expect(resumeMismatch(file(), now())).toBeNull();
	});

	test("a different --run, --idle or --package is refused, each by name", () => {
		expect(resumeMismatch(file(), now({ run: "checks,list-300-virtual" }))).toContain('--run "checks,quick" in the file, "checks,list-300-virtual" now');
		expect(resumeMismatch(file(), now({ idleSeconds: 20 }))).toContain("--idle 2 in the file, 20 now");
		expect(resumeMismatch(file(), now({ packageName: "io.other" }))).toContain('--package "io.example.svelteqa" in the file, "io.other" now');
	});

	test("another installed build is refused", () => {
		expect(resumeMismatch(file(), now({ installedSha256: "f".repeat(64) }))).toContain("installed build");
	});

	test("a build that could not be identified on either side is refused, even when both are null", () => {
		expect(resumeMismatch(file({}, null), now({ installedSha256: null }))).toContain("could not be identified");
		expect(resumeMismatch(file({}, null), now())).toContain("could not be identified");
		expect(resumeMismatch(file(), now({ installedSha256: null }))).toContain("could not be identified");
	});

	test("a file from before the run, the idle gap and the package were recorded cannot prove it is the same run", () => {
		const legacy = file() as Partial<CrashesFile>;
		delete legacy.run;
		delete legacy.idleSeconds;
		delete legacy.packageName;
		const reason = resumeMismatch(legacy as CrashesFile, now());
		expect(reason).toContain("--run null in the file");
		expect(reason).toContain("--idle null in the file");
		expect(reason).toContain("--package null in the file");
	});
});

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
			"10-26 13:00:00.100  1000  1100 E ActivityManager: ANR in io.example.svelteqa (io.example.svelteqa/.MainActivity)";
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
	test("a suite with a [Svelte stress] line the harness could not read did not measure: incomplete, with the reason", () => {
		const lines = sample("lab-run.log").split("\n");
		const index = lines.findIndex((entry) => entry.includes("'[Svelte stress]', '") && entry.includes('"name":"modal-8"'));
		lines[index] = (lines[index] ?? "").slice(0, 150);
		const record = classifySuite(4, run(lines.join("\n"), true), "runs/suite-4.log", pkg);
		expect(record.complete).toBe(false);
		expect(record.crashes).toBe(0);
		expect(record.error).toMatch(/^1 \[Svelte stress\] line\(s\) could not be read: malformed \[Svelte stress\] line/);
		expect(classifySuite(1, run(sample("lab-run.log"), true), "runs/suite-1.log", pkg).error).toBeNull();
	});
	test("crash lines and ANR lines of a suite are counted apart", () => {
		const text = `${sample("lab-run.log")}\n${sample("crash-js.log")}\n10-26 13:00:00.100  1000  1100 E ActivityManager: ANR in io.example.svelteqa (io.example.svelteqa/.MainActivity)\n`;
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

describe("pendingSteps", () => {
	const plan = chunkPlan(1000, 100, 100);
	test("a resumed file skips the chunks it already covers, so none of them restarts the emulator for nothing", () => {
		const left = pendingSteps(plan, { starts: 1000, suites: 10 });
		expect(left[0]).toEqual({ starts: 1000, suites: 20 });
		expect(left).toHaveLength(9);
		// a chunk cut short in the middle runs again (its counts are not reached), the ones before it do not
		expect(pendingSteps(plan, { starts: 225, suites: 0 })[0]).toEqual({ starts: 300, suites: 0 });
		expect(pendingSteps(plan, { starts: 1000, suites: 100 })).toEqual([]);
	});
	test("without a file every chunk runs", () => {
		expect(pendingSteps(plan, null)).toEqual(plan);
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
	test("a chunk on the shared emulator restarts it (--fresh), and a caller's own --fresh is not passed twice", () => {
		const args = childArgs({ ...values, fresh: true }, 600, 0, true, true);
		expect(args.filter((arg) => arg === "--fresh")).toEqual(["--fresh"]);
		expect(args.slice(0, 7)).toEqual(["crashes", "--starts", "600", "--suites", "0", "--resume", "--fresh"]);
		// a phone's chunks only continue the file
		expect(childArgs({ ...values, fresh: true }, 600, 0, true, false).includes("--fresh")).toBe(false);
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
