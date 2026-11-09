import { spawn } from "node:child_process";
import { exec, execOk, shellQuote, type ExecOptions } from "./exec.ts";
import type { AppInfo, DeviceInfo } from "./types.ts";
import {
	parseBaseApkPath,
	parseDevices,
	parseGetprop,
	parsePackageDump,
	parseRefreshRate,
} from "../parse/adb.ts";

const adbBinary = "adb";

export function adb(serial: string, args: string[], options?: ExecOptions) {
	return exec(adbBinary, ["-s", serial, ...args], options);
}

export function adbOk(serial: string, args: string[], options?: ExecOptions) {
	return execOk(adbBinary, ["-s", serial, ...args], options);
}

/** Runs a command line on the device through its shell. */
export function shell(serial: string, command: string, options?: ExecOptions) {
	return adb(serial, ["shell", command], options);
}

export async function assertOnline(serial: string): Promise<void> {
	const devices = parseDevices(await execOk(adbBinary, ["devices"]));
	const device = devices.find((entry) => entry.serial === serial);
	if (!device)
		throw new Error(
			`${serial} is not in \`adb devices\` (${devices.map((entry) => entry.serial).join(", ") || "none"})`,
		);
	if (device.state !== "device") throw new Error(`${serial} is ${device.state}, not online`);
}

/** The system properties of a device (`getprop`). */
export async function deviceProps(serial: string): Promise<Record<string, string>> {
	return parseGetprop(await adbOk(serial, ["shell", "getprop"]));
}

export async function deviceInfo(serial: string): Promise<DeviceInfo> {
	const props = parseGetprop(await adbOk(serial, ["shell", "getprop"]));
	const sdk = Number(props["ro.build.version.sdk"]);
	const display = await adbOk(serial, ["shell", "dumpsys", "display"]);
	return {
		serial,
		platform: "android",
		kind: props["ro.kernel.qemu"] === "1" ? "emulator" : "device",
		model: props["ro.product.model"] ?? "unknown",
		osVersion: props["ro.build.version.release"] ?? "unknown",
		sdk: Number.isFinite(sdk) ? sdk : null,
		abi: props["ro.product.cpu.abi"] ?? "unknown",
		refreshHz: parseRefreshRate(display),
	};
}

async function installedSha256(serial: string, packageName: string): Promise<string | null> {
	const path = parseBaseApkPath(await adbOk(serial, ["shell", "pm", "path", packageName]));
	if (!path) return null;
	const digest = await adbOk(serial, ["shell", "sha256sum", path]);
	return /^([0-9a-f]{64})\s/.exec(digest)?.[1] ?? null;
}

export async function appInfo(
	serial: string,
	packageName: string,
	apk: AppInfo["apk"],
): Promise<AppInfo> {
	const dump = parsePackageDump(await adbOk(serial, ["shell", "dumpsys", "package", packageName]));
	return {
		package: packageName,
		...dump,
		installedSha256: await installedSha256(serial, packageName),
		apk,
	};
}

export async function install(serial: string, apkPath: string): Promise<void> {
	await adbOk(serial, ["install", "-r", apkPath], { timeoutMs: 300_000 });
}

/**
 * What a store install leaves behind: the APK's baseline profile installed and the app compiled against it
 * (`speed-profile`). `adb install` alone leaves the app at dexopt `verify`, interpreted until the JIT warms up, which is
 * not what ships. The broadcast is androidx.profileinstaller's explicit install (result 1 = installed, 2 = already
 * there); the compile is the install-time one a store does.
 */
export async function compileWithProfile(serial: string, packageName: string): Promise<string> {
	const receiver = `${packageName}/androidx.profileinstaller.ProfileInstallReceiver`;
	const broadcast = await shell(serial, `am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE -n ${receiver}`, {
		timeoutMs: 30_000,
	});
	const result = /result=(-?\d+)/.exec(broadcast.stdout)?.[1] ?? "?";
	await adbOk(serial, ["shell", "cmd", "package", "compile", "-m", "speed-profile", "-f", packageName], { timeoutMs: 600_000 });
	const state = await shell(serial, `dumpsys package ${packageName}`, { timeoutMs: 30_000 });
	const status = /\[status=([a-z-]+)\]/.exec(state.stdout)?.[1] ?? "?";
	return `profile install result ${result}, dexopt ${status}`;
}

export async function wake(serial: string): Promise<void> {
	await adbOk(serial, ["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
}

export async function forceStop(serial: string, packageName: string): Promise<void> {
	await adbOk(serial, ["shell", "am", "force-stop", packageName]);
}

export async function clearLogcat(serial: string): Promise<void> {
	await adbOk(serial, ["logcat", "-c"]);
}

export async function dumpLogcat(serial: string): Promise<string> {
	return adbOk(serial, ["logcat", "-d", "-v", "threadtime"], { timeoutMs: 120_000 });
}

/** `am start -W` for an explicit component or a deep link; returns the raw output. */
export async function startApp(
	serial: string,
	packageName: string,
	deepLink?: string,
): Promise<string> {
	return adbOk(serial, ["shell", amStartCommand(packageName, deepLink)], { timeoutMs: 90_000 });
}

let launchExtras = "";

/**
 * `--gestures` of `lab`, `parity`, `a11y` and `resilience`: every launch of the app from here on carries the intent extra
 * `svelteGestures`, which makes the engine install react-native-gesture-handler's root helper at start (SvelteEngineModule), as
 * the first gesture would, so the suites measure the engine with it in place and no page has to ask for it. A link with
 * `?gestures=1` does the same for one launch.
 */
export function launchWithGestures(on: boolean): void {
	launchExtras = on ? " --ez svelteGestures true" : "";
}

/** The `am start -W` command line of the app: a deep link, or its launcher activity. */
export function amStartCommand(packageName: string, deepLink?: string | null): string {
	return deepLink
		? `am start -W -a android.intent.action.VIEW -d ${shellQuote(deepLink)}${launchExtras} ${packageName}`
		: `am start -W -n ${packageName}/.MainActivity${launchExtras}`;
}

/** Puts the system Settings app in front, so the app under test is in the background when it is killed. */
export async function showSettings(serial: string): Promise<void> {
	await adbOk(serial, ["shell", "am", "start", "-W", "-a", "android.settings.SETTINGS"]);
}

export type LogcatStream = { text: string; matched: boolean };

/**
 * Follows `logcat -v threadtime` (replaying what is already buffered) until a line matches
 * `marker`, then keeps reading for `settleMs` more so the lines after the marker are kept.
 */
export function followLogcat(
	serial: string,
	marker: RegExp,
	timeoutMs: number,
	settleMs: number,
): Promise<LogcatStream> {
	return new Promise((resolve, reject) => {
		const child = spawn(adbBinary, ["-s", serial, "logcat", "-v", "threadtime"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const chunks: string[] = [];
		let pending = "";
		let matched = false;
		let finishing: NodeJS.Timeout | undefined;
		const deadline = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			chunks.push(chunk);
			const parts = (pending + chunk).split("\n");
			pending = parts.pop() ?? "";
			if (!matched && parts.some((line) => marker.test(line))) {
				matched = true;
				finishing = setTimeout(() => child.kill("SIGTERM"), settleMs);
			}
		});
		child.on("error", (error) => {
			clearTimeout(deadline);
			clearTimeout(finishing);
			reject(error);
		});
		child.on("close", () => {
			clearTimeout(deadline);
			clearTimeout(finishing);
			resolve({ text: chunks.join(""), matched });
		});
	});
}
