import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { adbOk, shell } from "./adb.ts";
import type { ExecOptions } from "./exec.ts";
import { decodePng, type Image, type Rect } from "./png.ts";
import { outDir } from "./paths.ts";
import { slug } from "./runs.ts";
import type { DeviceRestart } from "./types.ts";
import { largestFontScale } from "./screens.ts";
import { parseHierarchy, type UiTree } from "./uia.ts";
import { sleep } from "./wait.ts";
import {
	parseAppLocales,
	parseDisplay,
	parseNightMode,
	parsePids,
	parseSetting,
	parseNavigationBarFrame, parseStatusBarFrame,
	type DisplayInfo,
} from "../parse/device-state.ts";

/** What the suites drive on a device: the screen they look at, the keys and taps they send, and the settings they flip. */

const dumpFile = "/sdcard/native-qa-dump.xml";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** One screenshot of the whole display (status bar and navigation bar included), decoded to RGBA. */
export function screenshot(serial: string): Promise<Image> {
	return new Promise((resolve, reject) => {
		const child = spawn("adb", ["-s", serial, "exec-out", "screencap", "-p"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const chunks: Buffer[] = [];
		const errors: Buffer[] = [];
		const deadline = setTimeout(() => child.kill("SIGTERM"), 30_000);
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
		child.on("error", (error) => {
			clearTimeout(deadline);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(deadline);
			const bytes = Buffer.concat(chunks);
			if (code !== 0 || !bytes.subarray(0, 4).equals(pngSignature)) {
				reject(
					new Error(
						`screencap on ${serial} failed (exit ${code}, ${bytes.length} bytes): ${Buffer.concat(errors).toString().trim().slice(0, 200)}`,
					),
				);
				return;
			}
			try {
				resolve(decodePng(bytes));
			} catch (error) {
				reject(error);
			}
		});
	});
}

/**
 * The accessibility tree of the foreground window, from `uiautomator dump` (the same node info a screen reader gets). The
 * file is removed first so a failed dump (`could not get idle state`) is never answered with the previous one.
 */
export async function dumpUi(
	serial: string,
	options: { important?: boolean } = {},
): Promise<UiTree> {
	let last = "";
	// `--compressed` drops the nodes a service that does not ask for flagIncludeNotImportantViews never receives: views that
	// are `importantForAccessibility=no` and everything under a `no-hide-descendants` view (uiautomator asks for all of them).
	const flags = options.important ? "--compressed " : "";
	for (let attempt = 1; attempt <= 5; attempt++) {
		const result = await shell(
			serial,
			`rm -f ${dumpFile}; uiautomator dump ${flags}${dumpFile} >/dev/null 2>&1; cat ${dumpFile}`,
			{ timeoutMs: 60_000 },
		);
		const start = result.stdout.indexOf("<?xml");
		if (start >= 0 && result.stdout.includes("</hierarchy>"))
			return parseHierarchy(result.stdout.slice(start));
		last = (result.stderr || result.stdout).trim().slice(0, 200);
		await sleep(600);
	}
	throw new Error(
		`uiautomator dump on ${serial} produced no tree after 5 attempts (${last || "no output"})`,
	);
}

export async function tap(serial: string, x: number, y: number): Promise<void> {
	await adbOk(serial, ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
}

export async function key(serial: string, name: string): Promise<void> {
	await adbOk(serial, ["shell", "input", "keyevent", name]);
}

export async function isRunning(serial: string, packageName: string): Promise<boolean> {
	return (await processIds(serial, packageName)).length > 0;
}

export async function processIds(serial: string, packageName: string): Promise<number[]> {
	const result = await shell(serial, `pidof ${packageName}`);
	return parsePids(result.stdout);
}

export async function readDisplay(serial: string): Promise<DisplayInfo> {
	const size = await adbOk(serial, ["shell", "wm", "size"]);
	const density = await adbOk(serial, ["shell", "wm", "density"]);
	return parseDisplay(size, density);
}

/** Whether an adb failure means the device is gone (offline, unplugged, tunnel down) rather than that one command failed. */
export function deviceGone(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /device offline|no devices\/emulators found|device '.*' not found|cannot connect|closed/.test(
		message,
	);
}

/** The status bar band of the display (its inset frame from the window manager), the region whose clock and icons vary. */
export async function statusBarRect(serial: string): Promise<Rect> {
	const result = await shell(serial, "dumpsys window", { timeoutMs: 60_000 });
	return parseStatusBarFrame(result.stdout);
}

/** The navigation bar's band: the gesture pill is drawn a level differently from one launch to the next, like the status bar's icons. */
export async function navigationBarRect(serial: string): Promise<Rect | null> {
	const result = await shell(serial, "dumpsys window", { timeoutMs: 60_000 });
	return parseNavigationBarFrame(result.stdout);
}

/** The foreground package and activity, from the window manager (`mCurrentFocus`). */
export async function focusedWindow(serial: string): Promise<string> {
	const result = await shell(serial, "dumpsys window | grep -m1 mCurrentFocus");
	return /mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/.exec(result.stdout)?.[1]?.trim() ?? "";
}

/* ---- device settings the suites change, and putting them back ---- */

/** One adb command for a device, returning its output or throwing. Tests hand a fake device in; the harness uses `adbOk`. */
export type AdbRun = (serial: string, args: string[], options?: ExecOptions) => Promise<string>;

const realAdb: AdbRun = (serial, args, options) => adbOk(serial, args, options);

export type DeviceState = {
	night: "yes" | "no" | "auto";
	fontScale: string | null;
	appLocales: string;
	accelerometerRotation: string | null;
	userRotation: string | null;
	proxy: string | null;
};

/**
 * The device is not in the state a case needs (a proxy or text size an earlier run left behind, a setting that did not take).
 * Every case after it would fail the same way, so a suite stops on it, restores the device and records it as the run's `aborted`.
 */
export class DeviceStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DeviceStateError";
	}
}

/** What a session found and could not do, for the run file: settings an earlier run left behind, and settings it could not put back. */
export type SessionNotes = { leftovers: string[]; restoreFailures: string[]; deviceRestarts: DeviceRestart[] };

export function newSessionNotes(): SessionNotes {
	return { leftovers: [], restoreFailures: [], deviceRestarts: [] };
}

/**
 * The identity of one boot of the device: `/proc/sys/kernel/random/boot_id` (a new UUID at every boot, readable by the adb shell),
 * else `getprop ro.boottime.init` (the nanoseconds of init's start, which differs at every boot). Null when neither is readable,
 * which turns the restart check off. A failure that is the device being gone is thrown, as it is for any other command.
 */
export async function readBootId(serial: string, run: AdbRun = realAdb): Promise<string | null> {
	let failure: unknown = null;
	try {
		const id = (await run(serial, ["shell", "cat", "/proc/sys/kernel/random/boot_id"])).trim();
		if (/^[0-9a-f-]{16,}$/i.test(id)) return id;
	} catch (error) {
		failure = error;
	}
	try {
		const id = (await run(serial, ["shell", "getprop", "ro.boottime.init"])).trim();
		if (/^\d+$/.test(id)) return `boottime-init-${id}`;
	} catch (error) {
		failure = error;
	}
	if (failure !== null && deviceGone(failure)) throw failure;
	return null;
}

async function setting(
	serial: string,
	namespace: string,
	name: string,
	run: AdbRun,
): Promise<string | null> {
	return parseSetting(await run(serial, ["shell", "settings", "get", namespace, name]));
}

async function writeSetting(
	serial: string,
	namespace: string,
	name: string,
	value: string | null,
	run: AdbRun,
): Promise<void> {
	if (value === null) await run(serial, ["shell", "settings", "delete", namespace, name]);
	else await run(serial, ["shell", "settings", "put", namespace, name, value]);
}

/** The state of the device as it is now, whatever put it there. */
export async function captureState(
	serial: string,
	packageName: string,
	run: AdbRun = realAdb,
): Promise<DeviceState> {
	return {
		night: parseNightMode(await run(serial, ["shell", "cmd", "uimode", "night"])),
		fontScale: await setting(serial, "system", "font_scale", run),
		appLocales: parseAppLocales(
			await run(serial, ["shell", "cmd", "locale", "get-app-locales", packageName]),
		),
		accelerometerRotation: await setting(serial, "system", "accelerometer_rotation", run),
		userRotation: await setting(serial, "system", "user_rotation", run),
		proxy: await setting(serial, "global", "http_proxy", run),
	};
}

/** The per-app languages the suites set (English for left-to-right, Arabic for right-to-left). */
const ltrLocale = "en-US";
const rtlLocale = "ar-SA";
export const harnessLocales: readonly string[] = [ltrLocale, rtlLocale];

/** The text sizes the suites set that no device has by default (1.0 is the default and cannot be told from it). */
const harnessFontScales: readonly number[] = [largestFontScale];

/** A proxy on this machine's loopback is one of the failing proxies of `openHoles`: no device is configured with one on purpose. */
const harnessProxy = /^(?:localhost|127\.0\.0\.1):\d+$/;

/**
 * The settings of a captured state that are the suites' own, left by a run that did not restore (killed, or the device lost),
 * and the state with them cleared, which is what the device is like without the harness. Not judged: the theme (a dark device is
 * indistinguishable from a dark theme the suite set, and every variant sets it anyway) and `accelerometer_rotation` (many devices
 * lock rotation themselves). Each leftover is a sentence for the warning and for the run file.
 */
export function harnessLeftovers(
	state: DeviceState,
	packageName: string,
): { state: DeviceState; leftovers: string[] } {
	const cleaned: DeviceState = { ...state };
	const leftovers: string[] = [];
	if (state.proxy !== null && harnessProxy.test(state.proxy)) {
		leftovers.push(
			`http_proxy was "${state.proxy}", the failing proxy of an earlier run that did not restore it: cleared`,
		);
		cleaned.proxy = null;
	}
	if (state.fontScale !== null && harnessFontScales.includes(Number(state.fontScale))) {
		leftovers.push(
			`font_scale was ${state.fontScale}, the text size of an earlier run that did not restore it: cleared`,
		);
		cleaned.fontScale = null;
	}
	if (harnessLocales.includes(state.appLocales)) {
		leftovers.push(
			`the app locales of ${packageName} were ${state.appLocales}, the language of an earlier run that did not restore it: cleared`,
		);
		cleaned.appLocales = "";
	}
	if (state.userRotation !== null && ["1", "2", "3"].includes(state.userRotation)) {
		leftovers.push(
			`user_rotation was ${state.userRotation}, the rotation of an earlier run that did not restore it: cleared`,
		);
		cleaned.userRotation = null;
	}
	return { state: cleaned, leftovers };
}

/** `captureState` with the harness's own leftovers taken out: the state the device is in apart from the harness, and what was taken out. */
export async function captureOriginal(
	serial: string,
	packageName: string,
	run: AdbRun = realAdb,
): Promise<{ original: DeviceState; leftovers: string[] }> {
	const { state, leftovers } = harnessLeftovers(await captureState(serial, packageName, run), packageName);
	return { original: state, leftovers };
}

async function setNight(serial: string, mode: DeviceState["night"], run: AdbRun): Promise<void> {
	await run(serial, ["shell", "cmd", "uimode", "night", mode]);
}

async function setAppLocales(
	serial: string,
	packageName: string,
	locales: string,
	run: AdbRun,
): Promise<void> {
	await run(serial, [
		"shell",
		"cmd",
		"locale",
		"set-app-locales",
		packageName,
		"--locales",
		locales || '""',
	]);
}

async function setProxy(serial: string, value: string | null, run: AdbRun): Promise<void> {
	if (value === null) {
		await run(serial, ["shell", "settings", "put", "global", "http_proxy", ":0"]);
		await run(serial, ["shell", "settings", "delete", "global", "http_proxy"]);
	} else {
		await run(serial, ["shell", "settings", "put", "global", "http_proxy", value]);
	}
}

/** The settings in which two captured states differ, as `name: was -> is`. */
export function stateDifferences(was: DeviceState, now: DeviceState): string[] {
	const names = Object.keys(was) as (keyof DeviceState)[];
	return names
		.filter((name) => was[name] !== now[name])
		.map((name) => `${name}: ${JSON.stringify(was[name])} -> ${JSON.stringify(now[name])}`);
}

/** Puts every setting the suites touch back to what it was. Each step runs even if another failed. */
export async function restoreState(
	serial: string,
	packageName: string,
	state: DeviceState,
	run: AdbRun = realAdb,
): Promise<string[]> {
	const failures: string[] = [];
	const attempt = async (name: string, step: () => Promise<unknown>) => {
		try {
			await step();
		} catch (error) {
			failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	await attempt("night mode", () => setNight(serial, state.night, run));
	await attempt("font_scale", () => writeSetting(serial, "system", "font_scale", state.fontScale, run));
	await attempt("app locales", () => setAppLocales(serial, packageName, state.appLocales, run));
	await attempt("accelerometer_rotation", () =>
		writeSetting(serial, "system", "accelerometer_rotation", state.accelerometerRotation, run),
	);
	await attempt("user_rotation", () =>
		writeSetting(serial, "system", "user_rotation", state.userRotation, run),
	);
	await attempt("http_proxy", () => setProxy(serial, state.proxy, run));
	return failures;
}

/* ---- a proxy that fails on purpose, for the loading and error states of the startup screen ---- */

export type NetworkMode = "normal" | "hang" | "refuse";

type Holes = { hang: number; refuse: number; server: Server; sockets: Set<Socket> };

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});
}

async function openHoles(serial: string, run: AdbRun): Promise<Holes> {
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("error", () => sockets.delete(socket));
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const hang = (server.address() as AddressInfo).port;
	const refuse = await freePort();
	await run(serial, ["reverse", `tcp:${hang}`, `tcp:${hang}`]);
	await run(serial, ["reverse", `tcp:${refuse}`, `tcp:${refuse}`]);
	return { hang, refuse, server, sockets };
}

async function closeHoles(serial: string, holes: Holes, run: AdbRun): Promise<void> {
	// A device that is gone has no reverse to remove: closing the sockets here is what is left to do.
	for (const port of [holes.hang, holes.refuse])
		await run(serial, ["reverse", "--remove", `tcp:${port}`]).catch(() => undefined);
	for (const socket of holes.sockets) socket.destroy();
	await new Promise<void>((resolve) => holes.server.close(() => resolve()));
}

export type Theme = "light" | "dark";
export type Direction = "ltr" | "rtl";

const stateFile = (serial: string, dir: string) => join(dir, `device-state-${slug(serial)}.json`);

export type SessionOptions = {
	/** The adb the session talks through; a fake device in tests. */
	run?: AdbRun;
	/** Where the state saved before the first change lives (qa/out). */
	stateDir?: string;
	/** Where a warning goes (`console.warn`). */
	warn?: (message: string) => void;
	/** Filled with what the session found and could not do, for the run file. */
	notes?: SessionNotes;
	/** How long a case's failure waits for a device that dropped off to come back before it is taken for gone (default 90 s). */
	deviceBackMs?: number;
	/** How often it looks while waiting (default 2 s). */
	devicePollMs?: number;
};

/** The settings the session has applied and so must put back when the device restarts: a fresh boot has the system's defaults. */
type Applied = { night?: "yes" | "no"; fontScale?: number; appLocales?: string; rotation?: 0 | 1 | 2 | 3 };

/**
 * Owns the settings one suite run changes. `open` first repairs what a killed earlier run left behind (the state it saved
 * before changing anything), then records the current state, less what is evidently an earlier run's (a proxy to a loopback
 * port, a text size or language only the suites set: warned about, cleared and noted, never taken for the device's own);
 * `close` restores it. Nothing else in the harness changes these settings, so the other agents' runs on the shared emulator
 * see the device as they left it.
 *
 * The device can restart under a long run (the emulator dies, a watchdog restarts it): a fresh boot has the system defaults, and
 * the reverse ports of the holes are gone. The session records the device's boot id at `open` (`readBootId`), compares it before
 * every case, after a failed one and in `close`, and when it changed re-applies and reads back every setting it manages
 * (`guarded`; the restart goes in `notes.deviceRestarts`).
 */
export class DeviceSession {
	private network: NetworkMode = "normal";
	private holes: Holes | null = null;
	private closed = false;
	private bootId: string | null;
	private readonly applied: Applied = {};
	private restarts = 0;
	private depth = 0;
	private readonly warn: (message: string) => void;
	private readonly deviceBackMs: number;
	private readonly devicePollMs: number;

	readonly serial: string;
	readonly packageName: string;
	readonly notes: SessionNotes;
	/** The adb the session's commands go through: the one it was opened with. */
	readonly run: AdbRun;
	private readonly original: DeviceState;
	private readonly stateDir: string;

	private constructor(
		serial: string,
		packageName: string,
		original: DeviceState,
		bootId: string | null,
		options: Required<Pick<SessionOptions, "run" | "stateDir" | "notes" | "warn" | "deviceBackMs" | "devicePollMs">>,
	) {
		this.serial = serial;
		this.packageName = packageName;
		this.original = original;
		this.run = options.run;
		this.stateDir = options.stateDir;
		this.notes = options.notes;
		this.bootId = bootId;
		this.warn = options.warn;
		this.deviceBackMs = options.deviceBackMs;
		this.devicePollMs = options.devicePollMs;
	}

	static async open(
		serial: string,
		packageName: string,
		options: SessionOptions = {},
	): Promise<DeviceSession> {
		const run = options.run ?? realAdb;
		const stateDir = options.stateDir ?? outDir;
		const warn = options.warn ?? ((message: string) => console.warn(message));
		const notes = options.notes ?? newSessionNotes();
		await mkdir(stateDir, { recursive: true });
		const bootId = await readBootId(serial, run);
		let saved: DeviceState | null = null;
		try {
			saved = JSON.parse(await readFile(stateFile(serial, stateDir), "utf8")) as DeviceState;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		if (saved) {
			console.log(`restoring the settings an interrupted run left on ${serial}`);
			const failures = await restoreState(serial, packageName, saved, run);
			if (failures.length) throw new Error(`could not repair ${serial}: ${failures.join("; ")}`);
			await rm(stateFile(serial, stateDir));
		}
		const { original, leftovers } = await captureOriginal(serial, packageName, run);
		if (leftovers.length > 0) {
			for (const leftover of leftovers) warn(`warning: ${serial}: ${leftover}`);
			const failures = await restoreState(serial, packageName, original, run);
			if (failures.length)
				throw new Error(`could not clear what an earlier run left on ${serial}: ${failures.join("; ")}`);
			notes.leftovers.push(...leftovers);
		}
		await writeFile(stateFile(serial, stateDir), `${JSON.stringify(original, null, "\t")}\n`);
		return new DeviceSession(serial, packageName, original, bootId, {
			run,
			stateDir,
			notes,
			warn,
			deviceBackMs: options.deviceBackMs ?? 90_000,
			devicePollMs: options.devicePollMs ?? 2_000,
		});
	}

	get originalState(): DeviceState {
		return this.original;
	}

	/**
	 * Restores everything, then removes the saved state. Safe to call twice. Throws if a setting could not be put back, after
	 * recording in `notes.restoreFailures` what could not be (the failures `restoreState` returns, the adb error that kept the
	 * result from being read, or the settings that differ): the device was then left in a changed state, and the run file says so.
	 * The saved state stays, so the next run repairs the device first.
	 */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		await this.noteRestartBeforeRestore();
		const failures = await restoreState(this.serial, this.packageName, this.original, this.run);
		if (this.holes) await closeHoles(this.serial, this.holes, this.run);
		this.holes = null;
		if (failures.length) {
			this.notes.restoreFailures.push(...failures);
			throw new Error(`could not restore ${this.serial}: ${failures.join("; ")}`);
		}
		let now: DeviceState;
		try {
			now = await captureState(this.serial, this.packageName, this.run);
		} catch (error) {
			this.notes.restoreFailures.push(
				`could not read ${this.serial} back: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
		const differing = stateDifferences(this.original, now);
		if (differing.length) {
			this.notes.restoreFailures.push(...differing);
			throw new Error(
				`${this.serial} is not back to its original settings after the restore: ${differing.join("; ")}`,
			);
		}
		await rm(stateFile(this.serial, this.stateDir), { force: true });
	}

	async theme(theme: Theme): Promise<void> {
		const night = theme === "dark" ? "yes" : "no";
		await setNight(this.serial, night, this.run);
		this.applied.night = night;
	}

	async fontScale(scale: number): Promise<void> {
		await writeSetting(this.serial, "system", "font_scale", scale.toFixed(2), this.run);
		this.applied.fontScale = scale;
	}

	/** Arabic (right-to-left) or English (left-to-right) for the app, through the per-app language the system keeps. */
	async direction(direction: Direction): Promise<void> {
		const locales = direction === "rtl" ? rtlLocale : ltrLocale;
		await setAppLocales(this.serial, this.packageName, locales, this.run);
		this.applied.appLocales = locales;
	}

	/** 0 portrait, 1 landscape (90 degrees), 2 reverse portrait, 3 reverse landscape; auto-rotate is switched off. */
	async rotation(rotation: 0 | 1 | 2 | 3): Promise<void> {
		await writeSetting(this.serial, "system", "accelerometer_rotation", "0", this.run);
		await writeSetting(this.serial, "system", "user_rotation", String(rotation), this.run);
		this.applied.rotation = rotation;
	}

	/** The proxy the current network mode means: a failing one on a port of the holes, or the device's own. */
	private expectedProxy(): string | null {
		return this.network === "normal" || this.holes === null
			? this.original.proxy
			: `localhost:${this.network === "hang" ? this.holes.hang : this.holes.refuse}`;
	}

	/** The device's boot id now; with `wait`, a device that dropped off is waited for (a restart takes a while) before its failure is thrown. */
	private async currentBootId(wait: boolean): Promise<string | null> {
		const deadline = Date.now() + this.deviceBackMs;
		for (;;) {
			try {
				return await readBootId(this.serial, this.run);
			} catch (error) {
				if (!wait || !deviceGone(error) || Date.now() >= deadline) throw error;
				await sleep(this.devicePollMs);
			}
		}
	}

	/** When the device booted: now less its uptime; the moment of noticing when the uptime cannot be read. */
	private async bootedAt(): Promise<string> {
		try {
			const uptime = Number.parseFloat((await this.run(this.serial, ["shell", "cat", "/proc/uptime"])).split(/\s+/)[0] ?? "");
			if (Number.isFinite(uptime) && uptime >= 0) return new Date(Date.now() - uptime * 1000).toISOString();
		} catch {
			// the time of noticing is the answer
		}
		return new Date().toISOString();
	}

	private async recordRestart(bootId: string, action: string): Promise<void> {
		const at = await this.bootedAt();
		this.bootId = bootId;
		this.restarts++;
		this.notes.deviceRestarts.push({ at, bootId });
		this.warn(`the device restarted at ${at} (boot id ${bootId}): ${action}`);
	}

	private async waitBooted(): Promise<void> {
		const deadline = Date.now() + this.deviceBackMs;
		for (;;) {
			try {
				if ((await this.run(this.serial, ["shell", "getprop", "sys.boot_completed"])).trim() === "1") return;
			} catch (error) {
				if (!deviceGone(error)) throw error;
			}
			if (Date.now() >= deadline)
				throw new DeviceStateError(`${this.serial} restarted and did not finish booting in ${this.deviceBackMs} ms`);
			await sleep(this.devicePollMs);
		}
	}

	/**
	 * Whether the device restarted since the last look (its boot id changed); if it did, records the restart and puts back every
	 * setting the session manages, then reads them back: a setting that reads differently is a `DeviceStateError`. The reverse
	 * ports of the holes died with the device and are made again (the host side still listens on the same ports).
	 */
	async checkRestart(options: { wait?: boolean } = {}): Promise<boolean> {
		if (this.bootId === null) return false;
		const now = await this.currentBootId(options.wait ?? false);
		if (now === null || now === this.bootId) return false;
		await this.recordRestart(now, "re-applying its settings");
		await this.waitBooted();
		await this.run(this.serial, ["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
		const { night, fontScale, appLocales, rotation } = this.applied;
		if (night !== undefined) await setNight(this.serial, night, this.run);
		if (fontScale !== undefined)
			await writeSetting(this.serial, "system", "font_scale", fontScale.toFixed(2), this.run);
		if (appLocales !== undefined) await setAppLocales(this.serial, this.packageName, appLocales, this.run);
		if (rotation !== undefined) await this.rotation(rotation);
		if (this.holes) {
			await this.run(this.serial, ["reverse", `tcp:${this.holes.hang}`, `tcp:${this.holes.hang}`]);
			await this.run(this.serial, ["reverse", `tcp:${this.holes.refuse}`, `tcp:${this.holes.refuse}`]);
		}
		const proxy = this.expectedProxy();
		if (proxy !== null || (await setting(this.serial, "global", "http_proxy", this.run)) !== null)
			await setProxy(this.serial, proxy, this.run);
		const state = await captureState(this.serial, this.packageName, this.run);
		const wrong: string[] = [];
		if (night !== undefined && state.night !== night) wrong.push(`night: "${night}" -> ${JSON.stringify(state.night)}`);
		if (fontScale !== undefined && Number(state.fontScale ?? 1) !== fontScale)
			wrong.push(`fontScale: ${fontScale.toFixed(2)} -> ${JSON.stringify(state.fontScale)}`);
		if (appLocales !== undefined && state.appLocales !== appLocales)
			wrong.push(`appLocales: ${JSON.stringify(appLocales)} -> ${JSON.stringify(state.appLocales)}`);
		if (rotation !== undefined && (state.accelerometerRotation !== "0" || state.userRotation !== String(rotation)))
			wrong.push(
				`rotation: ${rotation} -> accelerometer_rotation ${JSON.stringify(state.accelerometerRotation)}, user_rotation ${JSON.stringify(state.userRotation)}`,
			);
		if (state.proxy !== proxy) wrong.push(`proxy: ${JSON.stringify(proxy)} -> ${JSON.stringify(state.proxy)}`);
		if (wrong.length > 0)
			throw new DeviceStateError(
				`${this.serial} restarted and its settings read back differently after they were re-applied: ${wrong.join("; ")}`,
			);
		return true;
	}

	/**
	 * Runs one case (a launch, or the whole case): the device is checked for a restart first; a failure is checked again (the
	 * device may have restarted under the case, so it was lost or showed a fresh boot's settings), and when it had, the settings are
	 * back and the case is run once more. Inside another `guarded` only the first check applies: the outer one retries.
	 */
	async guarded<T>(body: () => Promise<T>, log: (message: string) => void = console.log): Promise<T> {
		if (this.depth > 0) {
			await this.checkRestart();
			return body();
		}
		this.depth++;
		try {
			await this.checkRestart();
			const before = this.restarts;
			try {
				return await body();
			} catch (error) {
				const restarted = await this.checkRestart({ wait: true }).catch((checkError: unknown) => {
					if (deviceGone(checkError)) return false;
					throw checkError;
				});
				if (!restarted && this.restarts === before) throw error;
				log("  the device restarted under the case: retrying it once");
				return await body();
			}
		} finally {
			this.depth--;
		}
	}

	/** At `close`: a restart is recorded, but nothing is re-applied: the restore is about to put the original settings back. */
	private async noteRestartBeforeRestore(): Promise<void> {
		if (this.bootId === null) return;
		try {
			const now = await this.currentBootId(false);
			if (now !== null && now !== this.bootId)
				await this.recordRestart(now, "restoring its original settings");
		} catch {
			// a device that is gone is what the restore reports
		}
	}

	/**
	 * Routes the app's HTTP(S) through a proxy that never answers (`hang`) or always refuses (`refuse`), or back to the real
	 * network, then reads the proxy back: an app launched on a device whose proxy is not the mode's would show a screen the
	 * case does not mean, so a mismatch is a `DeviceStateError` and the case is not launched. The read-back also runs when
	 * the mode is the one already set, which catches a proxy changed behind the session's back.
	 */
	async networkMode(mode: NetworkMode): Promise<void> {
		if (mode !== this.network) {
			if (mode === "normal") {
				await setProxy(this.serial, this.original.proxy, this.run);
			} else {
				this.holes ??= await openHoles(this.serial, this.run);
				await setProxy(
					this.serial,
					`localhost:${mode === "hang" ? this.holes.hang : this.holes.refuse}`,
					this.run,
				);
			}
			this.network = mode;
		}
		const expected =
			mode === "normal" || this.holes === null
				? this.original.proxy
				: `localhost:${mode === "hang" ? this.holes.hang : this.holes.refuse}`;
		const actual = await setting(this.serial, "global", "http_proxy", this.run);
		if (actual !== expected)
			throw new DeviceStateError(
				`the proxy on ${this.serial} is "${actual ?? "none"}" after switching to ${mode}`,
			);
	}

	/**
	 * How the device differs from what a case on the normal network at this text size needs (the original proxy, the text size
	 * the variant set), as phrases for the abort message; empty when it is what the case needs.
	 */
	async stateProblems(fontScale: number): Promise<string[]> {
		const problems: string[] = [];
		const proxy = await setting(this.serial, "global", "http_proxy", this.run);
		if (proxy !== this.original.proxy)
			problems.push(`http_proxy ${proxy ?? "none"} (expected ${this.original.proxy ?? "none"})`);
		const size = await setting(this.serial, "system", "font_scale", this.run);
		if (Number(size ?? 1) !== fontScale)
			problems.push(`font_scale ${size ?? "unset"} (expected ${fontScale.toFixed(2)})`);
		return problems;
	}
}

/**
 * Runs `body` with a session whose settings are restored when it returns, throws, or the process is interrupted. A restore
 * failure is reported on top of (never instead of) the body's own error; after a body that returned, it is logged and left
 * in `options.notes` for the run file rather than thrown, so the run's results are still written (see `reportRestore`).
 */
export async function withSession<T>(
	serial: string,
	packageName: string,
	body: (session: DeviceSession) => Promise<T>,
	options: SessionOptions = {},
): Promise<T> {
	const session = await DeviceSession.open(serial, packageName, options);
	const interrupted = (signal: NodeJS.Signals) => {
		console.error(`${signal}: restoring ${serial}`);
		session
			.close()
			.catch((error: unknown) =>
				console.error(error instanceof Error ? error.message : String(error)),
			)
			.finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
	};
	process.once("SIGINT", interrupted);
	process.once("SIGTERM", interrupted);
	let result: T;
	try {
		result = await body(session);
	} catch (error) {
		try {
			await session.close();
		} catch (restoreError) {
			console.error(restoreError instanceof Error ? restoreError.message : String(restoreError));
		}
		throw error;
	} finally {
		process.off("SIGINT", interrupted);
		process.off("SIGTERM", interrupted);
	}
	try {
		await session.close();
	} catch (restoreError) {
		console.error(restoreError instanceof Error ? restoreError.message : String(restoreError));
	}
	return result;
}

/** Whether a failure ends a suite: the device is gone, or it is not in the state the cases need. Both fail every case after. */
export function endsRun(error: unknown): boolean {
	return deviceGone(error) || error instanceof DeviceStateError;
}

/** Says, and sets the exit code, when a session could not put the device back: the run file records it, `report` warns and `gates` fails. */
export function reportRestore(notes: SessionNotes): void {
	if (notes.restoreFailures.length === 0) return;
	console.error(
		`the device was left in a changed state (${notes.restoreFailures.join("; ")}); the next run repairs it first`,
	);
	process.exitCode = 1;
}
