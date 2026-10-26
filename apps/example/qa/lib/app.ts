import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { appInfo, compileWithProfile, install } from "./adb.ts";
import { outDir } from "./paths.ts";
import type { ApkInfo, AppInfo, DeviceInfo } from "./types.ts";

export function defaultApkPath(abi: string): string {
	return join(outDir, `app-${abi}.apk`);
}

export async function describeApk(path: string): Promise<ApkInfo> {
	const bytes = await readFile(path);
	return {
		path,
		sizeBytes: (await stat(path)).size,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

export type AppChoice = { apk?: string; noInstall: boolean; packageName: string; dexopt?: "profile" | "none" };

/**
 * Puts the build under test on the device and describes what is installed. An explicit `--apk`
 * must exist; without one the build from `native-qa build` for the device's ABI is used if it is
 * there, otherwise the app already installed is measured as it is. After an install the app is
 * compiled against its baseline profile as a store install would be (`--dexopt none` skips that).
 */
export async function prepareApp(
	serial: string,
	device: DeviceInfo,
	choice: AppChoice,
): Promise<AppInfo> {
	let apk: ApkInfo | null = null;
	if (!choice.noInstall) {
		const path = choice.apk ? resolve(choice.apk) : defaultApkPath(device.abi);
		if (choice.apk && !(await exists(path))) throw new Error(`--apk ${path} does not exist`);
		if (await exists(path)) {
			apk = await describeApk(path);
			console.log(
				`installing ${path} (${(apk.sizeBytes / 1e6).toFixed(1)} MB, sha256 ${apk.sha256.slice(0, 12)})`,
			);
			await install(serial, path);
			if (choice.dexopt !== "none") console.log(`  ${await compileWithProfile(serial, choice.packageName)}`);
		} else {
			console.log(`no ${path}; measuring the app already installed on ${serial}`);
		}
	}
	return appInfo(serial, choice.packageName, apk);
}

/** `--dexopt profile` (default) compiles the installed app against its baseline profile; `none` leaves `adb install`'s verify-only state. */
export function dexoptFlag(value: string | boolean | undefined): "profile" | "none" {
	if (value === undefined || value === "profile") return "profile";
	if (value === "none") return "none";
	throw new Error(`--dexopt must be profile or none, not ${String(value)}`);
}
