import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assertOnline,
	clearLogcat,
	deviceInfo,
	dumpLogcat,
	forceStop,
	showSettings,
	startApp,
	wake,
} from "../lib/adb.ts";
import { dexoptFlag, prepareApp } from "../lib/app.ts";
import { flagString, integerFlag, parseFlags, platformOf, requireString } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { lockFor, reexecUnderLock } from "../lib/lock.ts";
import { defaultPackage, qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { BootDefinition, BootFile, Launch } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { iosBoot } from "./ios-boot.ts";
import { parseAmStart } from "../parse/adb.ts";
import {
	findEngineWarnings,
	findFaults,
	parseLaunchMarkers,
	parseSvelteBoot,
} from "../parse/logcat.ts";

const settleMs = 2500;
const logTimeoutMs = 12_000;

export function bootDefinition(coldIdleSeconds: number): BootDefinition {
	return {
		warm: "am force-stop, 1.5 s pause, then am start. The previous launch ran seconds earlier, so the page cache and the dex and oat files are hot. Measured from Start proc to Displayed in logcat.",
		cold: `Settings is brought to the front, the app process is killed with am force-stop, and the device idles ${coldIdleSeconds} s before the app is launched. Nothing is cleared (data, dex and oat files stay), and a stock emulator cannot drop the page cache, so this is a process-cold, idle-gap launch. Measured from Start proc to Displayed in logcat.`,
		coldIdleSeconds,
	};
}

const interesting =
	/Start proc|Displayed |Running "main"|\[Svelte boot\]|SvelteEngine|FATAL EXCEPTION|AndroidRuntime|Fatal signal|ANR in| E ReactNativeJS/;

async function launchOnce(
	serial: string,
	packageName: string,
	kind: "warm" | "cold",
	index: number,
	idleSeconds: number,
): Promise<{ launch: Launch; log: string }> {
	await wake(serial);
	if (kind === "cold") {
		await showSettings(serial);
		await sleep(1500);
		await forceStop(serial, packageName);
		await sleep(idleSeconds * 1000);
	} else {
		await forceStop(serial, packageName);
		await sleep(1500);
	}
	await clearLogcat(serial);
	const am = parseAmStart(await startApp(serial, packageName));
	await sleep(settleMs);

	let text = await dumpLogcat(serial);
	const deadline = Date.now() + logTimeoutMs;
	while (
		(!text.includes("[Svelte boot]") || parseLaunchMarkers(text, packageName).displayMs === null) &&
		Date.now() < deadline
	) {
		await sleep(1000);
		text = await dumpLogcat(serial);
	}

	const markers = parseLaunchMarkers(text, packageName);
	const faults = findFaults(text, packageName);
	const launch: Launch = {
		index,
		displayMs: markers.displayMs,
		runningMainMs: markers.runningMainMs,
		displayedReportedMs: markers.displayedReportedMs,
		totalTimeMs: am.totalTimeMs,
		jsMarks: parseSvelteBoot(text),
		crashes: faults.crashes.length,
		jsErrors: faults.jsErrors.length,
		engineWarnings: findEngineWarnings(text).length,
		error:
			markers.displayMs === null
				? "no Start proc to Displayed pair in logcat"
				: am.status === "ok"
					? null
					: `am start status ${am.status}`,
	};
	const log = [
		`=== ${kind} ${index} ===`,
		...text.split("\n").filter((line) => interesting.test(line)),
	].join("\n");
	return { launch, log };
}

function describeLaunch(kind: string, launch: Launch): string {
	return `  ${kind} ${String(launch.index).padStart(2)}: ${launch.displayMs ?? "-"} ms (Start proc to Displayed), running main ${launch.runningMainMs ?? "-"}, am TotalTime ${launch.totalTimeMs ?? "-"}, js ${launch.jsMarks?.total ?? "-"}${launch.error ? `  [${launch.error}]` : ""}`;
}

export async function boot(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosBoot(argv);
	const { values } = parseFlags(argv, {
		device: { type: "string" },
		apk: { type: "string" },
		"no-install": { type: "boolean" },
		dexopt: { type: "string" },
		warm: { type: "string" },
		cold: { type: "string" },
		idle: { type: "string" },
		package: { type: "string" },
	});
	const serial = requireString(values.device, "device");
	const lock = lockFor(serial);
	if (lock) reexecUnderLock(lock, ["boot", ...argv]);

	const warmCount = integerFlag(values.warm, "warm", 30);
	const coldCount = integerFlag(values.cold, "cold", 30);
	const idleSeconds = integerFlag(values.idle, "idle", 20);
	const packageName = flagString(values.package) ?? defaultPackage;

	await assertOnline(serial);
	const startedAt = new Date();
	const device = await deviceInfo(serial);
	const app = await prepareApp(serial, device, {
		apk: flagString(values.apk),
		noInstall: values["no-install"] === true,
		packageName,
		dexopt: dexoptFlag(values.dexopt),
	});
	console.log(
		`${device.kind} ${device.model} (${serial}); ${warmCount} warm and ${coldCount} cold launches, cold idle ${idleSeconds} s`,
	);

	const logs: string[] = [];
	const launches = { warm: [] as Launch[], cold: [] as Launch[] };
	for (const [kind, count] of [
		["warm", warmCount],
		["cold", coldCount],
	] as const) {
		for (let index = 1; index <= count; index++) {
			const { launch, log } = await launchOnce(serial, packageName, kind, index, idleSeconds);
			launches[kind].push(launch);
			logs.push(log);
			console.log(describeLaunch(kind, launch));
		}
	}
	await forceStop(serial, packageName);

	await mkdir(runsDir, { recursive: true });
	const logPath = join(runsDir, `boot-${slug(serial)}-${stamp(startedAt)}.log`);
	await writeFile(logPath, `${logs.join("\n")}\n`);
	const file: BootFile = {
		schema: 1,
		kind: "boot",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		definition: bootDefinition(idleSeconds),
		warm: launches.warm,
		cold: launches.cold,
		logFile: logPath.slice(qaDir.length + 1),
	};
	const name = await writeRun("boot", serial, startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
}
