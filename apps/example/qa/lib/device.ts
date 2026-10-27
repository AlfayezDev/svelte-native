import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { adb, adbOk, shell } from "./adb.ts";
import { decodePng, type Image, type Rect } from "./png.ts";
import { outDir } from "./paths.ts";
import { slug } from "./runs.ts";
import { parseHierarchy, type UiTree } from "./uia.ts";
import { sleep } from "./wait.ts";
import {
	parseAppLocales,
	parseDisplay,
	parseNightMode,
	parsePids,
	parseSetting,
	parseStatusBarFrame,
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

/** The foreground package and activity, from the window manager (`mCurrentFocus`). */
export async function focusedWindow(serial: string): Promise<string> {
	const result = await shell(serial, "dumpsys window | grep -m1 mCurrentFocus");
	return /mCurrentFocus=Window\{\S+ \S+ ([^}]+)\}/.exec(result.stdout)?.[1]?.trim() ?? "";
}

/* ---- device settings the suites change, and putting them back ---- */

export type DeviceState = {
	night: "yes" | "no" | "auto";
	fontScale: string | null;
	appLocales: string;
	accelerometerRotation: string | null;
	userRotation: string | null;
	proxy: string | null;
};

async function setting(serial: string, namespace: string, name: string): Promise<string | null> {
	return parseSetting(await adbOk(serial, ["shell", "settings", "get", namespace, name]));
}

async function writeSetting(
	serial: string,
	namespace: string,
	name: string,
	value: string | null,
): Promise<void> {
	if (value === null) await adbOk(serial, ["shell", "settings", "delete", namespace, name]);
	else await adbOk(serial, ["shell", "settings", "put", namespace, name, value]);
}

export async function captureState(serial: string, packageName: string): Promise<DeviceState> {
	return {
		night: parseNightMode(await adbOk(serial, ["shell", "cmd", "uimode", "night"])),
		fontScale: await setting(serial, "system", "font_scale"),
		appLocales: parseAppLocales(
			await adbOk(serial, ["shell", "cmd", "locale", "get-app-locales", packageName]),
		),
		accelerometerRotation: await setting(serial, "system", "accelerometer_rotation"),
		userRotation: await setting(serial, "system", "user_rotation"),
		proxy: await setting(serial, "global", "http_proxy"),
	};
}

async function setNight(serial: string, mode: DeviceState["night"]): Promise<void> {
	await adbOk(serial, ["shell", "cmd", "uimode", "night", mode]);
}

async function setAppLocales(serial: string, packageName: string, locales: string): Promise<void> {
	await adbOk(serial, [
		"shell",
		"cmd",
		"locale",
		"set-app-locales",
		packageName,
		"--locales",
		locales || '""',
	]);
}

async function setProxy(serial: string, value: string | null): Promise<void> {
	if (value === null) {
		await adbOk(serial, ["shell", "settings", "put", "global", "http_proxy", ":0"]);
		await adbOk(serial, ["shell", "settings", "delete", "global", "http_proxy"]);
	} else {
		await adbOk(serial, ["shell", "settings", "put", "global", "http_proxy", value]);
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
): Promise<string[]> {
	const failures: string[] = [];
	const attempt = async (name: string, run: () => Promise<unknown>) => {
		try {
			await run();
		} catch (error) {
			failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	await attempt("night mode", () => setNight(serial, state.night));
	await attempt("font_scale", () => writeSetting(serial, "system", "font_scale", state.fontScale));
	await attempt("app locales", () => setAppLocales(serial, packageName, state.appLocales));
	await attempt("accelerometer_rotation", () =>
		writeSetting(serial, "system", "accelerometer_rotation", state.accelerometerRotation),
	);
	await attempt("user_rotation", () =>
		writeSetting(serial, "system", "user_rotation", state.userRotation),
	);
	await attempt("http_proxy", () => setProxy(serial, state.proxy));
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

async function openHoles(serial: string): Promise<Holes> {
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
	await adbOk(serial, ["reverse", `tcp:${hang}`, `tcp:${hang}`]);
	await adbOk(serial, ["reverse", `tcp:${refuse}`, `tcp:${refuse}`]);
	return { hang, refuse, server, sockets };
}

async function closeHoles(serial: string, holes: Holes): Promise<void> {
	for (const port of [holes.hang, holes.refuse])
		await adb(serial, ["reverse", "--remove", `tcp:${port}`]);
	for (const socket of holes.sockets) socket.destroy();
	await new Promise<void>((resolve) => holes.server.close(() => resolve()));
}

export type Theme = "light" | "dark";
export type Direction = "ltr" | "rtl";

const stateFile = (serial: string) => join(outDir, `device-state-${slug(serial)}.json`);

/**
 * Owns the settings one suite run changes. `open` first repairs what a killed earlier run left behind (the state it saved
 * before changing anything), then records the current state; `close` restores it. Nothing else in the harness changes
 * these settings, so the other agents' runs on the shared emulator see the device as they left it.
 */
export class DeviceSession {
	private network: NetworkMode = "normal";
	private holes: Holes | null = null;
	private closed = false;

	readonly serial: string;
	readonly packageName: string;
	private readonly original: DeviceState;

	private constructor(serial: string, packageName: string, original: DeviceState) {
		this.serial = serial;
		this.packageName = packageName;
		this.original = original;
	}

	static async open(serial: string, packageName: string): Promise<DeviceSession> {
		await mkdir(outDir, { recursive: true });
		let leftover: DeviceState | null = null;
		try {
			leftover = JSON.parse(await readFile(stateFile(serial), "utf8")) as DeviceState;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
		}
		if (leftover) {
			console.log(`restoring the settings an interrupted run left on ${serial}`);
			const failures = await restoreState(serial, packageName, leftover);
			if (failures.length) throw new Error(`could not repair ${serial}: ${failures.join("; ")}`);
			await rm(stateFile(serial));
		}
		const original = await captureState(serial, packageName);
		await writeFile(stateFile(serial), `${JSON.stringify(original, null, "\t")}\n`);
		return new DeviceSession(serial, packageName, original);
	}

	get originalState(): DeviceState {
		return this.original;
	}

	/** Restores everything, then removes the saved state. Safe to call twice. Throws if a setting could not be put back. */
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		const failures = await restoreState(this.serial, this.packageName, this.original);
		if (this.holes) await closeHoles(this.serial, this.holes);
		this.holes = null;
		if (failures.length)
			throw new Error(`could not restore ${this.serial}: ${failures.join("; ")}`);
		const now = await captureState(this.serial, this.packageName);
		const differing = stateDifferences(this.original, now);
		if (differing.length)
			throw new Error(
				`${this.serial} is not back to its original settings after the restore: ${differing.join("; ")}`,
			);
		await rm(stateFile(this.serial), { force: true });
	}

	async theme(theme: Theme): Promise<void> {
		await setNight(this.serial, theme === "dark" ? "yes" : "no");
	}

	async fontScale(scale: number): Promise<void> {
		await writeSetting(this.serial, "system", "font_scale", scale.toFixed(2));
	}

	/** Arabic (right-to-left) or English (left-to-right) for the app, through the per-app language the system keeps. */
	async direction(direction: Direction): Promise<void> {
		await setAppLocales(this.serial, this.packageName, direction === "rtl" ? "ar-SA" : "en-US");
	}

	/** 0 portrait, 1 landscape (90 degrees), 2 reverse portrait, 3 reverse landscape; auto-rotate is switched off. */
	async rotation(rotation: 0 | 1 | 2 | 3): Promise<void> {
		await writeSetting(this.serial, "system", "accelerometer_rotation", "0");
		await writeSetting(this.serial, "system", "user_rotation", String(rotation));
	}

	/** Routes the app's HTTP(S) through a proxy that never answers (`hang`) or always refuses (`refuse`), or back to the real network. */
	async networkMode(mode: NetworkMode): Promise<void> {
		if (mode === this.network) return;
		if (mode === "normal") {
			await setProxy(this.serial, this.original.proxy);
		} else {
			this.holes ??= await openHoles(this.serial);
			await setProxy(
				this.serial,
				`localhost:${mode === "hang" ? this.holes.hang : this.holes.refuse}`,
			);
		}
		this.network = mode;
	}
}

/**
 * Runs `body` with a session whose settings are restored when it returns, throws, or the process is interrupted. A restore
 * failure is reported on top of (never instead of) the body's own error.
 */
export async function withSession<T>(
	serial: string,
	packageName: string,
	body: (session: DeviceSession) => Promise<T>,
): Promise<T> {
	const session = await DeviceSession.open(serial, packageName);
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
	await session.close();
	return result;
}
