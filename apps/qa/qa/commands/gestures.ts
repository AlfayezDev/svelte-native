import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearLogcat, forceStop, startApp, wake } from "../lib/adb.ts";
import { flagString, integerFlag, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { describeLaunch, launchFromLogcat, namesFor, runValue, scenarioNamesFrom } from "../lib/gestures.ts";
import { AdbDriver, tailLogcat } from "../lib/inject-android.ts";
import { runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import { commonOptions, startSuite } from "../lib/suite.ts";
import type { GestureInjection, GestureInput, GestureLaunch, GesturesFile } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { iosGestures } from "../lib/iphone/gestures.ts";

/**
 * `native-qa gestures`: the lab's `gestures-*` scenarios on a device, each driven by a way of injecting touches (SPEC.md, "Gestures",
 * "Driving the lab"), judged by the lab's own checks, written to `qa/runs/gestures-<device>-<stamp>.json` and merged by `report`.
 *
 * Android: `--input adb` opens the lab with `run=<scenarios>,drive:adb` and performs, with `adb shell input`, the input each `[Svelte
 * gesture] ready` line asks for (one pointer, the real input pipeline); `--input qa` opens it with `drive:qa` and the page injects the
 * same inputs itself, frame by frame, through `SvelteQaTouch` (every scenario, two pointers included); `both` (the default) does one
 * launch of each and checks that the counters agree. iOS (`--platform ios`): an XCUITest on the iPhone, see `lib/iphone/gestures.ts`.
 */

const pollMs = 500;

/** One launch of the lab with the given scenarios, driven by `input`; its logcat goes to `logPath`. */
export async function gesturesOnce(
	serial: string,
	packageName: string,
	input: Extract<GestureInput, "adb" | "qa">,
	names: string[],
	timeoutMs: number,
	logPath: string,
	logFileName: string,
): Promise<GestureLaunch> {
	await wake(serial);
	await forceStop(serial, packageName);
	await sleep(1500);
	await clearLogcat(serial);
	const startedAt = new Date();
	const driver = new AdbDriver(serial);
	const tail = tailLogcat(serial, input === "adb" ? driver.onLine : () => undefined);
	let matched: boolean;
	try {
		await startApp(serial, packageName, `expo-svelte-qa:///__dev?run=${runValue(names, input)}`);
		matched = await tail.until(/\[Svelte stress\] complete/, timeoutMs);
		// The lines after the last scenario's result, and the injections still in flight.
		if (matched) await sleep(2000);
		await Promise.race([driver.idle(), sleep(pollMs * 4)]);
	} finally {
		tail.stop();
		await forceStop(serial, packageName);
	}
	const text = tail.text();
	await writeFile(logPath, text);
	const injections: Record<string, GestureInjection[]> = {};
	for (const entry of driver.log)
		(injections[entry.scenario] ??= []).push({ round: entry.round, step: entry.step, stepName: entry.stepName, command: entry.command, problems: entry.problems, error: entry.error });
	const harnessErrors = [
		...driver.parseErrors,
		...driver.log.filter((entry) => entry.error !== null).map((entry) => `${entry.scenario} step ${entry.step + 1}: ${entry.error}`),
		...driver.log.filter((entry) => entry.problems.length > 0).map((entry) => `${entry.scenario} step ${entry.step + 1}: ${entry.problems.join("; ")}`),
	];
	return launchFromLogcat({
		input, asked: names, text, matched, startedAt, durationMs: Date.now() - startedAt.getTime(), logFile: logFileName, packageName, injections, harnessErrors,
	});
}

export async function gestures(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") return iosGestures(argv);
	const { values } = parseFlags(argv, {
		...commonOptions,
		platform: { type: "string" },
		input: { type: "string" },
		run: { type: "string" },
		repeat: { type: "string" },
		timeout: { type: "string" },
	});
	const wanted = flagString(values.input) ?? "both";
	if (wanted !== "adb" && wanted !== "qa" && wanted !== "both") throw new Error("--input must be adb, qa or both");
	const inputs: Extract<GestureInput, "adb" | "qa">[] = wanted === "both" ? ["adb", "qa"] : [wanted];
	const names = scenarioNamesFrom(flagString(values.run));
	const repeat = integerFlag(values.repeat, "repeat", 1);
	if (repeat < 1) throw new Error("--repeat must be at least 1");
	const timeoutMs = integerFlag(values.timeout, "timeout", 900) * 1000;
	const { serial, packageName, device, app, startedAt } = await startSuite("gestures", argv, values);

	await mkdir(runsDir, { recursive: true });
	const launches: GestureLaunch[] = [];
	for (const input of inputs) {
		const own = namesFor(names, input);
		if (own.length === 0) {
			console.log(`gestures ${input}: none of the requested scenarios can be driven this way`);
			continue;
		}
		for (let index = 1; index <= repeat; index++) {
			console.log(`gestures ${input} ${index}/${repeat}: ${own.map((name) => name.slice("gestures-".length)).join(", ")}`);
			const logName = `gestures-${slug(serial)}-${stamp(startedAt)}-${input}-${index}.log`;
			const launch = await gesturesOnce(serial, packageName, input, own, timeoutMs, join(runsDir, logName), `runs/${logName}`);
			launches.push(launch);
			for (const line of describeLaunch(launch)) console.log(line);
		}
	}
	const file: GesturesFile = {
		schema: 1,
		kind: "gestures",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		run: names,
		inputs,
		launches,
	};
	const name = await writeRun("gestures", serial, startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
}
