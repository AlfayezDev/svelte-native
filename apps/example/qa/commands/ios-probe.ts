import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, parseFlags } from "../lib/flags.ts";
import { appProcesses, fetchAppPath, launchApp, readAppFile, terminateApp } from "../lib/iphone/device.ts";
import { iosOptions, newToken, startIosSuite } from "../lib/iphone/session.ts";
import { runsDir } from "../lib/paths.ts";
import { slug, stamp } from "../lib/runs.ts";
import { launchArguments } from "../lib/iphone/capture.ts";
import { sleep } from "../lib/wait.ts";

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
	const token = newToken();
	const { pid } = await launchApp(session.target, { payloadUrl: `rasheed-svelte:///__dev?run=probe:${names.join(".")}&token=${token}`, args: launchArguments[direction] });
	const deadline = Date.now() + 600_000;
	let done = false;
	while (Date.now() < deadline && !done) {
		await sleep(6000);
		const text = await readAppFile(session.target, "Documents/probe/index.json");
		let index: { token: string | null; done: boolean; probes: unknown[] } | null = null;
		try {
			index = text === null ? null : (JSON.parse(text) as { token: string | null; done: boolean; probes: unknown[] });
		} catch {
			// A copy that caught the file while the app wrote it: read again on the next poll.
		}
		if (index && index.token === token) {
			done = index.done;
			console.log(`  ${index.probes.length} of ${names.length} probes done`);
		}
		if (!done && !(await appProcesses(session.target, session.installed)).includes(pid)) throw new Error(`the app (pid ${pid}) exited before the probes finished`);
	}
	if (!done) throw new Error("the probes did not finish within 10 minutes");
	const dir = join(runsDir, `probe-${slug(session.device.serial)}-${stamp(session.startedAt)}-${direction}`);
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	await fetchAppPath(session.target, "Documents/probe", dir);
	try {
		await terminateApp(session.target, pid);
	} catch {
		// The probes ended the lab's work; the app may already be gone.
	}
	const root = (await readdir(dir)).includes("index.json") ? dir : join(dir, "probe");
	const index = JSON.parse(await readFile(join(root, "index.json"), "utf8")) as { probes: { name: string; error: string | null; file: string }[] };
	for (const probe of index.probes) console.log(`  ${probe.error ? "error" : "ok   "} ${probe.name}${probe.error ? `: ${probe.error}` : ""}`);
	await writeFile(join(dir, "summary.txt"), `${index.probes.map((probe) => `${probe.name}\t${probe.error ?? "ok"}`).join("\n")}\n`);
	console.log(`wrote ${dir}`);
}
