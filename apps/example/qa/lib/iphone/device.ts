import { mkdir } from "node:fs/promises";
import { remote, remoteOk, scpFrom, words, type Mac } from "./mac.ts";
import type { ExecOptions } from "../exec.ts";
import type { DeviceInfo } from "../types.ts";
import { parseDeviceDetails, parseInstalledApp, parseLaunch, parseProcesses, type InstalledApp } from "../../parse/ios.ts";

/**
 * The iPhone as `xcrun devicectl` (on the Mac it is paired with) sees it: its details, the installed app, launching with a
 * payload URL and launch arguments, the app's data container. Nothing here installs a build or changes a setting of the phone.
 */

export type IosTarget = { mac: Mac; id: string; bundleId: string };

const scratch = "/tmp/native-qa-ios";
/**
 * The command, ended by the Mac itself after `limitSeconds` (`perl`'s `alarm`): ssh's timeout ends only this side, and a `devicectl` call that
 * hangs (they do, now and then, around a UI test) would go on holding the phone on the Mac, orphaned, with the next calls queued behind it.
 */
const devicectl = (args: readonly string[], limitSeconds: number): string => words(["perl", "-e", "alarm shift; exec @ARGV", String(limitSeconds), "xcrun", "devicectl", ...args]);
/** A little under the time ssh gives the call, so that the Mac ends it first and its words come back. */
const limitOf = (timeoutMs: number): number => Math.max(10, Math.floor(timeoutMs / 1000) - 5);

let counter = 0;
const unique = (name: string): string => `${scratch}/${name}-${process.pid}-${++counter}`;

/** Runs a devicectl command that writes JSON (`--json-output`, a global option: after a `--` it would be one of the app's arguments) and returns the text; a failure carries devicectl's own words. */
async function jsonCommand(target: IosTarget, args: string[], options: ExecOptions = {}): Promise<string> {
	const file = `${unique("out")}.json`;
	const result = await remote(
		target.mac,
		`mkdir -p ${scratch}; ${devicectl(["--json-output", file, ...args], limitOf(options.timeoutMs ?? 120_000))} > ${file}.log 2>&1; code=$?; if [ $code -ne 0 ]; then tail -n 6 ${file}.log >&2; fi; cat ${file} 2>/dev/null; rm -f ${file} ${file}.log; exit $code`,
		options,
	);
	if (result.code !== 0)
		throw new Error(`devicectl ${args.slice(0, 4).join(" ")} exited with ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
	return result.stdout;
}

export async function deviceDetails(target: IosTarget): Promise<DeviceInfo> {
	const text = await jsonCommand(target, ["list", "devices"], { timeoutMs: 60_000 });
	return parseDeviceDetails(text, target.id);
}

export async function installedApp(target: IosTarget): Promise<InstalledApp> {
	const text = await jsonCommand(target, ["device", "info", "apps", "--device", target.id, "--bundle-id", target.bundleId], { timeoutMs: 60_000 });
	return parseInstalledApp(text, target.bundleId);
}

/** Starts the app (after ending a running instance) and returns its process id. `args` follow the bundle id (after `--`) and reach the app as launch arguments. */
export async function launchApp(
	target: IosTarget,
	options: { payloadUrl?: string; args?: string[]; terminateExisting?: boolean } = {},
): Promise<{ pid: number }> {
	const args = [
		"device",
		"process",
		"launch",
		...(options.terminateExisting === false ? [] : ["--terminate-existing"]),
		"--device",
		target.id,
		...(options.payloadUrl ? ["--payload-url", options.payloadUrl] : []),
		target.bundleId,
		// devicectl reads a word that starts with a dash as one of its own options (`-AppleLanguages` became `-t`): after `--` the rest is the app's.
		...(options.args?.length ? ["--", ...options.args] : []),
	];
	return parseLaunch(await jsonCommand(target, args, { timeoutMs: 120_000 }));
}

export async function terminateApp(target: IosTarget, pid: number): Promise<void> {
	await jsonCommand(target, ["device", "process", "terminate", "--device", target.id, "--pid", String(pid)], { timeoutMs: 60_000 });
}

/** The pids of the app's processes: its executable lives under the app's bundle directory. */
export async function appProcesses(target: IosTarget, app: InstalledApp): Promise<number[]> {
	const text = await jsonCommand(target, ["device", "info", "processes", "--device", target.id], { timeoutMs: 60_000 });
	return parseProcesses(text, app.bundleUrl);
}

/** A file of the app's data container (`Documents/...`), as text; null when it is not there. */
export async function readAppFile(target: IosTarget, source: string): Promise<string | null> {
	const file = unique("copy");
	const result = await remote(
		target.mac,
		`mkdir -p ${scratch}; ${devicectl(["device", "copy", "from", "--device", target.id, "--domain-type", "appDataContainer", "--domain-identifier", target.bundleId, "--source", source, "--destination", file], limitOf(90_000))} > ${file}.log 2>&1; code=$?; if [ $code -eq 0 ]; then cat ${file}; fi; rm -rf ${file} ${file}.log; exit $code`,
		{ timeoutMs: 90_000 },
	);
	if (result.code === 0) return result.stdout;
	return null;
}

/**
 * Whether the phone answers `devicectl` at all (the cheapest call, `info lockState`, ended by the Mac after `limitSeconds`). Around a UI test CoreDevice
 * can stay wedged for many minutes: every other `devicectl` call then costs its whole limit, so a run asks once before it reads the phone.
 */
export async function phoneAnswers(target: IosTarget, limitSeconds = 25): Promise<boolean> {
	try {
		await jsonCommand(target, ["device", "info", "lockState", "--device", target.id], { timeoutMs: (limitSeconds + 5) * 1000 });
		return true;
	} catch {
		return false;
	}
}

/** The commands of one `afcclient` session (house_arrest into the app's container), one per line. */
export const afcSession = (commands: readonly string[]): string => `${commands.join("\n")}\nexit\n`;

/**
 * A file of the app's data container through house_arrest (`afcclient --container`, libimobiledevice on the Mac), which answers when CoreDevice is
 * wedged (the iOS campaign recovered a run's results this way). Text, or null when the file is not there or the Mac ended the call after
 * `limitSeconds`. The path is relative to the container, as `readAppFile`'s is.
 */
export async function readAppFileAfc(target: IosTarget, udid: string, source: string, limitSeconds = 30): Promise<string | null> {
	const directory = unique("afc");
	const session = afcSession([`get ${JSON.stringify(source)} out`]);
	const result = await remote(
		target.mac,
		`export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; mkdir -p ${directory} && cd ${directory} && printf %s ${words([session])} | ${words(["perl", "-e", "alarm shift; exec @ARGV", String(limitSeconds), "afcclient", "--udid", udid, "--container", target.bundleId])} > /dev/null 2>&1; code=1; if [ -f out ]; then cat out; code=0; fi; cd /; rm -rf ${directory}; exit $code`,
		{ timeoutMs: (limitSeconds + 15) * 1000 },
	);
	return result.code === 0 ? result.stdout : null;
}

/** Copies a file or directory of the app's data container to `destination` on this machine (a directory arrives as `<destination>/<name>`). */
export async function fetchAppPath(target: IosTarget, source: string, destination: string): Promise<void> {
	const staging = unique("fetch");
	await mkdir(destination, { recursive: true });
	await remoteOk(
		target.mac,
		`mkdir -p ${staging}; ${devicectl(["device", "copy", "from", "--device", target.id, "--domain-type", "appDataContainer", "--domain-identifier", target.bundleId, "--source", source, "--destination", staging], limitOf(300_000))} > ${staging}.log 2>&1 || { tail -n 6 ${staging}.log >&2; exit 1; }`,
		{ timeoutMs: 300_000 },
	);
	try {
		await scpFrom(target.mac, `${staging}/.`, destination, { timeoutMs: 300_000 });
	} finally {
		await remote(target.mac, `rm -rf ${staging} ${staging}.log`);
	}
}
