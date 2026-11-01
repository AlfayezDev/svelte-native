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
	listCrashLog,
	parseCrashLogListing,
	parsePhoneTime,
	pullCrashFiles,
	readCrashReport,
	readCrashReports,
	reportFiles,
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

/* ---- reading the crash log: the Mac's shell runs for real, with a stand-in for `xcrun devicectl` ---- */

type Call = { command: string; args: string[] };

/**
 * Runs what `ssh` would run on the Mac, here in `sh`, with `path` as the whole PATH: nothing but the stand-in can answer as `xcrun`,
 * whatever is installed on this machine.
 */
function runHere(script: string, path: string, env: Record<string, string>): Promise<ExecResult> {
	const here = script.replace("export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$PATH; ", "");
	return new Promise<ExecResult>((resolve) =>
		execFile("/bin/sh", ["-c", here], { env: { PATH: path, ...env } }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr })),
	);
}

/**
 * A Mac that is this machine: `ssh` runs the script in `sh` with a stand-in `xcrun` whose `devicectl` lists and copies the fixture's
 * crash log (the shapes `devicectl device info files --domain-type systemCrashLogs` and `device copy from` have on the lab phone), or
 * fails or hangs as the mode says; `scp` copies from a path. Nothing here reaches a phone.
 */
async function fakeMac(): Promise<{ mac: ReturnType<typeof macFrom>; log: Call[]; phone: string; mode: { value: string }; toolCalls: () => Promise<string>; cleanup: () => Promise<void> }> {
	const root = await mkdtemp(join(tmpdir(), "crash-pull-test-"));
	const bin = join(root, "bin");
	const phone = join(root, "phone");
	await mkdir(bin);
	await mkdir(phone);
	await writeFile(
		join(bin, "xcrun"),
		`#!/bin/sh
echo "$@" >> "$STUB_LOG"
case "$STUB_MODE" in
  nodevice) echo "ERROR: The device was not found (com.apple.dt.CoreDeviceError error 4000)." >&2; exit 1;;
  hang) sleep 30; exit 0;;
  notjson) json=""; while [ $# -gt 0 ]; do case "$1" in --json-output) json="$2"; shift 2;; *) shift;; esac; done; [ -n "$json" ] && echo 'not json' > "$json"; exit 0;;
esac
# xcrun devicectl [--json-output FILE] device info files|copy from --device ID --domain-type systemCrashLogs [--source P --destination D]
shift
json=""; source=""; destination=""; verb=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json-output) json="$2"; shift 2;;
    --source) source="$2"; shift 2;;
    --destination) destination="$2"; shift 2;;
    --device|--domain-type) shift 2;;
    info) verb=info; shift;;
    copy) verb=copy; shift;;
    *) shift;;
  esac
done
if [ "$verb" = copy ]; then
  [ -f "$STUB_REPORTS/$source" ] || { echo "ERROR: no such file $source" >&2; exit 1; }
  cp "$STUB_REPORTS/$source" "$destination"
  echo "File received from Device"
  exit 0
fi
# The listing: every directory and file, recursively, as devicectl writes it.
{
  printf '{"info":{"outcome":"success"},"result":{"deviceIdentifier":"ID","domain":"systemCrashLogs","files":['
  first=1
  (cd "$STUB_REPORTS" && find . -mindepth 1 | sed 's|^\\./||' | sort) | while IFS= read -r path; do
    [ $first = 1 ] || printf ','
    first=0
    if [ -d "$STUB_REPORTS/$path" ]; then dir=true; size=96; else dir=false; size=$(wc -c < "$STUB_REPORTS/$path" | tr -d ' '); fi
    printf '{"metadata":{"size":%s},"name":"%s","relativePath":"%s","resources":{"isDirectory":%s}}' "$size" "$(basename "$path")" "$path" "$dir"
  done
  printf ']}}'
} > "$json"
echo "listing"
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
	return {
		mac: macFrom("me@mac", run),
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

const deviceId = "E74A5608-BF8E-5806-8699-1605F82ADED9";
const otherBundle = objc.replace('"bundleID":"io.rasheed.svelteqa"', '"bundleID":"com.apple.mobilesafari"');
const watchOptions = (fake: { mac: ReturnType<typeof macFrom> }, extra: { limitSeconds?: number } = {}) => ({ mac: fake.mac, deviceId, bundleId, ...extra });

describe("listing the crash log of the phone", () => {
	test("lists files, not directories, retired ones too, and never reads a file", async () => {
		const fake = await fakeMac();
		try {
			await putOnPhone(fake.phone, {
				[objcName]: objc,
				[`Retired/${asiName}`]: asiOnly,
				[jetsamName]: jetsam,
				"Safari-2026-10-27-000000.ips": otherBundle,
				"DiagnosticLogs/sysdiagnose/sysdiagnose_2026.10.28_14-16-37+0300_iPhone-OS_iPhone_23G71.tar.gz": "x".repeat(64),
			});
			const listing = await listCrashLog(fake.mac, deviceId);
			expect(listing.files.map((file) => file.path).sort()).toEqual(
				[`Retired/${asiName}`, "DiagnosticLogs/sysdiagnose/sysdiagnose_2026.10.28_14-16-37+0300_iPhone-OS_iPhone_23G71.tar.gz", jetsamName, "Safari-2026-10-27-000000.ips", objcName].sort(),
			);
			expect(listing.files.find((file) => file.name === asiName)).toEqual({ path: `Retired/${asiName}`, name: asiName, bytes: asiOnly.length });
			expect(reportFiles(listing.files).map((file) => file.name).sort()).toEqual([jetsamName, asiName, objcName].sort());
			// One bounded call to the phone: nothing is copied, whatever the log holds (a sysdiagnose archive is 270 MB).
			const script = fake.log.find((call) => call.command === "ssh")?.args.at(-1) ?? "";
			expect(script).toContain(`'perl' '-e' 'alarm shift; exec @ARGV' '40' 'xcrun' 'devicectl' '--json-output'`);
			expect(script).toContain(`'--device' '${deviceId}' '--domain-type' 'systemCrashLogs'`);
			expect(fake.log.filter((call) => call.command === "scp")).toHaveLength(0);
			const calls = (await fake.toolCalls()).trim().split("\n");
			expect(calls).toHaveLength(1);
			expect(calls[0]).toContain("devicectl --json-output");
			expect(calls[0]).toContain("device info files");
		} finally {
			await fake.cleanup();
		}
	});

	test("a phone devicectl does not know is an error with the tool's words, not an empty list, after two tries", async () => {
		const fake = await fakeMac();
		try {
			fake.mode.value = "nodevice";
			await expect(listCrashLog(fake.mac, deviceId)).rejects.toThrow("The device was not found");
			expect((await fake.toolCalls()).trim().split("\n")).toHaveLength(2);
		} finally {
			await fake.cleanup();
		}
	});

	test("an answer that is not a listing is an error, never a phone with no reports", async () => {
		const fake = await fakeMac();
		try {
			fake.mode.value = "notjson";
			await expect(listCrashLog(fake.mac, deviceId)).rejects.toThrow("not a listing of the crash log");
		} finally {
			await fake.cleanup();
		}
	});

	test("a call that hangs is ended by the Mac after the limit, so it does not go on holding the phone", async () => {
		const fake = await fakeMac();
		try {
			fake.mode.value = "hang";
			const began = Date.now();
			await expect(listCrashLog(fake.mac, deviceId, { limitSeconds: 1 })).rejects.toThrow("devicectl did not answer in 1 s");
			expect(Date.now() - began).toBeLessThan(10_000);
		} finally {
			await fake.cleanup();
		}
	});

	test("the listing of an empty log is an empty list", () => {
		expect(parseCrashLogListing('{"info":{"outcome":"success"},"result":{"files":[]}}')).toEqual([]);
		expect(() => parseCrashLogListing("{}")).toThrow("no result.files");
		expect(() => parseCrashLogListing("nope")).toThrow("no result.files");
	});

	test("which files can be reports of the app: its own by process name, and every jetsam event; the smoke app's by its own process name", () => {
		const file = (name: string) => ({ path: name, name, bytes: 1 });
		const files = [file("RasheedSvelteQA-2026-10-27-090359.ips"), file("Sveltesmoke-2026-11-01-171503.ips"), file("JetsamEvent-2026-10-26-232518.ips"), file("Safari-2026-10-27-000000.ips"), file("RasheedSvelteQA-notes.txt")];
		expect(reportFiles(files).map((entry) => entry.name)).toEqual(["RasheedSvelteQA-2026-10-27-090359.ips", "JetsamEvent-2026-10-26-232518.ips"]);
		expect(reportFiles(files, "Sveltesmoke").map((entry) => entry.name)).toEqual(["Sveltesmoke-2026-11-01-171503.ips", "JetsamEvent-2026-10-26-232518.ips"]);
	});
});

describe("copying reports of the crash log", () => {
	test("copies only the named files, one bounded call each, and reads them", async () => {
		const fake = await fakeMac();
		try {
			await putOnPhone(fake.phone, { [objcName]: objc, [`Retired/${asiName}`]: asiOnly, [jetsamName]: jetsam });
			const pulled = await pullCrashFiles(fake.mac, deviceId, [{ path: objcName, name: objcName, bytes: null }, { path: `Retired/${asiName}`, name: asiName, bytes: null }], { bundleId });
			try {
				expect(pulled.reports.map((report) => report.file)).toEqual([asiName, objcName]);
				expect((await readdir(pulled.directory)).sort()).toEqual([asiName, objcName].sort());
			} finally {
				await rm(pulled.directory, { recursive: true, force: true });
			}
			const calls = (await fake.toolCalls()).trim().split("\n");
			expect(calls).toHaveLength(2);
			expect(calls[0]).toContain(`device copy from --device ${deviceId} --domain-type systemCrashLogs --source ${objcName}`);
			expect(calls[1]).toContain(`--source Retired/${asiName}`);
		} finally {
			await fake.cleanup();
		}
	});

	test("a file that does not arrive fails the pull with devicectl's words", async () => {
		const fake = await fakeMac();
		try {
			await expect(pullCrashFiles(fake.mac, deviceId, [{ path: objcName, name: objcName, bytes: null }], { bundleId })).rejects.toThrow("copying RasheedSvelteQA-2026-10-27-090359.ips failed");
		} finally {
			await fake.cleanup();
		}
	});

	test("no file to copy is no call to the phone and no copy of files", async () => {
		const fake = await fakeMac();
		try {
			const pulled = await pullCrashFiles(fake.mac, deviceId, [], { bundleId });
			await rm(pulled.directory, { recursive: true, force: true });
			expect(pulled.reports).toEqual([]);
			expect(fake.log.filter((call) => call.command === "scp")).toHaveLength(0);
			expect(await fake.toolCalls()).toBe("");
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
			await putOnPhone(fake.phone, { [`Retired/${asiName}`]: asiOnly, [jetsamName]: jetsam });
			const watch = await startCrashWatch(watchOptions(fake));
			expect([...(watch.known ?? [])].sort()).toEqual([jetsamName, asiName].sort());
			expect(watch.listedMs).not.toBeNull();
			await putOnPhone(fake.phone, { [objcName]: objc });
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record.crashReportsError).toBeUndefined();
			expect(found.record.crashReports?.map((report) => report.file)).toEqual([objcName]);
			// Two listings and one copy: the log is listed twice and only the new report is copied.
			const calls = (await fake.toolCalls()).trim().split("\n");
			expect(calls.filter((call) => call.includes("device info files"))).toHaveLength(2);
			expect(calls.filter((call) => call.includes("device copy from"))).toHaveLength(1);
			expect(calls.at(-1)).toContain(`--source ${objcName}`);
			const kept = await keepCrashFiles(found, "lab-E74A-20261027T060000Z", runs);
			expect(kept).toBe(join(runs, "lab-E74A-20261027T060000Z-crashes"));
			expect(await readdir(kept ?? "")).toEqual([objcName]);
			expect(await readFile(join(kept ?? "", objcName), "utf8")).toBe(objc);
		} finally {
			await fake.cleanup();
			await rm(runs, { recursive: true, force: true });
		}
	});

	test("a jetsam event that did not kill the app is not a report, and its file is not kept", async () => {
		const fake = await fakeMac();
		try {
			const watch = await startCrashWatch(watchOptions(fake));
			const quiet = edited(jetsam, (body) => {
				body.processes = [{ name: "SpringBoard", pid: 33, reason: "highwater" }];
			});
			await putOnPhone(fake.phone, { "JetsamEvent-2026-11-01-120000.ips": quiet });
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record).toEqual({ crashReports: [] });
			expect(found.directory).toBeNull();
		} finally {
			await fake.cleanup();
		}
	});

	test("a run that added nothing records an empty list, copies nothing and keeps no directory", async () => {
		const fake = await fakeMac();
		try {
			await putOnPhone(fake.phone, { [objcName]: objc });
			const watch = await startCrashWatch(watchOptions(fake));
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record).toEqual({ crashReports: [] });
			expect(found.directory).toBeNull();
			expect(await keepCrashFiles(found, "lab-x")).toBeNull();
			expect((await fake.toolCalls()).includes("copy from")).toBe(false);
		} finally {
			await fake.cleanup();
		}
	});

	test("a listing that failed at the start leaves nothing to tell new from old: not measured, and no second listing is tried", async () => {
		const fake = await fakeMac();
		try {
			fake.mode.value = "nodevice";
			const watch = await startCrashWatch(watchOptions(fake));
			expect(watch.known).toBeNull();
			fake.mode.value = "ok";
			const before = fake.log.length;
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record.crashReports).toBeUndefined();
			expect(found.record.crashReportsError).toMatch(/^before the run: .*The device was not found/);
			expect(fake.log).toHaveLength(before);
		} finally {
			await fake.cleanup();
		}
	});

	test("a listing that failed at the end is not measured, never an empty list", async () => {
		const fake = await fakeMac();
		try {
			const watch = await startCrashWatch(watchOptions(fake));
			fake.mode.value = "nodevice";
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record.crashReports).toBeUndefined();
			expect(found.record.crashReportsError).toMatch(/^after the run: .*The device was not found/);
		} finally {
			await fake.cleanup();
		}
	});

	test("a phone that hangs at the end is not measured within the limit, instead of holding the run", async () => {
		const fake = await fakeMac();
		try {
			const watch = await startCrashWatch(watchOptions(fake, { limitSeconds: 1 }));
			fake.mode.value = "hang";
			const began = Date.now();
			const found = await finishCrashWatch(watch, { settleMs: 0 });
			expect(found.record.crashReportsError).toMatch(/^after the run: .*devicectl did not answer in 1 s/);
			expect(Date.now() - began).toBeLessThan(15_000);
		} finally {
			await fake.cleanup();
		}
	});

	test("the smoke app's reports are named by its own process", async () => {
		const fake = await fakeMac();
		try {
			await putOnPhone(fake.phone, { "Sveltesmoke-2026-11-01-171503.ips": objc.replace('"app_name":"RasheedSvelteQA"', '"app_name":"Sveltesmoke"').replace('"bundleID":"io.rasheed.svelteqa"', '"bundleID":"io.rasheed.svelteqa.smoke"') });
			const watch = await startCrashWatch({ ...watchOptions(fake), bundleId: "io.rasheed.svelteqa.smoke", processName: "Sveltesmoke" });
			expect([...(watch.known ?? [])]).toEqual(["Sveltesmoke-2026-11-01-171503.ips"]);
			const qa = await startCrashWatch(watchOptions(fake));
			expect([...(qa.known ?? [])]).toEqual([]);
		} finally {
			await fake.cleanup();
		}
	});

	test("attribution keeps an error record as it is", () => {
		expect(withReports({ crashReportsError: "x" }, [])).toEqual({ crashReportsError: "x" });
	});
});
