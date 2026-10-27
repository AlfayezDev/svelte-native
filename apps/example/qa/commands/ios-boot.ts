import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integerFlag, parseFlags } from "../lib/flags.ts";
import { appProcesses, launchApp, readAppFile, terminateApp } from "../lib/iphone/device.ts";
import { describeCrashReports, finishCrashWatch, keepCrashFiles, launchesWithCrashes, withReports } from "../lib/iphone/crash-reports.ts";
import { notReported, reportedIdentity, withIdentity } from "../lib/iphone/identity.ts";
import { currentSource, iosOptions, startIosSuite, type IosSession } from "../lib/iphone/session.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { BootDefinition, BootFile, BuildIdentity, Launch } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { launchFromReport, parseBootReport, type BootReport } from "../parse/ios.ts";

const reportWaitMs = 25_000;
const reportPollMs = 1500;

export function iosBootDefinition(coldIdleSeconds: number): BootDefinition {
	return {
		warm: "The app is ended, 1.5 s pass, and it is launched again (devicectl process launch): the previous launch ran seconds earlier, so the page cache and the bundle are hot. Measured from the kernel's start time of the process (sysctl p_starttime) to the display link tick that shows the first React Native content (the vsync after RCTContentDidAppearNotification), both read inside the app.",
		cold: `The app is ended and the phone idles ${coldIdleSeconds} s before the app is launched. Nothing is cleared (data and bundle stay), and iOS cannot be made to drop its page cache, so this is a process-cold, idle-gap launch. Same measurement as the warm one. The first frame is the first content frame: the system's launch screen and Expo's splash overlay are drawn before it.`,
		coldIdleSeconds,
	};
}

/**
 * Why a boot report is not the launch just made, or null: it names another process, or its process started before the launch
 * command ran (the report a previous launch left behind). The two times are on different clocks, the phone's and this machine's,
 * which agree to well within the seconds a launch takes.
 */
/**
 * Whether the report is an earlier launch's: a different process than the one launched, or one that started no later than the
 * process measured before it (`baselineStartMs`, the phone's own clock, so no two clocks are compared). The first launch's
 * baseline is the report found on the phone before the run.
 */
export function staleReport(report: BootReport, pid: number, baselineStartMs: number | null): string | null {
	if (report.pid !== pid) return `from process ${report.pid}, not ${pid}`;
	if (baselineStartMs !== null && report.processStartMs <= baselineStartMs)
		return `of a process that started ${Math.round(baselineStartMs - report.processStartMs)} ms before the one measured before it`;
	return null;
}

export type ReportRead = { report: BootReport } | { stale: string } | null;

/** One poll's copy of boot-report.json: null while it cannot be read yet (a copy that caught the app writing it), `stale` when it is not this launch's. */
export function readLaunchReport(text: string, pid: number, baselineStartMs: number | null): ReportRead {
	let report: BootReport;
	try {
		report = parseBootReport(text);
	} catch {
		return null;
	}
	const stale = staleReport(report, pid, baselineStartMs);
	return stale === null ? { report } : { stale };
}

async function launchOnce(session: IosSession, kind: "warm" | "cold", index: number, idleSeconds: number, previous: number | null, baselineStartMs: number | null): Promise<{ launch: Launch; pid: number; report: BootReport | null }> {
	const { target } = session;
	if (previous !== null) {
		try {
			await terminateApp(target, previous);
		} catch {
			// The previous instance is already gone.
		}
	}
	await sleep(kind === "cold" ? idleSeconds * 1000 : 1500);
	const commandStartedAtMs = Date.now();
	const { pid } = await launchApp(target);
	const deadline = Date.now() + reportWaitMs;
	let error: string | null = "no boot report was written";
	let launch: Launch = { index, displayMs: null, runningMainMs: null, displayedReportedMs: null, totalTimeMs: null, jsMarks: null, crashes: 0, jsErrors: null, engineWarnings: 0, error, commandStartedAtMs, processStartMs: null };
	let accepted: BootReport | null = null;
	while (Date.now() < deadline) {
		await sleep(reportPollMs);
		const text = await readAppFile(target, "Documents/boot-report.json");
		if (text === null) continue;
		const read = readLaunchReport(text, pid, baselineStartMs);
		// The app writes the file while the harness copies it: a copy that caught it half written is read again on the next poll.
		if (read === null) continue;
		if ("stale" in read) {
			error = `the boot report found is ${read.stale}; no report of this launch was written`;
			continue;
		}
		const { report } = read;
		const measured = launchFromReport(report);
		accepted = report;
		error = null;
		launch = {
			index,
			displayMs: Math.round(measured.displayMs),
			runningMainMs: Math.round(measured.contentMs),
			displayedReportedMs: null,
			totalTimeMs: Math.round(measured.launchedMs),
			jsMarks: measured.jsMarks,
			crashes: 0,
			jsErrors: report.jsErrors,
			engineWarnings: 0,
			error: null,
			commandStartedAtMs,
			processStartMs: report.processStartMs,
		};
		break;
	}
	if (error !== null) {
		const alive = (await appProcesses(target, session.installed)).includes(pid);
		launch = { ...launch, crashes: alive ? 0 : 1, error: alive ? error : "the app exited before its first frame" };
	}
	return { launch: { ...launch, pid }, pid, report: accepted };
}

/** The process start of the boot report on the phone before the run, if one is there and readable. */
async function previousStart(session: IosSession): Promise<number | null> {
	const text = await readAppFile(session.target, "Documents/boot-report.json");
	if (text === null) return null;
	try {
		return parseBootReport(text).processStartMs;
	} catch {
		return null;
	}
}

function describeLaunch(kind: string, launch: Launch): string {
	return `  ${kind} ${String(launch.index).padStart(2)}: ${launch.displayMs ?? "-"} ms (process start to first frame), content mounted ${launch.runningMainMs ?? "-"}, didFinishLaunching ${launch.totalTimeMs ?? "-"}, js ${launch.jsMarks?.total ?? "-"}${launch.error ? `  [${launch.error}]` : ""}`;
}

export async function iosBoot(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { ...iosOptions, warm: { type: "string" }, cold: { type: "string" }, idle: { type: "string" } });
	const session = await startIosSuite("boot", argv, values);
	const warmCount = integerFlag(values.warm, "warm", 30);
	const coldCount = integerFlag(values.cold, "cold", 30);
	const idleSeconds = integerFlag(values.idle, "idle", 20);
	console.log(`${warmCount} warm and ${coldCount} cold launches, cold idle ${idleSeconds} s`);

	const launches = { warm: [] as Launch[], cold: [] as Launch[] };
	const logs: string[] = [];
	const reports: (BuildIdentity | null)[] = [];
	let running: number | null = null;
	// The report left on the phone by an earlier run is the first launch's baseline; each accepted report is the next one's.
	let baselineStartMs = await previousStart(session);
	for (const [kind, count] of [["warm", warmCount], ["cold", coldCount]] as const) {
		for (let index = 1; index <= count; index++) {
			const { launch, pid, report } = await launchOnce(session, kind, index, idleSeconds, running, baselineStartMs);
			running = pid;
			if (report) baselineStartMs = report.processStartMs;
			launches[kind].push(launch);
			logs.push(`=== ${kind} ${index} ===\n${JSON.stringify(launch)}`);
			console.log(describeLaunch(kind, launch));
			// Every launch that reported must be the recorded build, checked as it comes so a wrong build ends the run at once.
			if (report) reports.push(report.build);
			reportedIdentity(reports, session.build, "boot");
		}
	}
	const installed = reportedIdentity(reports, session.build, "boot");
	if (reports.length > 0 && installed === null) console.log(`warning: ${notReported}`);
	if (running !== null) {
		try {
			await terminateApp(session.target, running);
		} catch {
			// Already gone.
		}
	}
	// The app is ended: what the phone's crash log gained since the start belongs to a launch (by its pid) or to no run. A launch whose
	// app aborted keeps its measurement and gains a crash; a report no launch owns still counts (`boot.fatals`, `log.crashReports`).
	const found = await finishCrashWatch(session.crashes);
	const attributed = found.record.crashReports ? launchesWithCrashes(launches, found.record.crashReports) : null;
	const crashRecord = attributed ? withReports(found.record, attributed.reports) : found.record;
	if (attributed) {
		launches.warm = attributed.warm;
		launches.cold = attributed.cold;
	}
	for (const line of describeCrashReports(crashRecord)) console.log(line);
	await mkdir(runsDir, { recursive: true });
	const logPath = join(runsDir, `boot-${slug(session.device.serial)}-${stamp(session.startedAt)}.log`);
	await writeFile(logPath, `${logs.join("\n")}\n`);
	const file: BootFile = {
		schema: 1,
		kind: "boot",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device: session.device,
		app: withIdentity(session.app, installed),
		definition: iosBootDefinition(idleSeconds),
		warm: launches.warm,
		cold: launches.cold,
		logFile: logPath.slice(qaDir.length + 1),
		...crashRecord,
	};
	const name = await writeRun("boot", session.device.serial, session.startedAt, file);
	const kept = await keepCrashFiles(found, name);
	if (kept) console.log(`kept the crash reports in ${kept.slice(qaDir.length + 1)}`);
	console.log(`wrote qa/runs/${name}.json`);
}
