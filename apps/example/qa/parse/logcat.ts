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

/** The JSON payload of a console call such as `'[tag]', '{...}'`, or null when the message has none. */
function payload(message: string, tag: string): string | null {
	const prefix = `'${tag}', '`;
	if (!message.startsWith(prefix) || message[prefix.length] !== "{") return null;
	return message.slice(prefix.length).replace(/'\s*$/, "");
}

function parseJson(text: string, tag: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`malformed ${tag} line (logcat cuts lines near 4 KB): ${text.slice(0, 160)}`);
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
 * 4 KB, so entries are counted one by one; a cut-off line still yields every complete entry.
 */
export function parseLabChecks(text: string): LabChecks | null {
	const line = parseLines(text).find(
		(entry) =>
			entry.message.includes("[native lab results]") && entry.message.includes('"phase":"checks"'),
	);
	if (!line) return null;
	let passed = 0;
	const failures: string[] = [];
	for (const entry of line.message.matchAll(checkEntry)) {
		if (entry[2] === "true") passed++;
		else failures.push(entry[1] ?? "");
	}
	const finishedAt = /"finishedAt":"([^"]+)"/.exec(line.message)?.[1] ?? null;
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

/**
 * Per-scenario results from the `[Svelte stress]` JSON lines, in log order. A scenario line that
 * is cut off or malformed throws: a missing scenario must never read as a passing one.
 */
export function parseStressScenarios(text: string): Scenario[] {
	const scenarios: Scenario[] = [];
	for (const line of parseLines(text)) {
		const json = payload(line.message, "[Svelte stress]");
		if (json === null) continue;
		const value = parseJson(json, "[Svelte stress]");
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
	return scenarios;
}

export type StressComplete = {
	periodMs: number | null;
	results: { name: string; verdict: string }[];
};

/** The `[Svelte stress] complete` line the lab logs after its last scenario, or null if it never did. */
export function parseStressComplete(text: string): StressComplete | null {
	for (const line of parseLines(text)) {
		const json = payload(line.message, "[Svelte stress] complete");
		if (json === null) continue;
		const value = parseJson(json, "[Svelte stress] complete");
		if (!isRecord(value) || !Array.isArray(value.results))
			throw new Error(`unexpected [Svelte stress] complete payload: ${json.slice(0, 160)}`);
		const results = value.results
			.filter(isRecord)
			.flatMap((entry) =>
				typeof entry.name === "string" && typeof entry.verdict === "string"
					? [{ name: entry.name, verdict: entry.verdict }]
					: [],
			);
		return { periodMs: typeof value.periodMs === "number" ? value.periodMs : null, results };
	}
	return null;
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
