import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, integerFlag, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { describeForeign, foreignPins, readBundle } from "../lib/foreign.ts";
import { pressDriver } from "../lib/foreign-press.ts";
import { runsDir } from "../lib/paths.ts";
import { readBuilds, slug, stamp, writeRun } from "../lib/runs.ts";
import { commonOptions, startSuite } from "../lib/suite.ts";
import type { ForeignFile, ForeignLaunch, LabRun } from "../lib/types.ts";
import { parseForeignChecks } from "../parse/foreign.ts";
import { labOnce } from "./lab.ts";

/**
 * `native-qa foreign`: the native-view libraries on a device (SPEC.md, "Foreign views", "Device verification of the libraries"). Two launches of
 * the lab: `run=foreign-libraries` (every library inline, in a row of the windowed List and in a native sheet: mounts, prop updates, events, commands,
 * the pixels of a capture of it) and then `run=foreign-leftovers` (the capture files the first launch's process left in the cache directory are
 * gone), and the harness's own look at the release bundle of the build under test. The result is `qa/runs/foreign-<device>-<stamp>.json`, which
 * `report` merges and the `foreign.*` gates judge.
 *
 * `--only image,video` narrows the libraries (the run file then does not cover the others, and their gates read not measured).
 */
export function launchOf(name: ForeignLaunch["name"], run: string, result: LabRun, attempts = 1): ForeignLaunch {
	return {
		name,
		run,
		startedAt: result.startedAt,
		durationMs: result.durationMs,
		complete: result.complete,
		crashes: result.crashes,
		jsErrors: result.jsErrors,
		engineWarnings: result.engineWarnings,
		...(result.interrupted ? { interrupted: result.interrupted } : {}),
		logFile: result.logFile,
		...(attempts > 1 ? { attempts } : {}),
	};
}

/**
 * One launch of the lab, again when another app came to the front during it (`interrupted`: the app was paused, its views and its checks with it, and the
 * run says so): the emulator is shared, and another agent's own app launches on it. The last attempt is the launch; its `attempts` is how many it took.
 */
async function launchUntilUninterrupted(attempts: number, once: (attempt: number) => Promise<LabRun>): Promise<{ result: LabRun; attempts: number }> {
	let result = await once(1);
	let made = 1;
	while (result.interrupted && made < attempts) {
		console.log(`  interrupted by ${result.interrupted.by}; launching again (${made + 1} of ${attempts})`);
		result = await once(++made);
	}
	return { result, attempts: made };
}

export async function foreign(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") throw new Error("native-qa foreign: the iPhone lane is not built yet (the lab runs there through `lab --platform ios`; its checks need the QA module's readbacks, see SPEC.md, \"Device verification of the libraries\")");
	const { values } = parseFlags(argv, { ...commonOptions, platform: { type: "string" }, only: { type: "string" }, timeout: { type: "string" }, attempts: { type: "string" } });
	const timeoutMs = integerFlag(values.timeout, "timeout", 1500) * 1000;
	const attempts = integerFlag(values.attempts, "attempts", 3);
	if (attempts < 1) throw new Error("--attempts must be at least 1");
	const { serial, packageName, device, app, startedAt } = await startSuite("foreign", argv, values);
	const pins = await foreignPins(device.platform);
	const only = flagString(values.only)?.split(",").map((name) => name.trim()).filter(Boolean);
	const unknown = (only ?? []).filter((name) => !pins.libraries.includes(name));
	if (unknown.length > 0) throw new Error(`--only names ${unknown.join(", ")}, which gates.json does not pin (${pins.libraries.join(", ")})`);
	const asked = only && only.length > 0 ? only : [...pins.libraries];

	await mkdir(runsDir, { recursive: true });
	const launches: ForeignLaunch[] = [];
	// `drive:adb`: the lab asks the harness to press the buttons of the date dialog, a native window it cannot touch itself.
	const librariesRun = `foreign-libraries${only && only.length > 0 ? `,only:${only.join(".")}` : ""},drive:adb`;
	console.log(`foreign: ${librariesRun}`);
	const first = join(runsDir, `foreign-${slug(serial)}-${stamp(startedAt)}-libraries.log`);
	const presses = pressDriver(serial);
	let parsedText = "";
	try {
		const launched = await launchUntilUninterrupted(attempts, async (attempt) => {
			const result = await labOnce(serial, packageName, librariesRun, timeoutMs, first);
			parsedText = await readFile(first, "utf8");
			if (attempt > 1) console.log(`  attempt ${attempt}: ${result.complete ? "complete" : "incomplete"}`);
			return result;
		});
		launches.push(launchOf("libraries", librariesRun, launched.result, launched.attempts));
	} finally {
		presses.stop();
	}
	for (const line of presses.log) console.log(`  ${line}`);
	const parsed = parseForeignChecks(parsedText);
	console.log(`  ${parsed.checks.length} checks logged, ${parsed.checks.filter((entry) => !entry.passed).length} failed, ${parsed.skips.length} skipped`);
	console.log("foreign: foreign-leftovers (the launch after it)");
	const second = join(runsDir, `foreign-${slug(serial)}-${stamp(startedAt)}-leftovers.log`);
	launches.push(launchOf("leftovers", "foreign-leftovers", await labOnce(serial, packageName, "foreign-leftovers", 300_000, second)));
	const leftovers = parseForeignChecks(await readFile(second, "utf8")).checks;

	const file: ForeignFile = {
		schema: 1,
		kind: "foreign",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		asked,
		checks: parsed.checks,
		skips: parsed.skips,
		leftovers,
		launches,
		bundle: await readBundle(app, await readBuilds()),
	};
	for (const line of describeForeign(file, { libraries: asked })) console.log(line);
	const name = await writeRun("foreign", serial, startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
}
