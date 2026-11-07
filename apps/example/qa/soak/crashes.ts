import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { labOnce } from "../commands/lab.ts";
import {
	assertOnline,
	clearLogcat,
	deviceInfo,
	followLogcat,
	forceStop,
	shell,
	startApp,
	wake,
} from "../lib/adb.ts";
import { dexoptFlag, prepareApp } from "../lib/app.ts";
import { flagString, integerFlag, parseFlags, requireString } from "../lib/flags.ts";
import { currentSource } from "../lib/git.ts";
import { lockFor, reexecUnderLock } from "../lib/lock.ts";
import { defaultPackage, outDir, qaDir, runsDir } from "../lib/paths.ts";
import { latestRunFiles, readJson, slug, stamp, writeRun, writeSideRun } from "../lib/runs.ts";
import type {
	BuildFile,
	ColdStart,
	CrashesFile,
	CrashSignature,
	LabRun,
	SuiteRun,
} from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { findFaults, parseLine, parseSvelteBoot } from "../parse/logcat.ts";
import { crashMetrics } from "./metrics.ts";
import { extractCrashes, maxSignatures, recordSignature } from "./signatures.ts";
import { loadSymbolizer, symbolicateCrash, type Symbolizer } from "./symbolicate.ts";

const bootTimeoutMs = 20_000;
const settleMs = 1500;
const flushEvery = 25;

export function crashesDefinition(idleSeconds: number): string {
	return [
		`A cold start is a process started from nothing: wake, am force-stop, ${idleSeconds} s pause, logcat cleared, am start -W; the log is followed (main, system and crash buffers) until the JavaScript host prints [Svelte boot] and for ${settleMs / 1000} s more.`,
		"It crashed when the log holds a FATAL EXCEPTION or a native Fatal signal of the package, and it is an ANR when it holds ANR in <package>. It died when pidof finds no process of the package after that window. A start that did none of these but never printed [Svelte boot] within 20 s is counted apart (no boot).",
		"A suite is the full lab (rasheed-svelte:///__dev?run=checks,quick: 28 checks and the stress scenarios) as `native-qa lab` runs it; it crashed when its log holds a crash or an ANR of the package, and it is incomplete when the lab never logged its last line.",
		"Every distinct failure is kept once with a count (first 20), its frames symbolicated through the source map and the unstripped libraries when the build left them next to the APK.",
	].join(" ");
}

export type RunIdentity = { run: string; idleSeconds: number; packageName: string; installedSha256: string | null };

/**
 * Why a crashes file cannot be continued by this command, or null when it can: the suites, the idle gap, the package and the
 * installed build must all be the ones it measured. A file from before these were recorded, or a build that could not be
 * hashed on either side, cannot prove it, so it is refused too.
 */
export function resumeMismatch(resumed: CrashesFile, current: RunIdentity): string | null {
	const differences: string[] = [];
	const check = (name: string, before: unknown, now: unknown) => {
		if (before !== now) differences.push(`${name} ${JSON.stringify(before ?? null)} in the file, ${JSON.stringify(now)} now`);
	};
	check("--run", resumed.run, current.run);
	check("--idle", resumed.idleSeconds, current.idleSeconds);
	check("--package", resumed.packageName, current.packageName);
	check("installed build", resumed.app.installedSha256?.slice(0, 12), current.installedSha256?.slice(0, 12));
	if (resumed.app.installedSha256 === null || current.installedSha256 === null)
		differences.push("the installed build could not be identified on one side");
	return differences.length === 0 ? null : differences.join("; ");
}

/** The crash lines `findFaults` returns, split into ANRs and everything else. */
function split(crashes: string[], packageName: string): { crashes: number; anrs: number } {
	const anrs = crashes.filter((line) => line.startsWith(`ANR in ${packageName}`)).length;
	return { crashes: crashes.length - anrs, anrs };
}

/** A map or symbols from another build than the installed one would resolve frames to the wrong lines; say so. */
async function symbolizerWarning(
	abi: string,
	installedSha256: string | null,
): Promise<string | null> {
	try {
		const build = JSON.parse(
			await readFile(join(outDir, `build-${abi}.json`), "utf8"),
		) as BuildFile;
		if (installedSha256 !== null && build.apk.sha256 !== installedSha256)
			return `the source map and symbols next to the APK (qa/out/build-${abi}.json, apk sha256 ${build.apk.sha256.slice(0, 12)}) belong to another build than the installed one (${installedSha256.slice(0, 12)}); frames may resolve to the wrong lines. Pass --map and --symbols from the build that was installed.`;
		return null;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

type Outcome = { start: ColdStart; text: string };

async function coldStart(
	serial: string,
	packageName: string,
	index: number,
	idleSeconds: number,
	injectCrash: boolean,
): Promise<Outcome> {
	await wake(serial);
	await forceStop(serial, packageName);
	await sleep(idleSeconds * 1000);
	await clearLogcat(serial);
	const following = followLogcat(serial, /\[Svelte boot\]/, bootTimeoutMs, settleMs);
	let error: string | null = null;
	try {
		await startApp(serial, packageName);
		// Self-test: a real Java crash (`am crash`) right after the launch, to prove the runner sees what it counts.
		if (injectCrash) await shell(serial, `am crash ${packageName}`, { timeoutMs: 15_000 });
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	}
	const capture = await following;
	const pid = await shell(serial, `pidof ${packageName}`, { timeoutMs: 15_000 });
	// pidof exits 1 with no output when there is no such process; anything on stderr is adb itself failing.
	if (pid.stderr.trim() !== "")
		throw new Error(`adb shell pidof ${packageName} failed: ${pid.stderr.trim().slice(0, 300)}`);
	const alive = pid.stdout.trim() !== "";
	return {
		start: classifyStart(index, capture.text, capture.matched, alive, error, packageName),
		text: capture.text,
	};
}

/** What one cold start's log says: whether the host booted, whether the process crashed, hit an ANR or was gone. */
export function classifyStart(
	index: number,
	text: string,
	reachedBoot: boolean,
	alive: boolean,
	error: string | null,
	packageName: string,
): ColdStart {
	const faults = findFaults(text, packageName);
	const { crashes, anrs } = split(faults.crashes, packageName);
	return {
		index,
		reachedBoot,
		jsTotalMs: parseSvelteBoot(text)?.total ?? null,
		crash: crashes > 0,
		anr: anrs > 0,
		died: !alive,
		jsErrors: faults.jsErrors.length,
		error,
	};
}

/** What one full lab run says, as a suite of the crash count. */
export function classifySuite(
	index: number,
	run: LabRun,
	logFile: string,
	packageName: string,
): SuiteRun {
	const { crashes, anrs } = split(run.crashes, packageName);
	// A `[Svelte stress]` line the harness could not read is a suite that did not measure: incomplete, with the reason.
	const unreadable = run.unparsedLines ?? [];
	return {
		index,
		complete: run.complete && unreadable.length === 0,
		durationMs: run.durationMs,
		checksPassed: run.checks?.passed ?? null,
		crashes,
		anrs,
		jsErrors: run.jsErrors.length,
		logFile,
		error: unreadable.length > 0 ? `${unreadable.length} [Svelte stress] line(s) could not be read: ${unreadable[0]}` : null,
	};
}

/** The last few lines the app itself wrote, which is all a start that never booted can show. */
function lastAppLines(text: string, count: number): string[] {
	return text
		.split("\n")
		.map((line) => parseLine(line))
		.filter(
			(entry) =>
				entry !== null &&
				(entry.tag === "ReactNativeJS" ||
					entry.tag === "SvelteEngine" ||
					entry.tag === "ReactNative"),
		)
		.slice(-count)
		.map((entry) => `${entry?.tag}: ${entry?.message.slice(0, 200)}`);
}

async function recordFailure(
	signatures: CrashSignature[],
	symbolizer: Symbolizer,
	packageName: string,
	text: string,
	origin: string,
	fallback: { kind: "death" | "no-boot" | "suite-incomplete"; title: string } | null,
): Promise<void> {
	const crashes = extractCrashes(text, packageName);
	for (const crash of crashes) {
		const result = await symbolicateCrash(crash, symbolizer);
		recordSignature(signatures, {
			kind: crash.kind,
			title: crash.title,
			frames: result.frames.slice(0, 16),
			symbolicated: result.symbolicated,
			firstSeen: origin,
		});
	}
	if (crashes.length === 0 && fallback)
		recordSignature(signatures, {
			kind: fallback.kind,
			title: fallback.title,
			frames: lastAppLines(text, 3),
			symbolicated: false,
			firstSeen: origin,
		});
}

/** Suites are long (about 2.4 minutes each), so a chunk of them holds the device for about this many at most. */
const suiteChunkMax = 10;

export type CrashFlags = Record<string, string | boolean | undefined>;

/** The flags of a child run: everything the caller passed except those that describe the chunking itself. */
export function childArgs(
	values: CrashFlags,
	starts: number,
	suites: number,
	resume: boolean,
): string[] {
	const skipped = new Set(["chunk", "gap", "starts", "suites", "resume"]);
	const args = ["crashes", "--starts", String(starts), "--suites", String(suites)];
	if (resume) args.push("--resume");
	for (const [name, value] of Object.entries(values)) {
		if (skipped.has(name) || value === undefined || value === false) continue;
		args.push(`--${name}`);
		if (typeof value === "string") args.push(value);
	}
	return args;
}

/** What each chunk runs: the cold starts in steps of `chunk`, then the suites in steps of at most [suiteChunkMax]. */
export function chunkPlan(
	starts: number,
	suites: number,
	chunk: number,
): { starts: number; suites: number }[] {
	const plan: { starts: number; suites: number }[] = [];
	for (let done = 0; done < starts;) {
		done = Math.min(done + chunk, starts);
		plan.push({ starts: done, suites: 0 });
	}
	const step = Math.min(chunk, suiteChunkMax);
	for (let done = 0; done < suites;) {
		done = Math.min(done + step, suites);
		plan.push({ starts, suites: done });
	}
	return plan;
}

/**
 * `--chunk <n>`: the same run as several commands, each holding the emulator lock for at most `n` cold starts (or 10
 * suites) and releasing it in between, `--gap` seconds apart (default 20). The emulator's graphics stack leaks host
 * memory with every app launch, so a long series has to let the host's watchdog restart the emulator between chunks;
 * the chunks continue one file with `--resume`, so the counts add up across them.
 */
async function runInChunks(values: CrashFlags, chunk: number): Promise<void> {
	if (values["inject-crash"] === true)
		throw new Error("--chunk does not combine with --inject-crash");
	const script = process.argv[1];
	if (!script) throw new Error("cannot determine the script path to run the chunks");
	const startCount = integerFlag(values.starts, "starts", 1000);
	const suiteCount = integerFlag(values.suites, "suites", 100);
	const gapSeconds = integerFlag(values.gap, "gap", 20);
	const plan = chunkPlan(startCount, suiteCount, chunk);
	for (const [index, step] of plan.entries()) {
		if (index > 0) await sleep(gapSeconds * 1000);
		console.log(
			`chunk ${index + 1}/${plan.length}: up to ${step.starts} cold starts and ${step.suites} suites`,
		);
		const resume = index > 0 || values.resume === true;
		const result = spawnSync(
			process.execPath,
			[...process.execArgv, script, ...childArgs(values, step.starts, step.suites, resume)],
			{ stdio: "inherit" },
		);
		if (result.error) throw result.error;
		if (result.status !== 0)
			throw new Error(
				`chunk ${index + 1}/${plan.length} ended with status ${result.status}; continue with the same command plus --resume`,
			);
	}
}

export async function crashes(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		device: { type: "string" },
		apk: { type: "string" },
		"no-install": { type: "boolean" },
		dexopt: { type: "string" },
		starts: { type: "string" },
		suites: { type: "string" },
		idle: { type: "string" },
		run: { type: "string" },
		timeout: { type: "string" },
		package: { type: "string" },
		map: { type: "string" },
		symbols: { type: "string" },
		"inject-crash": { type: "boolean" },
		resume: { type: "boolean" },
		chunk: { type: "string" },
		gap: { type: "string" },
	});
	const serial = requireString(values.device, "device");
	const chunk = integerFlag(values.chunk, "chunk", 0);
	if (chunk > 0) {
		await runInChunks(values, chunk);
		return;
	}
	const lock = lockFor(serial);
	if (lock) await reexecUnderLock(lock, ["crashes", ...argv]);

	const startCount = integerFlag(values.starts, "starts", 1000);
	const suiteCount = integerFlag(values.suites, "suites", 100);
	const idleSeconds = integerFlag(values.idle, "idle", 2);
	const suiteTimeoutMs = integerFlag(values.timeout, "timeout", 360) * 1000;
	const run = flagString(values.run) ?? "checks,quick";
	const injectCrash = values["inject-crash"] === true;
	if (injectCrash && suiteCount > 0)
		throw new Error("--inject-crash is a self-test of the cold starts; pass --suites 0");
	const packageName = flagString(values.package) ?? defaultPackage;

	await assertOnline(serial);
	// `--resume` continues the device's newest crashes file (an emulator that went away, a Ctrl-C) where it stopped.
	const resumePath = values.resume ? (await latestRunFiles()).crashes.get(slug(serial)) : undefined;
	if (values.resume && !resumePath)
		throw new Error(`--resume: no crashes run file for ${serial} in qa/runs`);
	if (values.resume && injectCrash) throw new Error("--resume and --inject-crash do not combine");
	const resumed = resumePath ? await readJson<CrashesFile>(resumePath) : null;
	const startedAt = resumed ? new Date(resumed.startedAt) : new Date();
	const device = await deviceInfo(serial);
	const app = await prepareApp(serial, device, {
		apk: flagString(values.apk),
		noInstall: values["no-install"] === true,
		packageName,
		dexopt: dexoptFlag(values.dexopt),
	});
	const mismatch = resumed
		? resumeMismatch(resumed, { run, idleSeconds, packageName, installedSha256: app.installedSha256 })
		: null;
	if (mismatch)
		throw new Error(
			`--resume: this is not the run being resumed (${mismatch}); pass the same flags and install the same build with --apk`,
		);
	const symbolizer = await loadSymbolizer({
		map: flagString(values.map),
		symbols: flagString(values.symbols),
		abi: device.abi,
	});
	if (!values.map && !values.symbols) {
		const warning = await symbolizerWarning(device.abi, app.installedSha256);
		if (warning) console.log(`warning: ${warning}`);
	}
	console.log(
		`${device.kind} ${device.model} (${serial}); ${startCount} cold starts (idle ${idleSeconds} s), then ${suiteCount} full suites (${run}); source map ${symbolizer.map ? "found" : "missing"}, native symbols ${symbolizer.symbolsDir ? (symbolizer.ndkStack ? "found" : "found but no ndk-stack") : "missing"}`,
	);

	await mkdir(runsDir, { recursive: true });
	const base = `${injectCrash ? "crashtest" : "crashes"}-${slug(serial)}-${stamp(startedAt)}`;
	const logPath = join(runsDir, `${base}.log`);
	const failureLog: string[] = resumed
		? (await readFile(logPath, "utf8")).split("\n").filter(Boolean)
		: [];
	const coldStarts: ColdStart[] = resumed ? [...resumed.coldStarts] : [];
	const suites: SuiteRun[] = resumed ? [...resumed.suites] : [];
	const signatures: CrashSignature[] = resumed ? [...resumed.signatures] : [];
	if (resumed)
		console.log(
			`resuming ${base}: ${coldStarts.length} cold starts and ${suites.length} suites already measured`,
		);
	const source = await currentSource();

	async function flush(): Promise<void> {
		const file: CrashesFile = {
			schema: 1,
			kind: "crashes",
			startedAt: startedAt.toISOString(),
			finishedAt: new Date().toISOString(),
			source,
			device,
			app,
			definition: crashesDefinition(idleSeconds),
			run,
			idleSeconds,
			packageName,
			coldStarts,
			suites,
			signatures,
			logFile: logPath.slice(qaDir.length + 1),
		};
		await writeFile(logPath, `${failureLog.join("\n")}\n`);
		if (injectCrash) await writeSideRun("crashtest", serial, startedAt, file);
		else await writeRun("crashes", serial, startedAt, file);
	}
	// A run of hours is written as it goes and on Ctrl-C, so what it has measured is never lost with it.
	for (const signal of ["SIGINT", "SIGTERM"] as const)
		process.on(signal, () => {
			void flush().then(() => process.exit(130));
		});

	try {
		for (let index = coldStarts.length + 1; index <= startCount; index++) {
			const { start, text } = await coldStart(serial, packageName, index, idleSeconds, injectCrash);
			coldStarts.push(start);
			const failed = start.crash || start.died || start.anr || !start.reachedBoot;
			if (failed) {
				const what = start.crash
					? "crash"
					: start.anr
						? "ANR"
						: start.died
							? "process died"
							: "no [Svelte boot]";
				console.log(
					`  cold start ${index}: ${what}${start.error ? ` (${start.error.slice(0, 160)})` : ""}`,
				);
				failureLog.push(
					`=== cold start ${index}: ${what} ===`,
					...text
						.split("\n")
						.filter((line) => line.length > 0)
						.slice(-120),
				);
				const fallback = start.died
					? {
							kind: "death" as const,
							title: "the process was gone after [Svelte boot] with no fatal exception in the log",
						}
					: {
							kind: "no-boot" as const,
							title: `no [Svelte boot] within ${bootTimeoutMs / 1000} s`,
						};
				await recordFailure(
					signatures,
					symbolizer,
					packageName,
					text,
					`cold start ${index}`,
					start.reachedBoot && !start.died ? null : fallback,
				);
			}
			if (index % flushEvery === 0 || index === startCount) {
				const crashed = coldStarts.filter((entry) => entry.crash || entry.died).length;
				console.log(
					`  ${index}/${startCount} cold starts, ${crashed} crashed, ${coldStarts.filter((entry) => entry.anr).length} ANR, ${coldStarts.filter((entry) => !entry.reachedBoot).length} without boot`,
				);
				await flush();
			}
		}

		for (let index = suites.length + 1; index <= suiteCount; index++) {
			const suiteLog = join(runsDir, `${base}-suite-${index}.log`);
			let record: SuiteRun;
			try {
				const result = await labOnce(serial, packageName, run, suiteTimeoutMs, suiteLog);
				record = classifySuite(index, result, suiteLog.slice(qaDir.length + 1), packageName);
				if (record.crashes + record.anrs > 0 || !result.complete)
					await recordFailure(
						signatures,
						symbolizer,
						packageName,
						await readFile(suiteLog, "utf8"),
						`suite ${index}`,
						result.complete
							? null
							: {
									kind: "suite-incomplete",
									title: result.interrupted
										? `the lab was interrupted by ${result.interrupted.by}`
										: "the lab never logged its last line",
								},
					);
			} catch (error) {
				// A log that cannot be parsed is a suite that did not measure; a device that went away ends the run.
				await assertOnline(serial);
				record = {
					index,
					complete: false,
					durationMs: 0,
					checksPassed: null,
					crashes: 0,
					anrs: 0,
					jsErrors: 0,
					logFile: suiteLog.slice(qaDir.length + 1),
					error: error instanceof Error ? error.message : String(error),
				};
			}
			suites.push(record);
			console.log(
				`  suite ${index}/${suiteCount}: ${record.error ? `error ${record.error.slice(0, 200)}` : `complete ${record.complete} in ${(record.durationMs / 1000).toFixed(0)} s, checks ${record.checksPassed ?? "-"}, crashes ${record.crashes}, ANRs ${record.anrs}`}`,
			);
			await flush();
		}
	} finally {
		await flush();
	}
	const metrics = crashMetrics({
		schema: 1,
		kind: "crashes",
		startedAt: "",
		finishedAt: "",
		source,
		device,
		app,
		definition: "",
		run,
		idleSeconds,
		packageName,
		coldStarts,
		suites,
		signatures,
		logFile: "",
	});
	for (const [key, value] of Object.entries(metrics)) console.log(`  ${key.padEnd(28)} ${value}`);
	for (const signature of signatures.slice(0, maxSignatures))
		console.log(
			`  ${signature.kind} x${signature.count} (${signature.firstSeen}): ${signature.title.slice(0, 160)}${signature.symbolicated || !["js", "native"].includes(signature.kind) ? "" : "  [frames not symbolicated]"}`,
		);
	console.log(`wrote qa/runs/${base}.json`);
}
