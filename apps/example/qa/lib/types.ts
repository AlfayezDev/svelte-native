import type { A11yFinding } from "./a11y.ts";
import type { Rect } from "./png.ts";
import type { BootMarks, LabChecks, Scenario } from "../parse/logcat.ts";

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

export type AppInfo = {
	package: string;
	versionName: string | null;
	versionCode: number | null;
	lastUpdateTime: string | null;
	installedSha256: string | null;
	apk: ApkInfo | null;
};

export type Source = { commit: string; dirty: boolean };

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
	runs: LabRun[];
};

export type Launch = {
	index: number;
	displayMs: number | null;
	runningMainMs: number | null;
	displayedReportedMs: number | null;
	totalTimeMs: number | null;
	jsMarks: BootMarks | null;
	crashes: number;
	jsErrors: number;
	engineWarnings: number;
	error: string | null;
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
};

/** One flat number per measurement; null means the run was made but produced no value. */
export type Metrics = Record<string, number | null>;

export type BuildFile = {
	schema: 1;
	kind: "build";
	abi: string;
	finishedAt: string;
	durationMs: number;
	prebuilt: boolean;
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
};

/** `HermesInternal.getInstrumentedStats()`, bytes: live objects plus the old generation's garbage, committed heap, malloc estimate, address space, collections so far. */
export type HermesHeap = {
	allocated: number;
	heapSize: number;
	malloc: number;
	va: number;
	gcs: number;
};

export type SoakPhase = "start" | "sample" | "baseline" | "final";

/** One `[Svelte soak]` line from the lab. `t` is milliseconds since the soak scenario began. */
export type JsSample = {
	phase: SoakPhase;
	cycle: number;
	t: number;
	/** How the heap was brought to its live set before this sample (`gc`, `pressure <n> gcs`), null when it was not. */
	collected: string | null;
	heap: HermesHeap | null;
	engine: EngineStats | null;
};

/** One `dumpsys meminfo` of the app process; `tag` says which window it belongs to. */
export type MemSample = {
	tag: "series" | "baseline" | "final";
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
};

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
	orderViolations: number;
	titleFirst: boolean | null;
	/** Declared controls of the screen underneath that a sheet or modal leaves in the tree. */
	focusLeaks: number;
	stops: string[];
	findings: A11yFinding[];
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
};

export type ResilienceStep = {
	index: number;
	group: "rotation" | "fontScale" | "locale" | "background" | "lowMemory";
	name: string;
	ok: boolean;
	/** What failed: the process died, a fatal or an engine warning appeared, the anchor was not on screen. */
	failures: string[];
	/** True when the loop restarted the app after this step failed, so the next step starts from a working screen. */
	recovered: boolean;
	durationMs: number;
};

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
};
