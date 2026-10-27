import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integerFlag, parseFlags } from "../lib/flags.ts";
import { appProcesses, launchApp, readAppFile, terminateApp } from "../lib/iphone/device.ts";
import { currentSource, iosOptions, startIosSuite, type IosSession } from "../lib/iphone/session.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { BootDefinition, BootFile, Launch } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { launchFromReport, parseBootReport } from "../parse/ios.ts";

const reportWaitMs = 25_000;
const reportPollMs = 1500;

export function iosBootDefinition(coldIdleSeconds: number): BootDefinition {
	return {
		warm: "The app is ended, 1.5 s pass, and it is launched again (devicectl process launch): the previous launch ran seconds earlier, so the page cache and the bundle are hot. Measured from the kernel's start time of the process (sysctl p_starttime) to the display link tick that shows the first React Native content (the vsync after RCTContentDidAppearNotification), both read inside the app.",
		cold: `The app is ended and the phone idles ${coldIdleSeconds} s before the app is launched. Nothing is cleared (data and bundle stay), and iOS cannot be made to drop its page cache, so this is a process-cold, idle-gap launch. Same measurement as the warm one. The first frame is the first content frame: the system's launch screen and Expo's splash overlay are drawn before it.`,
		coldIdleSeconds,
	};
}

async function launchOnce(session: IosSession, kind: "warm" | "cold", index: number, idleSeconds: number, previous: number | null): Promise<{ launch: Launch; pid: number }> {
	const { target } = session;
	if (previous !== null) {
		try {
			await terminateApp(target, previous);
		} catch {
			// The previous instance is already gone.
		}
	}
	await sleep(kind === "cold" ? idleSeconds * 1000 : 1500);
	const { pid } = await launchApp(target, { terminateExisting: false });
	const deadline = Date.now() + reportWaitMs;
	let error: string | null = "no boot report was written";
	let launch: Launch = { index, displayMs: null, runningMainMs: null, displayedReportedMs: null, totalTimeMs: null, jsMarks: null, crashes: 0, jsErrors: 0, engineWarnings: 0, error };
	while (Date.now() < deadline) {
		await sleep(reportPollMs);
		const text = await readAppFile(target, "Documents/boot-report.json");
		if (text === null) continue;
		const report = parseBootReport(text);
		if (report.pid !== pid) continue;
		const measured = launchFromReport(report);
		error = null;
		launch = {
			index,
			displayMs: Math.round(measured.displayMs),
			runningMainMs: Math.round(measured.contentMs),
			displayedReportedMs: null,
			totalTimeMs: Math.round(measured.launchedMs),
			jsMarks: measured.jsMarks,
			crashes: 0,
			jsErrors: 0,
			engineWarnings: 0,
			error: null,
		};
		break;
	}
	if (error !== null) {
		const alive = (await appProcesses(target, session.installed)).includes(pid);
		launch = { ...launch, crashes: alive ? 0 : 1, error: alive ? error : "the app exited before its first frame" };
	}
	return { launch, pid };
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
	let running: number | null = null;
	for (const [kind, count] of [["warm", warmCount], ["cold", coldCount]] as const) {
		for (let index = 1; index <= count; index++) {
			const { launch, pid } = await launchOnce(session, kind, index, idleSeconds, running);
			running = pid;
			launches[kind].push(launch);
			logs.push(`=== ${kind} ${index} ===\n${JSON.stringify(launch)}`);
			console.log(describeLaunch(kind, launch));
		}
	}
	if (running !== null) {
		try {
			await terminateApp(session.target, running);
		} catch {
			// Already gone.
		}
	}
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
		app: session.app,
		definition: iosBootDefinition(idleSeconds),
		warm: launches.warm,
		cold: launches.cold,
		logFile: logPath.slice(qaDir.length + 1),
	};
	const name = await writeRun("boot", session.device.serial, session.startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
}
