import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Direction } from "../device.ts";
import { fetchAppPath, launchApp, readAppFile, terminateApp, appProcesses } from "./device.ts";
import type { IosSession } from "./session.ts";
import type { BuildIdentity } from "../types.ts";
import { sleep } from "../wait.ts";
import { parseIdentity } from "../../parse/ios.ts";

/** `Documents/capture/index.json` as `lib/native/dev/capture.ts` writes it (the type lives there too; the app's project is not part of this one). */
export type CaptureEntry = {
	name: string;
	screen: string;
	theme: "light" | "dark";
	rtl: boolean | null;
	png: string | null;
	a11y: string | null;
	uikit: string | null;
	width: number | null;
	height: number | null;
	scale: number | null;
	sha256: string | null;
	attempts: number | null;
	stable: boolean;
	moving: number[][];
	/** Frames (points) of the system's glass chrome. */
	glass?: number[][];
	/** Frames (points) of presented sheets' cards. */
	sheets?: number[][];
	error: string | null;
};
export type CaptureIndex = {
	schema: 1;
	token: string | null;
	/** What the app reports of its build; null for an app that does not. */
	build: BuildIdentity | null;
	startedAt: string;
	finishedAt: string | null;
	done: boolean;
	themes: ("light" | "dark")[];
	entries: CaptureEntry[];
	error: string | null;
};

export function parseCaptureIndex(text: string): CaptureIndex {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`capture/index.json is not JSON: ${text.slice(0, 160)}`);
	}
	const index = value as Partial<CaptureIndex> | null;
	if (!index || index.schema !== 1 || !Array.isArray(index.entries) || typeof index.done !== "boolean")
		throw new Error(`capture/index.json has an unexpected shape: ${text.slice(0, 160)}`);
	return { ...(index as CaptureIndex), build: parseIdentity(index.build) };
}

/** The index as far as it is readable: the app writes it while the harness copies it, and a copy can catch it empty or half written. */
export function tryParseCaptureIndex(text: string): CaptureIndex | null {
	try {
		return parseCaptureIndex(text);
	} catch {
		return null;
	}
}

/** What it takes to make the app start in right-to-left: the language of the launch (the app's own `Info.plist` lists Arabic). */
export const launchArguments: Record<Direction, string[]> = {
	ltr: [],
	rtl: ["-AppleLanguages", "(ar)", "-AppleLocale", "ar_SA"],
};

export type Captured = { index: CaptureIndex; dir: string };

const pollMs = 8000;

/**
 * Launches the lab in capture mode and brings back what it wrote: a screenshot and the accessibility dump of each screen in
 * each theme, for one layout direction. `dir` holds `index.json` and the files it names.
 */
export async function captureScreens(
	session: IosSession,
	options: { ids: string[]; themes: ("light" | "dark")[]; direction: Direction; dir: string; token: string; timeoutMs: number; log: (line: string) => void },
): Promise<Captured> {
	const { target } = session;
	const url = `expo-svelte-qa:///__dev?run=capture:${options.ids.join(".")}&themes=${options.themes.join(".")}&token=${options.token}`;
	const { pid } = await launchApp(target, { payloadUrl: url, args: launchArguments[options.direction] });
	const deadline = Date.now() + options.timeoutMs;
	let seen = -1;
	let done = false;
	let died: string | null = null;
	while (Date.now() < deadline && !done) {
		await sleep(pollMs);
		const text = await readAppFile(target, "Documents/capture/index.json");
		const index = text === null ? null : tryParseCaptureIndex(text);
		if (index) {
			if (index.token === options.token) {
				done = index.done;
				if (index.entries.length !== seen) {
					seen = index.entries.length;
					options.log(`  captured ${seen} of ${options.ids.length * options.themes.length}`);
				}
			}
		}
		if (!done && !(await appProcesses(target, session.installed)).includes(pid)) {
			died = `the app (pid ${pid}) exited before the capture finished`;
			break;
		}
	}
	if (died) throw new Error(died);
	if (!done) throw new Error(`the capture did not finish within ${options.timeoutMs / 1000} s`);
	// A copy of the directory can fail or catch a file empty (devicectl's file service drops its connection now and then): try again.
	let fetched: Captured | null = null;
	let fault = "";
	for (let attempt = 1; attempt <= 3 && !fetched; attempt++) {
		try {
			await rm(options.dir, { recursive: true, force: true });
			await mkdir(options.dir, { recursive: true });
			await fetchAppPath(target, "Documents/capture", options.dir);
			const root = await captureRoot(options.dir);
			const index = parseCaptureIndex(await readFile(join(root, "index.json"), "utf8"));
			if (index.token !== options.token) throw new Error("the capture directory fetched from the phone belongs to another launch");
			fetched = { index, dir: root };
		} catch (cause) {
			fault = cause instanceof Error ? cause.message : String(cause);
			options.log(`  fetching the capture failed (${fault}); ${attempt < 3 ? "trying again" : "giving up"}`);
			await sleep(2000);
		}
	}
	try {
		await terminateApp(target, pid);
	} catch {
		// The capture ended the lab's work; the app may already be gone.
	}
	if (!fetched) throw new Error(fault);
	return fetched;
}

/** `devicectl device copy from` puts a directory either directly in the destination or inside a directory of its name. */
async function captureRoot(dir: string): Promise<string> {
	const names = await readdir(dir);
	if (names.includes("index.json")) return dir;
	if (names.includes("capture")) return join(dir, "capture");
	throw new Error(`no index.json in what was fetched from the phone (${names.join(", ") || "nothing"})`);
}
