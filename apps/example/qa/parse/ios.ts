import type { BuildIdentity, DeviceInfo } from "../lib/types.ts";
import { parseBootBody, type BootMarks } from "./logcat.ts";

/** Parsers for what `xcrun devicectl` and the QA app write on iOS. */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(text: string, what: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`devicectl ${what} did not print JSON: ${text.trim().slice(0, 200)}`);
	}
	if (!isRecord(value)) throw new Error(`devicectl ${what} printed something other than an object`);
	return value;
}

function result(text: string, what: string): Record<string, unknown> {
	const root = parse(text, what);
	if (!isRecord(root.result)) throw new Error(`devicectl ${what} has no result: ${text.trim().slice(0, 200)}`);
	return root.result;
}

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const sha256 = /^[0-9a-f]{64}$/;

/** The `build` the app writes into its files: both digests, or null for an app that reports none (or not a whole identity). */
export function parseIdentity(value: unknown): BuildIdentity | null {
	if (!isRecord(value)) return null;
	const { jsbundleSha256, cdHash } = value;
	if (typeof jsbundleSha256 !== "string" || !sha256.test(jsbundleSha256)) return null;
	if (typeof cdHash !== "string" || !/^[0-9a-f]{40}$/.test(cdHash)) return null;
	return { jsbundleSha256, cdHash };
}

/** `devicectl list devices --json-output`: the device with the given identifier (or hardware UDID), as the report describes devices. */
export function parseDeviceDetails(text: string, id: string): DeviceInfo {
	const devices = result(text, "list devices").devices;
	if (!Array.isArray(devices)) throw new Error("devicectl list devices has no devices array");
	const device = devices.filter(isRecord).find((entry) => {
		const hardware = isRecord(entry.hardwareProperties) ? entry.hardwareProperties : {};
		return entry.identifier === id || hardware.udid === id;
	});
	if (!device) throw new Error(`devicectl does not list ${id}`);
	const hardware = isRecord(device.hardwareProperties) ? device.hardwareProperties : {};
	const properties = isRecord(device.deviceProperties) ? device.deviceProperties : {};
	const connection = isRecord(device.connectionProperties) ? device.connectionProperties : {};
	const tunnel = str(connection.tunnelState);
	if (tunnel !== null && tunnel === "unavailable") throw new Error(`${id} is unavailable (tunnel ${tunnel}): unlock the phone and check the cable`);
	return {
		serial: id,
		platform: "ios",
		kind: "device",
		model: str(hardware.marketingName) ?? str(hardware.productType) ?? "unknown",
		osVersion: str(properties.osVersionNumber) ?? "unknown",
		sdk: null,
		abi: "arm64",
		refreshHz: null,
	};
}

export type InstalledApp = {
	bundleId: string;
	name: string;
	version: string | null;
	bundleVersion: string | null;
	/** `file://` URL of the app's bundle directory on the phone: its processes run from under it. */
	bundleUrl: string | null;
};

/** `devicectl device info apps --bundle-id <id> --json-output`. */
export function parseInstalledApp(text: string, bundleId: string): InstalledApp {
	const apps = result(text, "info apps").apps;
	const app = Array.isArray(apps) ? apps.filter(isRecord).find((entry) => entry.bundleIdentifier === bundleId) : undefined;
	if (!app) throw new Error(`${bundleId} is not installed on the phone`);
	return {
		bundleId,
		name: str(app.name) ?? bundleId,
		version: str(app.version),
		bundleVersion: str(app.bundleVersion),
		bundleUrl: str(app.url),
	};
}

/** `devicectl device process launch --json-output`: the process id of the launched app. */
export function parseLaunch(text: string): { pid: number } {
	const process = result(text, "process launch").process;
	const pid = isRecord(process) ? process.processIdentifier : undefined;
	if (typeof pid !== "number") throw new Error(`devicectl process launch reported no process id: ${text.trim().slice(0, 200)}`);
	return { pid };
}

/** `devicectl device info processes --json-output`: the pids whose executable is inside the app's bundle. */
export function parseProcesses(text: string, bundleUrl: string | null): number[] {
	const processes = result(text, "info processes").runningProcesses;
	if (!Array.isArray(processes)) throw new Error("devicectl info processes has no runningProcesses array");
	if (bundleUrl === null) throw new Error("the installed app has no bundle URL to match processes against");
	const prefix = bundleUrl.endsWith("/") ? bundleUrl : `${bundleUrl}/`;
	return processes
		.filter(isRecord)
		.filter((entry) => typeof entry.executable === "string" && entry.executable.startsWith(prefix) && typeof entry.processIdentifier === "number")
		.map((entry) => entry.processIdentifier as number);
}

/** What the QA module writes to `Documents/boot-report.json` (`SvelteQAModule.swift`, `BootRecorder`). */
export type BootReport = {
	pid: number;
	processStartMs: number;
	launchedMs: number;
	contentAppearedMs: number;
	displayedMs: number;
	javaScript: string;
	/** `console.error` calls since the app's root layout ran; null for an app that does not count them. */
	jsErrors: number | null;
	build: BuildIdentity | null;
	osVersion: string;
};

export function parseBootReport(text: string): BootReport {
	const value = parse(text, "boot report");
	const numbers = ["pid", "processStartMs", "launchedMs", "contentAppearedMs", "displayedMs"] as const;
	for (const key of numbers) if (typeof value[key] !== "number") throw new Error(`the boot report has no numeric ${key}`);
	if (typeof value.javaScript !== "string") throw new Error("the boot report has no javaScript line");
	return {
		pid: value.pid as number,
		processStartMs: value.processStartMs as number,
		launchedMs: value.launchedMs as number,
		contentAppearedMs: value.contentAppearedMs as number,
		displayedMs: value.displayedMs as number,
		javaScript: value.javaScript,
		jsErrors: typeof value.jsErrors === "number" ? value.jsErrors : null,
		build: parseIdentity(value.build),
		osVersion: typeof value.osVersion === "string" ? value.osVersion : "unknown",
	};
}

export type IosLaunch = {
	/** Process start (kernel) to the frame that shows the first content, ms. */
	displayMs: number;
	/** Process start to React Native mounting the first content (`RCTContentDidAppearNotification`), ms. */
	contentMs: number;
	/** Process start to `application(_:didFinishLaunchingWithOptions:)`, ms. */
	launchedMs: number;
	jsMarks: BootMarks | null;
};

export function launchFromReport(report: BootReport): IosLaunch {
	return {
		displayMs: report.displayedMs - report.processStartMs,
		contentMs: report.contentAppearedMs - report.processStartMs,
		launchedMs: report.launchedMs - report.processStartMs,
		jsMarks: parseBootBody(report.javaScript),
	};
}
