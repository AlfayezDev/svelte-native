import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportProblems } from "../commands/gates.ts";
import { smokeLaunchUrl } from "../commands/ios-smoke.ts";
import { suiteBundleId } from "../lib/iphone/session.ts";
import { platformDir, runsDir } from "../lib/paths.ts";
import { formatSmokeLine, formatSmokeSummary } from "../../src/lib/native/dev/smoke-log.ts";
import { hmsOutcome, smokeScenarioOutcome } from "../../src/lib/native/dev/smoke-rules.ts";
import type { ReportFile } from "../commands/report.ts";
import type { SmokeFile } from "../lib/types.ts";

const made: string[] = [];
const temporary = (prefix: string): string => {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	made.push(directory);
	return directory;
};
afterAll(() => {
	for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

const gates = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as { smoke: { modules: { android: string[] }; skips: { android: string[] } } };

describe("`native-qa smoke` against a fake adb", () => {
	/** An `adb` that answers what the command asks, logs every call, and follows a logcat that is a file. */
	function fakeAdb(directory: string): { bin: string; log: string; logcat: string } {
		const bin = join(directory, "bin");
		mkdirSync(bin, { recursive: true });
		const log = join(directory, "adb.log");
		const logcat = join(directory, "logcat.txt");
		const script = `#!/bin/bash
echo "$*" >> "$FAKE_ADB_LOG"
if [ "$1" = devices ]; then printf 'List of devices attached\\nfake-1\\tdevice\\n'; exit 0; fi
shift 2
case "$*" in
  "shell getprop") printf '[ro.build.version.sdk]: [36]\\n[ro.product.model]: [Fake Phone]\\n[ro.build.version.release]: [16]\\n[ro.product.cpu.abi]: [x86_64]\\n[ro.kernel.qemu]: [1]\\n';;
  "shell dumpsys display") ;;
  "shell pm path "*) echo "package:/data/app/~~x/io.rasheed.svelteqa.smoke-y/base.apk";;
  "shell sha256sum "*) echo "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  /data/app/base.apk";;
  *"dumpsys package"*) printf '    versionCode=1 minSdk=24 targetSdk=36\\n    versionName=0.1.0\\n    lastUpdateTime=2026-11-01 00:00:00\\n    [status=speed-profile]\\n';;
  "install -r "*) echo Success;;
  *"am broadcast"*) echo "Broadcast completed: result=1";;
  "logcat -v threadtime") cat "$FAKE_LOGCAT"; exec sleep 30;;
  *) ;;
esac
`;
		writeFileSync(join(bin, "adb"), script);
		chmodSync(join(bin, "adb"), 0o755);
		return { bin, log, logcat };
	}
	const line = (message: string) => `11-01 12:00:00.123  4242  4290 I ReactNativeJS: ${message}`;
	/** A logcat of the smoke scenario: every pinned module answers (`ok`, or `skip` where the platform lists one), then the lab completes. */
	function logcatOf(overrides: Record<string, "ok" | "fail" | "skip" | null> = {}, extra: string[] = []): string {
		const results = gates.smoke.modules.android.flatMap((module) => {
			const status = overrides[module] !== undefined ? overrides[module] : gates.smoke.skips.android.includes(module) ? "skip" : "ok";
			return status === null ? [] : [{ module, status, path: "js" as const, ms: 3, detail: status === "fail" ? "boom" : "answered" }];
		});
		return [...results.map((entry) => line(formatSmokeLine(entry))), line(formatSmokeSummary(results, "android")), line("[Svelte stress] complete {\"periodMs\":16,\"results\":[]}"), ...extra].join("\n") + "\n";
	}
	function run(logcat: string): { status: number | null; stdout: string; adb: string[]; written: string[] } {
		const directory = temporary("native-qa-fake-adb-");
		const adb = fakeAdb(directory);
		writeFileSync(adb.logcat, logcat);
		const apk = join(directory, "smoke.apk");
		writeFileSync(apk, "apk");
		const done = spawnSync("node", ["qa/native-qa.ts", "smoke", "--device", "fake-1", "--apk", apk, "--timeout", "30"], {
			cwd: platformDir,
			encoding: "utf8",
			env: { ...process.env, PATH: `${adb.bin}:${process.env.PATH}`, FAKE_ADB_LOG: adb.log, FAKE_LOGCAT: adb.logcat },
		});
		// The command wrote its run file and log into qa/runs; they are this test's to remove.
		const written = [...done.stdout.matchAll(/wrote (qa\/runs\/smoke-fake-1-\S+)\.json/g)].map((match) => join(platformDir, `${match[1]}`));
		for (const base of written) {
			for (const suffix of [".json", ".log"]) if (existsSync(base + suffix)) made.push(base + suffix);
		}
		return { status: done.status, stdout: done.stdout + done.stderr, adb: existsSync(adb.log) ? readFileSync(adb.log, "utf8").trim().split("\n") : [], written };
	}
	afterAll(() => {
		for (const path of made) if (path.startsWith(runsDir)) rmSync(path, { force: true });
	});

	test("installs and launches the smoke app by its own scheme, never the QA app", () => {
		const done = run(logcatOf());
		expect(done.status).toBe(0);
		expect(done.stdout).toContain("smoke gates: pass");
		expect(done.adb.some((entry) => entry.includes("install -r") && entry.endsWith("smoke.apk"))).toBe(true);
		expect(done.adb.some((entry) => entry.includes("am start -W -a android.intent.action.VIEW -d 'rasheed-svelte-smoke:///__dev?run=smoke' io.rasheed.svelteqa.smoke"))).toBe(true);
		expect(done.adb.filter((entry) => entry.includes("force-stop")).every((entry) => entry.endsWith(" io.rasheed.svelteqa.smoke"))).toBe(true);
		// The QA app's id is a prefix of the smoke app's: nothing may name it alone, or by its scheme.
		expect(done.adb.filter((entry) => / io\.rasheed\.svelteqa(\s|$|\/)/.test(entry) || entry.includes("rasheed-svelte:///"))).toEqual([]);
		const file = JSON.parse(readFileSync(`${done.written[0]}.json`, "utf8")) as SmokeFile;
		expect(file.app.package).toBe("io.rasheed.svelteqa.smoke");
		expect(file.complete).toBe(true);
		expect(file.results).toHaveLength(36);
	}, 60_000);

	test("exits 1 and says which gate failed when a module fails, a pinned one never reports, or the app crashed", () => {
		const failed = run(logcatOf({ sentry: "fail" }));
		expect(failed.status).toBe(1);
		expect(failed.stdout).toContain("smoke gates: FAIL");
		expect(failed.stdout).toContain("gate smoke.failed fail");
		const missing = run(logcatOf({ adjust: null }));
		expect(missing.status).toBe(1);
		expect(missing.stdout).toContain("gate smoke.missing fail");
		const crashed = run(logcatOf({}, [`11-01 12:00:05.000  4242  4290 E AndroidRuntime: FATAL EXCEPTION: main`, "11-01 12:00:05.001  4242  4290 E AndroidRuntime: Process: io.rasheed.svelteqa.smoke, PID: 4242"]));
		expect(crashed.status).toBe(1);
		expect(crashed.stdout).toContain("gate smoke.fatals fail");
		expect(crashed.stdout).toContain("gate smoke.complete fail");
	}, 90_000);

	test("exits 1 for a skip the platform does not list, and for a run that logged no completion line", () => {
		const skipped = run(logcatOf({ "samsung-pay": "skip" }));
		expect(skipped.status).toBe(1);
		expect(skipped.stdout).toContain("UNEXPECTED SKIP samsung-pay");
		expect(skipped.stdout).toContain("gate smoke.unexpectedSkips fail");
		const unfinished = run(logcatOf().split("\n").filter((entry) => !entry.includes("[Svelte smoke] complete")).join("\n"));
		expect(unfinished.status).toBe(1);
		expect(unfinished.stdout).toContain("gate smoke.complete fail");
	}, 90_000);
});

describe("the decisions the app makes, without React Native", () => {
	test("hms: skipped when it is not a Huawei device, ok where HMS Core is, failed when the library did not link", () => {
		const natives = ["HMSFusedLocation", "HMSLocationKit"];
		expect(hmsOutcome("samsung", natives).status).toBe("skip");
		expect(hmsOutcome("samsung", natives).detail).toMatch(/^not a Huawei device \(samsung\)/);
		expect(hmsOutcome(null, natives).detail).toContain("unknown manufacturer");
		expect(hmsOutcome("HUAWEI", natives).status).toBe("ok");
		expect(hmsOutcome("HONOR", natives).status).toBe("ok");
		expect(hmsOutcome(" Huawei ", natives).status).toBe("ok");
		expect(hmsOutcome("HUAWEI", []).status).toBe("fail");
		expect(hmsOutcome("samsung", []).status).toBe("fail");
		// The library's name in a manufacturer string is not Huawei's.
		expect(hmsOutcome("Huawei Technologies Fake", natives).status).toBe("skip");
	});
	const entry = (module: string, status: "ok" | "fail" | "skip") => ({ module, status, path: "js" as const, ms: 1, detail: "" });
	test("the lab scenario passes only when every pinned module reported and none failed", () => {
		const all = Array.from({ length: 36 }, (_, index) => entry(`m${index}`, "ok"));
		expect(smokeScenarioOutcome(all, 36).verdict).toBe("pass");
		expect(smokeScenarioOutcome([...all.slice(0, 35), entry("m35", "skip")], 36).verdict).toBe("pass");
		expect(smokeScenarioOutcome([], 36)).toEqual({ verdict: "fail", summary: "0 ok · 0 fail · 0 skip of 0 · 0 of 36 modules reported" });
		expect(smokeScenarioOutcome(all.slice(0, 20), 36).verdict).toBe("fail");
		expect(smokeScenarioOutcome(all.slice(0, 20), 36).summary).toContain("20 of 36 modules reported");
		const failing = [...all.slice(0, 35), entry("m35", "fail")];
		expect(smokeScenarioOutcome(failing, 36)).toEqual({ verdict: "fail", summary: "35 ok · 1 fail · 0 skip of 36 · failed: m35" });
	});
});

describe("the iPhone run works on the smoke app", () => {
	test("its bundle id and launch URL are the smoke app's, not the QA app's", () => {
		expect(suiteBundleId({ device: "x" }, "smoke")).toBe("io.rasheed.svelteqa.smoke");
		expect(suiteBundleId({ device: "x" }, "qa")).toBe("io.rasheed.svelteqa");
		expect(suiteBundleId({ package: "com.example.other" }, "smoke")).toBe("com.example.other");
		expect(smokeLaunchUrl("t0k3n")).toBe("rasheed-svelte-smoke:///__dev?run=smoke&token=t0k3n");
	});
});

describe("each gate lane reads the warnings of its own runs", () => {
	const report = (patch: Partial<ReportFile>): ReportFile =>
		({ schema: 1, generatedAt: "2026-11-01T12:00:00.000Z", builds: {}, devices: {}, warnings: [], gates: [], verdict: {} as ReportFile["verdict"], ...patch }) as ReportFile;
	test("a warning about the QA runs fails the QA lane only, one about the smoke run the smoke lane only", () => {
		const both = report({ warnings: ["R58Y90KNGRP: the runs measured different builds (lab: a; boot: b)"], smokeWarnings: ["R58Y90KNGRP: the smoke run does not identify its build (build identity not reported)"] });
		expect(reportProblems(both, [])).toEqual(["the report warns: R58Y90KNGRP: the runs measured different builds (lab: a; boot: b)"]);
		expect(reportProblems(both, [], undefined, true)).toEqual(["the report warns: R58Y90KNGRP: the smoke run does not identify its build (build identity not reported)"]);
		expect(reportProblems(report({}), [], undefined, true)).toEqual([]);
	});
});
