import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, requireString } from "../flags.ts";
import { currentSource } from "../git.ts";
import { reexecUnderLock } from "../lock.ts";
import { defaultPackage, outDir } from "../paths.ts";
import type { AppInfo, DeviceInfo, Source } from "../types.ts";
import { deviceDetails, installedApp, type IosTarget } from "./device.ts";
import { macFrom, remoteOk, words } from "./mac.ts";
import type { InstalledApp } from "../../parse/ios.ts";

/** The lock one run of the harness holds on the iPhone: two runs at once would fight over the app and its data container. */
export const iphoneLock = "/tmp/svelte-qa-iphone.lock";

/** The flags every iOS command takes (`--platform ios` itself is read first, in `platformOf`). */
export const iosOptions = {
	platform: { type: "string" },
	device: { type: "string" },
	mac: { type: "string" },
	package: { type: "string" },
	app: { type: "string" },
	"no-install": { type: "boolean" },
} as const;

export type IosValues = {
	platform?: string | boolean | undefined;
	device?: string | boolean | undefined;
	mac?: string | boolean | undefined;
	package?: string | boolean | undefined;
	app?: string | boolean | undefined;
	"no-install"?: string | boolean | undefined;
};

/** What `native-qa build --platform ios` leaves for the other commands: where the signed app is on the Mac, and what is in it. */
export type IosBuildFile = {
	schema: 1;
	kind: "ios-build";
	finishedAt: string;
	durationMs: number;
	source: Source;
	/** The Mac checkout the build ran in, and the signed `.app` inside its DerivedData. */
	macCheckout: string;
	appPath: string;
	bundleSha256: string;
	bundleBytes: number;
	logFile: string;
};

export const iosBuildPath = join(outDir, "ios-build.json");

export async function readIosBuild(): Promise<IosBuildFile | null> {
	try {
		return JSON.parse(await readFile(iosBuildPath, "utf8")) as IosBuildFile;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

export async function writeIosBuild(build: IosBuildFile): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(iosBuildPath, `${JSON.stringify(build, null, "\t")}\n`);
}

/** A text the launch URL carries and the app echoes into the files it writes, so a file can be told from an older launch's. */
export const newToken = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export type IosSession = {
	target: IosTarget;
	device: DeviceInfo;
	installed: InstalledApp;
	app: AppInfo;
	startedAt: Date;
};

/**
 * What every iOS command does first: take the iPhone lock the way the emulator commands take theirs (re-running itself under
 * `flock`), find the phone through the Mac, install the build under test unless told not to, and describe the phone and the app.
 */
export async function startIosSuite(command: string, argv: string[], values: IosValues): Promise<IosSession> {
	reexecUnderLock(iphoneLock, [command, ...argv]);
	const id = requireString(values.device, "device");
	const mac = macFrom(flagString(values.mac));
	const bundleId = flagString(values.package) ?? defaultPackage;
	const target: IosTarget = { mac, id, bundleId };
	const startedAt = new Date();
	const device = await deviceDetails(target);
	const build = await readIosBuild();
	const appPath = flagString(values.app) ?? build?.appPath;
	let installedSha: string | null = null;
	if (values["no-install"] !== true && appPath) {
		console.log(`installing ${appPath} on ${device.model} (${id})`);
		await remoteOk(mac, words(["xcrun", "devicectl", "device", "install", "app", "--device", id, appPath]), { timeoutMs: 600_000 });
		installedSha = build && build.appPath === appPath ? build.bundleSha256 : null;
	} else console.log(`no build to install; measuring the app already on ${id}`);
	const installed = await installedApp(target);
	const versionCode = installed.bundleVersion !== null ? Number(installed.bundleVersion) : Number.NaN;
	const app: AppInfo = {
		package: bundleId,
		versionName: installed.version,
		versionCode: Number.isFinite(versionCode) ? versionCode : null,
		lastUpdateTime: null,
		installedSha256: installedSha,
		apk: null,
	};
	console.log(`${device.model} (${id}), iOS ${device.osVersion}; app ${installed.version ?? "?"} (${installed.bundleVersion ?? "?"})`);
	return { target, device, installed, app, startedAt };
}

export { currentSource };
