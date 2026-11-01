import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { deviceRoles, type GatesFile } from "../lib/gates.ts";
import { assertMayClear, clearAppData, identify, qaResetSetting, resetMode, resetRelease, resetRequest } from "../lib/reset.ts";

const qaRoot = join(import.meta.dirname, "..");
const gates = JSON.parse(readFileSync(join(qaRoot, "gates.json"), "utf8")) as GatesFile;
const pkg = "io.rasheed.svelteqa";

/** A device that records every command it is given. */
function recorder(answer = "Success") {
	const commands: string[] = [];
	return { commands, shell: async (command: string) => { commands.push(command); return { stdout: answer, stderr: "" }; } };
}

/** What a device says about itself. */
const emulatorProps = { "ro.kernel.qemu": "1", "ro.boot.qemu": "1", "ro.serialno": "EMULATOR31X1X1" };
const phoneProps = { "ro.serialno": "R58Y90KNGRP" };

describe("a phone is never cleared or uninstalled", () => {
	test("the roles come from gates.json: both phones are phones, the OVH emulator is the lab", () => {
		const roles = deviceRoles(gates, ["R58Y90KNGRP", "E74A5608-BF8E-5806-8699-1605F82ADED9", "localhost:5555", "unlisted"]);
		expect(roles).toEqual({ R58Y90KNGRP: "phone", "E74A5608-BF8E-5806-8699-1605F82ADED9": "phone", "localhost:5555": "lab", unlisted: null });
	});

	test("for a phone-role device nothing is sent: pm clear and uninstall are refused with a message that says why and what to do", async () => {
		for (const serial of ["R58Y90KNGRP", "E74A5608-BF8E-5806-8699-1605F82ADED9"]) {
			const identity = identify(serial, phoneProps, gates);
			const device = recorder();
			await expect(clearAppData(device.shell, identity, pkg)).rejects.toThrow(`refusing to pm clear on ${serial}`);
			expect(device.commands).toEqual([]);
			expect(() => assertMayClear(identity, "uninstall")).toThrow("never cleared or uninstalled");
			expect(() => assertMayClear(identity, "pm clear")).toThrow("install -r");
		}
	});

	test("a phone reached by a wireless-debugging or forwarded serial is still the phone: its serial number says so", async () => {
		for (const serial of ["192.168.1.40:41823", "localhost:5560", "adb-R58Y90KNGRP-AbCdEf._adb-tls-connect._tcp"]) {
			const identity = identify(serial, phoneProps, gates);
			expect(identity.role).toBe("phone");
			const device = recorder();
			await expect(clearAppData(device.shell, identity, pkg)).rejects.toThrow("is a phone");
			expect(device.commands).toEqual([]);
		}
	});

	test("default-deny: an emulator is cleared only when it says it is one and gates.json lists it as the lab", async () => {
		// The listed lab emulator, reached the way gates.json lists it.
		const lab = identify("localhost:5555", emulatorProps, gates);
		const device = recorder();
		await clearAppData(device.shell, lab, pkg);
		expect(device.commands).toEqual([`pm clear ${pkg}`]);
		// The same listed serial on a device that does not say it is an emulator (a phone behind a tunnel on that port).
		const forwarded = identify("localhost:5555", { "ro.serialno": "SOMETHINGELSE" }, gates);
		await expect(clearAppData(recorder().shell, forwarded, pkg)).rejects.toThrow("does not say it is an emulator");
		// A real emulator nobody listed, and a serial nobody knows.
		for (const identity of [identify("emulator-5554", emulatorProps, gates), identify("10.0.0.7:5555", {}, gates)]) {
			const unlisted = recorder();
			await expect(clearAppData(unlisted.shell, identity, pkg)).rejects.toThrow(/refusing to pm clear/);
			expect(unlisted.commands).toEqual([]);
		}
		expect(() => assertMayClear(identify("emulator-5554", emulatorProps, gates), "pm clear")).toThrow("not a lab device");
	});

	test("an emulator whose serial number is a listed phone is the phone", () => {
		expect(identify("localhost:5599", { ...emulatorProps, "ro.serialno": "R58Y90KNGRP" }, gates).role).toBe("phone");
	});

	test("a clear the device does not confirm is an error", async () => {
		await expect(clearAppData(recorder("Failed").shell, identify("localhost:5555", emulatorProps, gates), pkg)).rejects.toThrow("failed");
	});

	test("no other source of the harness can emit pm clear or an uninstall", () => {
		const offenders: string[] = [];
		const visit = (directory: string) => {
			for (const name of readdirSync(directory)) {
				const path = join(directory, name);
				if (statSync(path).isDirectory()) {
					if (!["node_modules", "out", "runs", "test", "screenshots"].includes(name)) visit(path);
				} else if (name.endsWith(".ts") && relative(qaRoot, path) !== join("lib", "reset.ts")) {
					const text = readFileSync(path, "utf8");
					if (/pm\s+clear|pm\s+uninstall|["'`]uninstall["'`]|adb\s+uninstall|\buninstall\s+-/.test(text)) offenders.push(relative(qaRoot, path));
				}
			}
		};
		visit(qaRoot);
		expect(offenders).toEqual([]);
	});
});

describe("the app-level reset, which a phone gets instead", () => {
	test("the request is one settings write and the release one settings delete: neither touches the app", () => {
		expect(resetRequest("qa-20261101T102000Z")).toBe(`settings put global ${qaResetSetting} qa-20261101T102000Z`);
		expect(resetRelease).toBe(`settings delete global ${qaResetSetting}`);
		for (const command of [resetRequest("qa-1"), resetRelease]) expect(/pm\s|uninstall|clear/.test(command)).toBe(false);
	});
	test("a token that is not shell-safe is refused, and the mode is app unless data is asked for", () => {
		expect(() => resetRequest("a; pm clear x")).toThrow("not shell-safe");
		expect(resetMode(undefined)).toBe("app");
		expect(resetMode("app")).toBe("app");
		expect(resetMode("data")).toBe("data");
		expect(() => resetMode("wipe")).toThrow("--reset must be app or data");
	});
	test("the flag the harness sets is the one the app reads (the decision itself is tested on the host, in packages/svelte-native/tests/updates-store-native.test.ts)", () => {
		const kotlin = readFileSync(join(qaRoot, "..", "modules", "svelte-updates", "android", "src", "main", "java", "expo", "modules", "svelteupdates", "QaReset.kt"), "utf8");
		expect(kotlin).toContain(`const val SETTING = "${qaResetSetting}"`);
	});
});
