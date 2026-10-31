import { describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult } from "../lib/exec.ts";
import {
	attribute,
	clockSkewMs,
	describeCrashReports,
	finishCrashWatch,
	keepCrashFiles,
	labRunsWithCrashes,
	launchesWithCrashes,
	parsePhoneTime,
	pullCrashReports,
	readCrashReport,
	readCrashReports,
	reportsSince,
	startCrashWatch,
	unattributed,
	withReports,
} from "../lib/iphone/crash-reports.ts";
import { parseIosLabResults, labRunFromIos } from "../lib/iphone/lab-results.ts";
import { macFrom, type Run } from "../lib/iphone/mac.ts";
import type { CrashReport, Launch } from "../lib/types.ts";
import { sample } from "./sample.ts";

const bundleId = "io.rasheed.svelteqa";
const options = { bundleId };
const objcName = "RasheedSvelteQA-2026-10-27-090359.ips";
const asiName = "RasheedSvelteQA-2026-10-26-153204.ips";
const jetsamName = "JetsamEvent-2026-10-26-232518.ips";
const objc = sample("ios-crash-objc-exception.ips");
const asiOnly = sample("ios-crash-asi-only.ips");
const jetsam = sample("ios-jetsam-event.ips");

/** A sample with its body changed: the header line stays, the body is parsed, edited and written back. */
function edited(content: string, change: (body: Record<string, unknown>) => void): string {
	const split = content.indexOf("\n");
	const body = JSON.parse(content.slice(split + 1)) as Record<string, unknown>;
	change(body);
	return `${content.slice(0, split)}\n${JSON.stringify(body)}`;
}

function must(report: CrashReport | null): CrashReport {
	if (!report) throw new Error("expected a report");
	return report;
}

describe("the time a report carries", () => {
	test("is an instant: the local time and the phone's UTC offset", () => {
		expect(parsePhoneTime("2026-10-27 09:03:59.2484 +0300")).toBe(Date.UTC(2026, 9, 27, 6, 3, 59, 248));
		expect(parsePhoneTime("2026-10-27 09:03:59.00 +0300")).toBe(Date.UTC(2026, 9, 27, 6, 3, 59, 0));
		expect(parsePhoneTime("2026-10-27 01:00:00 -0500")).toBe(Date.UTC(2026, 9, 27, 6, 0, 0, 0));
	});

	test("anything else is no time", () => {
		expect(parsePhoneTime("2026-10-27 09:03:59")).toBeNull();
		expect(parsePhoneTime("yesterday")).toBeNull();
		expect(parsePhoneTime(5)).toBeNull();
	});
});

describe("parsing a crash report", () => {
	test("an exception the app threw: the report names it and the frames start where it was thrown", () => {
		const report = must(readCrashReport(objcName, objc, options));
		expect(report.file).toBe(objcName);
		expect(report.capturedAt).toBe("2026-10-27T06:03:59.248Z");
		expect(report.processStartedAt).toBe("2026-10-27T06:01:43.164Z");
		expect(report.pid).toBe(2958);
		expect(report.exceptionType).toBe("EXC_CRASH");
		expect(report.signal).toBe("SIGABRT");
		expect(report.reason).toBe("NSRangeException: *** -[__NSSingleObjectArrayI objectAtIndex:]: index 1 beyond bounds [0 .. 0]");
		expect(report.framesOf).toBe("lastExceptionBacktrace");
		expect(report.topFrames).toHaveLength(12);
		expect(report.topFrames[0]).toEqual({ image: "CoreFoundation", offset: 1135172, symbol: "__exceptionPreprocess" });
		expect(report.topFrames[4]).toEqual({ image: "RasheedSvelteQA", offset: 1597812, symbol: "-[SvelteTabView unmountChildComponentView:index:]" });
		expect(report.attributedTo).toBeUndefined();
	});

	test("a report with only the abort's own words says those", () => {
		const report = must(readCrashReport(asiName, asiOnly, options));
		expect(report.pid).toBe(2000);
		expect(report.capturedAt).toBe("2026-10-26T12:32:04.180Z");
		expect(report.reason).toBe("abort() called");
		expect(report.topFrames[4]?.symbol).toBe("-[SvelteTabView unmountChildComponentView:index:]");
	});

	test("without a last exception backtrace the faulting thread's frames are the stack", () => {
		const report = must(readCrashReport(objcName, edited(objc, (body) => delete body.lastExceptionBacktrace), options));
		expect(report.framesOf).toBe("faultingThread");
		expect(report.topFrames).toHaveLength(12);
		expect(report.topFrames[0]).toEqual({ image: "libsystem_kernel.dylib", offset: 45520, symbol: "__pthread_kill" });
		expect(report.topFrames[10]?.symbol).toBe("-[__NSSingleObjectArrayI objectAtIndex:]");
	});

	test("without an exception reason or abort message the termination says why, and a long reason is cut at 300 characters", () => {
		const watchdog = edited(objc, (body) => {
			delete body.exceptionReason;
			delete body.asi;
			body.termination = { namespace: "FRONTBOARD", code: 0x8badf00d, indicator: "scene-create watchdog transgression", details: ["exhausted real (wall) time allowance of 10.00 seconds"] };
		});
		expect(must(readCrashReport(objcName, watchdog, options)).reason).toBe("scene-create watchdog transgression; exhausted real (wall) time allowance of 10.00 seconds");
		const long = edited(objc, (body) => (body.exceptionReason = { name: "NSInvalidArgumentException", composed_message: "x".repeat(500) }));
		expect(must(readCrashReport(objcName, long, options)).reason).toHaveLength(300);
	});

	test("a frame outside every image has no image name, and a report with no frames has none", () => {
		const report = must(
			readCrashReport(
				objcName,
				edited(objc, (body) => {
					body.lastExceptionBacktrace = [{ imageOffset: 7, imageIndex: 99 }];
				}),
				options,
			),
		);
		expect(report.topFrames).toEqual([{ image: null, offset: 7, symbol: null }]);
		const bare = must(readCrashReport(objcName, edited(objc, (body) => ((body.threads = []), delete body.lastExceptionBacktrace)), options));
		expect(bare.framesOf).toBeNull();
		expect(bare.topFrames).toEqual([]);
	});

	test("other bundles' reports and files that are not reports are not the app's", () => {
		const other = objc.replace('"bundleID":"io.rasheed.svelteqa"', '"bundleID":"com.apple.mobilesafari"');
		expect(readCrashReport(objcName, other, options)).toBeNull();
		expect(readCrashReport("Analytics-2026-10-27-030006.0005.ips.ca", objc, options)).toBeNull();
		expect(readCrashReport("SFA-sos.json-2026-10-27-010214.ips", "not json at all", options)).toBeNull();
	});

	test("a report of the app that cannot be read is still a report", () => {
		const cut = must(readCrashReport(objcName, objc.slice(0, objc.indexOf("\n") + 200), options));
		expect(cut.exceptionType).toBeNull();
		expect(cut.reason).toMatch(/could not be read: its body is not JSON/);
		expect(cut.capturedAt).toBe("2026-10-27T06:03:59.000Z");
		const noHeader = must(readCrashReport(objcName, "{\"app_na", options));
		expect(noHeader.reason).toMatch(/its header is not JSON/);
		expect(noHeader.capturedAt).toBeNull();
	});

	test("a jetsam event is the app's only when the system killed the app", () => {
		expect(readCrashReport(jetsamName, jetsam, options)).toBeNull();
		const killed = edited(jetsam, (body) => {
			const processes = body.processes as { name: string; reason?: string }[];
			const app = processes.find((entry) => entry.name === "RasheedSvelteQA");
			if (app) app.reason = "per-process-limit";
		});
		const report = must(readCrashReport(jetsamName, killed, options));
		expect(report.exceptionType).toBe("JETSAM");
		expect(report.pid).toBe(2241);
		expect(report.reason).toBe("the system killed the app: per-process-limit");
		expect(report.capturedAt).toBe("2026-10-26T20:25:18.230Z");
	});

	test("the app's reports are listed oldest first", () => {
		const reports = readCrashReports(
			[
				{ name: objcName, content: objc },
				{ name: jetsamName, content: jetsam },
				{ name: asiName, content: asiOnly },
			],
			options,
		);
		expect(reports.map((report) => report.file)).toEqual([asiName, objcName]);
	});

	test("what a command prints", () => {
		const lines = describeCrashReports({ crashReports: [{ ...must(readCrashReport(objcName, objc, options)), attributedTo: "lab 3" }] });
		expect(lines[0]).toBe("crash reports: 1 new on the phone");
		expect(lines[1]).toBe(`  ${objcName}  2026-10-27T06:03:59.248Z  pid 2958  EXC_CRASH SIGABRT  [lab 3]`);
		expect(lines[2]).toMatch(/NSRangeException/);
		expect(describeCrashReports({ crashReports: [] })).toEqual(["crash reports: none new on the phone"]);
		expect(describeCrashReports({ crashReportsError: "no phone" })[0]).toBe("crash reports NOT MEASURED: no phone");
	});
});

describe("the reports that are new since the command started", () => {
	const reports = readCrashReports(
		[
			{ name: objcName, content: objc },
			{ name: asiName, content: asiOnly },
		],
		options,
	);

	test("are the ones whose files were not on the phone then, whatever their time", () => {
		expect(reportsSince(reports, new Set([asiName])).map((report) => report.file)).toEqual([objcName]);
		expect(reportsSince(reports, new Set([asiName, objcName]))).toEqual([]);
		expect(reportsSince(reports, new Set())).toHaveLength(2);
	});
});

const owned = (label: string, pid: number | null, startedAt: string): { label: string; pid: number | null; startedAtMs: number } => ({ label, pid, startedAtMs: Date.parse(startedAt) });

describe("attributing a report to a run", () => {
	const crash = must(readCrashReport(objcName, objc, options)); // pid 2958, captured 06:03:59.248Z

	test("goes to the run whose process the report names and whose process started before it", () => {
		const attributed = attribute([crash], [owned("lab 1", 2950, "2026-10-27T05:50:00Z"), owned("lab 2", 2958, "2026-10-27T06:01:40Z"), owned("lab 3", 2970, "2026-10-27T06:10:00Z")]);
		expect(attributed[0]?.attributedTo).toBe("lab 2");
	});

	test("a pid no run knows is unattributed, and so is a pid the phone reused after the report", () => {
		expect(attribute([crash], [owned("lab 1", 2950, "2026-10-27T05:50:00Z")])[0]?.attributedTo).toBe(unattributed);
		const later = owned("lab 2", 2958, new Date(Date.parse("2026-10-27T06:03:59Z") + clockSkewMs + 5000).toISOString());
		expect(attribute([crash], [later])[0]?.attributedTo).toBe(unattributed);
	});

	test("clocks that differ by less than the slack still agree", () => {
		const early = owned("lab 1", 2958, new Date(Date.parse("2026-10-27T06:03:59Z") + 20_000).toISOString());
		expect(attribute([crash], [early])[0]?.attributedTo).toBe("lab 1");
	});

	test("an unreadable report names no pid and is unattributed", () => {
		const cut = must(readCrashReport(objcName, objc.slice(0, objc.indexOf("\n") + 200), options));
		expect(attribute([cut], [owned("lab 1", 2958, "2026-10-27T06:01:40Z")])[0]?.attributedTo).toBe(unattributed);
	});

	const labRun = (pid: number, startedAt: string) =>
		labRunFromIos({ results: parseIosLabResults(sample("ios-lab-results.json")), startedAt: new Date(startedAt), durationMs: 120_000, died: null, pid, logFile: "runs/x.log" }, true);

	test("a lab run whose app aborted after its results is incomplete, with the crash in its crashes", () => {
		const runs = [labRun(2950, "2026-10-27T05:50:00Z"), labRun(2958, "2026-10-27T06:01:40Z")];
		expect(runs.every((run) => run.complete)).toBe(true);
		const marked = labRunsWithCrashes(runs, [crash]);
		expect(marked.runs[0]).toBe(runs[0]);
		expect(marked.runs[1]?.complete).toBe(false);
		expect(marked.runs[1]?.crashes).toHaveLength(1);
		expect(marked.runs[1]?.crashes[0]).toBe(
			`the app aborted after it wrote its results: NSRangeException: *** -[__NSSingleObjectArrayI objectAtIndex:]: index 1 beyond bounds [0 .. 0] (SIGABRT, ${objcName})`,
		);
		expect(marked.reports[0]?.attributedTo).toBe("lab 2");
	});

	test("a run the harness found dead has one crash: the report explains it", () => {
		const dead = { ...labRun(2958, "2026-10-27T06:01:40Z"), complete: false, crashes: ["the app (pid 2958) was not running before the lab finished"] };
		const marked = labRunsWithCrashes([dead], [crash]).runs[0];
		expect(marked?.crashes).toHaveLength(1);
		expect(marked?.crashes[0]).toMatch(/^the app aborted: NSRangeException.*the harness found the app gone: the app \(pid 2958\) was not running/);
	});

	test("a report no lab run owns leaves the runs as they were and stays in the list as unattributed", () => {
		const runs = [labRun(2950, "2026-10-27T05:50:00Z")];
		const marked = labRunsWithCrashes(runs, [crash]);
		expect(marked.runs[0]).toBe(runs[0]);
		expect(marked.reports[0]?.attributedTo).toBe(unattributed);
	});

	const launch = (index: number, pid: number, processStartMs: number): Launch => ({
		index,
		displayMs: 200,
		runningMainMs: 190,
		displayedReportedMs: null,
		totalTimeMs: 80,
		jsMarks: null,
		crashes: 0,
		jsErrors: 0,
		engineWarnings: 0,
		error: null,
		commandStartedAtMs: processStartMs - 300,
		processStartMs,
		pid,
	});

	test("a boot launch whose app aborted keeps its measurement and gains a crash", () => {
		const warm = [launch(1, 2950, Date.parse("2026-10-27T05:50:00Z")), launch(2, 2958, Date.parse("2026-10-27T06:01:43Z"))];
		const cold = [launch(1, 2970, Date.parse("2026-10-27T06:10:00Z"))];
		const marked = launchesWithCrashes({ warm, cold }, [crash]);
		expect(marked.warm[0]).toBe(warm[0]);
		expect(marked.warm[1]?.crashes).toBe(1);
		expect(marked.warm[1]?.displayMs).toBe(200);
		expect(marked.cold[0]).toBe(cold[0]);
		expect(marked.reports[0]?.attributedTo).toBe("warm 2");
	});

	test("a launch the harness found dead and a report of that process are one crash", () => {
		const dead = { ...launch(1, 2958, Date.parse("2026-10-27T06:01:43Z")), crashes: 1, error: "the app exited before its first frame" };
		expect(launchesWithCrashes({ warm: [dead], cold: [] }, [crash]).warm[0]?.crashes).toBe(1);
	});
});

/* ---- the pull: the Mac's shell runs for real, with a stand-in for idevicecrashreport ---- */

type Call = { command: string; args: string[] };

/**
 * Runs what `ssh` would run on the Mac, here in `sh`, with `path` as the whole PATH: the script's own PATH lines (the Mac's Homebrew
 * directories) are taken out so that nothing but the stand-in can answer as `idevicecrashreport`, whatever is installed on this machine.
 */
function runHere(script: string, path: string, env: Record<string, string>): Promise<ExecResult> {
	const here = script.replace("export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH; ", "").replace("export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH", ":");
	return new Promise<ExecResult>((resolve) =>
		execFile("/bin/sh", ["-c", here], { env: { PATH: path, ...env } }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr })),
	);
}

/**
 * A Mac that is this machine: `ssh` runs the pull script in `sh` with a stand-in `idevicecrashreport` (it copies the fixture's crash
 * log, or fails as the mode says), `scp` copies from a path. Nothing here reaches a phone.
 */
async function fakeMac(): Promise<{ mac: ReturnType<typeof macFrom>; log: Call[]; phone: string; mode: { value: string }; toolCalls: () => Promise<string>; bare: ReturnType<typeof macFrom>; cleanup: () => Promise<void> }> {
	const root = await mkdtemp(join(tmpdir(), "crash-pull-test-"));
	const bin = join(root, "bin");
	const empty = join(root, "empty");
	const phone = join(root, "phone");
	await mkdir(bin);
	await mkdir(empty);
	await mkdir(phone);
	await writeFile(
		join(bin, "idevicecrashreport"),
		`#!/bin/sh
echo "$@" >> "$STUB_LOG"
case "$STUB_MODE" in
  nodevice) echo "No device found with udid $2, is it plugged in?"; exit 255;;
  silent) echo "No device found"; exit 0;;
esac
filter=""
while [ $# -gt 0 ]; do
  case "$1" in
    -f) filter="$2"; shift 2;;
    -u) shift 2;;
    -k) shift;;
    *) last="$1"; shift;;
  esac
done
# The real tool copies the files whose names contain the filter, and every file without one.
(cd "$STUB_REPORTS" && find . -type f) | while IFS= read -r file; do
  case "$file" in *"$filter"*) mkdir -p "$last/$(dirname "$file")"; cp "$STUB_REPORTS/$file" "$last/$file";; esac
done
echo "Copy: /fake.ips"
echo "Done."
`,
		{ mode: 0o755 },
	);
	const log: Call[] = [];
	const mode = { value: "ok" };
	const calls = join(root, "calls.log");
	const copy = (args: string[]): Promise<ExecResult> => {
		const from = (args[args.length - 2] ?? "").replace(/^[^:]*:/, "");
		return new Promise<ExecResult>((resolve) => execFile("cp", ["-R", from, args[args.length - 1] ?? ""], (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout, stderr })));
	};
	const run: Run = (command, args) => {
		log.push({ command, args });
		if (command !== "ssh") return copy(args);
		return runHere(args[args.length - 1] ?? "", `${bin}:/usr/bin:/bin`, { STUB_REPORTS: phone, STUB_MODE: mode.value, STUB_LOG: calls });
	};
	const withoutTool: Run = (command, args) => (command === "ssh" ? runHere(args[args.length - 1] ?? "", empty, {}) : copy(args));
	return {
		mac: macFrom("me@mac", run),
		bare: macFrom("me@mac", withoutTool),
		log,
		phone,
		mode,
		toolCalls: () => readFile(calls, "utf8").catch(() => ""),
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

async function putOnPhone(phone: string, files: Record<string, string>): Promise<void> {
	for (const [name, content] of Object.entries(files)) {
		await mkdir(join(phone, name, ".."), { recursive: true });
		await writeFile(join(phone, name), content);
	}
}

const udid = "00008110-001E10593410401E";
const otherBundle = objc.replace('"bundleID":"io.rasheed.svelteqa"', '"bundleID":"com.apple.mobilesafari"');

describe("pulling the crash log through the Mac", () => {
	test("keeps the phone's reports (-k), names the phone by its hardware UDID and finds the app's reports, retired ones too", async () => {
		const fake = await fakeMac();
		try {
			await putOnPhone(fake.phone, {
				[objcName]: objc,
				[`Retired/${asiName}`]: asiOnly,
				[jetsamName]: jetsam,
				"Safari-2026-10-27-000000.ips": otherBundle,
				"Analytics-2026-10-27-030006.0005.ips.ca": "x",
			});
			const pulled = await pullCrashReports(fake.mac, udid, bundleId);
			try {
				expect(pulled.reports.map((report) => report.file)).toEqual([asiName, objcName]);
				expect((await readdir(pulled.directory)).sort()).toEqual([jetsamName, asiName, objcName].sort());
			} finally {
				await rm(pulled.directory, { recursive: true, force: true });
			}
			const script = fake.log.find((call) => call.command === "ssh")?.args.at(-1) ?? "";
			expect(script).toContain(`idevicecrashreport -u '${udid}' -k -f 'RasheedSvelteQA' '/tmp/native-qa-ios/crashes-`);
			expect(script).toContain(`idevicecrashreport -u '${udid}' -k -f JetsamEvent '/tmp/native-qa-ios/crashes-`);
			expect(script).toContain("/opt/homebrew/bin");
			// Two pulls, and each has a filter: the crash log's sysdiagnose archives are never copied, and the phone keeps everything (-k).
			const calls = (await fake.toolCalls()).trim().split("\n");
			expect(calls).toHaveLength(2);
			expect(calls[0]).toMatch(new RegExp(`^-u ${udid} -k -f RasheedSvelteQA /tmp/native-qa-ios/crashes-`));
			expect(calls[1]).toMatch(new RegExp(`^-u ${udid} -k -f JetsamEvent /tmp/native-qa-ios/crashes-`));
			for (const call of calls) expect(call).toContain(" -k ");
		} finally {
			await fake.cleanup();
		}
	});

	test("a phone usbmuxd does not know is an error with the tool's words, not an empty list", async () => {
		const fake = await fakeMac();
		try {
			fake.mode.value = "nodevice";
			await expect(pullCrashReports(fake.mac, udid, bundleId)).rejects.toThrow("No device found");
		} finally {
			await fake.cleanup();
		}
	});

	test("a tool that exits 0 without saying Done. has not pulled anything", async () => {
		const fake = await fakeMac();
		try {
			fake.mode.value = "silent";
			await expect(pullCrashReports(fake.mac, udid, bundleId)).rejects.toThrow("failed (exit 1)");
		} finally {
			await fake.cleanup();
		}
	});

	test("a Mac without idevicecrashreport says so", async () => {
		const fake = await fakeMac();
		try {
			await expect(pullCrashReports(fake.bare, udid, bundleId)).rejects.toThrow("idevicecrashreport is not installed");
		} finally {
			await fake.cleanup();
		}
	});

	test("a phone with no reports of the app is an empty list", async () => {
		const fake = await fakeMac();
		try {
			await putOnPhone(fake.phone, { "Safari-2026-10-27-000000.ips": otherBundle });
			const pulled = await pullCrashReports(fake.mac, udid, bundleId);
			await rm(pulled.directory, { recursive: true, force: true });
			expect(pulled.reports).toEqual([]);
			expect(fake.log.filter((call) => call.command === "scp")).toHaveLength(0);
		} finally {
			await fake.cleanup();
		}
	});
});

describe("watching the crash log across a command", () => {
	test("only the reports that were not on the phone at the start count, and their files are kept with the run", async () => {
		const fake = await fakeMac();
		const runs = await mkdtemp(join(tmpdir(), "crash-runs-test-"));
		try {
			await putOnPhone(fake.phone, { [`Retired/${asiName}`]: asiOnly });
			const watch = await startCrashWatch(fake.mac, udid, bundleId);
			expect([...(watch.known ?? [])]).toEqual([asiName]);
			await putOnPhone(fake.phone, { [objcName]: objc });
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record.crashReportsError).toBeUndefined();
			expect(found.record.crashReports?.map((report) => report.file)).toEqual([objcName]);
			const kept = await keepCrashFiles(found, "lab-E74A-20261027T060000Z", runs);
			expect(kept).toBe(join(runs, "lab-E74A-20261027T060000Z-crashes"));
			expect(await readdir(kept ?? "")).toEqual([objcName]);
			expect(await readFile(join(kept ?? "", objcName), "utf8")).toBe(objc);
		} finally {
			await fake.cleanup();
			await rm(runs, { recursive: true, force: true });
		}
	});

	test("a run that added nothing records an empty list, and keeps no directory", async () => {
		const fake = await fakeMac();
		try {
			await putOnPhone(fake.phone, { [objcName]: objc });
			const watch = await startCrashWatch(fake.mac, udid, bundleId);
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record).toEqual({ crashReports: [] });
			expect(found.directory).toBeNull();
			expect(await keepCrashFiles(found, "lab-x")).toBeNull();
		} finally {
			await fake.cleanup();
		}
	});

	test("a pull that failed at the start leaves nothing to tell new from old: not measured, and no second pull is tried", async () => {
		const fake = await fakeMac();
		try {
			fake.mode.value = "nodevice";
			const watch = await startCrashWatch(fake.mac, udid, bundleId);
			expect(watch.known).toBeNull();
			fake.mode.value = "ok";
			const before = fake.log.length;
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record.crashReports).toBeUndefined();
			expect(found.record.crashReportsError).toMatch(/^before the run: .*No device found/);
			expect(fake.log).toHaveLength(before);
		} finally {
			await fake.cleanup();
		}
	});

	test("a pull that failed at the end is not measured, never an empty list", async () => {
		const fake = await fakeMac();
		try {
			const watch = await startCrashWatch(fake.mac, udid, bundleId);
			fake.mode.value = "nodevice";
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record.crashReports).toBeUndefined();
			expect(found.record.crashReportsError).toMatch(/^after the run: .*No device found/);
		} finally {
			await fake.cleanup();
		}
	});

	test("attribution keeps an error record as it is", () => {
		expect(withReports({ crashReportsError: "x" }, [])).toEqual({ crashReportsError: "x" });
	});
});
