import type { GatesFile, Role } from "./gates.ts";

/**
 * The only place the harness may clear an app's data or uninstall it, and default-deny: only a device positively identified as an
 * emulator whose role in gates.json is `lab` may be cleared. A `phone` is a shared device that takes `adb install -r` and nothing that
 * deletes the app's data or the app, whoever asks. Every destructive command goes through `assertMayClear`, and `test/reset.test.ts`
 * scans the harness's sources for any other emitter.
 */
export type Destructive = "pm clear" | "uninstall";

/** Who a device is, from what it says about itself, not only from the serial adb happens to reach it by (wireless debugging and port forwards give a phone an `ip:port` serial). */
export type Identity = {
	serial: string;
	role: Role | null;
	/** `ro.kernel.qemu` or `ro.boot.qemu` is 1. */
	emulator: boolean;
	/** `ro.serialno`, which gates.json lists phones by. */
	serialno: string | null;
};

export function identify(serial: string, props: Record<string, string>, gates: GatesFile): Identity {
	const serialno = props["ro.serialno"] || null;
	const roles = [gates.devices[serial]?.role ?? null, serialno ? (gates.devices[serialno]?.role ?? null) : null];
	// Listed as a phone under any name the device answers to, it is a phone.
	const role = roles.includes("phone") ? "phone" : (roles.find((candidate) => candidate !== null) ?? null);
	return { serial, role, emulator: props["ro.kernel.qemu"] === "1" || props["ro.boot.qemu"] === "1", serialno };
}

export function assertMayClear(identity: Identity, action: Destructive): void {
	const { serial, role } = identity;
	if (role === "phone")
		throw new Error(
			`refusing to ${action} on ${serial}: it is a phone in qa/gates.json, a shared device that only takes \`adb install -r\` and is never cleared or uninstalled. Reset the update state through the app instead (the QA app deletes its own updates directory and failed list when it starts with the reset flag; see qa/README.md, "updates")`,
		);
	if (!identity.emulator)
		throw new Error(`refusing to ${action} on ${serial}: it does not say it is an emulator (ro.kernel.qemu and ro.boot.qemu are not 1), and only an emulator may be cleared or uninstalled. Reset the update state through the app instead`);
	if (role !== "lab")
		throw new Error(`refusing to ${action} on ${serial}: it is not a lab device in qa/gates.json (role ${role ?? "none"}), and only a lab emulator may be cleared or uninstalled. Reset the update state through the app instead`);
}

/**
 * The example's production variant (`io.example.sveltenative.qaproduct`) is checked on the lab emulator only, and a shared phone carries apps
 * that are not the harness's (Example's `io.example.app` among them): the harness never installs, starts, clears or touches a product build there. Refuses a device that gates.json lists as a phone under any name it answers to. Checked from the
 * serial alone (`identify(serial, {}, gates)`) before the first adb command, and again from what the device says about itself.
 */
export function refusePhone(identity: Identity, what: string): void {
	if (identity.role === "phone")
		throw new Error(
			`refusing to ${what} on ${identity.serial}: it is a phone in qa/gates.json, a shared device on which the harness never installs or starts a product build. The product boot check is for the lab emulator (localhost:5555) only`,
		);
}

/** The product boot check puts the product on a device that says it is an emulator and that gates.json lists as the lab, and on no other. */
export function assertProductDevice(identity: Identity): void {
	const what = "install or start the product app";
	refusePhone(identity, what);
	if (!identity.emulator)
		throw new Error(`refusing to ${what} on ${identity.serial}: it does not say it is an emulator (ro.kernel.qemu and ro.boot.qemu are not 1)`);
	if (identity.role !== "lab")
		throw new Error(`refusing to ${what} on ${identity.serial}: it is not a lab device in qa/gates.json (role ${identity.role ?? "none"})`);
}

/** The check a command makes before it installs anything, when the run will have to clear the app. */
export function assertClearable(identity: Identity): void {
	assertMayClear(identity, "pm clear");
}

type Shell = (command: string) => Promise<{ stdout: string; stderr: string }>;

/** `pm clear <package>` on a lab emulator; throws on any other device before sending anything. */
export async function clearAppData(shell: Shell, identity: Identity, packageName: string): Promise<void> {
	assertMayClear(identity, "pm clear");
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
