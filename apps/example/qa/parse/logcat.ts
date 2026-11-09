export type LogLine = {
	tsMs: number;
	pid: number;
	tid: number;
	level: string;
	tag: string;
	message: string;
};

const threadtime =
	/^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) +(\d+) +(\d+) ([VDIWEF]) (\S.*?)\s*: (.*)$/;

/** One `logcat -v threadtime` line. `tsMs` is milliseconds since midnight, the device clock. */
export function parseLine(line: string): LogLine | null {
	const m = threadtime.exec(line);
	if (!m) return null;
	const [, , , hh, mm, ss, ms, pid, tid, level, tag, message] = m;
	const tsMs = ((Number(hh) * 60 + Number(mm)) * 60 + Number(ss)) * 1000 + Number(ms);
	return {
		tsMs,
		pid: Number(pid),
		tid: Number(tid),
		level: level ?? "",
		tag: tag ?? "",
		message: message ?? "",
	};
}

export function parseLines(text: string): LogLine[] {
	const parsed: LogLine[] = [];
	for (const line of text.split("\n")) {
		const entry = parseLine(line);
		if (entry) parsed.push(entry);
	}
	return parsed;
}

const day = 24 * 60 * 60 * 1000;

/** Milliseconds from one clock reading to a later one, across midnight. */
export function elapsedMs(from: number, to: number): number {
	return to >= from ? to - from : to + day - from;
}

/**
 * A string argument of a `console.info` call with several arguments, as it reaches logcat. React Native's JavaScript console
 * (`@react-native/js-polyfills/console.js`, `formatPrimitive`) prints it in single quotes: the `JSON.stringify` of the string without its
 * outer quotes, a `'` as `\'`, and a `\"` turned back into `"`. So a backslash is `\\` and the `\"` of a JSON detail that is JSON itself is
 * `\\"`. This undoes that, exactly, for text without control characters (a lab payload is one line; a newline that `JSON.stringify(x, null, 2)`
 * wrote is `\n` there, and stays so). A call with a single string argument is printed as it is, without quotes or escapes: undo nothing there.
 */
export function unescapeLogcat(text: string): string {
	return text.replace(/\\(['\\])/g, "$1");
}

/**
 * What follows [prefix] (`'[tag]', '`) in a message, without the closing quote, with the console's quoting undone. A message that does not
 * start with [prefix] is a mistake of the caller, not an empty payload: it throws.
 */
export function quotedArgument(message: string, prefix: string): string {
	if (!message.startsWith(prefix)) throw new Error(`the message does not start with ${prefix}: ${message.slice(0, 80)}`);
	return unescapeLogcat(message.slice(prefix.length).replace(/'\s*$/, ""));
}

/** The JSON payload of a console call such as `'[tag]', '{...}'`, or null when the message has none. */
function payload(message: string, tag: string): string | null {
	const prefix = `'${tag}', '`;
	if (!message.startsWith(prefix) || message[prefix.length] !== "{") return null;
	return quotedArgument(message, prefix);
}

/** At most this many characters of each end of a payload are shown by an error. */
const shownEnd = 160;

/**
 * The value of the JSON a lab line carries ([text], after the console's quoting was undone; [messageLength] is the length of the whole
 * logged message). When it is not JSON the error says what the parser found, how long the message was, the start and the end of the
 * payload, and names the two usual causes: logcat cut the entry (it holds about 4 KB, bytes), or something in it is escaped in a way
 * nobody expected.
 */
export function parseLoggedJson(text: string, tag: string, messageLength: number): unknown {
	try {
		return JSON.parse(text);
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause);
		const shown = text.length <= 2 * shownEnd ? text : `${text.slice(0, shownEnd)} [...] ${text.slice(-shownEnd)}`;
		throw new Error(
			`malformed ${tag} line, its payload is not JSON (${reason}): the message is ${messageLength} characters, and logcat cuts an entry near 4 KB (bytes), ` +
				`but a quote or a backslash escaped some other way breaks it just the same; the payload is ${shown}`,
			{ cause },
		);
	}
}

/* ---- lab checks ---- */

export type LabChecks = {
	passed: number;
	failed: number;
	total: number;
	failures: string[];
	finishedAt: string | null;
};

const checkEntry = /\{"name":"((?:[^"\\]|\\.)*)","passed":(true|false)/g;

/**
 * The lab's functional checks from its `"phase":"checks"` result line. logcat caps a line near
 * 4 KB, so entries are counted one by one; a cut-off line still yields every complete entry. A failure is named as the JSON
 * of the line writes it (a double quote in it is `\"`).
 */
export function parseLabChecks(text: string): LabChecks | null {
	const line = parseLines(text).find(
		(entry) =>
			entry.message.includes("[native lab results]") && entry.message.includes('"phase":"checks"'),
	);
	if (!line) return null;
	let passed = 0;
	const failures: string[] = [];
	// A quoted line went through the console's quoting (`'[native lab results]', '{...}'`): a quote or a backslash in a check's name is escaped a second time.
	const message = line.message.startsWith("'") ? unescapeLogcat(line.message) : line.message;
	for (const entry of message.matchAll(checkEntry)) {
		if (entry[2] === "true") passed++;
		else failures.push(entry[1] ?? "");
	}
	const finishedAt = /"finishedAt":"([^"]+)"/.exec(message)?.[1] ?? null;
	return { passed, failed: failures.length, total: passed + failures.length, failures, finishedAt };
}

/* ---- stress scenarios ---- */

export type FrameStats = {
	periodMs: number;
	durationMs: number;
	count: number;
	p50: number;
	p95: number;
	p99: number;
	max: number;
	droppedPct: number;
	smooth: boolean;
};
/**
 * How many intervals of a window were late (longer than 1.5 frame periods: the lab's own `dropped`), exactly. The run record holds no
 * count of them, only `count` (every interval) and `droppedPct`, which the lab computes as `100 * dropped / count` in full double
 * precision and the run file keeps unrounded, so the late count is `droppedPct * count / 100` rounded to the integer it must be. A
 * percentage no whole number of intervals reproduces (a rounded one, from an older record or a hand-made file) gives `null`: a
 * count is never guessed from a figure rounded to a tenth. A window with no interval has none to judge, `null` too.
 */
export function lateIntervals(frames: Pick<FrameStats, "count" | "droppedPct">): number | null {
	if (!Number.isInteger(frames.count) || frames.count <= 0 || !Number.isFinite(frames.droppedPct)) return null;
	const late = Math.round((frames.droppedPct * frames.count) / 100);
	if (late < 0 || late > frames.count) return null;
	return Math.abs((100 * late) / frames.count - frames.droppedPct) <= 1e-9 ? late : null;
}

export type Scenario = {
	name: string;
	verdict: string;
	summary: string;
	periodMs: number | null;
	frames: FrameStats | null;
	detail: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function frameStats(value: unknown): FrameStats | null {
	if (!isRecord(value)) return null;
	const keys = [
		"periodMs",
		"durationMs",
		"count",
		"p50",
		"p95",
		"p99",
		"max",
		"droppedPct",
	] as const;
	const numbers = keys.map((key) => value[key]);
	if (!numbers.every((entry): entry is number => typeof entry === "number")) return null;
	const [periodMs, durationMs, count, p50, p95, p99, max, droppedPct] = numbers;
	return {
		periodMs: periodMs ?? 0,
		durationMs: durationMs ?? 0,
		count: count ?? 0,
		p50: p50 ?? 0,
		p95: p95 ?? 0,
		p99: p99 ?? 0,
		max: max ?? 0,
		droppedPct: droppedPct ?? 0,
		smooth: value.smooth === true,
	};
}

/** What the harness read of the lab's `[Svelte stress]` lines, and the lines it could not: each is the error that says why (what the parser found, how long the message was). */
export type StressRead = { scenarios: Scenario[]; unparsed: string[] };

/**
 * Per-scenario results from the `[Svelte stress]` JSON lines, in log order. A line that is cut off or malformed is not skipped: it is in
 * `unparsed`, for the caller to fail the run with (the run file is still written, and a missing scenario never reads as a passing one).
 */
export function readStressScenarios(text: string): StressRead {
	const scenarios: Scenario[] = [];
	const unparsed: string[] = [];
	for (const line of parseLines(text)) {
		const json = payload(line.message, "[Svelte stress]");
		if (json === null) continue;
		let value: unknown;
		try {
			value = parseLoggedJson(json, "[Svelte stress]", line.message.length);
		} catch (error) {
			unparsed.push(error instanceof Error ? error.message : String(error));
			continue;
		}
		if (!isRecord(value) || typeof value.name !== "string" || typeof value.verdict !== "string")
			continue;
		scenarios.push({
			name: value.name,
			verdict: value.verdict,
			summary: typeof value.summary === "string" ? value.summary : "",
			periodMs: typeof value.periodMs === "number" ? value.periodMs : null,
			frames: frameStats(value.frames),
			detail: isRecord(value.detail) ? value.detail : null,
		});
	}
	return { scenarios, unparsed };
}

/** The scenarios of [readStressScenarios] for a caller that cannot go on with a line it could not read: it throws on the first one. */
export function parseStressScenarios(text: string): Scenario[] {
	const { scenarios, unparsed } = readStressScenarios(text);
	if (unparsed[0] !== undefined) throw new Error(unparsed[0]);
	return scenarios;
}

export type StressComplete = {
	periodMs: number | null;
	results: { name: string; verdict: string }[];
};

/**
 * The `[Svelte stress] complete` line the lab logs after its last scenario; `completion` is null if it never did, or if the line could not be
 * read (then `unparsed` says why, and the lab did not complete as far as anyone can tell).
 */
export function readStressComplete(text: string): { completion: StressComplete | null; unparsed: string[] } {
	const unparsed: string[] = [];
	for (const line of parseLines(text)) {
		const json = payload(line.message, "[Svelte stress] complete");
		if (json === null) continue;
		let value: unknown;
		try {
			value = parseLoggedJson(json, "[Svelte stress] complete", line.message.length);
		} catch (error) {
			unparsed.push(error instanceof Error ? error.message : String(error));
			continue;
		}
		if (!isRecord(value) || !Array.isArray(value.results)) {
			unparsed.push(`unexpected [Svelte stress] complete payload: ${json.slice(0, 160)}`);
			continue;
		}
		const results = value.results
			.filter(isRecord)
			.flatMap((entry) =>
				typeof entry.name === "string" && typeof entry.verdict === "string"
					? [{ name: entry.name, verdict: entry.verdict }]
					: [],
			);
		return { completion: { periodMs: typeof value.periodMs === "number" ? value.periodMs : null, results }, unparsed };
	}
	return { completion: null, unparsed };
}

/** The completion line of [readStressComplete] for a caller that cannot go on with a line it could not read: it throws on the first one. */
export function parseStressComplete(text: string): StressComplete | null {
	const { completion, unparsed } = readStressComplete(text);
	if (unparsed[0] !== undefined) throw new Error(unparsed[0]);
	return completion;
}

/* ---- boot ---- */

export type BootMarks = Record<string, number>;

const camel = (label: string) =>
	label.replace(/[- ]+(\w)/g, (_, letter: string) => letter.toUpperCase());

/** `init 2 · polyfills 12 · … · total 201 ms` as a map of phase to milliseconds. */
export function parseBootBody(body: string): BootMarks | null {
	const marks: BootMarks = {};
	for (const part of body.split("·")) {
		const m = /^\s*(.+?)\s+(\d+(?:\.\d+)?)(?:\s*ms)?\s*$/.exec(part);
		if (m?.[1] !== undefined && m[2] !== undefined) marks[camel(m[1])] = Number(m[2]);
	}
	return Object.keys(marks).length ? marks : null;
}

/** The first `[Svelte boot] init 2 · polyfills 12 · … · total 201 ms` line, as a map of phase to milliseconds. */
export function parseSvelteBoot(text: string): BootMarks | null {
	const line = parseLines(text).find((entry) => entry.message.includes("[Svelte boot]"));
	if (!line) return null;
	return parseBootBody(
		line.message
			.slice(line.message.indexOf("[Svelte boot]") + "[Svelte boot]".length)
			.replace(/'\s*$/, ""),
	);
}

export type LaunchMarkers = {
	displayMs: number | null;
	runningMainMs: number | null;
	displayedReportedMs: number | null;
};

const displayedLine = /^Displayed \S+ for user \d+: \+(?:(\d+)s)?(\d+)ms/;

/**
 * Timestamps of one app launch in a logcat captured after `logcat -c`: the activity manager's
 * `Start proc` for the package, the app's `Running "main"`, and `Displayed`. Durations are
 * measured from `Start proc`. `displayedReportedMs` is the number the system prints itself.
 */
export function parseLaunchMarkers(text: string, packageName: string): LaunchMarkers {
	let started: number | null = null;
	let running: number | null = null;
	let displayed: number | null = null;
	let reported: number | null = null;
	for (const line of parseLines(text)) {
		if (started === null) {
			if (
				line.tag === "ActivityManager" &&
				line.message.startsWith(`Start proc `) &&
				new RegExp(`^Start proc \\d+:${escapeRegExp(packageName)}/`).test(line.message)
			)
				started = line.tsMs;
			continue;
		}
		if (
			running === null &&
			line.tag === "ReactNativeJS" &&
			line.message.startsWith('Running "main"')
		)
			running = line.tsMs;
		if (displayed === null && line.message.startsWith(`Displayed ${packageName}/`)) {
			const m = displayedLine.exec(line.message);
			displayed = line.tsMs;
			if (m) reported = Number(m[1] ?? 0) * 1000 + Number(m[2]);
		}
	}
	return {
		displayMs: started !== null && displayed !== null ? elapsedMs(started, displayed) : null,
		runningMainMs: started !== null && running !== null ? elapsedMs(started, running) : null,
		displayedReportedMs: reported,
	};
}

export type Interruption = {
	/** The device clock of the line that showed it, as logcat prints it (`MM-DD HH:MM:SS.mmm`, no year). */
	at: string;
	/** The component that came to the front, `<package>/<class>` as the system wrote it. */
	by: string;
};

const stamped = /^(\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) /;
const startedComponent = /^START u\d+ \{.*? cmp=([\w.]+)\/([^\s}]+)/;
const requestedOpen = /^Transition requested .*type = OPEN,.*?(?:cmp=|ComponentInfo\{)([\w.]+)\/([^\s}]+)/;
const displayedComponent = /^Displayed ([\w.]+)\/(\S+?):? /;

/**
 * Another app coming to the front while the lab ran, or null. Once the package has been started (its own `START` or
 * `Start proc`), the first line that shows a component of another package opening is the interruption: the activity
 * manager's `START u0 {cmp=<package>/<class> ...}`, the shell's `Transition requested ... type = OPEN` naming the
 * task's component, or `Displayed <package>/<class>`. An emergency alert, a permission dialog or a call screen does
 * this; whatever opened before the app started (a leftover window) does not.
 */
export function findInterruption(text: string, packageName: string): Interruption | null {
	let started = false;
	for (const raw of text.split("\n")) {
		const line = parseLine(raw);
		const at = stamped.exec(raw)?.[1];
		if (!line || !at) continue;
		const activityManager = line.tag === "ActivityTaskManager" || line.tag === "ActivityManager";
		if (!started) {
			started =
				(activityManager && line.message.startsWith("START ") && startedComponent.exec(line.message)?.[1] === packageName) ||
				(line.tag === "ActivityManager" && new RegExp(`^Start proc \\d+:${escapeRegExp(packageName)}/`).test(line.message));
			continue;
		}
		const match =
			(activityManager && line.message.startsWith("START ") && startedComponent.exec(line.message)) ||
			(line.tag === "WindowManagerShell" && requestedOpen.exec(line.message)) ||
			(activityManager && line.message.startsWith("Displayed ") && displayedComponent.exec(line.message)) ||
			null;
		if (match?.[1] && match[1] !== packageName) return { at, by: `${match[1]}/${match[2]}` };
	}
	return null;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---- faults ---- */

export type Faults = { crashes: string[]; jsErrors: string[] };

/** libc names the dying process by its 15-character kernel name, the tail of the package name. */
function namesProcess(message: string, packageName: string): boolean {
	const name = /\bpid \d+ \(([^)]+)\)/.exec(message)?.[1];
	return name !== undefined && packageName.endsWith(name);
}

const hostException = ".handleHostException(message = ";

/**
 * A JavaScript fatal in a release build: React Native logs it as the host's `handleHostException`, destroys the React
 * host, and leaves the process alive with no UI. No `FATAL EXCEPTION` follows, so it would pass as a clean run.
 */
export function isJsFatal(line: LogLine): boolean {
	return line.tag.endsWith("BridgelessReact") && line.message.includes(hostException);
}

/**
 * What counts as a fatal: the app process crashing (`FATAL EXCEPTION` for the package, a native
 * `Fatal signal` of its process, an `ANR in` it), a JavaScript fatal that destroys the React host, and every
 * error-level line the app's JavaScript logs.
 */
export function findFaults(text: string, packageName: string): Faults {
	const lines = parseLines(text);
	const crashes: string[] = [];
	const jsErrors: string[] = [];
	lines.forEach((line, index) => {
		if (line.tag === "AndroidRuntime" && line.message.startsWith("FATAL EXCEPTION")) {
			const process = lines
				.slice(index + 1, index + 6)
				.find((next) => next.tag === "AndroidRuntime" && next.message.startsWith("Process: "));
			if (process?.message.startsWith(`Process: ${packageName},`))
				crashes.push(`FATAL EXCEPTION ${process.message}`);
		} else if (
			line.level === "F" &&
			line.message.startsWith("Fatal signal") &&
			namesProcess(line.message, packageName)
		) {
			crashes.push(line.message);
		} else if (line.message.startsWith(`ANR in ${packageName}`)) {
			crashes.push(line.message);
		} else if (isJsFatal(line)) {
			crashes.push(
				`JS fatal: ${line.message.slice(line.message.indexOf(hostException) + hostException.length)}`,
			);
		} else if (line.tag === "ReactNativeJS" && line.level === "E") {
			jsErrors.push(line.message);
		}
	});
	return { crashes, jsErrors };
}

/** Warning and error lines from the engine's own log tag. */
export function findEngineWarnings(text: string): string[] {
	return parseLines(text)
		.filter((line) => line.tag === "SvelteEngine" && (line.level === "W" || line.level === "E"))
		.map((line) => line.message);
}
