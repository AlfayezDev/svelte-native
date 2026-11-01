import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { flagString, requireString } from "../flags.ts";
import { currentSource } from "../git.ts";
import { reexecUnderLock } from "../lock.ts";
import { outDir } from "../paths.ts";
import { iosBuildName, packageOf, processNameOf, type Variant } from "../variant.ts";
import type { AppInfo, BuildRecord, DeviceInfo, Source } from "../types.ts";
import { defaultHardwareUdid, startCrashWatch, type CrashWatch } from "./crash-reports.ts";
import { deviceDetails, installedApp, type IosTarget } from "./device.ts";
import { boundedWords, macFrom, remoteOk } from "./mac.ts";
import type { InstalledApp } from "../../parse/ios.ts";

/** The lock one run of the harness holds on the iPhone: two runs at once would fight over the app and its data container. */
export const iphoneLock = "/tmp/svelte-qa-iphone.lock";

/** The flags every iOS command takes (`--platform ios` itself is read first, in `platformOf`). */
export const iosOptions = {
	platform: { type: "string" },
	device: { type: "string" },
	/** The phone's hardware UDID (`idevice_id -l` on the Mac), which `xcodebuild` and the USB check name it by; `--device` is the CoreDevice id `devicectl` takes. */
	udid: { type: "string" },
	mac: { type: "string" },
	package: { type: "string" },
	app: { type: "string" },
	"no-install": { type: "boolean" },
} as const;

export type IosValues = {
	platform?: string | boolean | undefined;
	device?: string | boolean | undefined;
	udid?: string | boolean | undefined;
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
	/** The SHA-256 of `main.jsbundle` (`bundleSha256` is the name older records give it) and of the executable the app's Info.plist names (absent from older records). */
	bundleSha256: string;
	jsbundleSha256?: string;
	cdHash?: string;
	bundleBytes: number;
	logFile: string;
};

export function buildRecordOf(file: IosBuildFile): BuildRecord {
	return {
		commit: file.source.commit,
		dirty: file.source.dirty,
		jsbundleSha256: file.jsbundleSha256 ?? file.bundleSha256,
		cdHash: file.cdHash ?? null,
	};
}

export const iosBuildPathOf = (variant: Variant): string => join(outDir, iosBuildName(variant));
/** The QA app's record, which every command but the smoke test reads. */
export const iosBuildPath = iosBuildPathOf("qa");

export async function readIosBuild(variant: Variant = "qa"): Promise<IosBuildFile | null> {
	try {
		return JSON.parse(await readFile(iosBuildPathOf(variant), "utf8")) as IosBuildFile;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
		throw error;
	}
}

export async function writeIosBuild(build: IosBuildFile, variant: Variant = "qa"): Promise<void> {
	await mkdir(outDir, { recursive: true });
	await writeFile(iosBuildPathOf(variant), `${JSON.stringify(build, null, "\t")}\n`);
}

/** A text the launch URL carries and the app echoes into the files it writes, so a file can be told from an older launch's. */
export const newToken = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export type IosSession = {
	target: IosTarget;
	/** The hardware UDID (`--udid`, else the lab phone's, `defaultHardwareUdid`): what `xcodebuild` and the USB check name the phone by. */
	udid: string;
	device: DeviceInfo;
	installed: InstalledApp;
	/** What the app reported is not known yet: `installed` and `installedSha256` are filled in by the command from the files it reads (`withIdentity`). */
	app: AppInfo;
	/** The build the run is meant to measure, from `qa/out/ios-build.json`; null when there is no record of the app under test. */
	build: BuildRecord | null;
	/** The phone's crash log as it was when the command started: `finishCrashWatch` tells what the run added. */
	crashes: CrashWatch;
	startedAt: Date;
};

/** The bundle id a suite works on: `--package`, else the variant's own (the smoke app's is not the QA app's). */
export const suiteBundleId = (values: IosValues, variant: Variant): string => flagString(values.package) ?? packageOf[variant];

/**
 * What every iOS command does first: take the iPhone lock the way the emulator commands take theirs (re-running itself under
 * `flock`), find the phone through the Mac, install the build under test unless told not to, and describe the phone and the app.
 */
export async function startIosSuite(command: string, argv: string[], values: IosValues, variant: Variant = "qa"): Promise<IosSession> {
	reexecUnderLock(iphoneLock, [command, ...argv]);
	const id = requireString(values.device, "device");
	const mac = macFrom(flagString(values.mac));
	const bundleId = suiteBundleId(values, variant);
	const udid = flagString(values.udid) ?? defaultHardwareUdid;
	const target: IosTarget = { mac, id, bundleId };
	const startedAt = new Date();
	const device = await deviceDetails(target);
	const record = await readIosBuild(variant);
	const appPath = flagString(values.app) ?? record?.appPath;
	const installing = values["no-install"] !== true && appPath;
	if (installing) {
		console.log(`installing ${appPath} on ${device.model} (${id})`);
		await remoteOk(mac, boundedWords(590, ["xcrun", "devicectl", "device", "install", "app", "--device", id, appPath]), { timeoutMs: 600_000 });
	} else console.log(`no build to install; measuring the app already on ${id}`);
	// The record describes the app it names: another `--app` has none, so what that app reports is recorded and not compared.
	const build = record && (!installing || appPath === record.appPath) ? buildRecordOf(record) : null;
	if (record && !build) console.log(`${appPath} is not the app of qa/out/ios-build.json: the identity it reports is recorded, not compared`);
	const installed = await installedApp(target);
	const versionCode = installed.bundleVersion !== null ? Number(installed.bundleVersion) : Number.NaN;
	const app: AppInfo = {
		package: bundleId,
		versionName: installed.version,
		versionCode: Number.isFinite(versionCode) ? versionCode : null,
		lastUpdateTime: null,
		installedSha256: null,
		apk: null,
		installed: null,
		build,
	};
	console.log(`${device.model} (${id}), iOS ${device.osVersion}; app ${installed.version ?? "?"} (${installed.bundleVersion ?? "?"})`);
	// After the install, before anything runs: the reports that are on the phone now are not this run's.
	const crashes = await startCrashWatch({ mac, deviceId: id, bundleId, processName: processNameOf[variant] });
	if (crashes.known) console.log(`crash log of ${device.model}: ${crashes.known.size} report file(s) of ${crashes.processName} and jetsam events already on the phone (listed in ${((crashes.listedMs ?? 0) / 1000).toFixed(1)} s)`);
	else console.log(`warning: the crash log of ${device.model} cannot be read (${crashes.startError}); this run will say so and log.crashReports will read not measured`);
	return { target, udid, device, installed, app, build, crashes, startedAt };
}

export { currentSource };
