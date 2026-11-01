import type { Role } from "./gates.ts";

/**
 * The only place the harness may clear an app's data or uninstall it. A `phone` in gates.json is a shared device: it takes
 * `adb install -r` and nothing that deletes the app's data or the app, whoever asks. Every destructive command goes through
 * `assertMayClear`, and `test/reset.test.ts` scans the harness's sources for any other emitter.
 */
export type Destructive = "pm clear" | "uninstall";

export function assertMayClear(serial: string, role: Role | null, action: Destructive): void {
	if (role === "phone")
		throw new Error(
			`refusing to ${action} on ${serial}: it is a phone in qa/gates.json, a shared device that only takes \`adb install -r\` and is never cleared or uninstalled. Reset the update state through the app instead (the QA app deletes its own updates directory and failed list when it starts with the reset flag; see qa/README.md, "updates")`,
		);
}

/** The check a command makes before it installs anything, when the run will have to clear the app. */
export function assertClearable(serial: string, role: Role | null): void {
	assertMayClear(serial, role, "pm clear");
}

type Shell = (command: string) => Promise<{ stdout: string; stderr: string }>;

/** `pm clear <package>` on a device that is not a phone; throws on a phone before sending anything. */
export async function clearAppData(shell: Shell, serial: string, role: Role | null, packageName: string): Promise<void> {
	assertMayClear(serial, role, "pm clear");
	const cleared = await shell(`pm clear ${packageName}`);
	if (!cleared.stdout.includes("Success")) throw new Error(`pm clear ${packageName} failed: ${cleared.stdout.trim()} ${cleared.stderr.trim()}`);
}

/**
 * The app-level reset (`QaReset.kt`): a token in the global setting the QA app reads when it starts. The first start that sees a token it
 * has not honoured forgets its downloaded updates and failed list before it picks a bundle. `settings put global` is something the
 * shell may do on any device, a shared phone included, and deletes nothing of the app's.
 */
export const qaResetSetting = "svelte_qa_reset_updates";

export type ResetMode = "app" | "data";

export function resetMode(value: string | boolean | undefined): ResetMode {
	if (value === undefined || value === "app") return "app";
	if (value === "data") return "data";
	throw new Error(`--reset must be app or data, not ${String(value)}`);
}

export const resetRequest = (token: string): string => {
	if (!/^[A-Za-z0-9._-]+$/.test(token)) throw new Error(`reset token ${JSON.stringify(token)} is not shell-safe`);
	return `settings put global ${qaResetSetting} ${token}`;
};
export const resetRelease = `settings delete global ${qaResetSetting}`;
