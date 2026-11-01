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

/** Dumps the screen's UI tree and taps the button; answers what it did. */
export async function pressButton(serial: string, request: PressRequest): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt++) {
		await shell(serial, "uiautomator dump /sdcard/foreign-ui.xml");
		const xml = await adbOk(serial, ["shell", "cat", "/sdcard/foreign-ui.xml"]);
		const at = findButton(xml, request.resourceId);
		if (at) {
			await shell(serial, `input tap ${at.x} ${at.y}`);
			return `pressed ${request.id} (${request.resourceId}) at ${at.x},${at.y}`;
		}
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
	return `no ${request.resourceId} on the screen for ${request.id}`;
}

/** Follows logcat while the lab runs and presses what it asks for; `stop` ends it and `errors` are the presses that found nothing. */
export function pressDriver(serial: string): { stop(): void; log: string[]; errors: string[] } {
	const log: string[] = [];
	const errors: string[] = [];
	const tail = tailLogcat(serial, (line) => {
		const request = parsePress(line);
		if (!request) return;
		void pressButton(serial, request).then((message) => {
			log.push(message);
			if (message.startsWith("no ")) errors.push(message);
		}, (error: unknown) => errors.push(`${request.id}: ${String(error)}`));
	});
	return { stop: () => tail.stop(), log, errors };
}
