import { shellQuote } from "../exec.ts";
import type { NavigationOutcome, ResilienceStep } from "../types.ts";
import { launchArguments } from "./capture.ts";

/**
 * `native-qa resilience --platform ios` (README, "Resilience on the iPhone"): what an iOS app can be put through from outside, in the order and
 * with the checks of the Android run (`lib/resilience.ts`), as a plan that an XCUITest (`ios-ui-tests/GesturesUITests/ResilienceUITests.swift`)
 * carries out on the phone in one go. This file is the plan and the reading of what the test printed; the test only interprets the moves and the
 * checks written here, so nothing about the run is decided in Swift (which cannot be run on this machine).
 *
 * What differs from Android, and why:
 * - A live change of the text size, the language or the layout direction is not possible: they are settings of the phone that only the Settings app
 *   changes, and XCUITest has no call for them. The launch arguments `-UIPreferredContentSizeCategoryName <category>` and `-AppleLanguages (ar)`
 *   override them for one launch, so each of those steps ends the app and starts it again with the argument: what it proves is the restore of the
 *   navigation under that text size / language, which is what Android's recreation proves for its font scale and locale.
 * - There is no memory-pressure signal to send (`am send-trim-memory`). The system ending the process is stood in for by ending it from
 *   outside after the app went to the background (`terminate`).
 * - Rotation is `XCUIDevice.orientation`; the appearance is `XCUIDevice.appearance` where the runner's SDK has it (the step is `skipped` where not).
 * - The user's swipe-away from the app switcher cannot be done by XCUITest on a phone with a Home button, so the rule "a swipe-away restores
 *   nothing" is not exercised here; it is the system's own (SPEC.md, "Navigation state across recreation and process death", "iOS").
 */

export type Orientation = "portrait" | "landscapeLeft";

/** How the test finds an element: by label or identifier, a navigation bar by its title, or the back button of the first navigation bar. */
export type Anchor = { kind: "label"; value: string } | { kind: "bar"; value: string } | { kind: "back" };

/** What the test does, one thing at a time. */
export type Move =
	/** `XCUIApplication.open(url)`: the app starts on (or receives) the link, with the launch arguments set so far. */
	| { do: "open"; url: string }
	/** The launch arguments of the launches that follow. */
	| { do: "args"; args: string[] }
	/** A fresh launch: the app is ended first when it runs. */
	| { do: "launch" }
	| { do: "activate" }
	/** The Home button: the app enters the background (and the navigation module writes its state). */
	| { do: "home" }
	/** Ends the process from outside, the stand-in for the system ending a backgrounded app. */
	| { do: "terminate" }
	| { do: "orient"; to: Orientation }
	| { do: "appearance"; to: "light" | "dark" }
	/** Waits for the element and taps it. */
	| { do: "tap"; label: string }
	/** Waits (up to 15 s) for the element to be on screen. */
	| { do: "await"; label: string }
	| { do: "wait"; seconds: number };

export type ExpectedState = "foreground" | "background" | "notRunning";

/** The height of an element relative to one recorded earlier: Dynamic Type made the text larger or smaller, which only the pixels say. */
export type Scale = { label: string; record?: string; against?: string; min?: number; max?: number };

export type IosCheck = { state: ExpectedState; present: Anchor[]; absent: Anchor[]; scale?: Scale };

export type IosStep = {
	group: ResilienceStep["group"];
	name: string;
	moves: Move[];
	check: IosCheck;
	/** Whether a failed step is followed by `recovery`, so the next step starts from a working screen (not for the rounds that depend on the process state). */
	recover: boolean;
};

export const rotationCycles = 5;
export const backgroundCycles = 100;
export const killRounds = 2;
/** Every Nth background/foreground cycle (and the last) also looks for the anchors; the rest check that the app is in the foreground. */
export const anchorEvery = 10;

export type IosPlanOptions = {
	rotationCycles: number;
	backgroundCycles: number;
	killRounds: number;
	/**
	 * Every launch carries `-SvelteNavigationAssumeSystemKill YES`, which the QA app's navigation module reads as "the system kept its state": the restore is judged
	 * without the system's say. It is for telling a fault of the module from the system counting the harness's kill as the user's (`last.json` says which); a run
	 * made with it is no evidence for the product, and `resilience.gateBypassed` fails it.
	 */
	assumeSystemKill?: boolean;
};
export const fullPlan: IosPlanOptions = { rotationCycles, backgroundCycles, killRounds };

/** Launch arguments of every run: XCUITest starts an app with `-ApplePersistenceIgnoreState YES` (a clean state for each test), which switches UIKit's state restoration off; the restore under test needs it on. */
export const restorationArgs = ["-ApplePersistenceIgnoreState", "NO"] as const;
export const assumeSystemKillArgs = ["-SvelteNavigationAssumeSystemKill", "YES"] as const;

/* ---- the screens the plan stands on (`apps/qa/src/routes/__dev/screens/+mobile.svelte`) ---- */

export const menuUrl = "example-svelte:///__dev/screens";
export const labUrl = (token: string): string => `example-svelte:///__dev?run=resilience&token=${token}`;
const menuText = "Each page below is a real screen: the engine draws its header, sheet and tab bar.";
export const menuBody: Anchor = { kind: "label", value: menuText };
export const menuBar: Anchor = { kind: "bar", value: "Native screens" };
export const pushButton = "Push eight screens with headers";
/** The pushed header screen: the loop screen of the plan, three screens deep (the lab, the menu, this), and the one a restore must bring back. */
export const headerBar: Anchor = { kind: "bar", value: "Screen 1" };
export const headerRow = "Screen 1 · row 1";
const headerText: Anchor = { kind: "label", value: headerRow };
const backButton: Anchor = { kind: "back" };
/** What a start with nothing to restore shows: the first screen of the QA app is the example's home screen, which a lab build gives the link into the lab (`src/lib/native/dev/LabLink.svelte`). */
export const firstScreen = { kind: "label", value: "Mobile development lab" } as const satisfies Anchor;
const onHeader: Anchor[] = [headerBar, headerText, backButton];

/** The categories `-UIPreferredContentSizeCategoryName` takes: the largest the system offers, the smallest, and the default. */
export const contentSizes = {
	largest: "UICTContentSizeCategoryAccessibilityXXXL",
	smallest: "UICTContentSizeCategoryXS",
	standard: "UICTContentSizeCategoryL",
} as const;
const sizeArgs = (category: string): string[] => ["-UIPreferredContentSizeCategoryName", category];

/** The moves that end the app and start it again with `args`, after it went to the background: the system ending a backgrounded process, and the user coming back. */
const endAndReturn = (args: string[]): Move[] => [
	{ do: "args", args },
	{ do: "home" },
	{ do: "wait", seconds: 1.5 },
	{ do: "terminate" },
	{ do: "wait", seconds: 1.2 },
	{ do: "launch" },
	{ do: "wait", seconds: 1 },
];

const foreground = (present: Anchor[], absent: Anchor[] = []): IosCheck => ({ state: "foreground", present, absent });
const resting: IosCheck = { state: "foreground", present: [], absent: [] };

/** The launch arguments every launch of a plan carries, before the ones a step adds. */
export const baseArgs = (options: Pick<IosPlanOptions, "assumeSystemKill">): string[] => [...restorationArgs, ...(options.assumeSystemKill ? assumeSystemKillArgs : [])];

/** The moves that start from nothing and stand on the pushed header screen: the lab (which writes the build identity), the menu over it, the push. */
export const standOnHeader = (token: string, base: string[]): Move[] => [
	{ do: "args", args: base },
	{ do: "open", url: labUrl(token) },
	{ do: "await", label: "Run all checks" },
	{ do: "open", url: menuUrl },
	{ do: "await", label: menuText },
	{ do: "tap", label: pushButton },
	{ do: "await", label: headerRow },
];

/** After a failed step: the settings the plan changed are put back and the header screen is stood on again. */
export const recovery = (token: string, base: string[]): Move[] => [{ do: "orient", to: "portrait" }, { do: "appearance", to: "light" }, { do: "terminate" }, { do: "wait", seconds: 1.2 }, ...standOnHeader(token, base)];

/** The steps of a plan. The full plan is what the gate expects; a smaller one is for working on the loop itself. */
export function buildIosPlan(options: IosPlanOptions, token: string): IosStep[] {
	const base = baseArgs(options);
	const steps: IosStep[] = [
		{
			group: "rotation",
			name: "launch the lab and open the menu",
			moves: [{ do: "args", args: base }, { do: "open", url: labUrl(token) }, { do: "await", label: "Run all checks" }, { do: "open", url: menuUrl }, { do: "await", label: menuText }],
			check: foreground([menuBody, menuBar, backButton]),
			recover: true,
		},
		{
			group: "rotation",
			name: "push the header screen",
			moves: [{ do: "tap", label: pushButton }, { do: "await", label: headerRow }],
			check: foreground(onHeader),
			recover: true,
		},
	];
	for (let cycle = 1; cycle <= options.rotationCycles; cycle++) {
		const of = `${cycle}/${options.rotationCycles}`;
		steps.push(
			{ group: "rotation", name: `landscape ${of}`, moves: [{ do: "orient", to: "landscapeLeft" }, { do: "wait", seconds: 1.5 }], check: foreground([headerBar, headerText]), recover: true },
			{ group: "rotation", name: `portrait ${of}`, moves: [{ do: "orient", to: "portrait" }, { do: "wait", seconds: 1.5 }], check: foreground(onHeader), recover: true },
		);
	}
	// The reference is the default size asked for by name (`L`), not whatever the phone is set to: the others are measured against it.
	for (const [name, category, scale] of [
		["default text (the reference), after a restart", contentSizes.standard, { record: "standard" }],
		["largest text (accessibility XXXL), after a restart", contentSizes.largest, { against: "standard", min: 1.5 }],
		["small text (extra small), after a restart", contentSizes.smallest, { against: "standard", max: 0.97 }],
		["default text again, after a restart", contentSizes.standard, { against: "standard", min: 0.95, max: 1.05 }],
	] as const)
		steps.push({
			group: "fontScale",
			name,
			moves: endAndReturn([...base, ...sizeArgs(category)]),
			check: { state: "foreground", present: onHeader, absent: [], scale: { label: headerRow, ...scale } },
			recover: true,
		});
	for (const [name, direction] of [["Arabic after a restart", "rtl"], ["English after a restart", "ltr"]] as const)
		steps.push({ group: "locale", name, moves: endAndReturn([...base, ...launchArguments[direction]]), check: foreground(onHeader), recover: true });
	steps.push(
		{ group: "appearance", name: "dark appearance while running", moves: [{ do: "appearance", to: "dark" }, { do: "wait", seconds: 2 }], check: foreground(onHeader), recover: true },
		{ group: "appearance", name: "light appearance while running", moves: [{ do: "appearance", to: "light" }, { do: "wait", seconds: 2 }], check: foreground(onHeader), recover: true },
	);
	for (let cycle = 1; cycle <= options.backgroundCycles; cycle++) {
		const looks = cycle % anchorEvery === 0 || cycle === options.backgroundCycles;
		steps.push({
			group: "background",
			name: `background and foreground ${cycle}/${options.backgroundCycles}`,
			moves: [{ do: "home" }, { do: "wait", seconds: 0.3 }, { do: "activate" }, { do: "wait", seconds: 0.3 }],
			check: looks ? foreground(onHeader) : resting,
			recover: true,
		});
	}
	for (let round = 1; round <= options.killRounds; round++) {
		const of = `${round}/${options.killRounds}`;
		steps.push(
			{
				group: "lowMemory",
				name: `background and end the process ${of}`,
				moves: [{ do: "home" }, { do: "wait", seconds: 1.5 }, { do: "terminate" }, { do: "wait", seconds: 1.2 }],
				check: { state: "notRunning", present: [], absent: [] },
				recover: false,
			},
			{
				group: "lowMemory",
				name: `return to the app after the process was ended ${of}`,
				moves: [{ do: "launch" }, { do: "wait", seconds: 1 }],
				check: foreground(onHeader),
				recover: false,
			},
		);
	}
	steps.push(
		{
			group: "lowMemory",
			name: "a link opened after the process was ended wins over the restored screens",
			moves: [{ do: "home" }, { do: "wait", seconds: 1.5 }, { do: "terminate" }, { do: "wait", seconds: 1.2 }, { do: "open", url: menuUrl }, { do: "await", label: menuText }],
			check: foreground([menuBody, menuBar], [headerText]),
			recover: false,
		},
		{
			group: "lowMemory",
			name: "a process that ends in the foreground restores nothing",
			moves: [{ do: "terminate" }, { do: "wait", seconds: 1.2 }, { do: "launch" }, { do: "wait", seconds: 4 }],
			check: foreground([firstScreen], [headerText, menuBody]),
			recover: false,
		},
	);
	return steps;
}

export const fullIosPlanSize = buildIosPlan(fullPlan, "x").length;

/** What the plan hands the XCUITest: the steps without their names (the harness keeps those), and the moves that put the phone right after a failure. */
export function testPlan(steps: IosStep[], token: string, options: Pick<IosPlanOptions, "assumeSystemKill"> = {}): { recovery: Move[]; steps: { index: number; moves: Move[]; check: IosCheck; recover: boolean }[] } {
	return { recovery: recovery(token, baseArgs(options)), steps: steps.map((step, at) => ({ index: at + 1, moves: step.moves, check: step.check, recover: step.recover })) };
}

/* ---- what the test printed ---- */

export type PrintedStep = { index: number; ok: boolean; failures: string[]; skipped: string | null; recovered: boolean; durationMs: number };

export type TestOutput = {
	started: boolean;
	/** The test reached its last line, after which the phone is upright and light and the app ended: a run without it may have left the phone changed. */
	done: boolean;
	steps: PrintedStep[];
	/** XCTest's own failure lines (an assertion outside a step, a crash of the runner). */
	failures: string[];
	/** The test case's verdict line, when it got that far. */
	ended: "passed" | "failed" | null;
	/** The test gave up at its time limit. */
	timedOut: boolean;
};

export const startedLine = "RESILIENCE-STARTED";
export const stepLine = "RESILIENCE-STEP";
export const timeoutLine = "RESILIENCE-TIMEOUT";
export const doneLine = "RESILIENCE-DONE";

/** Reads the lines of the test: `RESILIENCE-STEP {json}` per step, XCTest's failure lines and the verdict. */
export function parseTestOutput(text: string): TestOutput {
	const output: TestOutput = { started: false, done: false, steps: [], failures: [], ended: null, timedOut: false };
	for (const line of text.split("\n")) {
		if (line.startsWith(startedLine)) output.started = true;
		else if (line.startsWith(doneLine)) output.done = true;
		else if (line.startsWith(timeoutLine)) output.timedOut = true;
		const printed = new RegExp(`^${stepLine} (.*\\S)\\s*$`).exec(line);
		if (printed) {
			try {
				const value = JSON.parse(printed[1] as string) as Record<string, unknown>;
				output.steps.push({
					index: Number(value.index ?? 0),
					ok: value.ok === true,
					failures: Array.isArray(value.failures) ? value.failures.map(String) : [],
					skipped: typeof value.skipped === "string" ? value.skipped : null,
					recovered: value.recovered === true,
					durationMs: Number(value.durationMs ?? 0),
				});
			} catch {
				output.failures.push(`unreadable step line: ${line.slice(0, 120)}`);
			}
			continue;
		}
		const failure = /error: -\[[^\]]+\] : (.*)$/.exec(line);
		if (failure) output.failures.push(failure[1] as string);
		const verdict = /^Test Case '[^']+' (passed|failed)/.exec(line);
		if (verdict) output.ended = verdict[1] as "passed" | "failed";
	}
	return output;
}

/** The result of each step of the plan: what the test printed, and for a step it never reached, why it did not run. */
export function resultsFor(steps: IosStep[], output: TestOutput | null, couldNotRun: string): ResilienceStep[] {
	const printed = new Map(output?.steps.map((step) => [step.index, step]) ?? []);
	return steps.map((step, at) => {
		const index = at + 1;
		const result = printed.get(index);
		if (!result)
			return { index, group: step.group, name: step.name, ok: false, failures: [`the step did not run: ${couldNotRun}`], recovered: false, durationMs: 0 };
		return {
			index,
			group: step.group,
			name: step.name,
			ok: result.ok,
			failures: result.failures,
			recovered: result.recovered,
			durationMs: result.durationMs,
			...(result.skipped !== null ? { skipped: result.skipped } : {}),
		};
	});
}

/** Why the steps after the last printed one did not run, from what the test printed. */
export function whyStopped(output: TestOutput | null, ended: string | null): string {
	if (ended) return ended;
	if (output === null) return "the test run produced no output";
	if (!output.started) return `the test did not start${output.failures.length ? `: ${output.failures[0]}` : ""}`;
	if (output.timedOut) return "the test reached its time limit";
	if (output.failures.length) return `the test stopped: ${output.failures[0]}`;
	return output.ended === null ? "the test was stopped before it ended" : "the test ended before the last step";
}

/* ---- what the navigation module wrote ---- */

export function parseNavigationOutcome(text: string | null): NavigationOutcome | null {
	if (text === null) return null;
	try {
		const value = JSON.parse(text) as Partial<NavigationOutcome> | null;
		if (!value || typeof value.outcome !== "string" || typeof value.reason !== "string") return null;
		return { at: Number(value.at ?? 0), outcome: value.outcome, reason: value.reason, attempts: Number(value.attempts ?? 0), systemKept: value.systemKept === true, ...(typeof value.savedAt === "number" ? { savedAt: value.savedAt } : {}), ...(typeof value.bytes === "number" ? { bytes: value.bytes } : {}) };
	} catch {
		return null;
	}
}

/** The line that tells a failed restore from the system declining to keep the state, which the steps themselves cannot (they see only the screen). */
export function describeOutcome(outcome: NavigationOutcome | null): string {
	if (outcome === null) return "navigation module: no last.json (the module wrote nothing: not linked in this build, or the app never started)";
	const kept = outcome.systemKept ? "the system offered its state" : "the system offered no state";
	return `navigation module, the last start: ${outcome.outcome} (${outcome.reason}); ${kept}; attempts ${outcome.attempts}`;
}

/* ---- the Mac ---- */

export type ResilienceRun = { dir: string; udid: string; bundleId: string; seconds: number; outFile: string; plan: string };

/** The command line of the test run: the runner already built (`prepareUiTests`, shared with the gestures run); the plan travels in an environment variable the runner on the phone receives. */
export function resilienceCommand(options: ResilienceRun): string {
	const { dir, udid, bundleId, seconds, outFile, plan } = options;
	return [
		`cd ${shellQuote(dir)}`,
		`export TEST_RUNNER_RESILIENCE_SECONDS=${seconds} TEST_RUNNER_RESILIENCE_BUNDLE_ID=${shellQuote(bundleId)} TEST_RUNNER_RESILIENCE_PLAN=${shellQuote(plan)}`,
		`xcodebuild test-without-building -xctestrun "$(ls DerivedData/Build/Products/*.xctestrun | head -n 1)" -destination ${shellQuote(`id=${udid}`)} -only-testing:GesturesUITests/ResilienceUITests/testPlan > ${shellQuote(outFile)} 2>&1`,
	].join(" && ");
}
