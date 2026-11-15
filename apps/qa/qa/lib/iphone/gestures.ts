import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec, shellQuote } from "../exec.ts";
import { flagString, integerFlag, parseFlags } from "../flags.ts";
import { describeLaunch, namesFor, resultFrom, runValue, scenarioNamesFrom } from "../gestures.ts";
import { currentSource } from "../git.ts";
import { qaDir, runsDir } from "../paths.ts";
import { slug, stamp, writeRun } from "../runs.ts";
import { sleep } from "../wait.ts";
import { appProcesses, readAppFile, terminateApp } from "./device.ts";
import { describeStories, storiesFrom, type TraceAction, type TraceFile } from "./gesture-trace.ts";
import { attribute, describeCrash, describeCrashReports, finishCrashWatch, keepCrashFiles, withReports } from "./crash-reports.ts";
import { notReported, reportedIdentity, withIdentity } from "./identity.ts";
import { labFinished, labScenarios, parseIosLabResults, type IosLabResults } from "./lab-results.ts";
import { boundedWords, remote, remoteOk, type Mac } from "./mac.ts";
import { iosOptions, newToken, startIosSuite, type IosSession } from "./session.ts";
import type { BuildIdentity, CrashReport, GestureInjection, GestureLaunch, GesturesFile } from "../types.ts";

/**
 * Driving the gesture lab on the iPhone (SPEC.md, "Gestures", "Driving the lab"). Touches cannot be synthesized from inside an iOS app
 * without private API, so none is attempted: a small XCUITest bundle (`qa/ios-ui-tests/`, a standalone project whose runner targets the
 * installed app by bundle id) reads the lab's `ready` line from an element of the page (`gestures.status`, whose accessibility label is
 * the line's JSON), finds the views a step aims at by their `testID` (`gesture.<name>`, so no pixel handshake is needed) and performs the
 * input with `XCUICoordinate.press(forDuration:thenDragTo:withVelocity:thenHoldForDuration:)`, `pinch(withScale:velocity:)` and
 * `rotate(_:withVelocity:)`. It runs with `xcodebuild test-without-building` over `ssh` to the Mac while the app logs, as it does for `lab`,
 * `[Svelte stress]` results into `Documents/lab-results.json`, which this driver reads: the verdicts are the lab's own.
 *
 * Signing needs the login keychain of the logged-in user, so the runner is built the way the app is (`commands/ios-build.ts`): by a
 * script the GUI Terminal opens (`build-for-testing`, once per change of the test sources, and again when its provisioning profile has expired:
 * a Personal Team's lasts 7 days); the tests then run over `ssh`.
 * Run on the iPhone SE 3 (iOS 26.6, 28 Oct to 1 Nov 2026; SPEC.md, "iOS status (lane G5)"): the project `make-project.rb` generates builds, the
 * runner installs and starts, and the scenarios run (12 scenarios, 23 touch actions per full run, three full runs). What the phone needs is in
 * the SPEC: on USB, unlocked and awake, with Settings > Developer > Enable UI Automation on, and no `devicectl` call while the
 * test runs (it hangs; the results, the trace and the process list are read once the test has ended). What is not verified: a person's finger
 * (the edge zone and the release of a swipe are measured with synthesized touches only), a pinch and a rotation at the same moment (XCUITest does
 * one after the other), a touch on a gesture in a tab pane.
 */

export const uiTestsLocal = join(qaDir, "ios-ui-tests");
export const uiTestsRemote = "/tmp/native-qa-ios/gestures-ui-tests";
export const sourceFiles = ["make-project.rb", "GesturesUITests/GesturesUITests.swift", "GesturesUITests/ResilienceUITests.swift"];

/** The digest of the test sources: the runner is built again only when it changes. */
export function sourcesDigest(contents: readonly string[]): string {
	const hash = createHash("sha256");
	for (const content of contents) hash.update(content).update("\0");
	return hash.digest("hex").slice(0, 16);
}

export type BuildScript = { dir: string; team: string; udid: string; exitFile: string; logFile: string; digest: string };

/** The script the GUI Terminal runs: generate the project, `build-for-testing`, write the exit status. */
export function buildScript(options: BuildScript): string {
	const { dir, team, udid, exitFile, logFile, digest } = options;
	return [
		"#!/bin/bash",
		"export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH LANG=en_US.UTF-8",
		`cd ${shellQuote(dir)} || { echo 1 > ${shellQuote(exitFile)}; exit 1; }`,
		`export DEVELOPMENT_TEAM=${shellQuote(team)}`,
		"rm -rf GesturesUITests.xcodeproj DerivedData",
		`{ ruby make-project.rb && xcodebuild build-for-testing -project GesturesUITests.xcodeproj -scheme GesturesUITests -destination ${shellQuote(`id=${udid}`)} -derivedDataPath DerivedData -allowProvisioningUpdates DEVELOPMENT_TEAM=${shellQuote(team)}; } > ${shellQuote(logFile)} 2>&1`,
		"status=$?",
		`[ $status -eq 0 ] && echo ${shellQuote(digest)} > .built`,
		`echo $status > ${shellQuote(exitFile)}`,
		"",
	].join("\n");
}

export type TestRun = { dir: string; udid: string; bundleId: string; seconds: number; outFile: string; url: string; trace?: boolean; calibrate?: string; edgeX?: string; edgeRelease?: string; edgeBy?: string };

/** The command line of the test run: the runner already built; the test opens the lab's link itself (the lab app must not be started by anything else). */
export function testCommand(options: TestRun): string {
	const { dir, udid, bundleId, seconds, outFile, url, trace, calibrate, edgeX, edgeRelease, edgeBy } = options;
	return [
		`cd ${shellQuote(dir)}`,
		`export TEST_RUNNER_GESTURES_SECONDS=${seconds} TEST_RUNNER_GESTURES_BUNDLE_ID=${shellQuote(bundleId)} TEST_RUNNER_GESTURES_URL=${shellQuote(url)} TEST_RUNNER_GESTURES_TRACE=${trace ? 1 : 0} TEST_RUNNER_GESTURES_CALIBRATE=${shellQuote(calibrate ?? "")} TEST_RUNNER_GESTURES_EDGE_X=${shellQuote(edgeX ?? "")} TEST_RUNNER_GESTURES_EDGE_RELEASE=${shellQuote(edgeRelease ?? "")} TEST_RUNNER_GESTURES_EDGE_BY=${shellQuote(edgeBy ?? "")}`,
		`xcodebuild test-without-building -xctestrun "$(ls DerivedData/Build/Products/*.xctestrun | head -n 1)" -destination ${shellQuote(`id=${udid}`)} -only-testing:GesturesUITests/GesturesUITests/testDrive > ${shellQuote(outFile)} 2>&1`,
	].join(" && ");
}

/** Whether `idevice_id -l` (the phones on USB; `-n` lists the ones on the network) names the phone. */
export const onUsb = (listing: string, udid: string): boolean => listing.split("\n").some((line) => line.trim() === udid);

/**
 * XCUITest needs the phone on USB: over the local network (devicectl reaches it either way) the runner's automation mode times out after 60 s
 * ("Timed out while enabling automation mode"), and the crash-report pull needs USB too. Fails at once, saying so, instead of after that timeout.
 */
export async function requireUsb(mac: Mac, udid: string): Promise<void> {
	const result = await remote(mac, "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; command -v idevice_id > /dev/null && idevice_id -l");
	if (result.code !== 0) throw new Error(`cannot list the phones on USB: idevice_id is not installed on the Mac or failed (${(result.stderr || result.stdout).trim().slice(0, 200)})`);
	if (!onUsb(result.stdout, udid))
		throw new Error(`the iPhone (${udid}) is not on USB: it is reachable over the local network only, where XCUITest's automation mode times out after 60 s and the crash reports cannot be pulled. Plug it in, unlock it, and run again`);
}

/** Starts a command in the background on the Mac and prints its process id. */
export const inBackground = (command: string): string => `nohup sh -c ${shellQuote(command)} > /dev/null 2>&1 & echo $!`;

export type UiTestOutput = {
	actions: { scenario: string; round: number; step: number; kind: string; error: string | null; beganMs: number | null; endedMs: number | null }[];
	failures: string[];
	/** The test case's own verdict line, when it got that far (a run the harness stopped has none). */
	ended: "passed" | "failed" | null;
};

/** What the test printed: its `GESTURES-ACTION {json}` lines, XCTest's failure lines and the test case's verdict. */
export function parseUiTestOutput(text: string): UiTestOutput {
	const actions: UiTestOutput["actions"] = [];
	const failures: string[] = [];
	let ended: UiTestOutput["ended"] = null;
	for (const line of text.split("\n")) {
		const action = /^GESTURES-ACTION (.*\S)\s*$/.exec(line);
		if (action) {
			try {
				const value = JSON.parse(action[1] as string) as Record<string, unknown>;
				actions.push({
					scenario: String(value.scenario ?? ""),
					round: Number(value.round ?? 0),
					step: Number(value.step ?? 0),
					kind: String(value.kind ?? ""),
					error: typeof value.error === "string" ? value.error : null,
					beganMs: typeof value.beganMs === "number" ? value.beganMs : null,
					endedMs: typeof value.endedMs === "number" ? value.endedMs : null,
				});
			} catch {
				failures.push(`unreadable action line: ${line.slice(0, 120)}`);
			}
			continue;
		}
		const failure = /error: -\[[^\]]+\] : (.*)$/.exec(line);
		if (failure) failures.push(failure[1] as string);
		const verdict = /^Test Case '[^']+' (passed|failed)/.exec(line);
		if (verdict) ended = verdict[1] as "passed" | "failed";
	}
	return { actions, failures, ended };
}

/** The injections of each scenario, in the shape the run file keeps. */
export function injectionsFrom(output: UiTestOutput): Record<string, GestureInjection[]> {
	const byScenario: Record<string, GestureInjection[]> = {};
	for (const action of output.actions)
		(byScenario[action.scenario] ??= []).push({ round: action.round, step: action.step, stepName: "", command: action.kind, problems: [], error: action.error });
	return byScenario;
}

/** The launches with the crash reports attributed to them: a launch whose app aborted is incomplete, however far it got. */
export function launchesWithCrashes(launches: GestureLaunch[], reports: CrashReport[]): { launches: GestureLaunch[]; reports: CrashReport[] } {
	const attributed = attribute(
		reports,
		launches.map((launch, index) => ({ label: `gestures ${index + 1}`, pid: launch.pid ?? null, startedAtMs: Date.parse(launch.startedAt) })),
	);
	const marked = launches.map((launch, index) => {
		const own = attributed.filter((report) => report.attributedTo === `gestures ${index + 1}`);
		if (own.length === 0) return launch;
		return { ...launch, complete: false, crashes: [...launch.crashes, ...own.map((report) => `the app aborted: ${describeCrash(report)}`)] };
	});
	return { launches: marked, reports: attributed };
}

/** A launch from what the app wrote and what the test printed. */
export function launchFromIos(capture: {
	asked: string[];
	results: IosLabResults | null;
	startedAt: Date;
	durationMs: number;
	died: string | null;
	/** Set when the test ended before the lab did. */
	ended?: string | null;
	pid: number;
	output: UiTestOutput | null;
	testText: string;
	logFile: string;
}): GestureLaunch {
	const { results, output } = capture;
	const injections = output ? injectionsFrom(output) : {};
	const scenarios = results ? labScenarios(results).filter((scenario) => scenario.name.startsWith("gestures-")).map((scenario) => resultFrom(scenario, injections[scenario.name] ?? [])) : [];
	const finished = results !== null && labFinished(results, true);
	const harnessErrors: string[] = capture.ended ? [capture.ended] : [];
	if (output === null) harnessErrors.push("the test run produced no output");
	else {
		harnessErrors.push(...output.failures);
		for (const action of output.actions) if (action.error) harnessErrors.push(`${action.scenario} step ${action.step + 1}: ${action.error}`);
		if (output.actions.length === 0) harnessErrors.push(`the test performed no action: ${capture.testText.trim().split("\n").slice(-4).join(" | ").slice(0, 400)}`);
		if (capture.testText.includes("This provisioning profile has expired")) harnessErrors.push("the phone refused the XCUITest runner: its provisioning profile has expired (the next run builds it again)");
	}
	return {
		input: "xctest",
		asked: capture.asked,
		startedAt: capture.startedAt.toISOString(),
		durationMs: capture.durationMs,
		complete: finished && capture.died === null && capture.asked.every((name) => scenarios.some((scenario) => scenario.name === name)),
		scenarios,
		crashes: capture.died ? [capture.died] : [],
		jsErrors: [],
		engineWarnings: [],
		harnessErrors,
		pid: capture.pid,
		logFile: capture.logFile,
	};
}

/* ---- the Mac ---- */

async function remoteDigest(mac: Mac): Promise<string | null> {
	const result = await remote(mac, `cat ${shellQuote(`${uiTestsRemote}/.built`)} 2>/dev/null`);
	return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * Why the built runner must be signed again, or `null` while its profile is valid. A Personal Team's provisioning profile expires 7 days after it
 * was made, and the phone then refuses to install the runner ("This provisioning profile has expired", 0xe8008011) although its sources have not
 * changed. Only an expired or unreadable profile counts: Xcode may keep a profile that is still valid, so building again earlier need not renew
 * it, and the build deletes the runner that still works. A profile that expires during a long run fails the launches after that moment, which say so
 * (`launchFromIos`), and the next run builds again. `expiry` is the profile's `ExpirationDate` as `plutil -extract … raw` prints it, `null` when it
 * could not be read.
 */
export function profileStale(expiry: string | null, now: Date): string | null {
	const at = expiry === null ? Number.NaN : Date.parse(expiry);
	if (Number.isNaN(at)) return "its provisioning profile could not be read";
	if (at <= now.getTime()) return `its provisioning profile expired at ${new Date(at).toISOString()}`;
	return null;
}

/**
 * The `ExpirationDate` of the built runner's embedded provisioning profile, or `null`. The system's LibreSSL reads the signed plist without
 * verifying it: `security cms -D` fails over `ssh` ("cert import failed: Write permissions error", the login keychain is locked there).
 */
async function remoteProfileExpiry(mac: Mac): Promise<string | null> {
	const profile = `${uiTestsRemote}/DerivedData/Build/Products/Debug-iphoneos/GesturesUITests-Runner.app/embedded.mobileprovision`;
	const result = await remote(mac, `/usr/bin/openssl smime -inform der -verify -noverify -in ${shellQuote(profile)} 2>/dev/null | plutil -extract ExpirationDate raw -o - - 2>/dev/null`);
	return result.code === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : null;
}

/** Copies the test project to the Mac and, when its sources changed since the runner was built, its profile is stale (`profileStale`) or `rebuild` is set, builds the runner in the GUI Terminal. */
export async function prepareUiTests(session: IosSession, options: { team: string | undefined; rebuild: boolean }): Promise<void> {
	const { mac } = session.target;
	const digest = sourcesDigest(await Promise.all(sourceFiles.map((file) => readFile(join(uiTestsLocal, file), "utf8"))));
	await remoteOk(mac, `mkdir -p ${shellQuote(uiTestsRemote)}`);
	const synced = await exec("rsync", ["-rlpc", "-e", "ssh -o BatchMode=yes", "--exclude", "DerivedData", "--exclude", ".built", "--exclude", "*.xcodeproj", `${uiTestsLocal}/`, `${mac.target}:${uiTestsRemote}/`], { timeoutMs: 120_000 });
	if (synced.code !== 0) throw new Error(`rsync of qa/ios-ui-tests exited with ${synced.code}: ${synced.stderr.trim().slice(0, 400)}`);
	if (!options.rebuild && (await remoteDigest(mac)) === digest) {
		const stale = profileStale(await remoteProfileExpiry(mac), new Date());
		if (stale === null) {
			console.log(`the XCUITest runner on the Mac is current (${digest})`);
			return;
		}
		console.log(`the XCUITest runner on the Mac is built from the current sources (${digest}), but ${stale}: building it again`);
	}
	const team = options.team ?? process.env.NATIVE_QA_IOS_TEAM;
	if (!team) throw new Error("--team <development team id> (or NATIVE_QA_IOS_TEAM) is required to build the XCUITest runner");
	const base = "/tmp/native-qa-ios/gestures-ui-tests-build";
	const exitFile = `${base}.exit`;
	const logFile = `${base}.log`;
	const script = join(qaDir, "out", "gestures-ui-tests.command");
	await mkdir(join(qaDir, "out"), { recursive: true });
	await writeFile(script, buildScript({ dir: uiTestsRemote, team, udid: session.udid, exitFile, logFile, digest }), { mode: 0o755 });
	const scp = await exec("scp", ["-q", "-o", "BatchMode=yes", script, `${mac.target}:${base}.command`], { timeoutMs: 60_000 });
	if (scp.code !== 0) throw new Error(`scp of the build script exited with ${scp.code}: ${scp.stderr.trim().slice(0, 300)}`);
	await remoteOk(mac, `chmod +x ${shellQuote(`${base}.command`)} && rm -f ${shellQuote(exitFile)} && open -a Terminal ${shellQuote(`${base}.command`)}`);
	console.log("the XCUITest runner is built in the GUI Terminal; waiting for it");
	const began = Date.now();
	let code: string | null = null;
	while (Date.now() - began < 20 * 60_000) {
		await sleep(15_000);
		const result = await remote(mac, `cat ${shellQuote(exitFile)} 2>/dev/null`);
		if (/^\d+$/.test(result.stdout.trim())) { code = result.stdout.trim(); break; }
	}
	if (code === null) throw new Error(`the XCUITest runner was not built within 20 minutes (${logFile} on the Mac)`);
	if (code !== "0") {
		const tail = await remote(mac, `grep -E 'error:|BUILD FAILED|TEST BUILD FAILED' ${shellQuote(logFile)} | tail -n 6`);
		throw new Error(`building the XCUITest runner failed (exit ${code}): ${tail.stdout.trim().replaceAll("\n", " | ")} (${logFile} on the Mac)`);
	}
	console.log(`built the XCUITest runner (${digest})`);
}

/** Where the pushed-edge swipe starts on the iPhone, in points from the edge: the lab asks for 8 (Android's zone is 24 dp), UIKit's edge swipe takes touches within about 3 (SPEC.md, iOS contract item 3). `--edge-x` overrides it. */
export const defaultEdgeX = "2";

/** Writes `1` or `0` to the app's `Documents/gesture-trace.on`: the QA app records its recognizers at its next launch when it reads `1` (an app that XCUITest opens by link takes no launch argument). */
async function setTraceFlag(target: IosSession["target"], on: boolean): Promise<void> {
	const file = "/tmp/native-qa-ios/trace-flag";
	const copy = boundedWords(50, ["xcrun", "devicectl", "device", "copy", "to", "--device", target.id, "--source", file, "--destination", "Documents/gesture-trace.on", "--domain-type", "appDataContainer", "--domain-identifier", target.bundleId]);
	// devicectl's first copy to a phone that was just used fails now and then; the tool's own words are kept, and one more try is made.
	const command = `mkdir -p /tmp/native-qa-ios && printf ${on ? "1" : "0"} > ${file} && { out=$(${copy} 2>&1) || { sleep 3; out=$(${copy} 2>&1); } || { echo "$out" | tail -n 6 >&2; exit 1; }; }`;
	await remoteOk(target.mac, command, { timeoutMs: 120_000 });
}

/** The app's recognizer recording (`--trace`), kept beside the log as `<log>.trace.json`, and what it says about each action the test performed. */
async function readTrace(target: IosSession["target"], logPath: string, outFile: string, mac: Mac, launchedAfterMs: number): Promise<string[]> {
	// The app writes the recording about every 0.4 s while it changes: the last rows are in the file a moment after the last action.
	await sleep(1500);
	const text = await readAppFile(target, "Documents/gesture-trace.json");
	if (text === null) return ["trace: the app wrote no Documents/gesture-trace.json (is this build one with SvelteQAGestureTrace?)"];
	await writeFile(logPath.replace(/\.log$/, ".trace.json"), text);
	let trace: TraceFile;
	try {
		trace = JSON.parse(text) as TraceFile;
	} catch {
		return ["trace: Documents/gesture-trace.json is not JSON"];
	}
	const out = (await remote(mac, `cat ${shellQuote(outFile)} 2>/dev/null`)).stdout;
	const actions: TraceAction[] = parseUiTestOutput(out).actions.flatMap((action) =>
		action.beganMs !== null && action.endedMs !== null ? [{ scenario: action.scenario, round: action.round, step: action.step, kind: action.kind, beganMs: action.beganMs, endedMs: action.endedMs }] : [],
	);
	// The phone's clock and this machine's agree to a few seconds; a recording from before this launch is minutes old at least.
	if ((trace.startedMs ?? 0) < launchedAfterMs - 30_000) return ["trace: Documents/gesture-trace.json is from an earlier launch of the app (the app did not start recording this time)"];
	return [`trace: ${trace.rows.length} rows, ${trace.touches?.length ?? 0} touch events, ${trace.meta.length} recognizers, ${trace.context.length} context samples; ${actions.length} actions`, ...describeStories(storiesFrom(trace, actions))];
}

/** The line the test prints once it has opened the lab's link. */
export const testStartedLine = "GESTURES-STARTED";

/**
 * Waits for the test to say it opened the lab, before the harness asks the phone anything: devicectl calls made while the runner is starting up
 * (automation mode, the app's launch) hang for a minute and a half now and then. False when the line did not come in time (the run goes on and says why).
 */
export async function waitForTestStarted(mac: Mac, outFile: string, maxMs: number, line: string = testStartedLine): Promise<boolean> {
	const deadline = Date.now() + maxMs;
	while (Date.now() < deadline) {
		const result = await remote(mac, `grep -c ${shellQuote(line)} ${shellQuote(outFile)} 2>/dev/null`);
		if (result.stdout.trim() !== "" && result.stdout.trim() !== "0") return true;
		await sleep(2000);
	}
	return false;
}

/** The names of the Mac processes a UI test leaves behind that hold the phone (CoreDevice stays wedged until they are gone or the phone is plugged in again). */
const uiTestProcess = /xcodebuild|xctest|XCTRunner|testmanagerd|xcresulttool|xcdevice/;
/** CoreDevice's own daemon: it runs all the time, so it is never a leftover, and it is shown on a line of its own (a restart of it is worth knowing). */
const coreDeviceDaemon = /CoreDeviceService/;

const withoutPsItself = (output: string): string[] =>
	output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !/ps -axo/.test(line));

/** The `ps -axo pid,ppid,etime,command` lines of `output` that name a process of UI testing (the listing's own command and its `grep` are not among them; the CoreDevice daemon is not one). */
export function uiTestLeftovers(output: string): string[] {
	return withoutPsItself(output)
		.filter((line) => uiTestProcess.test(line) && !coreDeviceDaemon.test(line))
		.map((line) => line.slice(0, 220));
}

/** The lines of `output` that name CoreDevice's daemon. */
export function coreDeviceDaemons(output: string): string[] {
	return withoutPsItself(output)
		.filter((line) => coreDeviceDaemon.test(line))
		.map((line) => line.slice(0, 220));
}

/** How long the processes the test was told to end get to go before the Mac is asked what is left. */
export const leftoversGraceMs = 1500;

/**
 * What a finished UI test left running on the Mac, printed by the commands that ran one: when CoreDevice stays wedged afterwards, the run says which
 * process was still there. The commands end the test they started (`pkill -TERM`) just before this, and a process that was told to end takes a moment
 * to go, so it waits a second and a half before it asks. Nothing is ended here; a `ps` that failed says so, it does not read as none.
 */
export async function describeUiTestLeftovers(mac: Mac, graceMs: number = leftoversGraceMs): Promise<string[]> {
	await sleep(graceMs);
	const result = await remote(mac, "ps -axo pid,ppid,etime,command");
	if (result.code !== 0) return [`after the test: the process list of the Mac could not be read (exit ${result.code})`];
	const left = uiTestLeftovers(result.stdout);
	const daemon = coreDeviceDaemons(result.stdout);
	return [
		...(left.length === 0 ? ["after the test: no xcodebuild, xctest or testmanagerd process is left on the Mac"] : [`after the test: ${left.length} process(es) of UI testing on the Mac:`, ...left.map((line) => `  ${line}`)]),
		daemon.length === 0 ? "  CoreDeviceService is not running" : `  CoreDeviceService (a daemon, not a leftover): ${daemon.map((line) => line.split(/\s+/).slice(0, 3).join(" ")).join("; ")}`,
	];
}

/** Whether the process the test was started as (the shell that runs xcodebuild) still exists. */
export async function testAlive(mac: Mac, pid: number): Promise<boolean> {
	const result = await remote(mac, `kill -0 ${pid} 2>/dev/null && echo alive`);
	return result.stdout.includes("alive");
}

/** One launch of the lab with the given scenarios on the iPhone, an XCUITest injecting while the app writes its results. */
export async function iosGesturesOnce(session: IosSession, names: string[], timeoutMs: number, logPath: string, options: { trace?: boolean; calibrate?: string; edgeX?: string; edgeRelease?: string; edgeBy?: string; link?: string; collect?: string } = {}): Promise<{ launch: GestureLaunch; results: IosLabResults | null }> {
	const { target } = session;
	const { mac } = target;
	// `collect` is the token of a launch whose test already ran and whose results were not read (a `devicectl` call that hung after the test, say): the test is not
	// started again (a failed UI-testing start costs the phone a sysdiagnose of 270 MB), only what it left on the phone and on the Mac is read.
	const token = options.collect ?? newToken();
	let startedAt = new Date();
	const outFile = `${uiTestsRemote}/test-output-${token}.log`;
	const seconds = Math.ceil(timeoutMs / 1000);
	let testEnded: string | null = null;
	if (options.collect !== undefined) {
		const born = Number((await remote(mac, `stat -f %B ${shellQuote(outFile)} 2>/dev/null`)).stdout.trim());
		if (!Number.isFinite(born) || born <= 0) throw new Error(`--collect ${token}: there is no ${outFile} on the Mac, so no test of that token ran here`);
		startedAt = new Date(born * 1000);
		console.log(`collecting the results of the test ${token} (started ${startedAt.toISOString()}); no test is started`);
	} else {
		// The test opens the lab's link itself: XCUITest observes only an app it launched, and a step's input has to find the test already there.
		await setTraceFlag(target, options.trace === true);
		// `--link` opens a page by itself instead of the lab's run (a diagnostic: a page at the root of the stack, with no scenario around it).
		const url = options.link ?? `rasheed-svelte:///__dev?run=${runValue(names, "xctest")}&token=${token}`;
		const started = await remoteOk(mac, inBackground(testCommand({ dir: uiTestsRemote, udid: session.udid, bundleId: target.bundleId, seconds, outFile, url, trace: options.trace === true, calibrate: options.calibrate, edgeX: options.edgeX ?? defaultEdgeX, edgeRelease: options.edgeRelease, edgeBy: options.edgeBy })));
		const testPid = Number(started.trim().split("\n").pop());
		// While the test runs the phone is asked nothing: devicectl calls made then hang for a minute and a half now and then (CoreDevice shares the phone with the
		// runner), so the harness only watches the Mac's side, and reads the phone's files once the test has ended. The test ends when the lab says "Done." or gives up.
		if (!(await waitForTestStarted(mac, outFile, 150_000))) console.log(`warning: the test did not say ${testStartedLine} within 150 s`);
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await sleep(5000);
			if (Number.isFinite(testPid) && !(await testAlive(mac, testPid))) break;
		}
		if (Date.now() >= deadline) testEnded = "the XCUITest run did not end within the timeout";
		// Only the test this launch started: its shell's children (xcodebuild), then the shell.
		if (Number.isFinite(testPid)) await remote(mac, `pkill -TERM -P ${testPid} 2>/dev/null; kill ${testPid} 2>/dev/null; true`);
		for (const line of await describeUiTestLeftovers(mac)) console.log(`  ${line}`);
	}
	// The test is over: the phone answers again.
	let results: IosLabResults | null = null;
	let raw = "";
	for (let attempt = 1; attempt <= 3 && results === null; attempt++) {
		try {
			const text = await readAppFile(target, "Documents/lab-results.json");
			const parsed = text === null ? null : parseIosLabResults(text);
			if (text !== null && parsed && parsed.token === token) {
				results = parsed;
				raw = text;
			} else break;
		} catch (error) {
			console.log(`  reading lab-results.json failed (${attempt}/3): ${String(error instanceof Error ? error.message : error).slice(0, 160)}`);
		}
	}
	const traceLines = options.trace ? await readTrace(target, logPath, outFile, mac, startedAt.getTime()) : [];
	let pid = -1;
	try {
		pid = (await appProcesses(target, session.installed))[0] ?? -1;
	} catch (error) {
		console.log(`  listing the phone's processes failed: ${String(error instanceof Error ? error.message : error).slice(0, 120)}`);
	}
	if (pid >= 0) {
		try {
			await terminateApp(target, pid);
		} catch {
			// The app already ended (a finished lab or a crash).
		}
	}
	const testText = (await remote(mac, `cat ${shellQuote(outFile)} 2>/dev/null; rm -f ${shellQuote(outFile)}`)).stdout;
	await writeFile(logPath, `${raw || "no results were written\n"}\n--- xcodebuild test-without-building ---\n${testText}${traceLines.length ? `\n--- recognizer trace ---\n${traceLines.join("\n")}\n` : ""}`);
	for (const line of traceLines) console.log(`  ${line}`);
	const launch = launchFromIos({
		asked: names, results, startedAt, durationMs: Date.now() - startedAt.getTime(), died: null, ended: testEnded, pid, output: testText === "" ? null : parseUiTestOutput(testText), testText, logFile: logPath.slice(qaDir.length + 1),
	});
	return { launch, results };
}

/** `native-qa gestures --platform ios`. */
export async function iosGestures(argv: string[]): Promise<void> {
	const { values } = parseFlags(argv, { ...iosOptions, run: { type: "string" }, repeat: { type: "string" }, timeout: { type: "string" }, team: { type: "string" }, rebuild: { type: "boolean" }, input: { type: "string" }, trace: { type: "boolean" }, calibrate: { type: "string" }, "edge-x": { type: "string" }, "edge-release": { type: "string" }, "edge-by": { type: "string" }, link: { type: "string" }, collect: { type: "string" }, "build-only": { type: "boolean" } });
	const input = flagString(values.input) ?? "xctest";
	if (input !== "xctest") throw new Error("--input is xctest on iOS (touches cannot be synthesized from inside the app)");
	const session = await startIosSuite("gestures", argv, values, "qa", { uiTest: true });
	const names = namesFor(scenarioNamesFrom(flagString(values.run)), "xctest");
	const repeat = integerFlag(values.repeat, "repeat", 1);
	if (repeat < 1) throw new Error("--repeat must be at least 1");
	if (values.collect !== undefined && repeat !== 1) throw new Error("--collect reads the results of one test: --repeat must be 1");
	const timeoutMs = integerFlag(values.timeout, "timeout", 900) * 1000;
	await requireUsb(session.target.mac, session.udid);
	await prepareUiTests(session, { team: flagString(values.team), rebuild: values.rebuild === true });
	if (values["build-only"] === true) {
		console.log("--build-only: the runner is ready, no scenario was run");
		return;
	}

	await mkdir(runsDir, { recursive: true });
	let launches: GestureLaunch[] = [];
	const reports: (BuildIdentity | null)[] = [];
	for (let index = 1; index <= repeat; index++) {
		console.log(`gestures xctest ${index}/${repeat}: ${names.map((name) => name.slice("gestures-".length)).join(", ")}`);
		const logPath = join(runsDir, `gestures-${slug(session.device.serial)}-${stamp(session.startedAt)}-xctest-${index}.log`);
		const { launch, results } = await iosGesturesOnce(session, names, timeoutMs, logPath, { trace: values.trace === true, calibrate: flagString(values.calibrate), edgeX: flagString(values["edge-x"]), edgeRelease: flagString(values["edge-release"]), edgeBy: flagString(values["edge-by"]), link: flagString(values.link), collect: flagString(values.collect) });
		launches.push(launch);
		// A run that did not finish measured nothing to compare. Every one that did must be the recorded build.
		if (launch.complete && results) reports.push(results.build);
		reportedIdentity(reports, session.build, "gestures");
		for (const line of describeLaunch(launch)) console.log(line);
	}
	const installed = reportedIdentity(reports, session.build, "gestures");
	if (reports.length > 0 && installed === null) console.log(`warning: ${notReported}`);
	// An XCUITest run leaves CoreDevice wedged until the phone is plugged in again: the crash log is read over USB first.
	const found = await finishCrashWatch(session.crashes, { afterUiTest: true });
	const attributed = found.record.crashReports ? launchesWithCrashes(launches, found.record.crashReports) : null;
	if (attributed) launches = attributed.launches;
	const crashRecord = attributed ? withReports(found.record, attributed.reports) : found.record;
	for (const line of describeCrashReports(crashRecord)) console.log(line);
	const file: GesturesFile = {
		schema: 1,
		kind: "gestures",
		startedAt: session.startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		source: await currentSource(),
		device: session.device,
		app: withIdentity(session.app, installed),
		run: names,
		inputs: ["xctest"],
		launches,
		...crashRecord,
	};
	const name = await writeRun("gestures", session.device.serial, session.startedAt, file);
	const kept = await keepCrashFiles(found, name);
	if (kept) console.log(`kept the crash reports in ${kept.slice(qaDir.length + 1)}`);
	console.log(`wrote qa/runs/${name}.json`);
}

