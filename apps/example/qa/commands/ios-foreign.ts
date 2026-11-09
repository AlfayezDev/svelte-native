import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { flagString, integerFlag, parseFlags } from "../lib/flags.ts";
import { bundleOfMap, describeForeign, foreignPins, leftoverFilesPerRun } from "../lib/foreign.ts";
import { readAppFile } from "../lib/iphone/device.ts";
import { describeCrashReports, finishCrashWatch, keepCrashFiles, labRunsWithCrashes, withReports } from "../lib/iphone/crash-reports.ts";
import { foreignProgress, foreignRecords } from "../lib/iphone/foreign-results.ts";
import { notReported, reportedIdentity, withIdentity } from "../lib/iphone/identity.ts";
import { currentSource, iosOptions, readIosBuild, startIosSuite } from "../lib/iphone/session.ts";
import { describeRun } from "../lib/lab-run.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { BuildIdentity, ForeignBundle, ForeignFile, ForeignLaunch, LabRun } from "../lib/types.ts";
import { iosLabOnce } from "./ios-lab.ts";

/**
 * `native-qa foreign --platform ios`: the native-view libraries on the iPhone, the same two launches as Android's (`foreign.ts`) and the same gates. The lab is opened by
 * its URL (`run=foreign-libraries`, then `run=foreign-leftovers`) and the harness reads what the app wrote to `Documents/lab-results.json`: the lab puts every check and
 * every skip of the scenario into its entry there (`lib/iphone/foreign-results.ts`), where Android's harness reads one logcat line each. Nothing is driven from the harness
 * (`drive:adb` is Android's date dialog): a check that needs a finger is a skip with its reason, and a check that reads an Android-only fact is marked `androidOnly`.
 *
 * The app is ended after each launch (the way Android's force-stop ends it), so the second launch finds the files the first one's dead process left.
 */

/** The `ForeignLaunch` of an iPhone lab run: the JavaScript errors are the count the app reported of its own `console.error` calls, there is no engine to warn. */
export function iosLaunchOf(name: ForeignLaunch["name"], run: string, result: LabRun): ForeignLaunch {
	const reported = result.jsErrorCount ?? 0;
	return {
		name,
		run,
		startedAt: result.startedAt,
		durationMs: result.durationMs,
		complete: result.complete,
		crashes: result.crashes,
		jsErrors: reported > 0 ? [`the app counted ${reported} console.error call(s)`] : [],
		engineWarnings: [],
		logFile: result.logFile,
	};
}

/**
 * The release bundle of the build under test, from the source map that `build --platform ios` made of the same tree with Metro (`ios-bundle.ts`): the app on the phone
 * reported the identity of that build record, so the map belongs to it. No record, no map, or an app that reported no identity gives null, which fails the bundle check.
 */
export async function iosBundle(installed: BuildIdentity | null, record: Awaited<ReturnType<typeof readIosBuild>>): Promise<ForeignBundle | null> {
	if (!installed || !record?.sourceMap) return null;
	return { ...(await bundleOfMap(record.sourceMap.path)), matchesBuild: record.cdHash === installed.cdHash && (record.jsbundleSha256 ?? record.bundleSha256) === installed.jsbundleSha256 };
}

export async function iosForeign(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { ...iosOptions, only: { type: "string" }, timeout: { type: "string" } });
	const timeoutMs = integerFlag(values.timeout, "timeout", 1500) * 1000;
	const session = await startIosSuite("foreign", argv, values);
	const pins = await foreignPins("ios");
	const only = flagString(values.only)?.split(",").map((name) => name.trim()).filter(Boolean);
	const unknown = (only ?? []).filter((name) => !pins.libraries.includes(name));
	if (unknown.length > 0) throw new Error(`--only names ${unknown.join(", ")}, which gates.json does not pin (${pins.libraries.join(", ")})`);
	const asked = only && only.length > 0 ? only : [...pins.libraries];

	await mkdir(runsDir, { recursive: true });
	const librariesRun = `foreign-libraries${only && only.length > 0 ? `,only:${only.join(".")}` : ""}`;
	console.log(`foreign: ${librariesRun}`);
	const first = await iosLabOnce(session, librariesRun, timeoutMs, join(runsDir, `foreign-${slug(session.device.serial)}-${stamp(session.startedAt)}-libraries.log`));
	for (const line of describeRun(first.run)) console.log(line);
	let parsed = foreignRecords(first.results, "foreign-libraries");
	// A launch that did not reach the end of its scenario (the app died, the time ran out) wrote no results of it: the lab's progress file tells how far it got.
	if (!parsed.present) {
		const progress = foreignProgress(await readAppFile(session.target, "Documents/foreign-progress.json"), first.token);
		if (progress) {
			console.log(`  the scenario did not finish; its progress file has the places up to ${progress.finished}`);
			parsed = progress;
		}
	}
	console.log(`  ${parsed.checks.length} checks logged, ${parsed.checks.filter((entry) => !entry.passed).length} failed, ${parsed.skips.filter((entry) => !entry.androidOnly).length} skipped, ${parsed.skips.filter((entry) => entry.androidOnly).length} Android-only, ${parsed.unparsed.length} entries unreadable`);

	console.log("foreign: foreign-leftovers (the launch after it)");
	// The capture section leaves two files in each of the three places: a leftovers launch that has none to find proves nothing.
	const leftoversRun = `foreign-leftovers,expect:${asked.includes("capture") ? leftoverFilesPerRun : 0}`;
	const second = await iosLabOnce(session, leftoversRun, 300_000, join(runsDir, `foreign-${slug(session.device.serial)}-${stamp(session.startedAt)}-leftovers.log`));
	for (const line of describeRun(second.run)) console.log(line);
	const leftoverRecords = foreignRecords(second.results, "foreign-leftovers");

	// A run whose results never completed, or whose app died, is incomplete; the identity every file reported must be the recorded build.
	const reports = [first, second].flatMap((launch) => (launch.run.complete && launch.results ? [launch.results.build] : []));
	const installed = reportedIdentity(reports, session.build, "foreign");
	if (reports.length > 0 && installed === null) console.log(`warning: ${notReported}`);
	const found = await finishCrashWatch(session.crashes);
	const attributed = found.record.crashReports ? labRunsWithCrashes([first.run, second.run], found.record.crashReports) : null;
	const crashRecord = attributed ? withReports(found.record, attributed.reports) : found.record;
	const [firstRun, secondRun] = attributed?.runs ?? [first.run, second.run];
	for (const line of describeCrashReports(crashRecord)) console.log(line);

	const file: ForeignFile = {
		schema: 1,
		kind: "foreign",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device: session.device,
		app: withIdentity(session.app, installed),
		asked,
		checks: parsed.checks,
		skips: parsed.skips,
		leftovers: leftoverRecords.checks,
		unparsed: [...parsed.unparsed, ...leftoverRecords.unparsed],
		launches: [iosLaunchOf("libraries", librariesRun, firstRun ?? first.run), iosLaunchOf("leftovers", leftoversRun, secondRun ?? second.run)],
		bundle: await iosBundle(installed, await readIosBuild()),
		...crashRecord,
	};
	for (const line of describeForeign(file, { libraries: asked })) console.log(line);
	const name = await writeRun("foreign", session.device.serial, session.startedAt, file);
	const kept = await keepCrashFiles(found, name);
	if (kept) console.log(`kept the crash reports in ${kept.slice(qaDir.length + 1)}`);
	console.log(`wrote qa/runs/${name}.json`);
}
