import type { A11yFinding } from "./a11y.ts";
import type { Rect } from "./png.ts";
import type { BootMarks, FrameStats, LabChecks, Scenario } from "../parse/logcat.ts";

export type Platform = "android" | "ios";

export type DeviceInfo = {
	serial: string;
	platform: Platform;
	kind: "emulator" | "device";
	model: string;
	osVersion: string;
	sdk: number | null;
	abi: string;
	refreshHz: number | null;
};

export type ApkInfo = { path: string; sizeBytes: number; sha256: string };

/** What the iOS app reports of itself in the files it writes: the SHA-256 of `main.jsbundle` and of the executable. */
export type BuildIdentity = { jsbundleSha256: string; cdHash: string };

/** What `native-qa build --platform ios` recorded of the build the run was meant to measure. The executable digest is absent from a record made before it was taken. */
export type BuildRecord = { commit: string; dirty: boolean; jsbundleSha256: string; cdHash: string | null };

export type AppInfo = {
	package: string;
	versionName: string | null;
	versionCode: number | null;
	lastUpdateTime: string | null;
	/** Android: the SHA-256 of the installed `base.apk`. iOS: the executable digest the app reported (`installed`), null when it did not report one. */
	installedSha256: string | null;
	apk: ApkInfo | null;
	/** iOS only: the identity the app reported in this run's files (null: an app that does not report one), and the build record it was compared with (null: no record for this app). */
	installed?: BuildIdentity | null;
	build?: BuildRecord | null;
};

export type Source = { commit: string; dirty: boolean };

/**
 * What an iOS command records of the phone's crash log: the reports that are new since the command started, or why they could not be
 * read (the pull failed: the count is then not measured, never 0). Runs of other platforms and runs recorded before the pull have neither.
 */
export type CrashReportsRecord = { crashReports?: CrashReport[]; crashReportsError?: string };

/**
 * What an Android suite's device session found and could not do (`DeviceSession`), in the run file of parity, a11y and resilience.
 * `leftovers`: settings of the suites' own an earlier run left on the device (a failing proxy, a text size), cleared at the start,
 * so a report shows the previous run did not restore. `restoreFailures`: what this run could not put back (the device was lost, a
 * setting did not take): the device was left in a changed state, which `report` warns about and `gates` fails on. Absent in files
 * written before they were recorded. `deviceRestarts`: the times the session saw the device boot again (its boot id changed: the
 * emulator died or a watchdog restarted it), each after the session re-applied its settings; `at` is when the device booted, as
 * far as its uptime says, else when the session noticed. A run that survived a restart is still a measured run.
 */
export type DeviceRestart = { at: string; bootId: string };
export type SessionRecord = { leftovers?: string[]; restoreFailures?: string[]; deviceRestarts?: DeviceRestart[] };

/** One frame of a crashed thread: the image it is in, the offset in that image, and the symbol the report resolved (null when it did not). */
export type CrashFrame = { image: string | null; offset: number; symbol: string | null };

/**
 * One report of the iPhone's crash log for the app (`devicectl`, `lib/iphone/crash-reports.ts`): a crash (`EXC_CRASH` and the
 * other `EXC_` types), a kill the system's memory manager logged for the app (`JETSAM`), or a report of the app that could not be read
 * (`exceptionType` null). Times are the phone's own, as the report carries them (an instant: the report names its UTC offset).
 */
export type CrashReport = {
	/** The file's name on the phone (`RasheedSvelteQA-2026-10-27-090359.ips`); a copy is kept in `qa/runs/<run>-crashes/`. */
	file: string;
	/** The report's `captureTime` (its header's `timestamp` when it has none), as an ISO 8601 instant; null for a report that could not be read. */
	capturedAt: string | null;
	/** When the report says the process started (`procLaunch`); null for a jetsam event, which does not. */
	processStartedAt: string | null;
	pid: number | null;
	exceptionType: string | null;
	signal: string | null;
	/** The exception's message (`exceptionReason`), else the abort's own words (`asi`), else the termination's; at most 300 characters. */
	reason: string | null;
	/** The first 12 frames of `lastExceptionBacktrace` (where the exception was thrown), or of the faulting thread when the report has none. */
	framesOf: "lastExceptionBacktrace" | "faultingThread" | null;
	topFrames: CrashFrame[];
	/** `lab` and `boot`: the run or launch whose process it was (`lab 3`, `warm 7`), or `unattributed`: a report of a process no run of the command launched, which counts all the same. Absent in the other commands. */
	attributedTo?: string;
};

export type LabRun = {
	startedAt: string;
	durationMs: number;
	complete: boolean;
	checks: LabChecks | null;
	boot: BootMarks | null;
	scenarios: Scenario[];
	expectedScenarios: string[];
	crashes: string[];
	jsErrors: string[];
	engineWarnings: string[];
	/** The app's own `console.error` count since launch (iOS: the app reports it, null when it does not). Android counts the `E ReactNativeJS` lines in `jsErrors`; absent in runs recorded before the field. */
	jsErrorCount?: number | null;
	/** iOS: the process the run launched; the crash reports of the phone are matched to the run by it. */
	pid?: number | null;
	/** Android: another app's activity came to the front while the lab ran (an emergency alert, a permission dialog). The run is incomplete however far it got; `at` is the device clock, `by` the component. Absent when nothing did, and in runs recorded before the field. */
	interrupted?: { at: string; by: string };
	logFile: string;
};

export type LabFile = {
	schema: 1;
	kind: "lab";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** The `--run` value the lab was started with (`checks,quick` is the full run `gates.json` pins). */
	run: string;
	runs: LabRun[];
} & CrashReportsRecord;

export type Launch = {
	index: number;
	displayMs: number | null;
	runningMainMs: number | null;
	displayedReportedMs: number | null;
	totalTimeMs: number | null;
	jsMarks: BootMarks | null;
	crashes: number;
	/** `E ReactNativeJS` lines (Android) or the app's reported `console.error` count (iOS); null when the app did not report one. */
	jsErrors: number | null;
	engineWarnings: number;
	error: string | null;
	/** Android: how many launches filled the slot. 2 when the first one's logcat had no `Start proc` to `Displayed` pair while the process was alive and the launch was run again at once; absent in runs recorded before the field and on iOS. */
	attempts?: number;
	/** iOS: when the harness started the launch command (its clock) and the process start the app reported (the phone's); a report older than the launch is another launch's. */
	commandStartedAtMs?: number | null;
	processStartMs?: number | null;
	/** iOS: the process of the launch; the crash reports of the phone are matched to the launch by it. */
	pid?: number | null;
};

export type BootDefinition = { warm: string; cold: string; coldIdleSeconds: number };

export type BootFile = {
	schema: 1;
	kind: "boot";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	definition: BootDefinition;
	warm: Launch[];
	cold: Launch[];
	logFile: string;
} & CrashReportsRecord;

/** A measurement: a number, or a text for the few gates that compare for equality; null means the run was made but produced no value. */
export type Metric = number | string | null;
export type Metrics = Record<string, Metric>;

export type BuildFile = {
	schema: 1;
	kind: "build";
	/** The app built: absent in files written before the smoke app existed (the QA app). */
	variant?: "qa" | "smoke" | "production";
	abi: string;
	finishedAt: string;
	durationMs: number;
	prebuilt: boolean;
	/** The EAS Update channel the build checks (`--updates-channel`); absent: a plain QA build, which never checks for updates. */
	updatesChannel?: string;
	source: Source;
	apk: ApkInfo;
	/** The composed source map of the Hermes bytecode bundle, and the unstripped engine libraries, kept next to the APK for `soak/symbolicate.ts`. */
	sourceMap?: { path: string; sizeBytes: number; sha256: string };
	symbols?: { dir: string; files: string[] };
	logFile: string;
};

/** Engine counters read through `SvelteEngine.stats()` (MountingManager.stats). */
export type EngineStats = {
	/** Engine views mounted under a React tag. */
	alive: number;
	/** Views waiting in the pool, and deleted views still attached and held back. */
	pooled: number;
	held: number;
	created: number;
	deleted: number;
	/** Animated writes that found no view: the tag was deleted a moment ago (expected), or more than 1 s ago (an animation outliving its node). */
	lateWrites: number;
	staleWrites: number;
	/** Writes that arrived before their view and were replayed on it. */
	replayedWrites: number;
	/** Writes no batch claimed within 1 s, and writes dropped because the table for early ones was full. */
	expiredWrites: number;
	overflowWrites: number;
	earlyPending: number;
	/** Nodes the C++ delegate holds an event emitter (and, for scroll views, a state) for: a deleted node must be gone from both. Absent in logs of builds before the counters. */
	emitters?: number;
	scrollStates?: number;
};

/** `HermesInternal.getInstrumentedStats()`, bytes: live objects plus the old generation's garbage, committed heap, malloc estimate, address space, collections so far. */
export type HermesHeap = {
	allocated: number;
	heapSize: number;
	malloc: number;
	va: number;
	gcs: number;
};

/** The worklet (UI) runtime's Hermes heap as the lab reads it on the UI thread; `collected` is 1 when a full collection ran just before. Absent in logs of builds before it was logged. */
export type UiHeap = { collected: number; allocated: number; heapSize?: number; malloc?: number; va?: number; gcs?: number };

export type SoakPhase = "start" | "sample" | "baseline" | "checkpoint" | "final";

/** One `[Svelte soak]` line from the lab. `t` is milliseconds since the soak scenario began. */
export type JsSample = {
	phase: SoakPhase;
	cycle: number;
	t: number;
	/** How the heap was brought to its live set before this sample (`gc`, `pressure <n> gcs`), null when it was not. */
	collected: string | null;
	heap: HermesHeap | null;
	engine: EngineStats | null;
	ui?: UiHeap | null;
};

/** One `dumpsys meminfo` of the app process; `tag` says which window it belongs to. */
export type MemSample = {
	tag: "series" | "baseline" | "checkpoint" | "final";
	/** Milliseconds since the soak command launched the app. */
	atMs: number;
	pid: number;
	nativePssKb: number;
	nativeAllocKb: number;
	nativeSizeKb: number;
	dalvikPssKb: number;
	dalvikAllocKb: number;
	totalPssKb: number;
	views: number;
	viewRootImpls: number;
	activities: number;
	appContexts: number;
};

export type SoakFile = {
	schema: 1;
	kind: "soak";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** What the soak does and how its windows are defined, for whoever reads the file. */
	definition: string;
	minutesRequested: number;
	/** The parts of the soak cycle that ran when only some were asked for (a bisect, never merged into the report); empty for the full soak. */
	parts: string[];
	/** The lab reported its end and the final idle samples exist. */
	complete: boolean;
	js: JsSample[];
	memory: MemSample[];
	/** Crashes, ANRs and process deaths seen while it ran, one line each. */
	crashes: string[];
	jsErrors: string[];
	engineWarnings: string[];
	/** Derived by `soakMetrics` when the file was written; `report` derives them again from the series. */
	metrics: Metrics;
	logFile: string;
};

export type CrashKind = "java" | "js" | "native" | "anr" | "death" | "no-boot" | "suite-incomplete";

/** One distinct failure: where it was first seen, what it said, and its frames after symbolication when a map or symbols were at hand. */
export type CrashSignature = {
	key: string;
	kind: CrashKind;
	title: string;
	frames: string[];
	symbolicated: boolean;
	count: number;
	firstSeen: string;
};

export type ColdStart = {
	index: number;
	/** `[Svelte boot]` was logged (the JavaScript host booted). */
	reachedBoot: boolean;
	jsTotalMs: number | null;
	crash: boolean;
	anr: boolean;
	/** No process of the package was alive after the boot line and a settle window. */
	died: boolean;
	jsErrors: number;
	error: string | null;
};

export type SuiteRun = {
	index: number;
	complete: boolean;
	durationMs: number;
	checksPassed: number | null;
	crashes: number;
	anrs: number;
	jsErrors: number;
	logFile: string;
	/** The suite could not be run or its log could not be parsed; it counts as incomplete. */
	error: string | null;
};

export type CrashesFile = {
	schema: 1;
	kind: "crashes";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	definition: string;
	/** What the run was started with, which `--resume` must find unchanged: the lab `--run` of the suites, the idle gap of the cold starts, the package. */
	run: string;
	idleSeconds: number;
	packageName: string;
	coldStarts: ColdStart[];
	suites: SuiteRun[];
	/** The first 20 distinct failures. */
	signatures: CrashSignature[];
	logFile: string;
};

/* ---- parity, accessibility and resilience suites ---- */

export type NotCoveredRoute = { route: string; reason: string };

/** `pass` and `fail` compared the screenshot with its reference; the rest did not, and none of them counts as a comparison. */
export type ParityVerdict =
	"pass" | "fail" | "missing-reference" | "unstable" | "error" | "skipped" | "updated";

/**
 * The signed-in phase of a parity or accessibility run (`lib/signin.ts`): the cases that ran under the QA account's session. `detail`
 * says why the phase did not run or end cleanly; it never carries the account's address.
 */
export type SignedInRecord = {
	/** Signed-in cases the run selected. */
	cases: number;
	/** The harness signed in as the QA account. */
	signedIn: boolean;
	/** The session was ended again afterwards (null: nothing to end, the phase never started). */
	signedOut: boolean | null;
	detail: string | null;
};

export type ParityCase = {
	/** The reference's name: `<screen>--<theme>-<direction>-<text size>`. */
	name: string;
	screen: string;
	route: string;
	state: "ready" | "loading" | "error";
	theme: "light" | "dark";
	direction: "ltr" | "rtl";
	fontScale: number;
	verdict: ParityVerdict;
	/** Pixels that differ from the reference outside the masks; null when no comparison was made. */
	differingPixels: number | null;
	/** Pixels the reference's masks cover. */
	maskedPixels: number | null;
	/** Pixels that differ inside a mask (informational). */
	differingMaskedPixels: number | null;
	bounds: Rect | null;
	/** Screenshots taken until two in a row agreed. */
	attempts: number | null;
	/** Why the case errored or was skipped. */
	detail: string | null;
	/** Failing cases keep what the device drew and the diff, relative to `qa/`. */
	actual: string | null;
	diff: string | null;
};

export type ParityFile = {
	schema: 1;
	kind: "parity";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** The directory under qa/screenshots the references of this device kind live in. */
	deviceKind: string;
	/** `check` compares; `update` rewrites the references and is not a verification. */
	mode: "check" | "update";
	/** Pixels in one screenshot, for the share of the screen the masks cover. */
	screenPixels: number;
	/** Cases in the whole matrix (screens x variants), whatever this run selected. */
	matrixSize: number;
	selected: number;
	largestFontScale: number;
	cases: ParityCase[];
	notCovered: NotCoveredRoute[];	/** Why the run stopped before the end of its matrix (the device went away), or null. The cases it did not reach count as missing. */
	aborted: string | null;
	/** The signed-in phase; absent on the iPhone and in runs from before it existed. */
	signedInPhase?: SignedInRecord | null;
} & CrashReportsRecord &
	SessionRecord;

export type A11yScreenResult = {
	name: string;
	screen: string;
	route: string;
	direction: "ltr" | "rtl";
	fontScale: number;
	interactive: number;
	reachable: number;
	labeled: number;
	actionable: number;
	disabled: number;
	clipped: number;
	unreachable: number;
	unlabeled: number;
	notActionable: number;
	/** Enabled controls fully on screen under 48 dp in a direction; not gated. Absent in runs from before it was measured and on the iPhone. */
	smallTargets?: number;
	orderViolations: number;
	titleFirst: boolean | null;
	/** Declared controls of the screen underneath that a sheet or modal leaves in the tree. */
	focusLeaks: number;
	stops: string[];
	findings: A11yFinding[];
	/** iOS: elements the harness modelled from UIKit's state (the bars), which no accessibility client reported; excluded from the counts above. Absent in runs before they were marked. */
	chromeModelled?: number;
	/** Android: the dump was identical to the next one (`settledTree`); null where the tree is not dumped repeatedly (iOS). Absent in runs before it was recorded. */
	stable?: boolean | null;
	/** Set when the screen could not be dumped; the other fields are then zero and the screen counts as not measured. */
	error: string | null;
};

export type A11yFile = {
	schema: 1;
	kind: "a11y";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** What the checks read: stated in the file so nobody mistakes it for a TalkBack run. */
	oracle: string;
	matrixSize: number;
	screens: A11yScreenResult[];
	notCovered: NotCoveredRoute[];	/** Why the run stopped before the end of its matrix (the device went away), or null. The cases it did not reach count as missing. */
	aborted: string | null;
	/** The signed-in phase; absent on the iPhone and in runs from before it existed. */
	signedInPhase?: SignedInRecord | null;
} & CrashReportsRecord &
	SessionRecord;

export type ResilienceStep = {
	index: number;
	group: "rotation" | "fontScale" | "locale" | "appearance" | "background" | "lowMemory";
	name: string;
	ok: boolean;
	/** What failed: the process died, a fatal or an engine warning appeared, the anchor was not on screen. */
	failures: string[];
	/** True when the loop restarted the app after this step failed, so the next step starts from a working screen. */
	recovered: boolean;
	durationMs: number;
	/** A step the device could not perform, and why (iOS: the XCUITest runner's SDK has no `XCUIDevice.appearance`). It is neither a pass nor a failure: `ok` is true and `resilience.skipped` counts it. */
	skipped?: string;
};

/** `Library/Application Support/svelte-navigation/last.json` on the iPhone: what the navigation module did with the state it found at the last start of the app. */
export type NavigationOutcome = { at: number; outcome: string; reason: string; attempts: number; systemKept: boolean; savedAt?: number; bytes?: number };

export type ResilienceFile = {
	schema: 1;
	kind: "resilience";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** The screen the loop ran on, and the anchor each step looked for. */
	screen: string;
	steps: ResilienceStep[];
	/** Steps the plan contains; a run that stopped early has fewer `steps` than this. */
	planned: number;
	logFile: string;	/** Why the run stopped before the end of its matrix (the device went away), or null. The cases it did not reach count as missing. */
	aborted: string | null;
	/** iOS: what the navigation module did with the state at the last start of the app (null: it wrote nothing). Absent on Android. */
	navigation?: NavigationOutcome | null;
	/** iOS: the run was made with `--assume-system-kill` (a diagnostic of the restore without the system's say: `resilience.gateBypassed`). */
	assumeSystemKill?: true;
} & CrashReportsRecord &
	SessionRecord;

/* ---- native module smoke test ---- */

/** One module's `[Svelte smoke]` line: what the call did, which path it took (`js`, `direct`, `js+direct`, `none`), how long it took, and what it said. */
export type SmokeModuleResult = {
	module: string;
	status: "ok" | "fail" | "skip";
	path: string;
	ms: number | null;
	detail: string;
};

/** The `[Svelte smoke] complete {...}` line the app logs when its last module reported. */
export type SmokeCompletion = { os: string; total: number; ok: number; fail: number; skip: number };

export type SmokeFile = {
	schema: 1;
	kind: "smoke";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** The `--run` the lab was launched with (`smoke`). */
	run: string;
	/** Whether the app logged its completion line and nothing interrupted or crashed it. */
	complete: boolean;
	/** The modules that reported, the last line of each (the order they ran in). */
	results: SmokeModuleResult[];
	completion: SmokeCompletion | null;
	crashes: string[];
	/** Android: JavaScript errors (`E ReactNativeJS`) the run logged; null where the app does not report them. */
	jsErrorCount: number | null;
	durationMs: number;
	logFile: string;
} & CrashReportsRecord;

/* ---- gestures ---- */

/** Who injected the input of a gestures launch: `adb input` from the harness, the app's own injector (Android's QA variant), or an XCUITest on the iPhone. */
export type GestureInput = "adb" | "qa" | "xctest";

/** One check of a scenario (`gestures-lab.ts`, `Check`): its name, whether it held, and the value it read. */
export type GestureCheck = { name: string; ok: boolean; value: string | null };

/** What the injecting side of a step did (adb: the command it ran; xctest: the actions the test reported), by step. */
export type GestureInjection = { round: number; step: number; stepName: string; command: string; problems: string[]; error: string | null };

/** One `gestures-*` scenario as the lab reported it in its `[Svelte stress]` line. */
export type GestureResult = {
	name: string;
	verdict: string;
	summary: string;
	/** The frames of the window the scenario judges (the box, the busy box, the pinch); null for the others, whose frames are in `observedFrames`. */
	frames: FrameStats | null;
	observedFrames: { periodMs: number; p50: number; p95: number; max: number; droppedPct: number } | null;
	checks: GestureCheck[];
	/** Counters per round, `[begin, start, update, end, endOk, finalize, finalizeOk]` by handler; null when the lab dropped them to fit its line. */
	counters: Record<string, number[]>[] | null;
	marks: Record<string, number>[] | null;
	/** The scenario ran out of time (its round was given up on). */
	timedOut: boolean;
	/** The lab's own error text when the scenario threw before it could judge anything. */
	error: string | null;
	injections: GestureInjection[];
};

/** One launch of the lab app with a list of gestures scenarios and one way of driving them. */
export type GestureLaunch = {
	input: GestureInput;
	/** The scenarios the launch asked for, by name, in order. */
	asked: string[];
	startedAt: string;
	durationMs: number;
	/** The lab reached its completion line with every asked scenario in it, and nothing else came to the front. */
	complete: boolean;
	scenarios: GestureResult[];
	crashes: string[];
	jsErrors: string[];
	engineWarnings: string[];
	/** Lines of the handshake the harness could not read, and injections that failed: both leave a scenario to time out. */
	harnessErrors: string[];
	/** iOS: the process the launch started, which the phone's crash reports are matched to. */
	pid?: number | null;
	interrupted?: { at: string; by: string };
	logFile: string;
};

export type GesturesFile = {
	schema: 1;
	kind: "gestures";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** The `--run` list and the `--input` value the command was given. */
	run: string[];
	inputs: GestureInput[];
	launches: GestureLaunch[];
} & CrashReportsRecord &
	SessionRecord;

/* ---- foreign: the native-view libraries ---- */

/** The place of a check: the three places the lab mounts a library in, and the release bundle (the harness's own checks of what it holds). */
export type ForeignPlace = "inline" | "row" | "sheet" | "bundle";

/** One check of a native-view library (`foreign-libraries-lab.ts`, `[Svelte foreign library]`, or the harness's own `bundle` checks). */
export type ForeignCheck = { library: string; where: ForeignPlace; name: string; passed: boolean; detail: string };

/** A check the platform cannot run yet (no native inspection, no pixel reader): reported, never counted as a pass. */
export type ForeignSkip = { library: string; where: string; name: string; why: string };

/** One launch of the lab for the `foreign` run: `libraries` (the checks) or `leftovers` (the launch after it). */
export type ForeignLaunch = {
	name: "libraries" | "leftovers";
	run: string;
	startedAt: string;
	durationMs: number;
	/** The lab reached its completion line and nothing else came to the front. */
	complete: boolean;
	crashes: string[];
	jsErrors: string[];
	engineWarnings: string[];
	interrupted?: { at: string; by: string };
	/** How many times the lab was launched for this (another app came to the front during the earlier ones); absent: once. */
	attempts?: number;
	logFile: string;
};

/** What the release bundle's source map says of the libraries: the modules of each that it holds, and the files of React it holds at all. */
export type ForeignBundle = {
	map: string;
	sources: number;
	/** Files of `react` itself (`node_modules/react/`), reported: the app's other dependencies (Reanimated, expo-modules-core) import them. */
	reactFiles: string[];
	/** The library of the lab each module belongs to, for the modules of a library's own JavaScript that the wrappers must not pull in. */
	forbidden: { library: string; module: string }[];
	/** Whether the APK the run measured is the one the map belongs to (the build record's digest). */
	matchesBuild: boolean;
};

export type ForeignFile = {
	schema: 1;
	kind: "foreign";
	startedAt: string;
	finishedAt: string;
	source: Source;
	device: DeviceInfo;
	app: AppInfo;
	/** The libraries the run asked for (all of the pinned ones unless `--only` narrowed it). */
	asked: string[];
	checks: ForeignCheck[];
	skips: ForeignSkip[];
	/** The checks of the `foreign-leftovers` launch. */
	leftovers: ForeignCheck[];
	/** The lines of either launch that carried a check's tag and could not be read as one: each is a failure of the run (`foreign.unparsedLines`). */
	unparsed?: string[];
	launches: ForeignLaunch[];
	bundle: ForeignBundle | null;
} & CrashReportsRecord;
