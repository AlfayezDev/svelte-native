import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integerFlag, parseFlags } from "../lib/flags.ts";
import { appProcesses, launchApp, readAppFile, terminateApp } from "../lib/iphone/device.ts";
import { currentSource, iosOptions, newToken, startIosSuite } from "../lib/iphone/session.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import { describeSmoke, smokePins } from "../lib/smoke.ts";
import { reportVerdict } from "./smoke.ts";
import type { SmokeFile, SmokeModuleResult } from "../lib/types.ts";
import { schemeOf } from "../lib/variant.ts";
import { sleep } from "../lib/wait.ts";

const pollMs = 3_000;

/** The URL that starts the smoke scenario in the smoke app; the token comes back in the results file. */
export const smokeLaunchUrl = (token: string): string => `${schemeOf.smoke}:///__dev?run=smoke&token=${token}`;

type ResultsFile = { token: string | null; finishedAt: string; os: string; results: { module: string; status: string; path: string; ms: number; detail: string }[] };

/** `Documents/smoke-results.json`, as the app wrote it; null for text that is not the file (the app was writing it while it was copied). */
export function parseSmokeResultsFile(text: string): ResultsFile | null {
	try {
		const value = JSON.parse(text) as Partial<ResultsFile>;
		if (!Array.isArray(value.results) || typeof value.os !== "string") return null;
		return { token: typeof value.token === "string" ? value.token : null, finishedAt: String(value.finishedAt), os: value.os, results: value.results };
	} catch {
		return null;
	}
}

export function moduleResults(file: ResultsFile): SmokeModuleResult[] {
	return file.results.flatMap((entry) =>
		entry.status === "ok" || entry.status === "fail" || entry.status === "skip"
			? [{ module: entry.module, status: entry.status, path: entry.path, ms: typeof entry.ms === "number" ? entry.ms : null, detail: entry.detail }]
			: [],
	);
}

/**
 * The smoke test on the iPhone, in the smoke app (`io.rasheed.svelteqa.smoke`, built by `build --platform ios --variant smoke`): the lab is started by its URL with a token, the app writes `Documents/smoke-results.json` when its
 * last module reported (an iPhone run cannot follow a log), and the harness reads the file that carries its token. Same run file
 * as Android's, `smoke-<device>-<stamp>.json`.
 */
export async function iosSmoke(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { ...iosOptions, timeout: { type: "string" } });
	const session = await startIosSuite("smoke", argv, values, "smoke");
	const timeoutMs = integerFlag(values.timeout, "timeout", 180) * 1000;
	const pins = await smokePins("ios");
	const { target } = session;
	const token = newToken();
	const launched = Date.now();
	const { pid } = await launchApp(target, { payloadUrl: smokeLaunchUrl(token) });
	const deadline = launched + timeoutMs;
	let found: ResultsFile | null = null;
	let raw = "";
	let died: string | null = null;
	while (Date.now() < deadline && found === null) {
		await sleep(pollMs);
		const text = await readAppFile(target, "Documents/smoke-results.json");
		const parsed = text === null ? null : parseSmokeResultsFile(text);
		if (text !== null && parsed?.token === token) {
			found = parsed;
			raw = text;
		} else if (!(await appProcesses(target, session.installed)).includes(pid)) {
			died = `the app (pid ${pid}) was not running before the smoke test finished`;
			break;
		}
	}
	try {
		await terminateApp(target, pid);
	} catch {
		// The app already ended (a finished run or a crash); there is nothing left to stop.
	}
	await mkdir(runsDir, { recursive: true });
	const logPath = join(runsDir, `smoke-${slug(session.device.serial)}-${stamp(session.startedAt)}.log`);
	await writeFile(logPath, raw || `no results were written${died ? `: ${died}` : ""}\n`);
	const results = found ? moduleResults(found) : [];
	const count = (status: SmokeModuleResult["status"]) => results.filter((result) => result.status === status).length;
	const file: SmokeFile = {
		schema: 1,
		kind: "smoke",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device: session.device,
		app: session.app,
		run: "smoke",
		complete: found !== null,
		results,
		completion: found ? { os: found.os, total: results.length, ok: count("ok"), fail: count("fail"), skip: count("skip") } : null,
		crashes: died ? [died] : [],
		jsErrorCount: null,
		durationMs: Date.now() - launched,
		logFile: logPath.slice(qaDir.length + 1),
	};
	for (const line of describeSmoke(file, pins)) console.log(line);
	const name = await writeRun("smoke", session.device.serial, session.startedAt, file);
	console.log(`wrote qa/runs/${name}.json`);
	await reportVerdict(file);
}
