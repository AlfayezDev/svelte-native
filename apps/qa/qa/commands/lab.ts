import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assertOnline,
	clearLogcat,
	deviceInfo,
	followLogcat,
	forceStop,
	launchWithGestures,
	startApp,
	wake,
} from "../lib/adb.ts";
import { dexoptFlag, prepareApp } from "../lib/app.ts";
import { flagString, integerFlag, parseFlags, platformOf, requireString } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { describeRun, labRunFrom, stressRequested } from "../lib/lab-run.ts";
import { lockFor, reexecUnderLock } from "../lib/lock.ts";
import { defaultPackage, qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { LabFile, LabRun } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { iosLab } from "./ios-lab.ts";


/** The lab's last line: after the stress scenarios, or after the checks when only they were requested. */
function completionMarker(run: string): RegExp {
	return stressRequested(run)
		? /\[Svelte stress\] complete/
		: /\[native lab results\].*"phase":"done"/;
}

export async function labOnce(
	serial: string,
	packageName: string,
	run: string,
	timeoutMs: number,
	logPath: string,
): Promise<LabRun> {
	await wake(serial);
	await forceStop(serial, packageName);
	await sleep(1500);
	await clearLogcat(serial);
	const startedAt = new Date();
	await startApp(serial, packageName, `example-svelte:///__dev?run=${run}`);
	const stream = await followLogcat(serial, completionMarker(run), timeoutMs, 2000);
	await forceStop(serial, packageName);
	await writeFile(logPath, stream.text);
	const capture = {
		...stream,
		startedAt,
		durationMs: Date.now() - startedAt.getTime(),
		logFile: logPath.slice(qaDir.length + 1),
	};
	try {
		return labRunFrom(capture, packageName, stressRequested(run));
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)} (full log: ${logPath})`,
			{ cause: error },
		);
	}
}

export async function lab(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosLab(argv);
	const { values } = parseFlags(argv, {
		device: { type: "string" },
		apk: { type: "string" },
		"no-install": { type: "boolean" },
		dexopt: { type: "string" },
		repeat: { type: "string" },
		timeout: { type: "string" },
		run: { type: "string" },
		package: { type: "string" },
		gestures: { type: "boolean" },
	});
	const serial = requireString(values.device, "device");
	const lock = lockFor(serial);
	if (lock) await reexecUnderLock(lock, ["lab", ...argv]);
	launchWithGestures(values.gestures === true);
	if (values.gestures === true) console.log("gestures: the gesture handler root is installed at every launch (--gestures)");

	const repeat = integerFlag(values.repeat, "repeat", 1);
	const timeoutMs = integerFlag(values.timeout, "timeout", 360) * 1000;
	const run = flagString(values.run) ?? "checks,quick";
	const packageName = flagString(values.package) ?? defaultPackage;
	if (repeat < 1) throw new Error("--repeat must be at least 1");

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
		`${device.kind} ${device.model} (${serial}), Android ${device.osVersion}, ${device.abi}, ${device.refreshHz ?? "?"} Hz; app ${app.versionName} installed ${app.lastUpdateTime}`,
	);

	await mkdir(runsDir, { recursive: true });
	const runs: LabRun[] = [];
	for (let index = 1; index <= repeat; index++) {
		console.log(`lab run ${index}/${repeat} (${run})`);
		const logPath = join(runsDir, `lab-${slug(serial)}-${stamp(startedAt)}-${index}.log`);
		const result = await labOnce(serial, packageName, run, timeoutMs, logPath);
		runs.push(result);
		for (const line of describeRun(result)) console.log(line);
	}
	const file: LabFile = {
		schema: 1,
		kind: "lab",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		run,
		runs,
	};
	const name = await writeRun("lab", serial, startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
}
