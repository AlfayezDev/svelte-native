import { adbOk, shell } from "./adb.ts";
import { parseLine, quotedArgument } from "../parse/logcat.ts";
import { tailLogcat, type LogcatTail } from "./inject-android.ts";

/**
 * What the foreign lab asks of the harness when it needs a finger on a window of its own (SPEC.md, "Device verification of the libraries"): the date
 * dialog of `@react-native-community/datetimepicker` is a native dialog the page cannot press. The lab logs `[Svelte foreign press] {"id":..,"resourceId":..,"token":..}`
 * (when it was opened with `drive:adb`) and waits for the effect; the harness dumps the screen's UI tree, finds the button by its resource id and taps it
 * with `adb shell input tap`, the real input pipeline. The lab logs `[Svelte foreign press done] {"id":..,"token":..}` when it is no longer waiting (the dialog
 * answered, or the wait ran out): every dialog has an OK button with the resource id `android:id/button1`, so a harness that went on looking for it after its
 * own dialog ended would press the next dialog's, and this line is what ties a press to its dialog.
 */

/** [token] names the request across the two lines (it is unique to the launch, since the lab starts counting again at every launch); an app that sends none is pressed as before. */
export type PressRequest = { id: string; resourceId: string; token?: string };

const tag = "[Svelte foreign press]";
const doneTag = "[Svelte foreign press done]";

/** The JSON a lab line carries after [tag], or null when the line is another one or not JSON. */
function taggedValue(line: string, tag: string): Record<string, unknown> | null {
	const message = parseLine(line)?.message;
	const prefix = `'${tag}', '`;
	if (!message?.startsWith(prefix)) return null;
	try {
		const value: unknown = JSON.parse(quotedArgument(message, prefix));
		return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** The request on a logcat line, or null for any other line. */
export function parsePress(line: string): PressRequest | null {
	const value = taggedValue(line, tag);
	if (!value || typeof value.id !== "string" || typeof value.resourceId !== "string") return null;
	return typeof value.token === "string" ? { id: value.id, resourceId: value.resourceId, token: value.token } : { id: value.id, resourceId: value.resourceId };
}

/** The token of the request the lab has stopped waiting for, from its logcat line, or null for any other line. */
export function parsePressDone(line: string): string | null {
	const value = taggedValue(line, doneTag);
	return value && typeof value.token === "string" ? value.token : null;
}

/** The middle, in pixels, of the first node of a `uiautomator dump` whose `resource-id` is [resourceId]. */
export function findButton(xml: string, resourceId: string): { x: number; y: number } | null {
	for (const node of xml.matchAll(/<node\b[^>]*>/g)) {
		const text = node[0];
		if (!text.includes(`resource-id="${resourceId}"`)) continue;
		const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(text);
		if (!bounds) continue;
		const [left, top, right, bottom] = [Number(bounds[1]), Number(bounds[2]), Number(bounds[3]), Number(bounds[4])];
		if (right <= left || bottom <= top) continue;
		return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
	}
	return null;
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** The screen of a device as far as a press needs it: its UI tree, and a finger. */
export type Screen = { dump(): Promise<string>; tap(x: number, y: number): Promise<void> };

/** The screen of the device [serial], through `adb`. */
export function adbScreen(serial: string): Screen {
	return {
		async dump() {
			await shell(serial, "uiautomator dump /sdcard/foreign-ui.xml");
			return adbOk(serial, ["shell", "cat", "/sdcard/foreign-ui.xml"]);
		},
		async tap(x, y) {
			await shell(serial, `input tap ${x} ${y}`);
		},
	};
}

/** The presses the lab has stopped waiting for, by token, and whoever waits for one. */
export class Answered {
	private readonly done = new Set<string>();
	private readonly waiting = new Map<string, (() => void)[]>();

	mark(token: string): void {
		this.done.add(token);
		for (const wake of this.waiting.get(token) ?? []) wake();
		this.waiting.delete(token);
	}

	has(token: string | undefined): boolean {
		return token !== undefined && this.done.has(token);
	}

	/** True as soon as [token] is answered (at once when it already is), false after [milliseconds]. */
	wait(token: string, milliseconds: number): Promise<boolean> {
		if (this.done.has(token)) return Promise.resolve(true);
		return new Promise((resolve) => {
			const timer = setTimeout(() => resolve(false), milliseconds);
			const waiting = this.waiting.get(token) ?? [];
			waiting.push(() => { clearTimeout(timer); resolve(true); });
			this.waiting.set(token, waiting);
		});
	}
}

/** [settle]: how long a tap has to end the dialog before the harness looks again (the input takes seconds on an emulator); [afterTap]: the pause before that look for an app that says nothing. */
export type Timing = { settle: number; afterTap: number };
const defaultTiming: Timing = { settle: 3000, afterTap: 900 };

/**
 * Taps the button and waits for the lab to say the dialog is over. A date dialog changes height while it settles (a month of five weeks, then of six), which moves its buttons by
 * more than a button's height between the dump and the tap, so a tap that did not end the dialog is made again at the button's new place.
 *
 * The dialog is the one the request is about: the harness never taps after the lab said it was over (the next dialog has the same buttons, and the dump that sees it
 * can finish seconds late on a loaded emulator), and it does not look at the screen to see that its tap worked, which is a second dump that can overlap the next dialog.
 * An app that sends no token cannot say so, and is looked at again after a pause, as before.
 */
export async function pressButton(screen: Screen, request: PressRequest, answered: Answered = new Answered(), timing: Timing = defaultTiming): Promise<string> {
	const { token } = request;
	const over = `${request.id} (${request.resourceId}) was over before the harness pressed it`;
	let last = "";
	for (let attempt = 0; attempt < 6; attempt++) {
		if (answered.has(token)) return attempt === 0 ? over : `pressed ${request.id} (${request.resourceId}) ${last}`;
		const xml = await screen.dump();
		// The dump read the screen while the lab went on: the dialog it asked about may have ended meanwhile, and what the dump holds may be the next one.
		if (answered.has(token)) return attempt === 0 ? over : `pressed ${request.id} (${request.resourceId}) ${last}`;
		const at = findButton(xml, request.resourceId);
		if (!at) return attempt === 0 ? `no ${request.resourceId} on the screen for ${request.id}` : `pressed ${request.id} (${request.resourceId}) ${last}`;
		await screen.tap(at.x, at.y);
		last = `at ${at.x},${at.y} (try ${attempt + 1})`;
		if (token === undefined) await sleep(timing.afterTap);
		else if (await answered.wait(token, timing.settle)) return `pressed ${request.id} (${request.resourceId}) ${last}`;
	}
	return `no ${request.resourceId} on the screen went away for ${request.id}: still there after ${last}`;
}

export type PressDriverParts = { screen?: Screen; tail?: (onLine: (line: string) => void) => Pick<LogcatTail, "stop">; timing?: Timing };

/** Follows logcat while the lab runs and presses what it asks for, one at a time; `stop` ends it and `errors` are the presses that found nothing. */
export function pressDriver(serial: string, parts: PressDriverParts = {}): { stop(): void; idle(): Promise<unknown>; log: string[]; errors: string[] } {
	const log: string[] = [];
	const errors: string[] = [];
	const screen = parts.screen ?? adbScreen(serial);
	const answered = new Answered();
	let chain: Promise<unknown> = Promise.resolve();
	const onLine = (line: string) => {
		const done = parsePressDone(line);
		if (done !== null) {
			answered.mark(done);
			return;
		}
		const request = parsePress(line);
		if (!request) return;
		chain = chain.then(() =>
			pressButton(screen, request, answered, parts.timing).then((message) => {
				log.push(message);
				if (message.startsWith("no ")) errors.push(message);
			}, (error: unknown) => { errors.push(`${request.id}: ${String(error)}`); }),
		);
	};
	const tail = (parts.tail ?? ((handler) => tailLogcat(serial, handler)))(onLine);
	return { stop: () => tail.stop(), idle: () => chain, log, errors };
}
