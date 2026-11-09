import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { shellQuote } from "../lib/exec.ts";
import { flagString, integerFlag, parseFlags } from "../lib/flags.ts";
import { appProcesses, phoneAnswers, readAppFile, readAppFileAfc, terminateApp } from "../lib/iphone/device.ts";
import { describeCrashReports, finishCrashWatch, keepCrashFiles } from "../lib/iphone/crash-reports.ts";
import { describeUiTestLeftovers, inBackground, prepareUiTests, requireUsb, testAlive, uiTestsRemote, waitForTestStarted } from "../lib/iphone/gestures.ts";
import { notReported, reportedIdentity, withIdentity } from "../lib/iphone/identity.ts";
import {
	buildIosPlan,
	describeOutcome,
	fullIosPlanSize,
	fullPlan,
	parseNavigationOutcome,
	parseTestOutput,
	resilienceCommand,
	resultsFor,
	startedLine,
	testPlan,
	whyStopped,
	type IosPlanOptions,
	type IosStep,
	type TestOutput,
} from "../lib/iphone/resilience.ts";
import { remote, remoteOk } from "../lib/iphone/mac.ts";
import { currentSource, iosOptions, newToken, startIosSuite, type IosSession } from "../lib/iphone/session.ts";
import { qaDir, runsDir } from "../lib/paths.ts";
import { slug, stamp, writeRun } from "../lib/runs.ts";
import type { BuildIdentity, NavigationOutcome, ResilienceFile, ResilienceStep } from "../lib/types.ts";
import { sleep } from "../lib/wait.ts";
import { parseIdentity } from "../parse/ios.ts";

/**
 * `native-qa resilience --platform ios` (README, "Resilience on the iPhone"): the plan of `lib/iphone/resilience.ts` carried out on the phone by an
 * XCUITest (`ios-ui-tests/GesturesUITests/ResilienceUITests.swift`) that the harness starts over `ssh` like the gesture run. While the test runs the
 * phone is asked nothing; afterwards the harness reads the build the app reported (`Documents/resilience.json`, written by the lab's
 * `run=resilience` launch) and what the navigation module did at the app's last start (`last.json`), pulls the crash log, and writes the run file the
 * Android run writes.
 */

const progressEveryMs = 30_000;

export type PlanRun = {
	output: TestOutput | null;
	text: string;
	/** Set when the harness stopped waiting before the test ended. */
	ended: string | null;
	identity: BuildIdentity | null;
	navigation: NavigationOutcome | null;
};

/** Starts the test on the Mac, waits for it, and reads what the phone holds afterwards. */
export async function runPlan(session: IosSession, steps: IosStep[], token: string, timeoutMs: number, options: IosPlanOptions, pollMs = 5000): Promise<PlanRun> {
	const { target } = session;
	const { mac } = target;
	const outFile = `${uiTestsRemote}/resilience-output-${token}.log`;
	const seconds = Math.ceil(timeoutMs / 1000);
	const plan = JSON.stringify(testPlan(steps, token, options));
	const started = await remoteOk(mac, inBackground(resilienceCommand({ dir: uiTestsRemote, udid: session.udid, bundleId: target.bundleId, seconds, outFile, plan })));
	const testPid = Number(started.trim().split("\n").pop());
	// The phone is not asked anything while the test runs: devicectl calls made then hang now and then, so the harness only watches the Mac's side.
	if (!(await waitForTestStarted(mac, outFile, 150_000, startedLine))) console.log(`warning: the test did not say ${startedLine} within 150 s`);
	const deadline = Date.now() + timeoutMs;
	let ended: string | null = null;
	let nextProgress = Date.now() + progressEveryMs;
	let reached = 0;
	while (Date.now() < deadline) {
		await sleep(pollMs);
		if (Number.isFinite(testPid) && !(await testAlive(mac, testPid))) break;
		if (Date.now() >= nextProgress) {
			nextProgress = Date.now() + progressEveryMs;
			const counted = await remote(mac, `grep -c ${shellQuote("^RESILIENCE-STEP")} ${shellQuote(outFile)} 2>/dev/null`);
			const count = Number.parseInt(counted.stdout.trim(), 10);
			if (Number.isFinite(count) && count !== reached) {
				reached = count;
				console.log(`  ${count} of ${steps.length} steps done`);
			}
		}
	}
	if (Date.now() >= deadline) ended = "the XCUITest run did not end within the timeout";
	if (Number.isFinite(testPid)) await remote(mac, `pkill -TERM -P ${testPid} 2>/dev/null; kill ${testPid} 2>/dev/null; true`);
	for (const line of await describeUiTestLeftovers(mac)) console.log(`  ${line}`);
	// The test is over: the phone answers again.
	const text = (await remote(mac, `cat ${shellQuote(outFile)} 2>/dev/null; rm -f ${shellQuote(outFile)}`)).stdout;
	// The two small files come through house_arrest first: CoreDevice is often wedged for minutes after a UI test, and then every `devicectl` call costs its whole limit.
	// `devicectl` is asked only when the file did not come that way and the phone answers it.
	let answering: boolean | null = null;
	const readFile = async (source: string): Promise<string | null> => {
		const viaAfc = await readAppFileAfc(target, session.udid, source).catch(() => null);
		if (viaAfc !== null) return viaAfc;
		answering ??= await phoneAnswers(target);
		return answering ? await readAppFile(target, source) : null;
	};
	let identity: BuildIdentity | null = null;
	let navigation: NavigationOutcome | null = null;
	try {
		const reported = await readFile("Documents/resilience.json");
		const parsed = reported === null ? null : (JSON.parse(reported) as { token?: unknown; build?: unknown });
		// A file of an earlier run (another token) says nothing about this one.
		if (parsed && parsed.token === token) identity = parseIdentity(parsed.build);
	} catch (error) {
		console.log(`  reading Documents/resilience.json failed: ${String(error instanceof Error ? error.message : error).slice(0, 160)}`);
	}
	try {
		navigation = parseNavigationOutcome(await readFile("Library/Application Support/svelte-navigation/last.json"));
	} catch (error) {
		console.log(`  reading the navigation module's last.json failed: ${String(error instanceof Error ? error.message : error).slice(0, 160)}`);
	}
	// The test ends the app as its last act; only a phone that answers is asked to end a process that is still there.
	try {
		answering ??= await phoneAnswers(target);
		if (answering) for (const pid of await appProcesses(target, session.installed)) await terminateApp(target, pid).catch(() => undefined);
	} catch {
		// The app already ended, as the test leaves it.
	}
	return { output: text.trim() === "" ? null : parseTestOutput(text), text, ended, identity, navigation };
}

/** What a run says about a restore that failed: the steps see the screen; this is what the module did, which tells a fault of the state from the system declining to keep it. */
export function restoreHints(steps: ResilienceStep[], navigation: NavigationOutcome | null): string[] {
	const failedRestore = steps.filter((step) => !step.ok && step.group !== "rotation" && step.group !== "background" && step.group !== "appearance");
	if (failedRestore.length === 0) return [];
	return [`${failedRestore.length} step(s) that end and restart the app failed; ${describeOutcome(navigation)}`];
}

export async function iosResilience(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, {
		...iosOptions,
		rotations: { type: "string" },
		cycles: { type: "string" },
		rounds: { type: "string" },
		timeout: { type: "string" },
		team: { type: "string" },
		rebuild: { type: "boolean" },
		"build-only": { type: "boolean" },
		"assume-system-kill": { type: "boolean" },
	});
	const session = await startIosSuite("resilience", argv, values, "qa", { uiTest: true });
	const options: IosPlanOptions = {
		rotationCycles: integerFlag(values.rotations, "rotations", fullPlan.rotationCycles),
		backgroundCycles: integerFlag(values.cycles, "cycles", fullPlan.backgroundCycles),
		killRounds: integerFlag(values.rounds, "rounds", fullPlan.killRounds),
		...(values["assume-system-kill"] === true ? { assumeSystemKill: true } : {}),
	};
	if (options.assumeSystemKill) console.log("--assume-system-kill: the navigation module hands its state over without the system's signal; this run is a diagnostic, and resilience.gateBypassed fails it");
	const timeoutMs = integerFlag(values.timeout, "timeout", 1800) * 1000;
	await requireUsb(session.target.mac, session.udid);
	await prepareUiTests(session, { team: flagString(values.team), rebuild: values.rebuild === true });
	if (values["build-only"] === true) {
		console.log("--build-only: the runner is ready, no step was run");
		return;
	}
	const token = newToken();
	const steps = buildIosPlan(options, token);
	console.log(`resilience: ${steps.length} steps (the full plan has ${fullIosPlanSize})`);

	await mkdir(runsDir, { recursive: true });
	const logPath = join(runsDir, `resilience-${slug(session.device.serial)}-${stamp(session.startedAt)}.log`);
	const run = await runPlan(session, steps, token, timeoutMs, options);
	const results = resultsFor(steps, run.output, whyStopped(run.output, run.ended));
	for (const result of results) {
		if (!result.ok || result.skipped !== undefined || result.index % 10 === 0)
			console.log(`  ${result.skipped !== undefined ? "skip" : result.ok ? "ok  " : "FAIL"} ${String(result.index).padStart(3)} ${result.group.padEnd(10)} ${result.name} (${(result.durationMs / 1000).toFixed(1)} s)${result.skipped !== undefined ? `\n        ${result.skipped}` : ""}${result.ok ? "" : `\n        ${result.failures.join("\n        ")}`}`);
	}
	for (const line of restoreHints(results, run.navigation)) console.log(line);
	console.log(describeOutcome(run.navigation));

	let installed: BuildIdentity | null;
	try {
		installed = reportedIdentity([run.identity], session.build, "resilience");
	} catch (error) {
		// A run of the wrong build measured nothing a gate could read, but the crash log still tells what the app did on the phone.
		const found = await finishCrashWatch(session.crashes, { afterUiTest: true });
		for (const line of describeCrashReports(found.record)) console.log(line);
		throw error;
	}
	if (installed === null) console.log(`warning: ${notReported}`);
	// CoreDevice can stay wedged for minutes after a UI test: the crash log is read over USB first.
	const found = await finishCrashWatch(session.crashes, { afterUiTest: true });
	for (const line of describeCrashReports(found.record)) console.log(line);
	const failed = results.filter((step) => !step.ok).length;
	const unfinished = run.output === null || !run.output.done;
	await writeFile(logPath, `${run.text || "the test printed nothing\n"}\n--- navigation module ---\n${describeOutcome(run.navigation)}\n${run.navigation ? JSON.stringify(run.navigation) : ""}\n`);
	const file: ResilienceFile = {
		schema: 1,
		kind: "resilience",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device: session.device,
		app: withIdentity(session.app, installed),
		screen: "screens-header",
		steps: results,
		planned: steps.length,
		logFile: logPath.slice(qaDir.length + 1),
		aborted: results.some((step) => step.failures.some((failure) => failure.startsWith("the step did not run"))) ? whyStopped(run.output, run.ended) : null,
		navigation: run.navigation,
		...(options.assumeSystemKill ? { assumeSystemKill: true } : {}),
		// The test puts the phone upright and light as its last act: a run that did not get there may have left it changed.
		...(unfinished ? { restoreFailures: ["the test ended before RESILIENCE-DONE: the phone may be left in landscape or in the dark appearance, and the app running"] } : {}),
		...found.record,
	};
	const name = await writeRun("resilience", session.device.serial, session.startedAt, file);
	const kept = await keepCrashFiles(found, name);
	if (kept) console.log(`kept the crash reports in ${kept.slice(qaDir.length + 1)}`);
	console.log(`resilience: ${results.length} steps, ${failed} failed, ${results.filter((step) => step.skipped !== undefined).length} skipped`);
	console.log(`wrote qa/runs/${name}.json`);
}
