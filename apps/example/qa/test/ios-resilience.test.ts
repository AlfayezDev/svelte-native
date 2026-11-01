import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { evaluate, type GatesFile, type ReportDevice } from "../lib/gates.ts";
import { sourceFiles } from "../lib/iphone/gestures.ts";
import {
	anchorEvery,
	assumeSystemKillArgs,
	baseArgs,
	buildIosPlan,
	contentSizes,
	describeOutcome,
	fullIosPlanSize,
	fullPlan,
	headerRow,
	labUrl,
	menuUrl,
	parseNavigationOutcome,
	parseTestOutput,
	recovery,
	resilienceCommand,
	restorationArgs,
	resultsFor,
	testPlan,
	whyStopped,
	type IosStep,
	type Move,
} from "../lib/iphone/resilience.ts";
import { crashReportMetrics } from "../lib/metrics.ts";
import { fullPlanSize } from "../lib/resilience.ts";
import { resilienceMetrics } from "../lib/suite-metrics.ts";
import type { DeviceInfo, ResilienceFile, ResilienceStep } from "../lib/types.ts";
import { restoreHints } from "../commands/ios-resilience.ts";

const qa = join(import.meta.dirname, "..");
const swift = readFileSync(join(qa, "ios-ui-tests/GesturesUITests/ResilienceUITests.swift"), "utf8");
const token = "tok1";
const plan = buildIosPlan(fullPlan, token);
const group = (name: string) => plan.filter((step) => step.group === name);
const movesOf = (step: IosStep | undefined): Move[] => step?.moves ?? [];
const kinds = (step: IosStep | undefined) => movesOf(step).map((move) => move.do);

describe("the iPhone's resilience plan", () => {
	test("the full plan has the Android plan's shape: rotation, text size, language, the Home button 100 times, the process ended twice", () => {
		expect(group("rotation")).toHaveLength(1 + 1 + 2 * 5);
		expect(group("fontScale")).toHaveLength(4);
		expect(group("locale")).toHaveLength(2);
		expect(group("appearance")).toHaveLength(2);
		expect(group("background")).toHaveLength(100);
		expect(group("lowMemory")).toHaveLength(2 * 2 + 2);
		expect(plan).toHaveLength(fullIosPlanSize);
		expect(fullIosPlanSize).toBe(126);
		expect(fullPlan).toEqual({ rotationCycles: 5, backgroundCycles: 100, killRounds: 2 });
	});

	test("a smaller plan is for working on the loop: the counts follow the options", () => {
		const small = buildIosPlan({ rotationCycles: 1, backgroundCycles: 7, killRounds: 1 }, token);
		expect(small.filter((step) => step.group === "background")).toHaveLength(7);
		expect(small.filter((step) => step.group === "rotation")).toHaveLength(4);
		expect(small.filter((step) => step.name.startsWith("background and end the process"))).toHaveLength(1);
	});

	test("it starts on the lab page that writes the build identity, opens the menu over it and pushes the header screen", () => {
		const [launch, push] = plan;
		expect(movesOf(launch)).toContainEqual({ do: "open", url: labUrl(token) });
		expect(labUrl(token)).toBe("rasheed-svelte:///__dev?run=resilience&token=tok1");
		expect(movesOf(launch)).toContainEqual({ do: "open", url: menuUrl });
		expect(movesOf(push)).toContainEqual({ do: "tap", label: "Push eight screens with headers" });
		expect(push?.check.present).toContainEqual({ kind: "bar", value: "Screen 1" });
		expect(headerRow).toBe("Screen 1 · row 1");
	});

	test("every step that ends the process backgrounds the app first, so the module has written its state; the one that does not is the foreground case", () => {
		const ending = plan.filter((step) => kinds(step).includes("terminate"));
		const names = (steps: IosStep[]) => steps.map((step) => step.name);
		const withoutHome = ending.filter((step) => !kinds(step).includes("home"));
		expect(names(withoutHome)).toEqual(["a process that ends in the foreground restores nothing"]);
		for (const step of ending.filter((entry) => kinds(entry).includes("home"))) {
			const moves = kinds(step);
			expect(moves.indexOf("home")).toBeLessThan(moves.indexOf("terminate"));
			expect(movesOf(step).find((move) => move.do === "wait")).toBeDefined(); // time for the state to reach the disk
		}
	});

	test("what comes back after the process was ended is checked on the screen: the header screen, its back button, the stack under it", () => {
		const back = plan.filter((step) => step.name.startsWith("return to the app after the process was ended"));
		expect(back).toHaveLength(2);
		for (const step of back) {
			expect(step.check.state).toBe("foreground");
			expect(step.check.present).toContainEqual({ kind: "bar", value: "Screen 1" });
			expect(step.check.present).toContainEqual({ kind: "label", value: headerRow });
			expect(step.check.present).toContainEqual({ kind: "back" });
			expect(kinds(step)).toEqual(["launch", "wait"]); // no link: a start from the icon
		}
		const ended = plan.filter((step) => step.name.startsWith("background and end the process"));
		for (const step of ended) expect(step.check.state).toBe("notRunning");
	});

	test("a link after the process was ended wins over the restored screens, and a process that dies in the foreground restores nothing", () => {
		const link = plan.find((step) => step.name.startsWith("a link opened after the process was ended"));
		expect(movesOf(link)).toContainEqual({ do: "open", url: menuUrl });
		expect(link?.check.present).toContainEqual({ kind: "bar", value: "Native screens" });
		expect(link?.check.absent).toContainEqual({ kind: "label", value: headerRow });
		const foreground = plan.at(-1);
		expect(foreground?.name).toBe("a process that ends in the foreground restores nothing");
		expect(foreground?.check.absent).toContainEqual({ kind: "label", value: headerRow });
		expect(kinds(foreground)).toEqual(["terminate", "wait", "launch", "wait"]);
	});

	test("the text size and the language are launch arguments of a restart, and the size is judged on the pixels against a reference set by name", () => {
		const sizes = group("fontScale");
		const base = [...restorationArgs];
		expect(sizes.map((step) => movesOf(step).find((move) => move.do === "args"))).toEqual([
			{ do: "args", args: [...base, "-UIPreferredContentSizeCategoryName", contentSizes.standard] },
			{ do: "args", args: [...base, "-UIPreferredContentSizeCategoryName", contentSizes.largest] },
			{ do: "args", args: [...base, "-UIPreferredContentSizeCategoryName", contentSizes.smallest] },
			{ do: "args", args: [...base, "-UIPreferredContentSizeCategoryName", contentSizes.standard] },
		]);
		expect(contentSizes.largest).toBe("UICTContentSizeCategoryAccessibilityXXXL");
		expect(sizes.map((step) => step.check.scale)).toEqual([
			{ label: headerRow, record: "standard" },
			{ label: headerRow, against: "standard", min: 1.5 },
			{ label: headerRow, against: "standard", max: 0.97 },
			{ label: headerRow, against: "standard", min: 0.95, max: 1.05 },
		]);
		const languages = group("locale").map((step) => movesOf(step).find((move) => move.do === "args"));
		expect(languages).toEqual([{ do: "args", args: [...base, "-AppleLanguages", "(ar)", "-AppleLocale", "ar_SA"] }, { do: "args", args: base }]);
		// Each restart is the process ended after a trip to the background, then a launch: the restore under that size and language.
		for (const step of [...sizes, ...group("locale")]) expect(kinds(step)).toEqual(["args", "home", "wait", "terminate", "wait", "launch", "wait"]);
	});

	test("every launch of the plan turns UIKit's state restoration on, which XCUITest turns off for the apps it starts", () => {
		expect(restorationArgs).toEqual(["-ApplePersistenceIgnoreState", "NO"]);
		const argsMoves = plan.flatMap((step) => step.moves.filter((move) => move.do === "args")) as { do: "args"; args: string[] }[];
		expect(argsMoves.length).toBeGreaterThan(5);
		for (const move of argsMoves) expect(move.args.slice(0, 2)).toEqual(["-ApplePersistenceIgnoreState", "NO"]);
		for (const move of recovery(token, baseArgs({})).filter((entry) => entry.do === "args")) expect((move as { args: string[] }).args.slice(0, 2)).toEqual(["-ApplePersistenceIgnoreState", "NO"]);
	});

	test("--assume-system-kill adds the QA app's override to every launch, and nothing else changes", () => {
		const bypass = buildIosPlan({ ...fullPlan, assumeSystemKill: true }, token);
		expect(bypass.map((step) => step.name)).toEqual(plan.map((step) => step.name));
		const argsOf = (steps: IosStep[]) => steps.flatMap((step) => step.moves.filter((move) => move.do === "args")) as { do: "args"; args: string[] }[];
		for (const move of argsOf(bypass)) expect(move.args).toContain("-SvelteNavigationAssumeSystemKill");
		for (const move of argsOf(plan)) expect(move.args).not.toContain("-SvelteNavigationAssumeSystemKill");
		expect(baseArgs({ assumeSystemKill: true })).toEqual([...restorationArgs, ...assumeSystemKillArgs]);
		expect(testPlan(bypass, token, { assumeSystemKill: true }).recovery.find((move) => move.do === "args")).toEqual({ do: "args", args: baseArgs({ assumeSystemKill: true }) });
		// Nothing but the launch arguments differs.
		const strip = (steps: IosStep[]) => JSON.stringify(steps).replaceAll(',"-SvelteNavigationAssumeSystemKill","YES"', "");
		expect(strip(bypass)).toBe(JSON.stringify(plan));
	});

	test("only every tenth background cycle and the last look for the anchors; the rest check that the app is in the foreground", () => {
		const looked = group("background").map((step, index) => [index + 1, step.check.present.length > 0] as const).filter(([, looks]) => looks).map(([cycle]) => cycle);
		expect(looked).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
		expect(anchorEvery).toBe(10);
		const short = buildIosPlan({ rotationCycles: 1, backgroundCycles: 7, killRounds: 1 }, token).filter((step) => step.group === "background");
		expect(short.filter((step) => step.check.present.length > 0)).toHaveLength(1);
		for (const step of group("background")) expect(step.check.state).toBe("foreground");
	});

	test("the rounds that depend on the process state are not followed by a recovery; everything else is", () => {
		for (const step of plan) expect([step.name, step.recover]).toEqual([step.name, step.group !== "lowMemory"]);
	});

	test("the recovery puts the phone upright and light and stands on the header screen again", () => {
		const moves = recovery(token, baseArgs({}));
		expect(moves.slice(0, 2)).toEqual([{ do: "orient", to: "portrait" }, { do: "appearance", to: "light" }]);
		expect(moves).toContainEqual({ do: "tap", label: "Push eight screens with headers" });
		expect(moves.at(-1)).toEqual({ do: "await", label: headerRow });
	});

	test("what the XCUITest receives is the steps without their names, numbered from 1, and it stays small enough for an environment variable", () => {
		const sent = testPlan(plan, token);
		expect(sent.steps.map((step) => step.index)).toEqual(plan.map((_, at) => at + 1));
		expect(JSON.stringify(sent)).not.toContain("background and foreground 1/100");
		expect(JSON.stringify(sent).length).toBeLessThan(60_000);
		expect(sent.recovery).toEqual(recovery(token, baseArgs({})));
	});
});

describe("the XCUITest and the plan agree", () => {
	test("every move and anchor the plan can contain is one the Swift test performs", () => {
		const moves = new Set<string>();
		const anchors = new Set<string>();
		for (const step of [...plan, { moves: recovery(token, baseArgs({})), check: { present: [], absent: [] } } as unknown as IosStep]) {
			for (const move of step.moves) moves.add(move.do);
			for (const anchor of [...step.check.present, ...step.check.absent]) anchors.add(anchor.kind);
		}
		for (const name of moves) expect(swift).toContain(`case "${name}"`);
		// A label is what a lookup falls back to (and what `tap` and `await` build); a bar and a back button are cases of their own.
		for (const kind of anchors) expect(swift).toContain(kind === "label" ? '"kind": "label"' : `case "${kind}"`);
		expect([...moves].sort()).toEqual(["activate", "appearance", "args", "await", "home", "launch", "open", "orient", "tap", "terminate", "wait"]);
	});

	test("the lines the harness reads are the lines the test prints, and its environment is the one the command line sets", () => {
		for (const line of ["RESILIENCE-STARTED", "RESILIENCE-STEP", "RESILIENCE-TIMEOUT", "RESILIENCE-DONE"]) expect(swift).toContain(line);
		const command = resilienceCommand({ dir: "/tmp/d", udid: "U", bundleId: "io.rasheed.svelteqa", seconds: 900, outFile: "/tmp/o.log", plan: "{}" });
		for (const name of ["RESILIENCE_SECONDS", "RESILIENCE_BUNDLE_ID", "RESILIENCE_PLAN"]) {
			expect(swift).toContain(`environment["${name}"]`);
			expect(command).toContain(`TEST_RUNNER_${name}=`);
		}
		expect(command).toContain("-only-testing:GesturesUITests/ResilienceUITests/testPlan");
		expect(swift).toContain("func testPlan()");
		expect(swift).toContain("final class ResilienceUITests: XCTestCase");
	});

	test("the keys of a printed step are the ones the harness reads, and the project builds the file with the gesture test", () => {
		for (const key of ['"index"', '"ok"', '"failures"', '"recovered"', '"durationMs"', '"skipped"']) expect(swift).toContain(key);
		expect(readFileSync(join(qa, "ios-ui-tests/make-project.rb"), "utf8")).toContain("group.new_file('ResilienceUITests.swift')");
		// The runner is rebuilt when the test changes: the digest covers the file.
		expect(sourceFiles).toContain("GesturesUITests/ResilienceUITests.swift");
	});

	test("the plan travels through the shell intact, apostrophes and double quotes included", async () => {
		const awkward = JSON.stringify({ recovery: [], steps: [{ index: 1, moves: [{ do: "tap", label: "it's \"quoted\" $HOME `x`" }], check: {}, recover: true }] });
		const command = resilienceCommand({ dir: "/tmp/ui tests", udid: "U", bundleId: "io.rasheed.svelteqa", seconds: 5, outFile: "/tmp/o.log", plan: awkward });
		const exported = / && (export .*) && xcodebuild /s.exec(command)?.[1];
		expect(exported).toBeDefined();
		const echoed = await new Promise<string>((resolve, reject) => {
			execFile("sh", ["-c", `${exported}; printf %s "$TEST_RUNNER_RESILIENCE_PLAN"`], (error, stdout) => (error ? reject(error) : resolve(stdout)));
		});
		expect(echoed).toBe(awkward);
	});
});

describe("what the test printed", () => {
	const printed = [
		"Test Suite 'ResilienceUITests' started",
		'RESILIENCE-STARTED {"steps":4}',
		'RESILIENCE-STEP {"index":1,"ok":true,"failures":[],"recovered":false,"durationMs":9100}',
		'RESILIENCE-STEP {"index":2,"ok":false,"failures":["not on screen: the navigation bar \\"Screen 1\\""],"recovered":true,"durationMs":15300}',
		'RESILIENCE-STEP {"index":3,"ok":true,"failures":[],"recovered":false,"durationMs":2100,"skipped":"this SDK\'s XCUIDevice has no appearance"}',
		"/x/ResilienceUITests.swift:60: error: -[GesturesUITests.ResilienceUITests testPlan] : RESILIENCE_PLAN is not a JSON object",
		"RESILIENCE-DONE",
		"Test Case '-[GesturesUITests.ResilienceUITests testPlan]' failed (80.0 seconds).",
	].join("\n");

	test("steps, the verdict line, XCTest's failures and the last line are read", () => {
		const output = parseTestOutput(printed);
		expect(output.started).toBe(true);
		expect(output.done).toBe(true);
		expect(output.ended).toBe("failed");
		expect(output.timedOut).toBe(false);
		expect(output.failures).toEqual(["RESILIENCE_PLAN is not a JSON object"]);
		expect(output.steps.map((step) => [step.index, step.ok, step.recovered, step.skipped])).toEqual([[1, true, false, null], [2, false, true, null], [3, true, false, "this SDK's XCUIDevice has no appearance"]]);
		expect(output.steps[1]?.failures).toEqual(['not on screen: the navigation bar "Screen 1"']);
	});

	test("a step line that is not JSON is a failure of the run, not a dropped step", () => {
		expect(parseTestOutput("RESILIENCE-STEP {not json").failures).toEqual(["unreadable step line: RESILIENCE-STEP {not json"]);
	});

	test("every step of the plan has a result: the ones the test reached as printed, the others as steps that did not run, with the reason", () => {
		const steps = buildIosPlan({ rotationCycles: 1, backgroundCycles: 1, killRounds: 1 }, token).slice(0, 4);
		const output = parseTestOutput(printed);
		const results = resultsFor(steps, output, whyStopped(output, null));
		expect(results.map((step) => [step.index, step.ok])).toEqual([[1, true], [2, false], [3, true], [4, false]]);
		expect(results[2]?.skipped).toBe("this SDK's XCUIDevice has no appearance");
		expect(results[1]?.recovered).toBe(true);
		expect(results[3]?.failures[0]).toStartWith("the step did not run: the test stopped: RESILIENCE_PLAN is not a JSON object");
		expect(resultsFor(steps, null, "the test run produced no output").every((step) => !step.ok && step.failures[0]?.includes("no output"))).toBe(true);
	});

	test("why a run stopped, in the order of what is known", () => {
		expect(whyStopped(null, null)).toBe("the test run produced no output");
		expect(whyStopped(parseTestOutput("noise"), null)).toBe("the test did not start");
		expect(whyStopped(parseTestOutput("RESILIENCE-STARTED {}\nRESILIENCE-TIMEOUT"), null)).toBe("the test reached its time limit");
		expect(whyStopped(parseTestOutput("RESILIENCE-STARTED {}"), "the XCUITest run did not end within the timeout")).toBe("the XCUITest run did not end within the timeout");
		expect(whyStopped(parseTestOutput("RESILIENCE-STARTED {}"), null)).toBe("the test was stopped before it ended");
	});
});

describe("the navigation module's account of the last start", () => {
	test("last.json is read, and a restore the system declined is told from one that failed", () => {
		const text = JSON.stringify({ at: 1, outcome: "dropped", reason: "the system kept no state of its own (the user left the app)", attempts: 1, systemKept: false, savedAt: 5, bytes: 321 });
		const outcome = parseNavigationOutcome(text);
		expect(outcome).toEqual({ at: 1, outcome: "dropped", reason: "the system kept no state of its own (the user left the app)", attempts: 1, systemKept: false, savedAt: 5, bytes: 321 });
		expect(describeOutcome(outcome)).toBe("navigation module, the last start: dropped (the system kept no state of its own (the user left the app)); the system offered no state; attempts 1");
		expect(describeOutcome(parseNavigationOutcome(JSON.stringify({ at: 2, outcome: "restored", reason: "the surface started with the saved state", attempts: 1, systemKept: true })))).toContain("restored (the surface started with the saved state); the system offered its state");
		expect(describeOutcome(null)).toContain("no last.json");
		for (const bad of [null, "", "not json", "[]", "{}", JSON.stringify({ outcome: 1, reason: "x" })]) expect(parseNavigationOutcome(bad)).toBeNull();
	});

	test("a failed restart step brings the module's account with it; a failed rotation does not", () => {
		const step = (group: ResilienceStep["group"], ok: boolean): ResilienceStep => ({ index: 1, group, name: "x", ok, failures: ok ? [] : ["f"], recovered: false, durationMs: 1 });
		expect(restoreHints([step("rotation", false), step("background", false), step("appearance", false)], null)).toEqual([]);
		expect(restoreHints([step("lowMemory", true), step("fontScale", true)], null)).toEqual([]);
		expect(restoreHints([step("lowMemory", false), step("locale", false)], parseNavigationOutcome(JSON.stringify({ at: 1, outcome: "dropped", reason: "r", attempts: 1, systemKept: false })))).toEqual([
			"2 step(s) that end and restart the app failed; navigation module, the last start: dropped (r); the system offered no state; attempts 1",
		]);
	});
});

describe("the run file and the gates", () => {
	const phone: DeviceInfo = { serial: "E74A5608-BF8E-5806-8699-1605F82ADED9", platform: "ios", kind: "device", model: "iPhone SE 3", osVersion: "26.6", sdk: null, abi: "arm64", refreshHz: 60 };
	const file = (steps: ResilienceStep[], device: DeviceInfo = phone, extra: Partial<ResilienceFile> = {}): ResilienceFile => ({
		schema: 1,
		kind: "resilience",
		startedAt: "2026-11-02T09:00:00.000Z",
		finishedAt: "2026-11-02T09:20:00.000Z",
		source: { commit: "abc1234", dirty: false },
		device,
		app: { package: "io.rasheed.svelteqa", versionName: "0.1.0", versionCode: 1, lastUpdateTime: null, installedSha256: null, apk: null },
		screen: "screens-header",
		steps,
		planned: steps.length,
		logFile: "runs/x.log",
		aborted: null,
		...extra,
	});
	const results = (override: (index: number) => Partial<ResilienceStep> = () => ({})): ResilienceStep[] =>
		plan.map((step, at) => ({ index: at + 1, group: step.group, name: step.name, ok: true, failures: [], recovered: false, durationMs: 1, ...override(at + 1) }));

	test("the iPhone's steps missing are counted against the iPhone's plan, Android's against Android's", () => {
		expect(resilienceMetrics(file(results()))).toEqual({ "resilience.steps": fullIosPlanSize, "resilience.failures": 0, "resilience.skipped": 0, "resilience.stepsMissing": 0, "resilience.gateBypassed": 0 });
		expect(resilienceMetrics(file(results().slice(0, 20)))["resilience.stepsMissing"]).toBe(fullIosPlanSize - 20);
		const android: DeviceInfo = { ...phone, serial: "localhost:5555", platform: "android", kind: "emulator" };
		expect(resilienceMetrics(file(results().slice(0, 20), android))["resilience.stepsMissing"]).toBe(fullPlanSize - 20);
	});

	test("a skipped step is neither a pass nor a failure; it is counted on its own", () => {
		const metrics = resilienceMetrics(file(results((index) => (index === 50 || index === 51 ? { skipped: "no appearance" } : index === 60 ? { ok: false, failures: ["f"] } : {}))));
		expect([metrics["resilience.failures"], metrics["resilience.skipped"]]).toEqual([1, 2]);
	});

	test("the crash reports the phone's crash log gained during the run count with the others'", () => {
		const report = { file: "RasheedSvelteQA.ips", capturedAt: null, processStartedAt: null, pid: null, exceptionType: "EXC_CRASH", attributedTo: "unattributed" };
		expect(crashReportMetrics([file(results(), phone, { crashReports: [report] as never })])).toEqual({ "log.crashReports": 1 });
		expect(crashReportMetrics([file(results(), phone, { crashReports: [] })])).toEqual({ "log.crashReports": 0 });
		expect(crashReportMetrics([file(results(), phone, { crashReportsError: "the pull failed" })])).toEqual({ "log.crashReports": null });
	});

	const gates = JSON.parse(readFileSync(join(qa, "gates.json"), "utf8")) as GatesFile;

	test("the iPhone provides the run, and the three resilience bars are written for both platforms", () => {
		expect((gates.devices["E74A5608-BF8E-5806-8699-1605F82ADED9"] as { runs: string[] }).runs).toContain("resilience");
		const bar = (id: string) => gates.gates.find((gate) => gate.id === id)?.bar;
		expect(bar("resilience.failures")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
		expect(bar("resilience.stepsMissing")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
		// The appearance pair is the one gap the runner may have: two skipped steps on the iPhone, none on Android.
		expect(bar("resilience.skipped")).toEqual({ android: { max: 0 }, ios: { max: 2 } });
		expect(group("appearance")).toHaveLength(2);
		expect(bar("resilience.gateBypassed")).toEqual({ android: { max: 0 }, ios: { max: 0 } });
	});

	test("a run made with --assume-system-kill is a diagnostic: it measures, and the gate refuses it as evidence", () => {
		const metrics = resilienceMetrics(file(results(), phone, { assumeSystemKill: true }));
		expect(metrics["resilience.gateBypassed"]).toBe(1);
		const devices: Record<string, ReportDevice> = { [phone.serial]: { platform: "ios", metrics } };
		const rows = evaluate(gates.gates.filter((gate) => gate.id === "resilience.gateBypassed"), devices, "ios");
		expect(rows.map((row) => row.verdict)).toEqual(["fail"]);
	});

	test("a clean iPhone run passes the three; a failed step, a third skipped step or a missing step fails its own", () => {
		const ids = ["resilience.failures", "resilience.stepsMissing", "resilience.skipped"];
		const judged = (steps: ResilienceStep[]) => {
			const devices: Record<string, ReportDevice> = { [phone.serial]: { platform: "ios", metrics: resilienceMetrics(file(steps)) } };
			return Object.fromEntries(evaluate(gates.gates.filter((gate) => ids.includes(gate.id)), devices, "ios").map((row) => [row.id, row.verdict]));
		};
		expect(judged(results())).toEqual({ "resilience.failures": "pass", "resilience.stepsMissing": "pass", "resilience.skipped": "pass" });
		expect(judged(results((index) => (index === 50 || index === 51 ? { skipped: "x" } : {})))["resilience.skipped"]).toBe("pass");
		expect(judged(results((index) => (index >= 50 && index <= 52 ? { skipped: "x" } : {})))["resilience.skipped"]).toBe("fail");
		expect(judged(results((index) => (index === 7 ? { ok: false, failures: ["f"] } : {})))["resilience.failures"]).toBe("fail");
		expect(judged(results().slice(0, 125))["resilience.stepsMissing"]).toBe("fail");
	});
});
