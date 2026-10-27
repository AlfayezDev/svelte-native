import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, integerFlag, parseFlags } from "../lib/flags.ts";
import { appProcesses, launchApp, readAppFile, terminateApp } from "../lib/iphone/device.ts";
import { labFinished, labRunFromIos, parseIosLabResults, type IosLabResults } from "../lib/iphone/lab-results.ts";
import { currentSource, iosOptions, newToken, startIosSuite, type IosSession } from "../lib/iphone/session.ts";
import { describeRun, stressRequested } from "../lib/lab-run.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { LabFile, LabRun } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";


const pollMs = 10_000;
const aliveEveryMs = 30_000;

/**
 * One lab run on the iPhone: the lab is started by its URL (with a token that comes back in every file it writes), and its results
 * are read from `Documents/lab-results.json` until it says it has finished. The app is ended afterwards, the way the Android run
 * force-stops it.
 */
export async function iosLabOnce(session: IosSession, run: string, timeoutMs: number, logPath: string): Promise<LabRun> {
	const { target } = session;
	const token = newToken();
	const startedAt = new Date();
	const { pid } = await launchApp(target, { payloadUrl: `rasheed-svelte:///__dev?run=${run}&token=${token}` });
	const deadline = Date.now() + timeoutMs;
	let results: IosLabResults | null = null;
	let raw = "";
	let died: string | null = null;
	let nextAliveCheck = Date.now() + aliveEveryMs;
	const wanted = stressRequested(run);
	while (Date.now() < deadline) {
		await sleep(pollMs);
		const text = await readAppFile(target, "Documents/lab-results.json");
		let parsed: IosLabResults | null = null;
		try {
			parsed = text === null ? null : parseIosLabResults(text);
		} catch {
			// The app writes the file while the harness copies it: a copy that caught it empty or half written is read again on the next poll.
		}
		if (text !== null && parsed) {
			if (parsed.token === token) {
				results = parsed;
				raw = text;
				if (labFinished(parsed, wanted)) break;
			}
		}
		if (Date.now() >= nextAliveCheck) {
			nextAliveCheck = Date.now() + aliveEveryMs;
			if (!(await appProcesses(target, session.installed)).includes(pid)) {
				died = `the app (pid ${pid}) was not running before the lab finished`;
				break;
			}
		}
	}
	try {
		await terminateApp(target, pid);
	} catch {
		// The app already ended (a finished lab or a crash); there is nothing left to stop.
	}
	await writeFile(logPath, raw || "no results were written\n");
	return labRunFromIos({ results, startedAt, durationMs: Date.now() - startedAt.getTime(), died, logFile: logPath.slice(qaDir.length + 1) }, wanted);
}

export async function iosLab(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		...iosOptions,
		repeat: { type: "string" },
		timeout: { type: "string" },
		run: { type: "string" },
	});
	const session = await startIosSuite("lab", argv, values);
	const repeat = integerFlag(values.repeat, "repeat", 1);
	const timeoutMs = integerFlag(values.timeout, "timeout", 360) * 1000;
	const run = flagString(values.run) ?? "checks,quick";
	if (repeat < 1) throw new Error("--repeat must be at least 1");

	await mkdir(runsDir, { recursive: true });
	const runs: LabRun[] = [];
	for (let index = 1; index <= repeat; index++) {
		console.log(`lab run ${index}/${repeat} (${run})`);
		const logPath = join(runsDir, `lab-${slug(session.device.serial)}-${stamp(session.startedAt)}-${index}.log`);
		const result = await iosLabOnce(session, run, timeoutMs, logPath);
		runs.push(result);
		for (const line of describeRun(result)) console.log(line);
	}
	const idle = runs.flatMap((entry) => entry.scenarios).find((scenario) => scenario.name === "idle")?.periodMs;
	const device = idle ? { ...session.device, refreshHz: Math.round(1000 / idle) } : session.device;
	const file: LabFile = {
		schema: 1,
		kind: "lab",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app: session.app,
		runs,
	};
	const name = await writeRun("lab", device.serial, session.startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
}
