import { adbOk, shell } from "./adb.ts";
import { parseLine } from "../parse/logcat.ts";
import { tailLogcat } from "./inject-android.ts";

/**
 * What the foreign lab asks of the harness when it needs a finger on a window of its own (SPEC.md, "Device verification of the libraries"): the date
 * dialog of `@react-native-community/datetimepicker` is a native dialog the page cannot press. The lab logs `[Svelte foreign press] {"id":..,"resourceId":..}`
 * (when it was opened with `drive:adb`) and waits for the effect; the harness dumps the screen's UI tree, finds the button by its resource id and taps it
 * with `adb shell input tap`, the real input pipeline.
 */

export type PressRequest = { id: string; resourceId: string };

const tag = "[Svelte foreign press]";

/** The request on a logcat line, or null for any other line. */
export function parsePress(line: string): PressRequest | null {
	const message = parseLine(line)?.message;
	if (!message?.startsWith(`'${tag}', '`)) return null;
	try {
		const value = JSON.parse(message.slice(`'${tag}', '`.length).replace(/'\s*$/, "")) as Partial<PressRequest>;
		return typeof value.id === "string" && typeof value.resourceId === "string" ? { id: value.id, resourceId: value.resourceId } : null;
	} catch {
		return null;
	}
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

/** The XML of the screen's UI tree now. */
async function dump(serial: string): Promise<string> {
	await shell(serial, "uiautomator dump /sdcard/foreign-ui.xml");
	return adbOk(serial, ["shell", "cat", "/sdcard/foreign-ui.xml"]);
}

/**
 * Taps the button and checks it went. A date dialog changes height while it settles (a month of five weeks, then of six), which moves its buttons by
 * more than a button's height between the dump and the tap, so a tap that did not close the dialog is made again at the button's new place.
 */
export async function pressButton(serial: string, request: PressRequest): Promise<string> {
	let last = "";
	for (let attempt = 0; attempt < 6; attempt++) {
		const at = findButton(await dump(serial), request.resourceId);
		if (!at) return attempt === 0 ? `no ${request.resourceId} on the screen for ${request.id}` : `pressed ${request.id} (${request.resourceId}) ${last}`;
		await shell(serial, `input tap ${at.x} ${at.y}`);
		last = `at ${at.x},${at.y} (try ${attempt + 1})`;
		await sleep(900);
	}
	return `no ${request.resourceId} on the screen went away for ${request.id}: still there after ${last}`;
}

/** Follows logcat while the lab runs and presses what it asks for, one at a time; `stop` ends it and `errors` are the presses that found nothing. */
export function pressDriver(serial: string): { stop(): void; log: string[]; errors: string[] } {
	const log: string[] = [];
	const errors: string[] = [];
	let chain: Promise<unknown> = Promise.resolve();
	const tail = tailLogcat(serial, (line) => {
		const request = parsePress(line);
		if (!request) return;
		chain = chain.then(() =>
			pressButton(serial, request).then((message) => {
				log.push(message);
				if (message.startsWith("no ")) errors.push(message);
			}, (error: unknown) => { errors.push(`${request.id}: ${String(error)}`); }),
		);
	});
	return { stop: () => tail.stop(), log, errors };
}
