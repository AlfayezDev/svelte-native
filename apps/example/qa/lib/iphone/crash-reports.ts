import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellQuote } from "../exec.ts";
import { runsDir } from "../paths.ts";
import type { CrashFrame, CrashReport, CrashReportsRecord, LabRun, Launch } from "../types.ts";
import { sleep } from "../wait.ts";
import { remote, scpFrom, words, type Mac } from "./mac.ts";

/**
 * The iPhone's crash log, read through the Mac the phone is paired with (`xcrun devicectl`, see "reading the crash log" below). An app that
 * aborts after it wrote its results, at the end of the last scenario or while the harness ends it, leaves nothing in the files
 * the harness reads: only the system's crash report says so. Every iOS command lists the app's reports before and after its run;
 * the reports that were not there before are the run's.
 */

/** The hardware UDID of the lab's iPhone (the id `idevice_id -l` prints, not the CoreDevice id `devicectl` uses); `--udid` names another. `xcodebuild` and the USB check take it. */
export const defaultHardwareUdid = "00008110-001E10593410401E";

/** The QA app's executable: its reports are named after it, and a jetsam event names the processes it lists by it. */
export const qaProcessName = "RasheedSvelteQA";

/** What attribution calls a report of a process no run of the command launched. */
export const unattributed = "unattributed";

const reasonLimit = 300;
const frameLimit = 12;

/**
 * The crash report is written by the system a moment after the process dies: the pull at the end of a run waits this long after the
 * app was ended, so a teardown crash is not read before its report exists.
 */
export const settleMs = 5_000;

/**
 * How far the phone's clock and this machine's may differ before attribution stops trusting them: a report captured more than this
 * before the harness started a run cannot be that run's, even with its pid. The clocks are only compared there.
 */
export const clockSkewMs = 60_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/**
 * A time as a report writes it, `2026-10-27 09:03:59.2484 +0300`: the phone's local time and its UTC offset, which makes it an
 * instant. Milliseconds since the epoch; null for anything else.
 */
export function parsePhoneTime(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))? ([+-])(\d{2}):?(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const [, year, month, day, hour, minute, second, fraction, sign, offsetHours, offsetMinutes] = match.map((part) => part ?? "");
	const local = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Math.floor(Number(`0.${fraction || "0"}`) * 1000));
	const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000;
	return sign === "-" ? local + offset : local - offset;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

function framesFrom(frames: unknown, images: unknown): CrashFrame[] {
	if (!Array.isArray(frames)) return [];
	const names = Array.isArray(images) ? images.map((image) => (isRecord(image) ? text(image.name) : null)) : [];
	return frames
		.filter(isRecord)
		.slice(0, frameLimit)
		.map((frame) => {
			const index = count(frame.imageIndex);
			return { image: index === null ? null : (names[index] ?? null), offset: count(frame.imageOffset) ?? 0, symbol: text(frame.symbol) };
		});
}

const limited = (reason: string | null): string | null => (reason === null ? null : reason.slice(0, reasonLimit));

/** The exception's own message, else what the abort said (`asi`), else the termination's words, else the exception's subtype. */
function reasonOf(body: Record<string, unknown>): string | null {
	const exception = isRecord(body.exceptionReason) ? body.exceptionReason : null;
	const message = exception ? (text(exception.composed_message) ?? text(exception.format_string)) : null;
	if (message) {
		const name = text(exception?.name);
		return limited(name ? `${name}: ${message}` : message);
	}
	if (isRecord(body.asi)) {
		const lines = Object.values(body.asi)
			.flatMap((value) => (Array.isArray(value) ? value : []))
			.map(text)
			.filter((line): line is string => line !== null);
		if (lines.length > 0) return limited(lines.join("; "));
	}
	if (isRecord(body.termination)) {
		const details = Array.isArray(body.termination.details) ? body.termination.details.map(text).filter((line): line is string => line !== null) : [];
		const words = [text(body.termination.indicator), ...details].filter((line): line is string => line !== null);
		if (words.length > 0) return limited(words.join("; "));
	}
	return isRecord(body.exception) ? limited(text(body.exception.subtype)) : null;
}

/** The JSON object in `value`, or null when it is not JSON or not an object. */
function parseObject(value: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function unreadable(file: string, why: string, header: Record<string, unknown> | null): CrashReport {
	return {
		file,
		capturedAt: iso(parsePhoneTime(header?.timestamp)),
		processStartedAt: null,
		pid: null,
		exceptionType: null,
		signal: null,
		reason: limited(`the report could not be read: ${why}`),
		framesOf: null,
		topFrames: [],
	};
}

function crashOf(file: string, header: Record<string, unknown>, body: Record<string, unknown>): CrashReport {
	const exception = isRecord(body.exception) ? body.exception : {};
	// Where an exception was thrown is where its cause is; the faulting thread's own first frames are the runtime's abort machinery.
	const thrown = framesFrom(body.lastExceptionBacktrace, body.usedImages);
	const threads = Array.isArray(body.threads) ? body.threads : [];
	const faultingIndex = count(body.faultingThread);
	const faulting = faultingIndex === null ? null : threads[faultingIndex];
	const stack = thrown.length > 0 ? thrown : framesFrom(isRecord(faulting) ? faulting.frames : null, body.usedImages);
	return {
		file,
		capturedAt: iso(parsePhoneTime(body.captureTime) ?? parsePhoneTime(header.timestamp)),
		processStartedAt: iso(parsePhoneTime(body.procLaunch)),
		pid: count(body.pid),
		exceptionType: text(exception.type),
		signal: text(exception.signal),
		reason: reasonOf(body),
		framesOf: stack.length === 0 ? null : thrown.length > 0 ? "lastExceptionBacktrace" : "faultingThread",
		topFrames: stack,
	};
}

/** A jetsam event lists every process of the phone; it is a report of the app only when the system killed the app (an entry with a `reason`). */
function jetsamOf(file: string, header: Record<string, unknown>, body: Record<string, unknown>, processName: string): CrashReport | null {
	const killed = (Array.isArray(body.processes) ? body.processes : []).filter(isRecord).find((entry) => entry.name === processName && text(entry.reason) !== null);
	if (!killed) return null;
	return {
		file,
		capturedAt: iso(parsePhoneTime(body.date) ?? parsePhoneTime(header.timestamp)),
		processStartedAt: null,
		pid: count(killed.pid),
		exceptionType: "JETSAM",
		signal: null,
		reason: limited(`the system killed the app: ${text(killed.reason)}`),
		framesOf: null,
		topFrames: [],
	};
}

/**
 * One `.ips` file of the phone's crash log as a report of the app, or null when it is not about the app: another bundle's report, or a
 * jetsam event that killed another process. A file that is the app's by its name or its header but cannot be read is a report all the
 * same (`exceptionType` null): a crash is never dropped because its file was cut short.
 */
export function readCrashReport(file: string, content: string, options: { bundleId: string; processName?: string }): CrashReport | null {
	if (!file.endsWith(".ips")) return null;
	const processName = options.processName ?? qaProcessName;
	const ours = file.startsWith(`${processName}-`);
	const split = content.indexOf("\n");
	const header = parseObject(split < 0 ? content : content.slice(0, split));
	if (header === null) return ours ? unreadable(file, "its header is not JSON", null) : null;
	const jetsam = header.bug_type === "298";
	if (!jetsam && header.bundleID !== options.bundleId && !(header.bundleID === undefined && ours)) return null;
	const body = split < 0 ? null : parseObject(content.slice(split + 1));
	if (body === null) return jetsam ? null : unreadable(file, "its body is not JSON", header);
	return jetsam ? jetsamOf(file, header, body, processName) : crashOf(file, header, body);
}

/** The reports of the app among the files of a crash log, oldest first. */
export function readCrashReports(files: { name: string; content: string }[], options: { bundleId: string; processName?: string }): CrashReport[] {
	const reports = files.map((file) => readCrashReport(file.name, file.content, options)).filter((report): report is CrashReport => report !== null);
	return reports.sort((a, b) => (a.capturedAt ?? "").localeCompare(b.capturedAt ?? "") || a.file.localeCompare(b.file));
}

/**
 * The reports that were not on the phone when the command started: by file name, which is the phone's own record of each report and
 * needs no clock. (A moment on the phone's clock would also do, and does not need the first pull, but a report written late for a crash
 * before the moment, or two crashes in one second, would be missed; a name never is.)
 */
export function reportsSince(reports: CrashReport[], known: ReadonlySet<string>): CrashReport[] {
	return reports.filter((report) => !known.has(report.file));
}

/** A run of the command, as far as crash reports are concerned: its label, the process it launched, and when. */
export type RunProcess = { label: string; pid: number | null; startedAtMs: number | null };

/**
 * Whose report each one is: the run whose process it names (`pid`, which is the phone's own and needs no clock) and whose process had
 * started before the report was captured. Two clocks are compared only there, with `clockSkewMs` of slack: a pid the phone reused long
 * after the run is not the run's. A report no run owns is `unattributed`; it is listed and it counts all the same.
 */
export function attribute(reports: CrashReport[], processes: RunProcess[]): CrashReport[] {
	return reports.map((report) => {
		const capturedMs = report.capturedAt === null ? null : Date.parse(report.capturedAt);
		const owners = processes.filter(
			(entry) => report.pid !== null && entry.pid === report.pid && (entry.startedAtMs === null || capturedMs === null || capturedMs >= entry.startedAtMs - clockSkewMs),
		);
		const owner = owners.sort((a, b) => (b.startedAtMs ?? 0) - (a.startedAtMs ?? 0))[0];
		return { ...report, attributedTo: owner?.label ?? unattributed };
	});
}

/** What a report says in a run's `crashes` line. */
export function describeCrash(report: CrashReport): string {
	return `${report.reason ?? "no reason in the report"} (${report.signal ?? report.exceptionType ?? "unreadable"}, ${report.file})`;
}

/**
 * The lab runs with the crash reports attributed to them: a run whose app aborted is incomplete, however good its results were. A run
 * the harness already found dead (`crashes` is then the one line saying so) has one crash, not two: the report is that crash explained.
 */
export function labRunsWithCrashes(runs: LabRun[], reports: CrashReport[]): { runs: LabRun[]; reports: CrashReport[] } {
	const attributed = attribute(
		reports,
		runs.map((run, index) => ({ label: `lab ${index + 1}`, pid: run.pid ?? null, startedAtMs: Date.parse(run.startedAt) })),
	);
	const marked = runs.map((run, index) => {
		const own = attributed.filter((report) => report.attributedTo === `lab ${index + 1}`);
		if (own.length === 0) return run;
		const lines = own.map((report) => `${run.complete ? "the app aborted after it wrote its results" : "the app aborted"}: ${describeCrash(report)}`);
		const seen = run.crashes.length > 0;
		return { ...run, complete: false, crashes: seen ? lines.map((line) => `${line} (the harness found the app gone: ${run.crashes.join("; ")})`) : lines };
	});
	return { runs: marked, reports: attributed };
}

/** The boot launches with the crash reports attributed to them: the launch's measurement stands, its crash count does not stay 0 (a launch the harness found dead has that one crash, which the report explains). */
export function launchesWithCrashes(launches: { warm: Launch[]; cold: Launch[] }, reports: CrashReport[]): { warm: Launch[]; cold: Launch[]; reports: CrashReport[] } {
	const labelled = (kind: "warm" | "cold") => launches[kind].map((launch) => ({ launch, label: `${kind} ${launch.index}` }));
	const all = [...labelled("warm"), ...labelled("cold")];
	const attributed = attribute(
		reports,
		all.map(({ launch, label }) => ({ label, pid: launch.pid ?? null, startedAtMs: launch.processStartMs ?? launch.commandStartedAtMs ?? null })),
	);
	const mark = (kind: "warm" | "cold") =>
		launches[kind].map((launch) => {
			const own = attributed.filter((report) => report.attributedTo === `${kind} ${launch.index}`).length;
			return own <= launch.crashes ? launch : { ...launch, crashes: own };
		});
	return { warm: mark("warm"), cold: mark("cold"), reports: attributed };
}

/** The reports of a file that no run owns: they are fatals of the file all the same. */
export const unattributedCount = (reports: CrashReport[] | undefined): number => (reports ?? []).filter((report) => report.attributedTo === unattributed).length;

/** What a command prints of its crash reports. */
export function describeCrashReports(record: CrashReportsRecord): string[] {
	if (record.crashReportsError !== undefined)
		return [`crash reports NOT MEASURED: ${record.crashReportsError}`, "  the run file records crashReportsError; log.crashReports reads not measured and its gate fails"];
	const reports = record.crashReports ?? [];
	if (reports.length === 0) return ["crash reports: none new on the phone"];
	const lines = [`crash reports: ${reports.length} new on the phone`];
	for (const report of reports) {
		lines.push(
			`  ${report.file}  ${report.capturedAt ?? "no capture time"}  pid ${report.pid ?? "?"}  ${report.exceptionType ?? "unreadable"}${report.signal ? ` ${report.signal}` : ""}${report.attributedTo ? `  [${report.attributedTo}]` : ""}`,
		);
		if (report.reason) lines.push(`    ${report.reason}`);
		for (const frame of report.topFrames.slice(0, 6)) lines.push(`    ${frame.image ?? "?"} +${frame.offset} ${frame.symbol ?? ""}`.trimEnd());
	}
	return lines;
}

/* ---- reading the crash log ---- */

/*
 * The crash log of the phone holds more than reports: sysdiagnose archives of 270 MB each, one for every UI-testing start that timed out
 * (seven of them, 1.6 GB, on the lab phone on 1 Nov 2026). `idevicecrashreport` reaches the log through the phone's crash-report mover and
 * a copy service, and copied all of it: a pull took more than the 180 s the harness allowed (the Mac's script went on, orphaned, for
 * seven minutes, and the next pull queued behind it). Filtering its copy by name (`-f`) made one pull 2 s, but left the cost tied to
 * what the phone happens to hold and to a tool that cannot say what it has before it copies. So the harness no longer copies the log:
 * it LISTS it (`devicectl device info files --domain-type systemCrashLogs`: names, sizes and dates, 1 s on the lab phone, the report of
 * a deliberate SIGABRT in the listing 4.5 s after the signal, with no mover) and copies only the reports that appeared during the run
 * (`devicectl device copy from`, 1 s each). Every phone command runs under an `alarm` on the Mac, so the Mac ends it and nothing outlives
 * the harness's wait.
 */

const macScratch = "/tmp/native-qa-ios";
let counter = 0;

/** What one phone command may take on the Mac before the Mac ends it (a listing is 1 s; `devicectl` calls hang for 90 s now and then, around UI tests). */
export const defaultLimitSeconds = 40;
/** A listing that failed is tried once more: the hang above is not a state of the phone but of one `devicectl` call. */
const listAttempts = 2;

/** The command prefixed so that the Mac kills it after `seconds` (`perl` is on every Mac; `timeout` is not). */
const bounded = (seconds: number, command: readonly string[]): string => words(["perl", "-e", "alarm shift; exec @ARGV", String(seconds), ...command]);
const devicectlFiles = (deviceId: string, args: readonly string[]): string[] => ["xcrun", "devicectl", ...args, "--device", deviceId, "--domain-type", "systemCrashLogs"];
/** The shell's status for a command the alarm ended (128 + SIGALRM). */
const killedByAlarm = 142;

/** A file of the crash log, as `devicectl device info files` lists it. */
export type CrashLogFile = {
	/** Relative to the crash log: `RasheedSvelteQA-2026-11-01-171503.ips`, or `Retired/RasheedSvelteQA-...` once the phone retired it. */
	path: string;
	name: string;
	bytes: number | null;
};

/**
 * The files (not the directories) in the JSON `devicectl device info files` writes. A document that is not devicectl's listing throws:
 * a listing of no files has an empty `files` array, and anything else is a tool that failed, never a phone with nothing on it.
 */
export function parseCrashLogListing(document: string): CrashLogFile[] {
	const parsed = parseObject(document);
	const result = parsed && isRecord(parsed.result) ? parsed.result : null;
	if (!result || !Array.isArray(result.files)) throw new Error("devicectl's answer is not a listing of the crash log (no result.files)");
	return result.files.filter(isRecord).flatMap((entry) => {
		const path = text(entry.relativePath) ?? text(entry.name);
		const resources = isRecord(entry.resources) ? entry.resources : {};
		if (path === null || resources.isDirectory === true) return [];
		const metadata = isRecord(entry.metadata) ? entry.metadata : {};
		return [{ path, name: path.slice(path.lastIndexOf("/") + 1), bytes: count(metadata.size) }];
	});
}


/** The files that can be reports of the app or that killed it: its crash reports (`<process>-<date>.ips`) and the jetsam events (which name no bundle). */
export function reportFiles(files: readonly CrashLogFile[], processName: string = qaProcessName): CrashLogFile[] {
	return files.filter((file) => file.name.endsWith(".ips") && (file.name.startsWith(`${processName}-`) || file.name.startsWith("JetsamEvent-")));
}

/** The shell the Mac runs to list the crash log: devicectl writes its JSON to a file (the only interface it supports for scripts), which is printed. */
export function listScript(options: { deviceId: string; file: string; limitSeconds: number }): string {
	const file = shellQuote(options.file);
	const log = shellQuote(`${options.file}.log`);
	return [
		`mkdir -p ${shellQuote(macScratch)}`,
		`${bounded(options.limitSeconds, [...devicectlFiles(options.deviceId, ["--json-output", options.file, "device", "info", "files"])])} > ${log} 2>&1`,
		"code=$?",
		`if [ $code -ne 0 ]; then if [ $code -eq ${killedByAlarm} ]; then echo 'devicectl did not answer in ${options.limitSeconds} s' >&2; fi; tail -n 6 ${log} >&2; rm -f ${file} ${log}; exit $code; fi`,
		`cat ${file}`,
		`rm -f ${file} ${log}`,
	].join("\n");
}

/** The shell that copies the named files of the crash log into `directory` on the Mac, one bounded `devicectl` call each; it fails if any file did not arrive. */
export function fetchScript(options: { deviceId: string; directory: string; files: readonly CrashLogFile[]; limitSeconds: number }): string {
	const dir = shellQuote(options.directory);
	return [
		`rm -rf ${dir}`,
		`mkdir -p ${dir}`,
		"failed=0",
		...options.files.map((file) => {
			const log = shellQuote(`${options.directory}/${file.name}.log`);
			const copy = bounded(options.limitSeconds, [...devicectlFiles(options.deviceId, ["device", "copy", "from"]), "--source", file.path, "--destination", `${options.directory}/${file.name}`]);
			return `${copy} > ${log} 2>&1 || { echo ${shellQuote(`copying ${file.path} failed:`)} >&2; tail -n 4 ${log} >&2; failed=1; }`;
		}),
		`if [ $failed -ne 0 ]; then rm -rf ${dir}; exit 1; fi`,
		`rm -f ${dir}/*.log`,
		`echo "copied=$(ls ${dir} | wc -l | tr -d ' ')"`,
	].join("\n");
}

/** What a failed phone command said: the Mac's words, never an empty message. */
const said = (result: { stderr: string; stdout: string }): string => (result.stderr || result.stdout).trim().slice(0, 400) || "no output";

export type CrashLogListing = { files: CrashLogFile[]; ms: number };

/** Lists the crash log of the phone (CoreDevice id `deviceId`), trying twice; throws with the tool's own words, never returns a list it could not read. */
export async function listCrashLog(mac: Mac, deviceId: string, options: { limitSeconds?: number } = {}): Promise<CrashLogListing> {
	const limitSeconds = options.limitSeconds ?? defaultLimitSeconds;
	const began = Date.now();
	let failure = "";
	for (let attempt = 1; attempt <= listAttempts; attempt++) {
		const result = await remote(mac, listScript({ deviceId, file: `${macScratch}/crashlog-${process.pid}-${++counter}.json`, limitSeconds }), { timeoutMs: (limitSeconds + 20) * 1000 });
		if (result.code === 0) {
			try {
				return { files: parseCrashLogListing(result.stdout), ms: Date.now() - began };
			} catch (error) {
				failure = messageOf(error);
			}
		} else failure = said(result);
	}
	throw new Error(`listing the crash log of ${deviceId} through ${mac.target} failed${listAttempts > 1 ? ` (${listAttempts} tries)` : ""}: ${failure}`);
}

export type CrashPull = {
	/** The reports among the files that were copied, oldest first. */
	reports: CrashReport[];
	/** A local directory holding the copied `.ips` files; the caller removes it. */
	directory: string;
};

/** Copies `files` of the crash log to the Mac, brings them here and reads them. Throws, with the tool's own words, when any step fails. */
export async function pullCrashFiles(mac: Mac, deviceId: string, files: readonly CrashLogFile[], options: { bundleId: string; processName?: string; limitSeconds?: number }): Promise<CrashPull> {
	const limitSeconds = options.limitSeconds ?? defaultLimitSeconds;
	const directory = `${macScratch}/crashes-${process.pid}-${++counter}`;
	const local = await mkdtemp(join(tmpdir(), "native-qa-crashes-"));
	try {
		if (files.length > 0) {
			const result = await remote(mac, fetchScript({ deviceId, directory, files, limitSeconds }), { timeoutMs: (limitSeconds * files.length + 20) * 1000 });
			if (result.code !== 0 || !/^copied=\d+$/m.test(result.stdout)) throw new Error(`reading the crash log of ${deviceId} through ${mac.target} failed (exit ${result.code}): ${said(result)}`);
			await scpFrom(mac, `${directory}/.`, local, { timeoutMs: 300_000 });
		}
		const names = await readdir(local);
		const contents = await Promise.all(names.map(async (name) => ({ name, content: await readFile(join(local, name), "utf8") })));
		return { reports: readCrashReports(contents, { bundleId: options.bundleId, ...(options.processName ? { processName: options.processName } : {}) }), directory: local };
	} catch (error) {
		await rm(local, { recursive: true, force: true });
		throw error;
	} finally {
		await remote(mac, `rm -rf ${shellQuote(directory)}`).catch(() => undefined);
	}
}

/** What the command knew of the phone's crash log when it started: the names of the files that can be reports of the app, or why it could not tell. */
export type CrashWatch = {
	mac: Mac;
	/** The CoreDevice id `devicectl` takes (`--device`). */
	deviceId: string;
	bundleId: string;
	/** The executable's name, which names the app's reports. */
	processName: string;
	known: ReadonlySet<string> | null;
	startError: string | null;
	/** How long the first listing took, in ms (null when it failed). */
	listedMs: number | null;
	/** What one phone command may take on the Mac; the default is `defaultLimitSeconds`. */
	limitSeconds?: number;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The first listing, when the command starts. A failure is recorded, not thrown: the command goes on and says at its end that it could not measure. */
export async function startCrashWatch(options: { mac: Mac; deviceId: string; bundleId: string; processName?: string; limitSeconds?: number }): Promise<CrashWatch> {
	const { mac, deviceId, bundleId } = options;
	const processName = options.processName ?? qaProcessName;
	const limit = options.limitSeconds === undefined ? {} : { limitSeconds: options.limitSeconds };
	try {
		const listing = await listCrashLog(mac, deviceId, limit);
		return { mac, deviceId, bundleId, processName, known: new Set(reportFiles(listing.files, processName).map((file) => file.name)), startError: null, listedMs: listing.ms, ...limit };
	} catch (error) {
		return { mac, deviceId, bundleId, processName, known: null, startError: `before the run: ${messageOf(error)}`, listedMs: null, ...limit };
	}
}

export type CrashFinding = {
	/** What goes into the run file: the new reports, or why they could not be read. */
	record: CrashReportsRecord;
	/** A local directory with the `.ips` files of the new reports (see `keepCrashFiles`); null when there are none. */
	directory: string | null;
};

/**
 * The second listing, after the app was ended: the reports that were not there when the command started, copied and read. Without the
 * first listing there is nothing to tell new from old, and a failing listing or copy has seen nothing: either way the answer is an error,
 * never an empty list.
 */
export async function finishCrashWatch(watch: CrashWatch, options: { settleMs?: number } = {}): Promise<CrashFinding> {
	if (watch.known === null) return { record: { crashReportsError: watch.startError ?? "the crash log was not read before the run" }, directory: null };
	await sleep(options.settleMs ?? settleMs);
	const limit = watch.limitSeconds === undefined ? {} : { limitSeconds: watch.limitSeconds };
	let pulled: CrashPull;
	try {
		const listing = await listCrashLog(watch.mac, watch.deviceId, limit);
		const fresh = reportFiles(listing.files, watch.processName).filter((file) => !watch.known?.has(file.name));
		pulled = await pullCrashFiles(watch.mac, watch.deviceId, fresh, { bundleId: watch.bundleId, processName: watch.processName, ...limit });
	} catch (error) {
		return { record: { crashReportsError: `after the run: ${messageOf(error)}` }, directory: null };
	}
	if (pulled.reports.length === 0) {
		await rm(pulled.directory, { recursive: true, force: true });
		return { record: { crashReports: [] }, directory: null };
	}
	return { record: { crashReports: pulled.reports }, directory: pulled.directory };
}

/** The record with its reports replaced (attribution adds `attributedTo`); an error record stays as it is. */
export const withReports = (record: CrashReportsRecord, reports: CrashReport[]): CrashReportsRecord => (record.crashReports === undefined ? record : { ...record, crashReports: reports });

/**
 * Copies the `.ips` files of the new reports into `<root>/<run>-crashes/` (the run is the name of its run file or directory, without
 * extension) and removes the scratch directory. Returns the directory kept, or null when there was nothing to keep.
 */
export async function keepCrashFiles(finding: CrashFinding, run: string, root: string = runsDir): Promise<string | null> {
	const { directory } = finding;
	if (directory === null) return null;
	try {
		const destination = join(root, `${run}-crashes`);
		await mkdir(destination, { recursive: true });
		for (const report of finding.record.crashReports ?? []) await cp(join(directory, report.file), join(destination, report.file));
		return destination;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
