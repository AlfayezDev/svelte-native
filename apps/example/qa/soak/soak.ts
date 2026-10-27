import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assertOnline,
	clearLogcat,
	deviceInfo,
	forceStop,
	shell,
	startApp,
	wake,
} from "../lib/adb.ts";
import { dexoptFlag, prepareApp } from "../lib/app.ts";
import { flagString, parseFlags, requireString } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { lockFor, reexecUnderLock } from "../lib/lock.ts";
import { defaultPackage, qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun, writeSideRun } from "../lib/runs.ts";
import type { MemSample, SoakFile } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { findEngineWarnings, findFaults, isJsFatal, parseLine } from "../parse/logcat.ts";
import { parseSoakSamples, soakPhaseOf } from "./log.ts";
import { parseMeminfo } from "./meminfo.ts";
import { soakMetrics } from "./metrics.ts";
import { watchLogcat } from "./stream.ts";

/** The parts of a soak cycle the lab knows (`soak-mix` in Stress.svelte); `static` is plain view churn and is only run when named. */
export const soakParts = [
	"churn",
	"static",
	"nav",
	"modal",
	"sheet",
	"header",
	"list",
	"tabs",
] as const;

function partsFlag(value: string | boolean | undefined): string[] {
	if (value === undefined) return [];
	if (typeof value !== "string") throw new Error("--parts needs a comma-separated list");
	const parts = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	const unknown = parts.filter((part) => !(soakParts as readonly string[]).includes(part));
	if (unknown.length > 0 || parts.length === 0)
		throw new Error(
			`--parts takes some of ${soakParts.join(", ")}${unknown.length ? `, not ${unknown.join(", ")}` : ""}`,
		);
	return parts;
}

/** A minute count with a fraction allowed (`--minutes 0.5`), at least 10 seconds. */
function minutesFlag(value: string | boolean | undefined): number {
	if (value === undefined) return 10;
	const minutes = typeof value === "string" ? Number(value) : Number.NaN;
	if (!Number.isFinite(minutes) || minutes < 1 / 6)
		throw new Error("--minutes must be a number of at least 0.17 (10 seconds)");
	return minutes;
}

function secondsFlag(value: string | boolean | undefined, name: string, fallback: number): number {
	if (value === undefined) return fallback;
	const seconds = typeof value === "string" ? Number(value) : Number.NaN;
	if (!Number.isFinite(seconds) || seconds < 1) throw new Error(`--${name} must be at least 1`);
	return seconds;
}

export function soakDefinition(
	minutes: number,
	intervalSeconds: number,
	parts: string[] = [],
): string {
	return [
		parts.length > 0
			? `A partial soak, to find where a growth comes from: only the parts ${parts.join(", ")} of the cycle run (the file is not merged into the report).`
			: "",
		`The lab (rasheed-svelte:///__dev?run=soak-mix-<seconds>s) runs cycles of 6 s animated churn (32 tiles replaced every 250 ms), 2 push/pop of a 60-row screen, 2 modal open/close, a sheet, 2 native-header screens pushed and popped, a 300-row windowed list mounted, scrolled and unmounted, and 3 tab switches, for ${minutes} minute(s), the first two cycles being the warm-up.`,
		`After the warm-up cycles and after the last cycle everything is unmounted and the app idles: 3 samples each (the Hermes heap collected first, then JS heap and engine counts from the lab, the process from dumpsys meminfo) form the baseline and final windows. Every ${intervalSeconds} s in between the same sources are sampled without a collection.`,
		"heapGrowthPct is the worse of the JS heap (HermesInternal allocated bytes) and the native heap (Native Heap Heap Alloc), final window over baseline window, medians. leakedViews is engine views mounted at the end minus at the baseline. deadTagWrites counts animated writes for a tag deleted more than 1 s ago, never claimed within 1 s, or dropped for lack of room, between the start of the soak and its end.",
	]
		.filter(Boolean)
		.join(" ");
}

type State = {
	booted: boolean;
	died: boolean;
	faulted: boolean;
	completedAt: number | null;
};

export async function soak(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		device: { type: "string" },
		apk: { type: "string" },
		"no-install": { type: "boolean" },
		dexopt: { type: "string" },
		minutes: { type: "string" },
		parts: { type: "string" },
		interval: { type: "string" },
		package: { type: "string" },
	});
	const serial = requireString(values.device, "device");
	const lock = lockFor(serial);
	if (lock) reexecUnderLock(lock, ["soak", ...argv]);

	const minutes = minutesFlag(values.minutes);
	const parts = partsFlag(values.parts);
	const intervalSeconds = secondsFlag(values.interval, "interval", 5);
	const packageName = flagString(values.package) ?? defaultPackage;
	const durationSeconds = Math.round(minutes * 60);
	// Two warm-up cycles and two idle windows come on top of the requested time, and the last cycle finishes whole.
	const timeoutMs = (durationSeconds + 180) * 1000;

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
		`${device.kind} ${device.model} (${serial}); soak of ${minutes} minute(s), process sampled every ${intervalSeconds} s`,
	);

	await wake(serial);
	await forceStop(serial, packageName);
	await sleep(1500);
	await clearLogcat(serial);

	const state: State = { booted: false, died: false, faulted: false, completedAt: null };
	const memory: MemSample[] = [];
	const t0 = Date.now();
	let sampling: Promise<void> = Promise.resolve();
	let samplesQueued = 0;
	let samplingFailure: Error | null = null;

	async function sampleProcess(tag: MemSample["tag"]): Promise<void> {
		const result = await shell(serial, `dumpsys meminfo ${packageName}`, { timeoutMs: 60_000 });
		if (result.code !== 0)
			throw new Error(
				`dumpsys meminfo exited with ${result.code}: ${result.stderr.trim().slice(0, 300)}`,
			);
		const info = parseMeminfo(result.stdout);
		if (!info) {
			if (state.booted) state.died = true;
			return;
		}
		memory.push({
			tag,
			atMs: Date.now() - t0,
			pid: info.pid,
			nativePssKb: info.nativePssKb,
			nativeAllocKb: info.nativeAllocKb,
			nativeSizeKb: info.nativeSizeKb,
			dalvikPssKb: info.dalvikPssKb,
			dalvikAllocKb: info.dalvikAllocKb,
			totalPssKb: info.totalPssKb,
			views: info.views,
			viewRootImpls: info.viewRootImpls,
			activities: info.activities,
			appContexts: info.appContexts,
		});
	}
	/** One `dumpsys meminfo` at a time, in the order asked; a failure is kept and ends the soak at the next look. */
	function enqueue(tag: MemSample["tag"]): void {
		samplesQueued++;
		sampling = sampling
			.then(() => sampleProcess(tag))
			.catch((error: unknown) => {
				samplingFailure ??= error instanceof Error ? error : new Error(String(error));
			})
			.finally(() => {
				samplesQueued--;
			});
	}

	const watch = watchLogcat(serial, (line) => {
		const entry = parseLine(line);
		if (!entry) return;
		if (entry.message.includes("[Svelte boot]")) state.booted = true;
		const phase = soakPhaseOf(entry.message);
		if (phase === "baseline" || phase === "checkpoint" || phase === "final") enqueue(phase);
		if (entry.message.startsWith("'[Svelte stress] complete'")) state.completedAt ??= Date.now();
		if (
			new RegExp(`^Process ${packageName.replaceAll(".", "\\.")} \\(pid \\d+\\) has died`).test(
				entry.message,
			)
		)
			state.died = true;
		// A JavaScript fatal leaves the process alive and blank, so the soak cannot wait for a death.
		if (
			(entry.tag === "AndroidRuntime" && entry.message.startsWith("FATAL EXCEPTION")) ||
			isJsFatal(entry)
		)
			state.faulted = true;
	});

	let text = "";
	let timedOut = false;
	try {
		await startApp(
			serial,
			packageName,
			`rasheed-svelte:///__dev?run=soak-mix-${durationSeconds}s${parts.map((part) => `.${part}`).join("")}`,
		);
		const deadline = t0 + timeoutMs;
		let nextSeries = t0 + intervalSeconds * 1000;
		let endedAt: number | null = null;
		for (;;) {
			const now = Date.now();
			const logFailure = watch.failure();
			if (logFailure) throw logFailure;
			if (samplingFailure) throw samplingFailure;
			if (state.completedAt !== null && now - state.completedAt > 2000) break;
			if (state.died || state.faulted) {
				endedAt ??= now;
				if (now - endedAt > 3000) break;
			}
			if (now > deadline) {
				timedOut = true;
				break;
			}
			if (state.booted && now >= nextSeries && state.completedAt === null && samplesQueued === 0) {
				enqueue("series");
				nextSeries = now + intervalSeconds * 1000;
			}
			await sleep(250);
		}
		await sampling;
		if (samplingFailure) throw samplingFailure;
	} finally {
		text = await watch.stop();
		await forceStop(serial, packageName);
	}

	await mkdir(runsDir, { recursive: true });
	const logPath = join(runsDir, `soak-${slug(serial)}-${stamp(startedAt)}.log`);
	await writeFile(logPath, text);
	const faults = findFaults(text, packageName);
	const crashes = [...faults.crashes];
	if (state.died && crashes.length === 0)
		crashes.push("the app process died without a fatal exception in the log");
	const js = parseSoakSamples(text);
	const file: SoakFile = {
		schema: 1,
		kind: "soak",
		startedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device,
		app,
		definition: soakDefinition(minutes, intervalSeconds, parts),
		parts,
		minutesRequested: minutes,
		complete:
			!timedOut && state.completedAt !== null && js.some((sample) => sample.phase === "final"),
		js,
		memory,
		crashes,
		jsErrors: faults.jsErrors,
		engineWarnings: findEngineWarnings(text),
		metrics: {},
		logFile: logPath.slice(qaDir.length + 1),
	};
	file.metrics = soakMetrics(file);
	// A partial soak is for bisecting a growth; it must never stand in for the full one in the report.
	const name = await (parts.length > 0
		? writeSideRun("partsoak", serial, startedAt, file)
		: writeRun("soak", serial, startedAt, file));
	console.log(
		`${js.length} lab samples, ${memory.length} process samples, complete ${file.complete}${timedOut ? " (timed out)" : ""}`,
	);
	for (const [key, value] of Object.entries(file.metrics))
		console.log(`  ${key.padEnd(30)} ${value ?? "not measured"}`);
	for (const crash of crashes.slice(0, 5)) console.log(`  crash: ${crash.slice(0, 200)}`);
	console.log(`wrote qa/runs/${name}.json`);
}
