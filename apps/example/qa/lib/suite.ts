import { assertOnline, deviceInfo, launchWithGestures } from "./adb.ts";
import { dexoptFlag, prepareApp } from "./app.ts";
import { flagString, requireString } from "./flags.ts";
import { lockFor, reexecUnderLock } from "./lock.ts";
import { defaultPackage } from "./paths.ts";
import type { AppInfo, DeviceInfo } from "./types.ts";

/** The flags every suite takes: which device, which build to install on it (or none), and `--gestures` (the gesture handler root installed at every launch, see `launchWithGestures`). */
export const commonOptions = {
	device: { type: "string" },
	apk: { type: "string" },
	"no-install": { type: "boolean" },
	dexopt: { type: "string" },
	package: { type: "string" },
	gestures: { type: "boolean" },
} as const;

export type CommonValues = {
	device?: string | boolean | undefined;
	apk?: string | boolean | undefined;
	"no-install"?: string | boolean | undefined;
	dexopt?: string | boolean | undefined;
	package?: string | boolean | undefined;
	gestures?: string | boolean | undefined;
};

export type SuiteDevice = {
	serial: string;
	packageName: string;
	device: DeviceInfo;
	app: AppInfo;
	startedAt: Date;
};

/**
 * What every suite does first: take the emulator lock the way `lab` and `boot` do (re-running itself under `flock`), check
 * the device is online, install the build under test as a store install would be, and describe the device and the app.
 */
export async function startSuite(
	command: string,
	argv: string[],
	values: CommonValues,
): Promise<SuiteDevice> {
	const serial = requireString(values.device, "device");
	const lock = lockFor(serial);
	if (lock) await reexecUnderLock(lock, [command, ...argv]);
	const packageName = flagString(values.package) ?? defaultPackage;
	launchWithGestures(values.gestures === true);
	if (values.gestures === true) console.log("gestures: the gesture handler root is installed at every launch (--gestures)");
	await assertOnline(serial);
	const startedAt = new Date();
	const device = await deviceInfo(serial);
	const app = await prepareApp(serial, device, {
		apk: flagString(values.apk),
		noInstall: values["no-install"] === true,
		packageName,
		dexopt: dexoptFlag(values.dexopt),
	});
	console.log(
		`${device.kind} ${device.model} (${serial}), Android ${device.osVersion}, ${device.abi}, ${device.refreshHz ?? "?"} Hz; app ${app.versionName} installed ${app.lastUpdateTime}`,
	);
	return { serial, packageName, device, app, startedAt };
}

export type BackendStatus = { ok: boolean; detail: string };

/**
 * Whether the dev backend the app configures itself from answers, asked from the machine running the suite. A screen that
 * only exists while it does (login) is skipped, not failed, when it does not; the skip says why.
 */
export async function backendStatus(): Promise<BackendStatus> {
	const base = process.env.EXPO_PUBLIC_API_URL ?? "https://dev.qarnos.com";
	const url = new URL("/api/configuration", base);
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
		return { ok: response.ok, detail: `${url.href} answered ${response.status}` };
	} catch (error) {
		return {
			ok: false,
			detail: `${url.href} unreachable: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
