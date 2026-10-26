import type { Rect } from "../lib/png.ts";

/** Parsers for the `adb shell` output the suites read to learn (and later restore) the device's settings. */

/** `settings get <namespace> <key>`: the value, or null when the key is unset (the tool prints the word `null`). */
export function parseSetting(stdout: string): string | null {
	const value = stdout.trim();
	return value === "" || value === "null" ? null : value;
}

/** `cmd uimode night`: `Night mode: yes`, `no` or `auto`. */
export function parseNightMode(stdout: string): "yes" | "no" | "auto" {
	const value = /Night mode:\s*(\w+)/i.exec(stdout)?.[1]?.toLowerCase();
	if (value === "yes" || value === "no" || value === "auto") return value;
	throw new Error(`unexpected \`cmd uimode night\` output: ${stdout.trim().slice(0, 120)}`);
}

/** `cmd locale get-app-locales <package>`: the per-app locale list, `""` when the app follows the system. */
export function parseAppLocales(stdout: string): string {
	const list = /are \[([^\]]*)\]/.exec(stdout)?.[1];
	if (list === undefined)
		throw new Error(
			`unexpected \`cmd locale get-app-locales\` output: ${stdout.trim().slice(0, 120)}`,
		);
	return list.trim();
}

export type DisplayInfo = {
	width: number;
	height: number;
	densityDpi: number;
};

/** `wm size` and `wm density` output joined: the physical (not the overridden) size and density. */
export function parseDisplay(size: string, density: string): DisplayInfo {
	const dimensions = /Physical size:\s*(\d+)x(\d+)/.exec(size);
	const dpi = /Physical density:\s*(\d+)/.exec(density)?.[1];
	if (!dimensions?.[1] || !dimensions[2] || dpi === undefined)
		throw new Error(
			`cannot read the display from \`wm size\` (${size.trim()}) and \`wm density\` (${density.trim()})`,
		);
	return { width: Number(dimensions[1]), height: Number(dimensions[2]), densityDpi: Number(dpi) };
}

/** `pidof <package>`: the process ids, empty when the app is not running. */
export function parsePids(stdout: string): number[] {
	return stdout
		.split(/\s+/)
		.filter((part) => /^\d+$/.test(part))
		.map(Number);
}

/** `dumpsys activity activities` configuration line: whether the resumed activity's configuration is right-to-left. */
export function parseLayoutDirection(stdout: string): "ltr" | "rtl" | null {
	const line = /CurrentConfiguration=\{[^}]*?\}|mGlobalConfig=\{[^\n]*/.exec(stdout)?.[0];
	if (!line) return null;
	return /\bldrtl\b/.test(line) ? "rtl" : "ltr";
}

/**
 * The device kind a reference set is frozen for: the platform, the Android release, what the device is (an emulator is
 * one kind, a phone is its model) and the physical display. Pixels differ across any of them.
 */
export function deviceKindName(parts: {
	platform: string;
	sdk: number | null;
	kind: "emulator" | "device";
	model: string;
	display: DisplayInfo;
}): string {
	const what = parts.kind === "emulator" ? "emulator" : parts.model.replace(/[^A-Za-z0-9]+/g, "-");
	return [
		parts.platform,
		parts.sdk === null ? "api-unknown" : `api${parts.sdk}`,
		what,
		`${parts.display.width}x${parts.display.height}`,
		`${parts.display.densityDpi}dpi`,
	].join("-");
}

/** `dumpsys window`: the `statusBars` inset source, `frame=[0,0][1080,128]`, as the band the clock and icons are drawn in. */
export function parseStatusBarFrame(stdout: string): Rect {
	const frame = /type=statusBars frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(stdout);
	if (!frame?.[1] || !frame[2] || !frame[3] || !frame[4])
		throw new Error("`dumpsys window` has no statusBars inset source");
	const [left, top, right, bottom] = [frame[1], frame[2], frame[3], frame[4]].map(Number) as [
		number,
		number,
		number,
		number,
	];
	return { x: left, y: top, width: right - left, height: bottom - top };
}
