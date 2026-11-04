import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { dumpUi, endsRun, screenshotPng, type AdbRun, type DeviceSession, type Direction } from "./device.ts";
import { accountRects, maskRects, ObservedError, retryCase } from "./drive.ts";
import { decodePng, encodePng, paintOver, type Rect } from "./png.ts";
import { accountEmail, assertClean, redact } from "./qa-account.ts";
import { qaDir } from "./paths.ts";
import type { ScreenCase } from "./screens.ts";
import type { FailureEvidence } from "./types.ts";
import { parsePids } from "../parse/device-state.ts";
import type { UiTree } from "./uia.ts";

/**
 * Evidence of a try of a case that did not get its screen (an anchor that never came, a dump that could not be read), kept for `parity` and
 * `a11y` on the emulator. A case that errors says "no node X on screen after 15000 ms" and nothing about what was on screen instead; the
 * emulator is restarted for the next chunk, so the screen is gone by the time anyone asks. This takes what the device shows right after the try failed and before the retry
 * launches the case again: a screenshot, the raw dump the try last read, the window manager's focus and window list, the top activity and the last
 * lines of the app's logcat. Never taken for a case that passed its first try; one set per failed try, each part size-capped, the run as a whole
 * held to a budget of sets and bytes.
 */

/** The most one part may keep (a dump of a busy screen is some hundreds of kilobytes). */
export const maxDumpBytes = 600_000;
export const maxTextBytes = 256_000;
export const maxScreenshotBytes = 8_000_000;
/** Lines of the app's logcat kept: its own process, the newest; and of the crash buffer, which holds the crashes of every process. */
export const logcatLines = 400;
export const crashLines = 100;
/** Attempts of the plain and of the compressed dump taken after the failure: a busy screen answers `could not get idle state` more than once, and a signed-in picture needs them. */
export const plainDumpAttempts = 3;
export const compressedDumpAttempts = 2;
/** The sets one run may keep, and the bytes of all of them: a backend that is down for a whole matrix does not fill the disk with a hundred sets. */
export const defaultBudget = { sets: 40, bytes: 64_000_000 };

/** What a run has spent of its evidence budget. */
export class EvidenceBudget {
	sets = 0;
	bytes = 0;
	readonly limits: { sets: number; bytes: number };
	constructor(limits: { sets: number; bytes: number } = defaultBudget) {
		this.limits = limits;
	}

	/** Whether another set may be taken; counts it. */
	take(): boolean {
		if (this.sets >= this.limits.sets || this.bytes >= this.limits.bytes) return false;
		this.sets++;
		return true;
	}

	/** Bytes a part may still use, or 0 when the budget is spent. */
	left(): number {
		return Math.max(0, this.limits.bytes - this.bytes);
	}

	spend(bytes: number): void {
		this.bytes += bytes;
	}
}

/** The device and the files a capture works with; tests hand fakes in. */
export type EvidenceDeps = {
	/** The adb of the session. */
	run: AdbRun;
	/** The PNG of the display (`adb exec-out screencap -p`). */
	png?: (serial: string) => Promise<Buffer>;
	/** A dump taken now: for a try that read none, and (with the QA account configured) to paint the picture over from; `important` is the compressed dump a service walks. */
	dump?: (serial: string, options?: { important?: boolean; attempts?: number }) => Promise<UiTree>;
	/** Where the files go, and what their paths are relative to (default: `qa/`, like the failure pictures of `parity`). */
	base?: string;
	budget?: EvidenceBudget;
};

export type EvidenceTarget = {
	serial: string;
	packageName: string;
	/** The directory beside the run file (named like it) the files go in. */
	directory: string;
	/** The file name the parts are named after: the case's name. */
	stem: string;
	/** The screen and the direction it was opened in: a signed-in screen shows the QA account's address, so its screenshot is only kept after `pictureRedactions`; the screen's masks are painted too. */
	screen: ScreenCase;
	direction: Direction;
};

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Text cut to `limit` bytes of UTF-8 (on a character boundary), saying how much was left out. */
export function capText(text: string, limit: number): string {
	const bytes = Buffer.byteLength(text);
	if (bytes <= limit) return text;
	const kept = Buffer.from(text).subarray(0, limit).toString("utf8").replace(/�$/, "");
	return `${kept}\n[... ${bytes - Buffer.byteLength(kept)} bytes left out]\n`;
}

/** The last `count` lines of a text. */
export function lastLines(text: string, count: number): string {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines.length <= count ? `${lines.join("\n")}\n` : `${lines.slice(-count).join("\n")}\n`;
}

/**
 * What the top-level node of a dump is, in one line: the package and class of the window the dump walked (`uiautomator dump` walks the active window
 * only, so a sheet's window, a system dialog or the launcher would show here as another package), its bounds, the node count and the first texts on it.
 */
export function describeTopWindow(tree: UiTree): string {
	const root = tree.root;
	if (root === null) return "an empty dump (no nodes)";
	const { x, y, width, height } = root.bounds;
	const texts: string[] = [];
	for (const node of tree.nodes) {
		if (node.bounds.width <= 0 || node.bounds.height <= 0) continue;
		const text = (node.text || node.contentDesc).trim().replace(/\s+/g, " ");
		if (text.length === 0 || texts.includes(text)) continue;
		texts.push(text);
		if (texts.length === 6) break;
	}
	const shown = texts.map((text) => JSON.stringify(text.length > 40 ? `${text.slice(0, 40)}…` : text));
	return redact(
		`${root.packageName || "(no package)"} ${root.className || "(no class)"} [${x},${y}][${x + width},${y + height}], ${tree.nodes.length} node${tree.nodes.length === 1 ? "" : "s"}${shown.length > 0 ? `: ${shown.join(", ")}` : ""}`,
	);
}

/** The one-line digest of a failed try for a case's `detail` and the console: the try, the wait, and what was on screen. */
export function digest(evidence: FailureEvidence): string {
	const wait = evidence.waited === null ? "" : `, waited ${(evidence.waited.ms / 1000).toFixed(1)} s over ${evidence.waited.dumps} dump${evidence.waited.dumps === 1 ? "" : "s"}`;
	return `try ${evidence.attempt}${wait}, top window ${evidence.topWindow ?? "unknown"}`;
}

/** A dump taken after the failure, or null (and why, in `missing`). */
async function freshDump(deps: EvidenceDeps, serial: string, important: boolean, attempts: number, missing: string[]): Promise<UiTree | null> {
	try {
		return await (deps.dump ?? ((id: string, options?: { important?: boolean; attempts?: number }) => dumpUi(id, { timeoutMs: 20_000, ...options })))(serial, { important, attempts });
	} catch (cause) {
		missing.push(`${important ? "compressed dump" : "dump"}: ${message(cause).slice(0, 160)}`);
		return null;
	}
}

/** The dumps a failed try has: the one its wait last read (`observed`), and, when the account is configured, ones taken after the failure to paint over from. */
export type Trees = { observed: UiTree | null; plain: UiTree | null; compressed: UiTree | null };

/**
 * What a failure picture needs before it is kept, with the QA account configured: the rectangles to paint over, or why the picture is not kept. They are the
 * ones `parity` paints over a failed comparison (`liveRedactions`): every node of every dump that shows the address (the plain dump lists the screen a sheet or
 * modal covers, the compressed one a service walks leaves it out, and the wait's own dump is either) and the screen's masks (`maskRects`: the avatar, the
 * devices), so a node that moved since the last dump is still covered. A signed-in screen is only kept when every dump's top-level window is the app's: under a
 * dialog or the launcher the dump walks that window, and the app's frame with the address on it, dimmed, is still in the picture.
 */
export function pictureRedactions(target: EvidenceTarget, trees: Trees): { rects: Rect[] } | { refused: string } {
	if (accountEmail() === null) return { rects: [] };
	const { screen } = target;
	const read = [trees.observed, trees.plain, trees.compressed].filter((tree): tree is UiTree => tree !== null);
	if (screen.signedIn) {
		if (trees.plain === null) return { refused: "the screen is the QA account's and no dump after the failure says where its address is" };
		if (screen.hidden.length > 0 && trees.compressed === null) return { refused: "the screen is the QA account's and no dump of what a service walks says what is on top" };
		const foreign = read.find((tree) => tree.root === null || tree.root.packageName !== target.packageName);
		if (foreign) return { refused: `the top window is ${foreign.root?.packageName || "not the app's"}, not ${target.packageName}: the app's frame with the QA account's address on it may be behind it` };
	}
	const rects = read.flatMap((tree) => accountRects(tree));
	const plain = trees.plain ?? trees.observed;
	if (plain !== null) {
		try {
			rects.push(...maskRects(plain, screen, target.direction, trees.compressed ?? undefined));
		} catch {
			// a mask that matches no node has nothing to paint; the nodes with the address are covered above
		}
	}
	return { rects };
}

/** The seconds of a logcat stamp (`MM-DD HH:MM:SS.mmm`, the device's clock, no year) from the start of its year; null for a line without one. */
function stampSeconds(stamp: string): number | null {
	const match = /^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.(\d{3}))?/.exec(stamp);
	if (!match) return null;
	const [, month, day, hour, minute, second, millis] = match;
	return (Date.UTC(2001, Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - Date.UTC(2001, 0, 1)) / 1000 + Number(millis ?? 0) / 1000;
}

/** logcat's own stamp for a moment of the device's clock (`MM-DD HH:MM:SS.mmm`). */
export function logcatStamp(deviceClock: Date): string {
	const two = (value: number) => String(value).padStart(2, "0");
	return `${two(deviceClock.getUTCMonth() + 1)}-${two(deviceClock.getUTCDate())} ${two(deviceClock.getUTCHours())}:${two(deviceClock.getUTCMinutes())}:${two(deviceClock.getUTCSeconds())}.${String(deviceClock.getUTCMilliseconds()).padStart(3, "0")}`;
}

/**
 * The lines of a `logcat -v threadtime` text at or after a stamp: the crash buffer holds the crashes of every process since boot, so an earlier case's crash
 * is not filed under this try. A line without a stamp (the `--------- beginning of crash` header) goes. The stamps carry no year, so one a half year away is read as the next or the last.
 */
export function linesSince(text: string, since: string): string {
	const from = stampSeconds(since);
	if (from === null) return text;
	const year = 366 * 24 * 3600;
	const kept = text.split("\n").filter((line) => {
		const at = stampSeconds(line);
		if (at === null) return false;
		let difference = at - from;
		if (difference > year / 2) difference -= year;
		else if (difference < -year / 2) difference += year;
		return difference >= 0;
	});
	return kept.length === 0 ? "" : `${kept.join("\n")}\n`;
}

/**
 * Takes the evidence of a failed try and writes its files. Never throws: whatever cannot be taken is named in `missing`, because the capture
 * runs on the way to a retry or to the error record, and losing either to a failed adb command would be worse than the evidence.
 */
export async function captureEvidence(deps: EvidenceDeps, target: EvidenceTarget, attempt: number, error: unknown, startedAt?: number): Promise<FailureEvidence> {
	const missing: string[] = [];
	const evidence: FailureEvidence = {
		attempt,
		error: redact(message(error)),
		waited: null,
		topWindow: null,
		screenshot: null,
		uiDump: null,
		windows: null,
		activity: null,
		logcat: null,
		missing,
	};
	try {
		await take(deps, target, attempt, error, evidence, startedAt);
	} catch (cause) {
		missing.push(`capture: ${message(cause).slice(0, 160)}`);
	}
	// On every path out, the early ones included.
	for (let index = 0; index < missing.length; index++) missing[index] = redact(missing[index] ?? "");
	return evidence;
}

async function take(deps: EvidenceDeps, target: EvidenceTarget, attempt: number, error: unknown, evidence: FailureEvidence, startedAt?: number): Promise<void> {
	const { missing } = evidence;
	const { serial } = target;
	const base = deps.base ?? qaDir;
	const budget = deps.budget;

	const observation = error instanceof ObservedError ? error.observation : null;
	const observed = observation?.tree ?? null;
	if (observation) evidence.waited = { ms: observation.elapsedMs, dumps: observation.dumps };
	// The picture is held as bytes in memory, and whether it may be kept is decided once the dumps are in. With the account configured it is painted over from dumps taken
	// now (the wait's own may be the compressed one) and is taken between the plain dump and the compressed one, so the gap to the plain one is as short as it can be;
	// without, it is taken first, because only a try that read no dump needs one.
	const account = accountEmail() !== null;
	let png: Buffer | null = null;
	const shoot = async () => {
		try {
			png = await (deps.png ?? screenshotPng)(serial);
		} catch (cause) {
			missing.push(`screenshot: ${message(cause).slice(0, 160)}`);
		}
	};
	if (!account) await shoot();
	const plain = account || observed === null ? await freshDump(deps, serial, false, plainDumpAttempts, missing) : null;
	if (account) await shoot();
	const compressed = account && target.screen.hidden.length > 0 ? await freshDump(deps, serial, true, compressedDumpAttempts, missing) : null;
	const tree = observed ?? plain;
	if (tree) evidence.topWindow = `${describeTopWindow(tree)}${observed === null ? " (read after the failure)" : ""}`;

	if (budget && !budget.take()) {
		missing.push(`files: the run's evidence budget is spent (${budget.limits.sets} sets, ${budget.limits.bytes} bytes)`);
		return;
	}
	await mkdir(target.directory, { recursive: true });
	const file = (part: string) => join(target.directory, `${target.stem}.attempt${attempt}.${part}`);
	const keep = async (part: string, bytes: Buffer | string): Promise<string | null> => {
		const size = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length;
		if (budget && size > budget.left()) {
			missing.push(`${part}: ${size} bytes do not fit the run's evidence budget`);
			return null;
		}
		const path = file(part);
		await writeFile(path, bytes);
		budget?.spend(size);
		return relative(base, path);
	};
	const keepText = async (part: string, text: string, limit: number): Promise<string | null> => {
		// Redacted first and cut after: a cut through the address would leave a piece no redaction recognises.
		const clean = capText(redact(text), limit);
		// The check behind the redaction: a text with the account in it is never written.
		assertClean(clean, `the ${part} of a failed try`);
		return keep(part, clean);
	};

	if (png !== null) {
		try {
			const redactions = pictureRedactions(target, { observed, plain, compressed });
			if ("refused" in redactions) missing.push(`screenshot: ${redactions.refused}`);
			else {
				const bytes = redactions.rects.length > 0 ? encodePng(paintOver(decodePng(png), redactions.rects)) : png;
				if (bytes.length > maxScreenshotBytes) missing.push(`screenshot: ${bytes.length} bytes, over the ${maxScreenshotBytes} cap`);
				else evidence.screenshot = await keep("png", bytes);
			}
		} catch (cause) {
			missing.push(`screenshot: ${message(cause).slice(0, 160)}`);
		}
	}

	// The dump the wait last read; a dump taken after the failure when that one has no XML to keep.
	const raw = observed?.raw ?? plain?.raw;
	if (raw !== undefined) {
		try {
			evidence.uiDump = await keepText("uidump.xml", raw, maxDumpBytes);
		} catch (cause) {
			missing.push(`uidump: ${message(cause).slice(0, 160)}`);
		}
	} else if (tree !== null) missing.push("uidump: the tree was not read from a device (no raw dump)");

	const read = async (command: string, timeoutMs = 30_000): Promise<{ text: string } | { failed: string }> => {
		try {
			return { text: await deps.run(serial, ["shell", command], { timeoutMs }) };
		} catch (cause) {
			return { failed: message(cause).slice(0, 160) };
		}
	};
	/** The first of the commands that answers with something is kept as the part; each one that failed or answered nothing is named in `missing`, and the part is null when none did. */
	const firstAnswer = async (part: string, commands: string[], keepLines: number): Promise<string | null> => {
		const reasons: string[] = [];
		for (const command of commands) {
			const answer = await read(command);
			const name = command.split(" |")[0] ?? command;
			if ("failed" in answer) reasons.push(`${name}: ${answer.failed}`);
			else if (answer.text.trim() === "") reasons.push(`${name}: empty`);
			else {
				try {
					return await keepText(part, lastLines(answer.text, keepLines), maxTextBytes);
				} catch (cause) {
					missing.push(`${part}: ${message(cause).slice(0, 160)}`);
					return null;
				}
			}
		}
		missing.push(`${part}: ${reasons.join("; ")}`);
		return null;
	};
	// Empty is as good as failed: API 36 answers `dumpsys window windows` with nothing where the plain `dumpsys window` has the lines.
	const windowLines = "grep -E 'mCurrentFocus|mFocusedApp|Window #[0-9]+ Window\\{' | head -n 80";
	evidence.windows = await firstAnswer("windows.txt", [`dumpsys window windows | ${windowLines}`, `dumpsys window | ${windowLines}`], 80);
	evidence.activity = await firstAnswer(
		"activity.txt",
		["dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity|ResumedActivity:|mFocusedApp' | head -n 20"],
		20,
	);

	// The app's own process when it is there: its lines are this launch's, since the case killed the one before. Otherwise the buffer's newest lines that name the package.
	// The crash buffer is always read: a crash followed by the relaunch of the retry leaves the dead process's lines nowhere else.
	let pids: number[] = [];
	try {
		pids = parsePids(await deps.run(serial, ["shell", `pidof ${target.packageName}`], { timeoutMs: 15_000 }));
	} catch {
		// no process: the other command answers
	}
	const [pid] = pids;
	const appCommand =
		pid === undefined
			? `logcat -d -v threadtime -t 4000 | grep -E '${target.packageName}' | tail -n ${logcatLines}`
			: `logcat -d -v threadtime --pid=${pid} -t ${logcatLines}`;
	const crashCommand = `logcat -b crash -d -v threadtime -t ${crashLines}`;
	// The try's start on the device's clock: its clock now, less the time the try has run on this host's. The crash buffer and the lines that name the package of an app with
	// no process hold earlier tries and earlier cases too, and only this try's belong in its evidence.
	let since: string | null = null;
	if (startedAt !== undefined) {
		const clock = await read("date +'%m-%d %H:%M:%S'", 15_000);
		const now = "text" in clock ? /^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(clock.text.trim()) : null;
		if (now) {
			const [, month, day, hour, minute, second] = now;
			const device = Date.UTC(new Date().getUTCFullYear(), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
			since = logcatStamp(new Date(device - (Date.now() - startedAt) - 1000));
		} else missing.push("logcat.txt: the device's clock could not be read, so the crash buffer is not narrowed to the try");
	}
	const sections: string[] = [];
	let answered = false;
	for (const [title, command, lines, narrowed] of [
		[pid === undefined ? `lines that name ${target.packageName}${since === null ? "" : ` since ${since}`} (the app had no process)` : `app process ${pid} (logcat --pid=${pid} -t ${logcatLines})`, appCommand, logcatLines, pid === undefined],
		[`crash buffer${since === null ? "" : ` since ${since}`} (logcat -b crash -d -t ${crashLines})`, crashCommand, crashLines, true],
	] as const) {
		const answer = await read(command);
		if ("failed" in answer) {
			sections.push(`--- ${title}: not read (${answer.failed}) ---\n`);
			missing.push(`logcat.txt: ${title.split(" (")[0]}: ${answer.failed}`);
			continue;
		}
		answered = true;
		const text = narrowed && since !== null ? linesSince(answer.text, since) : answer.text;
		sections.push(`--- ${title} ---\n${text.trim() === "" ? "(no lines)\n" : capText(redact(lastLines(text, lines)), maxTextBytes / 2)}`);
	}
	if (answered) {
		try {
			evidence.logcat = await keepText("logcat.txt", sections.join("\n"), maxTextBytes);
		} catch (cause) {
			missing.push(`logcat.txt: ${message(cause).slice(0, 160)}`);
		}
	}
	if (pid === undefined) missing.push(`logcat: ${target.packageName} had no process; the lines that name it`);
}

/** A failed try with what was kept of it, ready for the console. */
export function reportFailure(evidence: FailureEvidence, stem: string, directory: string, log: (line: string) => void, base: string = qaDir): void {
	const kept = [evidence.screenshot, evidence.uiDump, evidence.windows, evidence.activity, evidence.logcat].filter((path) => path !== null).length;
	log(`  evidence (${digest(evidence)}): ${kept} file${kept === 1 ? "" : "s"} ${relative(base, join(directory, `${stem}.attempt${evidence.attempt}.*`))}${evidence.missing.length > 0 ? `; not kept: ${evidence.missing.map((entry) => entry.split(":")[0]).join(", ")}` : ""}`);
}

/** The case failed on every try: what it leaves in its record. */
export class AttemptsFailed extends Error {
	readonly failures: FailureEvidence[];
	readonly tries: number;
	constructor(error: unknown, tries: number, failures: FailureEvidence[]) {
		super(message(error), { cause: error });
		this.name = "AttemptsFailed";
		this.tries = tries;
		this.failures = failures;
	}
}

export type Attempted<T> = { value: T; tries: number; failures: FailureEvidence[] };

export type AttemptOptions<T> = {
	session: DeviceSession;
	screen: ScreenCase;
	fontScale: number;
	label: string;
	/** One try of the case: launch, wait for the anchor, whatever the suite measures. */
	body: () => Promise<T>;
	evidence: { deps: EvidenceDeps; target: EvidenceTarget };
	log?: (message: string) => void;
	/** Which failures get the retry; default every one that does not end the run. A failure it refuses is thrown as it is: no retry, no evidence. */
	retryable?: (error: unknown) => boolean;
};

/**
 * `retryCase` with the evidence of every failed try: the case is run, and once more when it fails for a reason that is not the device going away
 * or being in the wrong state (and, with `retryable`, is one the retry may cure); each failure is photographed before the retry launches the case again.
 * Returns the value with the tries it took and the evidence of the tries that failed. `tries` counts every run of `body`: the retry, and the re-run
 * `DeviceSession.guarded` makes when the emulator restarted under the case, so it is 2 for a retry and can be more only after such a restart.
 * When the last try fails too, throws `AttemptsFailed` (the cause's message, the tries, the evidence); the failures that end a run (`endsRun`) and
 * those `retryable` refuses pass through as they are.
 */
export async function attemptCase<T>(options: AttemptOptions<T>): Promise<Attempted<T>> {
	const { session, screen, fontScale, label, body, evidence } = options;
	const log = options.log ?? console.log;
	let tries = 0;
	const failures: FailureEvidence[] = [];
	// When the run that is going on began, by this host's clock: the evidence of a failed run narrows the device's logs to it.
	let startedAt = Date.now();
	const counted = async (): Promise<T> => {
		tries++;
		startedAt = Date.now();
		return body();
	};
	try {
		const value = await retryCase(
			session,
			screen,
			fontScale,
			label,
			counted,
			log,
			async (error) => {
				const taken = await captureEvidence(evidence.deps, evidence.target, tries, error, startedAt);
				failures.push(taken);
				reportFailure(taken, evidence.target.stem, evidence.target.directory, log, evidence.deps.base);
			},
			options.retryable,
		);
		return { value, tries, failures };
	} catch (error) {
		// A failure that ends the run (the device is gone, or in the wrong state) is not the case's: it is thrown as it is.
		if (failures.length === 0 || endsRun(error)) throw error;
		throw new AttemptsFailed(error, tries, failures);
	}
}

/**
 * The fields of a record for a case that failed on every try: `detail` is the last error and what the device showed (the digest of the last try),
 * `attempts` and `tries` the tries made, `failures` the evidence of each.
 */
export function failedFields(error: AttemptsFailed): { detail: string; attempts: number; tries: number; failures: FailureEvidence[] } {
	const last = error.failures.at(-1);
	return {
		detail: `${redact(error.message)}${last ? ` (${digest(last)})` : ""}`,
		attempts: error.tries,
		tries: error.tries,
		failures: error.failures,
	};
}

/** The fields of a record for a case that passed its retry: the tries and the first try's evidence, so the retry is never silent. */
export function retriedFields(attempted: Pick<Attempted<unknown>, "tries" | "failures">): { tries: number; failures: FailureEvidence[] } | Record<string, never> {
	return attempted.tries > 1 || attempted.failures.length > 0 ? { tries: attempted.tries, failures: attempted.failures } : {};
}
