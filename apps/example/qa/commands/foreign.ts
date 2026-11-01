import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, integerFlag, parseFlags, platformOf } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { describeForeign, foreignPins, readBundle } from "../lib/foreign.ts";
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
export function launchOf(name: ForeignLaunch["name"], run: string, result: LabRun): ForeignLaunch {
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
	};
}

export async function foreign(argv: string[]): Promise<void> {
	if (platformOf(argv) === "ios") throw new Error("native-qa foreign: the iPhone lane is not built yet (the lab runs there through `lab --platform ios`; its checks need the QA module's readbacks, see SPEC.md, \"Device verification of the libraries\")");
	const { values } = parseFlags(argv, { ...commonOptions, platform: { type: "string" }, only: { type: "string" }, timeout: { type: "string" } });
	const timeoutMs = integerFlag(values.timeout, "timeout", 1500) * 1000;
	const { serial, packageName, device, app, startedAt } = await startSuite("foreign", argv, values);
	const pins = await foreignPins(device.platform);
	const only = flagString(values.only)?.split(",").map((name) => name.trim()).filter(Boolean);
	const unknown = (only ?? []).filter((name) => !pins.libraries.includes(name));
	if (unknown.length > 0) throw new Error(`--only names ${unknown.join(", ")}, which gates.json does not pin (${pins.libraries.join(", ")})`);
	const asked = only && only.length > 0 ? only : [...pins.libraries];

	await mkdir(runsDir, { recursive: true });
	const launches: ForeignLaunch[] = [];
	const librariesRun = `foreign-libraries${only && only.length > 0 ? `,only:${only.join(".")}` : ""}`;
	console.log(`foreign: ${librariesRun}`);
	const first = join(runsDir, `foreign-${slug(serial)}-${stamp(startedAt)}-libraries.log`);
	launches.push(launchOf("libraries", librariesRun, await labOnce(serial, packageName, librariesRun, timeoutMs, first)));
	const parsed = parseForeignChecks(await readFile(first, "utf8"));
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
