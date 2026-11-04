import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { dumpUi, endsRun, screenshotPng, type AdbRun, type DeviceSession } from "./device.ts";
import { accountRects, ObservedError, retryCase, type Observation } from "./drive.ts";
import { decodePng, encodePng, paintOver } from "./png.ts";
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
/** Lines of the app's logcat kept: its own process, the newest. */
export const logcatLines = 400;
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
	/** A dump taken now, for a try that read none. */
	dump?: (serial: string) => Promise<UiTree>;
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
	/** A screen of the signed-in phase: the account's address is on it, so a screenshot is only kept when the tree to paint it over from is there. */
	signedIn: boolean;
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

/** The dump of the try: the one its wait last read, else one taken now. */
async function treeOf(error: unknown, deps: EvidenceDeps, serial: string, missing: string[]): Promise<{ tree: UiTree | null; fresh: boolean; observation: Observation | null }> {
	const observation = error instanceof ObservedError ? error.observation : null;
	if (observation?.tree) return { tree: observation.tree, fresh: false, observation };
	try {
		const tree = await (deps.dump ?? ((id: string) => dumpUi(id, { attempts: 1, timeoutMs: 20_000 })))(serial);
		return { tree, fresh: true, observation };
	} catch (cause) {
		missing.push(`dump: ${message(cause).slice(0, 160)}`);
		return { tree: null, fresh: false, observation };
	}
}

/**
 * Takes the evidence of a failed try and writes its files. Never throws: whatever cannot be taken is named in `missing`, because the capture
 * runs on the way to a retry or to the error record, and losing either to a failed adb command would be worse than the evidence.
 */
export async function captureEvidence(deps: EvidenceDeps, target: EvidenceTarget, attempt: number, error: unknown): Promise<FailureEvidence> {
	const missing: string[] = [];
	const base = deps.base ?? qaDir;
	const budget = deps.budget;
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
		const { tree, fresh, observation } = await treeOf(error, deps, target.serial, missing);
		if (observation) evidence.waited = { ms: observation.elapsedMs, dumps: observation.dumps };
		if (tree) evidence.topWindow = `${describeTopWindow(tree)}${fresh ? " (read after the failure)" : ""}`;
		if (budget && !budget.take()) {
			missing.push(`files: the run's evidence budget is spent (${budget.limits.sets} sets, ${budget.limits.bytes} bytes)`);
			return evidence;
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
			const clean = redact(capText(text, limit));
			// The check behind the redaction: a text with the account in it is never written.
			assertClean(clean, `the ${part} of a failed try`);
			return keep(part, clean);
		};

		// The picture first: the screen changes while the rest is read.
		try {
			let png = await (deps.png ?? screenshotPng)(target.serial);
			const email = accountEmail();
			if (email !== null) {
				if (tree === null && target.signedIn) throw new Error("the screen is the QA account's and no tree says where its address is");
				const rects = tree === null ? [] : accountRects(tree);
				if (rects.length > 0) png = encodePng(paintOver(decodePng(png), rects));
			}
			if (png.length > maxScreenshotBytes) missing.push(`screenshot.png: ${png.length} bytes, over the ${maxScreenshotBytes} cap`);
			else evidence.screenshot = await keep("png", png);
		} catch (cause) {
			missing.push(`screenshot: ${message(cause).slice(0, 160)}`);
		}

		if (tree?.raw !== undefined) {
			try {
				evidence.uiDump = await keepText("uidump.xml", tree.raw, maxDumpBytes);
			} catch (cause) {
				missing.push(`uidump: ${message(cause).slice(0, 160)}`);
			}
		} else if (tree !== null) missing.push("uidump: the tree was not read from a device (no raw dump)");

		const shell = async (part: string, command: string, keepLines: number): Promise<string | null> => {
			try {
				const out = await deps.run(target.serial, ["shell", command], { timeoutMs: 30_000 });
				return await keepText(part, lastLines(out, keepLines), maxTextBytes);
			} catch (cause) {
				missing.push(`${part}: ${message(cause).slice(0, 160)}`);
				return null;
			}
		};
		evidence.windows = await shell(
			"windows.txt",
			"dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp|Window #[0-9]+ Window\\{' | head -n 80",
			80,
		);
		evidence.activity = await shell(
			"activity.txt",
			"dumpsys activity activities | grep -E 'topResumedActivity|mResumedActivity|ResumedActivity:|mFocusedApp' | head -n 20",
			20,
		);
		// The app's own process when it is there: its lines are this launch's, since the case killed the one before. Otherwise the buffer's newest lines that name the package or a crash.
		let pids: number[] = [];
		try {
			pids = parsePids(await deps.run(target.serial, ["shell", `pidof ${target.packageName}`], { timeoutMs: 15_000 }));
		} catch {
			// no process: the other command answers
		}
		const [pid] = pids;
		evidence.logcat = await shell(
			"logcat.txt",
			pid === undefined
				? `logcat -d -v threadtime -t 4000 | grep -E '${target.packageName}|FATAL EXCEPTION|AndroidRuntime|am_crash|am_anr|ANR in' | tail -n ${logcatLines}`
				: `logcat -d -v threadtime --pid=${pid} -t ${logcatLines}`,
			logcatLines,
		);
		if (pid === undefined) missing.push(`logcat: ${target.packageName} had no process; the lines that name it or a crash`);
	} catch (cause) {
		missing.push(`capture: ${message(cause).slice(0, 160)}`);
	}
	for (let index = 0; index < missing.length; index++) missing[index] = redact(missing[index] ?? "");
	return evidence;
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
};

/**
 * `retryCase` with the evidence of every failed try: the case is run, and once more when it fails for a reason that is not the device going away
 * or being in the wrong state; each failure is photographed before the retry launches the case again. Returns the value with the tries it took
 * and the evidence of the tries that failed. When the last try fails too, throws `AttemptsFailed` (the cause's message, the tries, the evidence); the
 * failures that end a run (`endsRun`) pass through as they are.
 */
export async function attemptCase<T>(options: AttemptOptions<T>): Promise<Attempted<T>> {
	const { session, screen, fontScale, label, body, evidence } = options;
	const log = options.log ?? console.log;
	let tries = 0;
	const failures: FailureEvidence[] = [];
	const counted = async (): Promise<T> => {
		tries++;
		return body();
	};
	try {
		const value = await retryCase(session, screen, fontScale, label, counted, log, async (error) => {
			const taken = await captureEvidence(evidence.deps, evidence.target, tries, error);
			failures.push(taken);
			reportFailure(taken, evidence.target.stem, evidence.target.directory, log, evidence.deps.base);
		});
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
