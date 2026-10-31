import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellQuote } from "../exec.ts";
import { runsDir } from "../paths.ts";
import type { CrashFrame, CrashReport, CrashReportsRecord, LabRun, Launch } from "../types.ts";
import { sleep } from "../wait.ts";
import { remote, scpFrom, type Mac } from "./mac.ts";

/**
 * The iPhone's crash log, read through the Mac the phone is paired with (`idevicecrashreport`, libimobiledevice). An app that
 * aborts after it wrote its results, at the end of the last scenario or while the harness ends it, leaves nothing in the files
 * the harness reads: only the system's crash report says so. Every iOS command lists the app's reports before and after its run;
 * the reports that were not there before are the run's.
 */

/** The hardware UDID of the lab's iPhone (the id `idevice_id -l` prints, not the CoreDevice id `devicectl` uses); `--udid` names another. */
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

/* ---- the pull ---- */

const macScratch = "/tmp/native-qa-ios";
let counter = 0;

/**
 * The shell the Mac runs for one pull: `idevicecrashreport` copies the app's reports and the jetsam events (which name no bundle) of the
 * phone's crash log into a scratch directory, and the files that are the app's or jetsam events are gathered in a second one for `scp`
 * (`-k`: the phone keeps its reports; without it the tool deletes them). Two pulls, each filtered by name (`-f`), not one of the whole
 * log: the crash log also holds sysdiagnose archives of hundreds of megabytes (a failed UI-testing start on the phone writes one), and
 * copying those takes minutes. A report of the app is named by its process (`<process>-<date>.ips`). The PATH adds Homebrew's, where
 * libimobiledevice lives. The pull counts as done only when both runs exit 0 and say `Done.`: a tool that found no phone must never read
 * as a phone with no reports. A failure prints the tool's words on stderr (a locked phone says `Password protected`) and exits 1; the
 * Mac's ssh drops the remote exit status (the command runs under `login`), so the caller tells a failed pull by its stderr and the missing `ours=` line.
 */
export function pullScript(options: { udid: string; bundleId: string; processName?: string; directory: string }): string {
	const processName = options.processName ?? qaProcessName;
	const dir = shellQuote(options.directory);
	const gathered = shellQuote(`${options.directory}.ours`);
	const log = shellQuote(`${options.directory}.log`);
	const header = shellQuote(`"bundleID":"${options.bundleId}"`);
	return [
		"export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH",
		"command -v idevicecrashreport >/dev/null 2>&1 || { echo 'idevicecrashreport is not installed on the Mac (it comes with libimobiledevice)' >&2; exit 127; }",
		`mkdir -p ${shellQuote(macScratch)}`,
		`rm -rf ${dir} ${gathered} ${log}`,
		`mkdir -p ${dir} ${gathered}`,
		`idevicecrashreport -u ${shellQuote(options.udid)} -k -f ${shellQuote(processName)} ${dir} > ${log} 2>&1`,
		"code=$?",
		`idevicecrashreport -u ${shellQuote(options.udid)} -k -f JetsamEvent ${dir} >> ${log} 2>&1`,
		"second=$?",
		"if [ $code -eq 0 ]; then code=$second; fi",
		`if [ $code -ne 0 ] || [ "$(grep -c '^Done\\.' ${log})" -ne 2 ]; then tail -n 6 ${log} >&2; rm -rf ${dir} ${gathered} ${log}; exit 1; fi`,
		`find ${dir} -type f -name '*.ips' | while IFS= read -r file; do`,
		`  name=$(basename "$file")`,
		`  if head -n 1 "$file" | grep -qF ${header}; then cp "$file" ${gathered}/; else case "$name" in JetsamEvent-*|${processName}-*) cp "$file" ${gathered}/;; esac; fi`,
		"done",
		`echo "ours=$(ls ${gathered} | wc -l | tr -d ' ')"`,
		`rm -rf ${dir} ${log}`,
	].join("\n");
}

export type CrashPull = {
	/** Every report of the app on the phone, oldest first. */
	reports: CrashReport[];
	/** A local directory holding the `.ips` files of those reports; the caller removes it. */
	directory: string;
};

/** Copies the phone's crash log to the Mac, brings the app's files here and reads them. Throws, with the tool's own words, when any step fails. */
export async function pullCrashReports(mac: Mac, udid: string, bundleId: string): Promise<CrashPull> {
	const directory = `${macScratch}/crashes-${process.pid}-${++counter}`;
	const result = await remote(mac, pullScript({ udid, bundleId, directory }), { timeoutMs: 180_000 });
	if (result.code !== 0) {
		await remote(mac, `rm -rf ${shellQuote(`${directory}.ours`)}`).catch(() => undefined);
		throw new Error(`reading the crash log of ${udid} through ${mac.target} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 400) || "no output"}`);
	}
	const gathered = /^ours=(\d+)$/m.exec(result.stdout);
	if (!gathered) throw new Error(`reading the crash log of ${udid} through ${mac.target}: the pull did not say how many files it found: ${(result.stderr || result.stdout).trim().slice(-300)}`);
	const local = await mkdtemp(join(tmpdir(), "native-qa-crashes-"));
	try {
		if (Number(gathered[1]) > 0) await scpFrom(mac, `${directory}.ours/.`, local, { timeoutMs: 300_000 });
		const files = await Promise.all((await readdir(local)).map(async (name) => ({ name, content: await readFile(join(local, name), "utf8") })));
		return { reports: readCrashReports(files, { bundleId }), directory: local };
	} catch (error) {
		await rm(local, { recursive: true, force: true });
		throw error;
	} finally {
		await remote(mac, `rm -rf ${shellQuote(`${directory}.ours`)}`).catch(() => undefined);
	}
}

/** What the command knew of the phone's crash log when it started: the file names of the app's reports, or why it could not tell. */
export type CrashWatch = {
	mac: Mac;
	udid: string;
	bundleId: string;
	known: ReadonlySet<string> | null;
	startError: string | null;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The first pull, when the command starts. A failure is recorded, not thrown: the command goes on and says at its end that it could not measure. */
export async function startCrashWatch(mac: Mac, udid: string, bundleId: string): Promise<CrashWatch> {
	try {
		const pulled = await pullCrashReports(mac, udid, bundleId);
		await rm(pulled.directory, { recursive: true, force: true });
		return { mac, udid, bundleId, known: new Set(pulled.reports.map((report) => report.file)), startError: null };
	} catch (error) {
		return { mac, udid, bundleId, known: null, startError: `before the run: ${messageOf(error)}` };
	}
}

export type CrashFinding = {
	/** What goes into the run file: the new reports, or why they could not be read. */
	record: CrashReportsRecord;
	/** A local directory with the `.ips` files of the new reports (see `keepCrashFiles`); null when there are none. */
	directory: string | null;
};

/**
 * The second pull, after the app was ended: the reports that were not there when the command started. Without the first pull there is
 * nothing to tell new from old, and a failing pull has seen nothing: either way the answer is an error, never an empty list.
 */
export async function finishCrashWatch(watch: CrashWatch, options: { settleMs?: number } = {}): Promise<CrashFinding> {
	if (watch.known === null) return { record: { crashReportsError: watch.startError ?? "the crash log was not read before the run" }, directory: null };
	await sleep(options.settleMs ?? settleMs);
	let pulled: CrashPull;
	try {
		pulled = await pullCrashReports(watch.mac, watch.udid, watch.bundleId);
	} catch (error) {
		return { record: { crashReportsError: `after the run: ${messageOf(error)}` }, directory: null };
	}
	const fresh = reportsSince(pulled.reports, watch.known);
	if (fresh.length === 0) {
		await rm(pulled.directory, { recursive: true, force: true });
		return { record: { crashReports: [] }, directory: null };
	}
	return { record: { crashReports: fresh }, directory: pulled.directory };
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
