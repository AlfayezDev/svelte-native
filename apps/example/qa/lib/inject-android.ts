import { spawn } from "node:child_process";
import { shell } from "./adb.ts";
import { parseLine, unescapeLogcat } from "../parse/logcat.ts";
import {
	parseGestureLine,
	pxPath,
	resolveAnchor,
	type Input,
	type Point,
	type Ready,
	type Rects,
} from "../../src/lib/native/dev/gestures-lab.ts";

/**
 * Driving the gesture lab on Android (SPEC.md, "Gestures", "Driving the lab").
 *
 * One pointer goes through the real input pipeline: `adb shell input tap | swipe` with exact pixel coordinates from the lab's
 * `[Svelte gesture] ready` line (`input swipe` moves as fast as the shell can, not frame by frame, so it proves counters, not latency;
 * a zero length swipe of 700 ms is a long press). Two pointers, and drags paced by the frame, are the app's own injector
 * (`SvelteQaTouch`, `modules/svelte-qa-android`): the page calls it itself when it is opened with `drive:qa`, from the same `Input` and the same
 * `pxPath`, so there is nothing to send from here; `qaPlan` is only what such a call would carry, for a person to read or replay.
 * `sendevent` on the emulator's touch device would be the end-to-end path for a pinch and is not built: it takes one process per event.
 */

/** The shell command lines that perform a single pointer input (`input tap x y`, `input swipe x1 y1 x2 y2 ms`), in whole pixels. */
export function adbInputCommands(input: Input, rects: Rects, density: number): string[] {
	const whole = (point: Point): [number, number] => [Math.round(point.x), Math.round(point.y)];
	switch (input.kind) {
		case "tap": {
			const [x, y] = whole(resolveAnchor(input.at, rects, density));
			return [`input tap ${x} ${y}`];
		}
		case "drag": {
			const [x, y] = whole(resolveAnchor(input.from, rects, density));
			const [x2, y2] = whole({ x: x + input.by[0] * density, y: y + input.by[1] * density });
			return [`input swipe ${x} ${y} ${x2} ${y2} ${Math.round(input.durationMs)}`];
		}
		case "hold": {
			const [x, y] = whole(resolveAnchor(input.at, rects, density));
			const [dx, dy] = input.drift ?? [0, 0];
			const [x2, y2] = whole({ x: x + dx * density, y: y + dy * density });
			// A swipe that ends where it began is a press that lasts the duration.
			return [`input swipe ${x} ${y} ${x2} ${y2} ${Math.round(input.durationMs)}`];
		}
		case "twoFinger":
			throw new Error("adb input moves one pointer: a two finger input is the in-app injector's (drive:qa)");
	}
}

/** How long the command takes on the device, so the shell call is given that and the time `input` needs to start. */
export function inputDurationMs(input: Input): number {
	return input.kind === "tap" ? 100 : input.durationMs;
}

/** What the in-app injector is handed for an input: the JSON `SvelteQaTouch.run` takes. */
export function qaPlan(input: Input, rects: Rects, density: number): string {
	return JSON.stringify(pxPath(input, rects, density));
}

/**
 * Why a step cannot be aimed at, or nothing: the overlay is not at the screen's origin (the rectangles are window pixels and `adb input`
 * takes screen pixels, so they differ by the overlay's offset), or a point of the input falls outside the screen.
 */
export function aimProblems(ready: Ready): string[] {
	const problems: string[] = [];
	const { screen } = ready;
	if (Math.abs(screen.x) > 1 || Math.abs(screen.y) > 1)
		problems.push(`the engine overlay is at (${screen.x}, ${screen.y}) in the window: window pixels are not screen pixels`);
	if (!ready.input) return problems;
	const path = pxPath(ready.input, ready.rects, ready.density);
	const outside = path.pointers.flatMap((pointer) => pointer.waypoints).filter(([, x, y]) => x < 0 || y < 0 || x > screen.w || y > screen.h);
	if (outside.length > 0) {
		const [, x, y] = outside[0] as [number, number, number];
		problems.push(`the input leaves the screen (${Math.round(x)}, ${Math.round(y)} of ${Math.round(screen.w)} x ${Math.round(screen.h)})`);
	}
	return problems;
}

export type InjectionLog = { scenario: string; round: number; step: number; stepName: string; command: string; problems: string[]; error: string | null };

/**
 * Reads the lab's `ready` lines from logcat and performs the input each one asks for, one at a time, once per (scenario, round, step).
 * Only lines of a page opened with `drive:adb` are acted on. A failed injection is recorded, not thrown: the scenario then times out
 * with the counters it has, and says so.
 */
export class AdbDriver {
	readonly log: InjectionLog[] = [];
	readonly parseErrors: string[] = [];
	private readonly seen = new Set<string>();
	private chain: Promise<void> = Promise.resolve();
	private readonly say: (message: string) => void;
	private readonly run: (command: string, timeoutMs: number) => Promise<void>;

	/** `run` performs a shell command on the device (the default is `adb -s <serial> shell`); tests hand in their own. */
	constructor(
		serial: string,
		say: (message: string) => void = console.log,
		run: (command: string, timeoutMs: number) => Promise<void> = async (command, timeoutMs) => {
			await shell(serial, command, { timeoutMs });
		},
	) {
		this.say = say;
		this.run = run;
	}

	/** One line of `logcat -v threadtime`. */
	onLine = (raw: string): void => {
		const line = parseLine(raw);
		if (!line) return;
		let parsed;
		try {
			// The lab's own parser reads the payload as JSON, which it is only after the console's quoting (React Native's JS console, `'` as `\'` and `\` as `\\`) is undone; a bare line (one string argument) was not quoted.
			parsed = parseGestureLine(line.message.startsWith("'") ? unescapeLogcat(line.message) : line.message);
		} catch (error) {
			this.parseErrors.push(error instanceof Error ? error.message : String(error));
			return;
		}
		if (!parsed || parsed.event !== "ready") return;
		const { ready } = parsed;
		if (ready.drive !== "adb" || !ready.input) return;
		const key = `${ready.scenario}#${ready.round}#${ready.step}`;
		if (this.seen.has(key)) return;
		this.seen.add(key);
		this.chain = this.chain.then(() => this.inject(ready));
	};

	/** Everything asked for so far has been performed (or failed). */
	idle(): Promise<void> {
		return this.chain;
	}

	private async inject(ready: Ready): Promise<void> {
		const problems = aimProblems(ready);
		const entry: InjectionLog = { scenario: ready.scenario, round: ready.round, step: ready.step, stepName: ready.stepName, command: "", problems, error: null };
		this.log.push(entry);
		try {
			if (!ready.input) return;
			const commands = adbInputCommands(ready.input, ready.rects, ready.density);
			entry.command = commands.join("; ");
			this.say(`  ${ready.scenario} step ${ready.step + 1}/${ready.steps} (${ready.stepName}): ${entry.command}${problems.length > 0 ? `  [${problems.join("; ")}]` : ""}`);
			await this.run(commands.join("; "), inputDurationMs(ready.input) + 30_000);
		} catch (error) {
			entry.error = error instanceof Error ? error.message : String(error);
			this.say(`  ${ready.scenario} step ${ready.step + 1}: injection failed: ${entry.error}`);
		}
	}
}

export type LogcatTail = {
	/** Everything read so far. */
	text(): string;
	/** Resolves once a line matches `pattern` (anything already read counts), or false after `timeoutMs`. */
	until(pattern: RegExp, timeoutMs: number): Promise<boolean>;
	/** Stops reading; the text stays. */
	stop(): void;
};

/** `adb logcat -v threadtime` read as it comes, each whole line handed to `onLine`. */
export function tailLogcat(serial: string, onLine: (line: string) => void): LogcatTail {
	const child = spawn("adb", ["-s", serial, "logcat", "-v", "threadtime"], { stdio: ["ignore", "pipe", "pipe"] });
	const chunks: string[] = [];
	let pending = "";
	const watchers: { pattern: RegExp; resolve: (found: boolean) => void }[] = [];
	child.stdout.setEncoding("utf8");
	child.stdout.on("data", (chunk: string) => {
		chunks.push(chunk);
		const parts = (pending + chunk).split("\n");
		pending = parts.pop() ?? "";
		for (const part of parts) {
			onLine(part);
			for (const watcher of watchers.splice(0)) {
				if (watcher.pattern.test(part)) watcher.resolve(true);
				else watchers.push(watcher);
			}
		}
	});
	child.stderr.resume();
	const finish = () => { for (const watcher of watchers.splice(0)) watcher.resolve(false); };
	child.on("close", finish);
	child.on("error", finish);
	return {
		text: () => chunks.join(""),
		until(pattern, timeoutMs) {
			if (pattern.test(chunks.join(""))) return Promise.resolve(true);
			return new Promise((resolve) => {
				const watcher = { pattern, resolve: (found: boolean) => { clearTimeout(timer); resolve(found); } };
				const timer = setTimeout(() => {
					const index = watchers.indexOf(watcher);
					if (index >= 0) watchers.splice(index, 1);
					resolve(false);
				}, timeoutMs);
				watchers.push(watcher);
			});
		},
		stop() {
			child.kill("SIGTERM");
		},
	};
}

