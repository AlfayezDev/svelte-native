import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assertOnline,
	clearLogcat,
	deviceInfo,
	followLogcat,
	forceStop,
	startApp,
	wake,
} from "../lib/adb.ts";
import { dexoptFlag, prepareApp } from "../lib/app.ts";
import { flagString, integerFlag, parseFlags, platformOf, requireString } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { lockFor, reexecUnderLock } from "../lib/lock.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import { describeSmoke, judgeSmoke, smokePins } from "../lib/smoke.ts";
import type { SmokeFile } from "../lib/types.ts";
import { packageOf, schemeOf } from "../lib/variant.ts";
import { findFaults, findInterruption } from "../parse/logcat.ts";
import { parseSmokeCompletion, parseSmokeResults } from "../parse/smoke.ts";
import { iosSmoke } from "./ios-smoke.ts";

/** The stress scenario `smoke` ends the lab the way every scenario does; the run is complete when that line came and the app logged its own. */
const labComplete = /\[Svelte stress\] complete/;

/**
 * The smoke gates of `gates.json` against this run, the verdict `gates --smoke` gives for it: a failed gate (a failed or missing module,
 * a skip the platform does not list, a crash, an incomplete run, too few answers) is printed and makes the command exit 1, so a script
 * or CI step that only runs `smoke` cannot pass a run the gates would fail.
 */
export async function reportVerdict(file: SmokeFile): Promise<void> {
	const verdict = await judgeSmoke(file);
	if (verdict.ok) {
		console.log("smoke gates: pass");
		return;
	}
	console.log("smoke gates: FAIL");
	for (const line of verdict.lines) console.log(line);
	process.exitCode = 1;
}

/**
 * Installs the smoke app (`dev.alfayez.exposvelte.qa.smoke`, `qa/out/app-smoke-<abi>.apk` from `native-qa build --variant smoke`), launches
 * its lab's `smoke` scenario (`expo-svelte-qa-smoke:///__dev?run=smoke`) on an Android device, follows logcat until the lab says it
 * is done, and writes `qa/runs/smoke-<device>-<stamp>.json` with the module lines it parsed. The libraries are linked in the smoke
 * app only; the QA app, which every other command measures, is neither installed nor started. Nothing here prompts, and the smoke
 * app is force-stopped afterwards.
 */
export async function smoke(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosSmoke(argv);
	const { values } = parseFlags(argv, {
		device: { type: "string" },
		apk: { type: "string" },
		"no-install": { type: "boolean" },
		dexopt: { type: "string" },
		timeout: { type: "string" },
		package: { type: "string" },
	});
	const serial = requireString(values.device, "device");
	const lock = lockFor(serial);
	if (lock) await reexecUnderLock(lock, ["smoke", ...argv]);

	const timeoutMs = integerFlag(values.timeout, "timeout", 180) * 1000;
	const packageName = flagString(values.package) ?? packageOf.smoke;
	const pins = await smokePins("android");

	await assertOnline(serial);
	const startedAt = new Date();
	const device = await deviceInfo(serial);
	const app = await prepareApp(serial, device, {
		apk: flagString(values.apk),
		noInstall: values["no-install"] === true,
		packageName,
		dexopt: dexoptFlag(values.dexopt),
		variant: "smoke",
	});
	console.log(
		`${device.kind} ${device.model} (${serial}), Android ${device.osVersion}, ${device.abi}; app ${app.versionName} installed ${app.lastUpdateTime}`,
	);

	await mkdir(runsDir, { recursive: true });
	await wake(serial);
	await forceStop(serial, packageName);
	await clearLogcat(serial);
	const launched = new Date();
	await startApp(serial, packageName, `${schemeOf.smoke}:///__dev?run=smoke`);
	const stream = await followLogcat(serial, labComplete, timeoutMs, 2000);
	await forceStop(serial, packageName);
	const logPath = join(runsDir, `smoke-${slug(serial)}-${stamp(startedAt)}.log`);
	await writeFile(logPath, stream.text);

	const faults = findFaults(stream.text, packageName);
	const interrupted = findInterruption(stream.text, packageName);
	const completion = parseSmokeCompletion(stream.text);
	const file: SmokeFile = {
		schema: 1,
		kind: "smoke",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		run: "smoke",
		complete: stream.matched && completion !== null && interrupted === null && faults.crashes.length === 0,
		results: parseSmokeResults(stream.text),
		completion,
		crashes: interrupted ? [...faults.crashes, `interrupted by ${interrupted.by} at ${interrupted.at}`] : faults.crashes,
		jsErrorCount: faults.jsErrors.length,
		durationMs: Date.now() - launched.getTime(),
		logFile: logPath.slice(qaDir.length + 1),
	};
	for (const line of describeSmoke(file, pins)) console.log(line);
	const name = await writeRun("smoke", serial, startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
	await reportVerdict(file);
}
