import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, parseFlags } from "../lib/flags.ts";
import { appProcesses, fetchAppPath, launchApp, readAppFile, terminateApp } from "../lib/iphone/device.ts";
import { describeCrashReports, finishCrashWatch, keepCrashFiles } from "../lib/iphone/crash-reports.ts";
import { reportedIdentity } from "../lib/iphone/identity.ts";
import { iosOptions, newToken, startIosSuite, type IosSession } from "../lib/iphone/session.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp } from "../lib/runs.ts";
import { launchArguments } from "../lib/iphone/capture.ts";
import { sleep } from "../lib/wait.ts";
import { parseIdentity } from "../parse/ios.ts";

/**
 * Device probes of the native screens (`lib/native/dev/probe.ts`): the lab puts a screen in a state, does what a user would
 * (scroll, type into the search field, move a sheet, press escape, focus a field) and writes what UIKit and the accessibility tree
 * report. This command starts them and brings the results back into `qa/runs/probe-<device>-<stamp>/`; the verdicts are written
 * in SPEC.md, they are not gates.
 */
export async function iosProbe(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { ...iosOptions, probes: { type: "string" }, direction: { type: "string" } });
	const session = await startIosSuite("probe", argv, values);
	const names = (flagString(values.probes) ?? "large-title,translucent,search,sheet,dismissal,reset-form,reset-modal,reset-sheet,back-form,back-modal,back-sheet,tabs,keyboard,keyboard-sheet").split(",").filter(Boolean);
	const direction = flagString(values.direction) === "rtl" ? "rtl" : "ltr";
	const run = `probe-${slug(session.device.serial)}-${stamp(session.startedAt)}-${direction}`;
	const dir = join(runsDir, run);
	let reported: unknown;
	try {
		reported = await runProbes(session, { names, direction, dir });
	} catch (error) {
		// A probe whose app died is where its crash report matters most: list what the phone's crash log gained, then fail as before.
		const found = await finishCrashWatch(session.crashes);
		for (const line of describeCrashReports(found.record)) console.log(line);
		const kept = await keepCrashFiles(found, run).catch(() => null);
		if (kept) console.log(`kept the crash reports in ${kept.slice(qaDir.length + 1)}`);
		throw error;
	}
	// The app is ended: what the phone's crash log gained since the start is this run's, and it is listed before anything else can fail.
	const found = await finishCrashWatch(session.crashes);
	for (const line of describeCrashReports(found.record)) console.log(line);
	await writeFile(join(dir, "crash-reports.json"), `${JSON.stringify(found.record, null, "\t")}\n`);
	const kept = await keepCrashFiles(found, run);
	if (kept) console.log(`kept the crash reports in ${kept.slice(qaDir.length + 1)}`);
	// A probe of the wrong build leaves nothing running and writes no summary.
	const installed = reportedIdentity([parseIdentity(reported)], session.build, "probe");
	if (installed === null) console.log("warning: the probe index carries no build identity: the build under probe is not verified");
	const root = (await readdir(dir)).includes("index.json") ? dir : join(dir, "probe");
	const index = JSON.parse(await readFile(join(root, "index.json"), "utf8")) as { probes: { name: string; error: string | null; file: string }[] };
	for (const probe of index.probes) console.log(`  ${probe.error ? "error" : "ok   "} ${probe.name}${probe.error ? `: ${probe.error}` : ""}`);
	await writeFile(join(dir, "summary.txt"), `${index.probes.map((probe) => `${probe.name}\t${probe.error ?? "ok"}`).join("\n")}\n`);
	console.log(`wrote ${dir}`);
}

/** Starts the probes, waits for them, brings `Documents/probe` into `dir` and ends the app; returns the build identity the probe index reported. */
async function runProbes(session: IosSession, options: { names: string[]; direction: "ltr" | "rtl"; dir: string }): Promise<unknown> {
	const { names, direction, dir } = options;
	const token = newToken();
	const { pid } = await launchApp(session.target, { payloadUrl: `example-svelte:///__dev?run=probe:${names.join(".")}&token=${token}`, args: launchArguments[direction] });
	const deadline = Date.now() + 600_000;
	let done = false;
	let reported: unknown = null;
	while (Date.now() < deadline && !done) {
		await sleep(6000);
		const text = await readAppFile(session.target, "Documents/probe/index.json");
		let index: { token: string | null; done: boolean; probes: unknown[]; build?: unknown } | null = null;
		try {
			index = text === null ? null : (JSON.parse(text) as { token: string | null; done: boolean; probes: unknown[]; build?: unknown });
		} catch {
			// A copy that caught the file while the app wrote it: read again on the next poll.
		}
		if (index && index.token === token) {
			done = index.done;
			reported = index.build;
			console.log(`  ${index.probes.length} of ${names.length} probes done`);
		}
		if (!done && !(await appProcesses(session.target, session.installed)).includes(pid)) throw new Error(`the app (pid ${pid}) exited before the probes finished`);
	}
	if (!done) throw new Error("the probes did not finish within 10 minutes");
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	await fetchAppPath(session.target, "Documents/probe", dir);
	try {
		await terminateApp(session.target, pid);
	} catch {
		// The probes ended the lab's work; the app may already be gone.
	}
	return reported;
}
