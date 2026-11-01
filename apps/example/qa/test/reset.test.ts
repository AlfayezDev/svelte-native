import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { deviceRoles, type GatesFile } from "../lib/gates.ts";
import { assertMayClear, clearAppData } from "../lib/reset.ts";

const qaRoot = join(import.meta.dirname, "..");
const gates = JSON.parse(readFileSync(join(qaRoot, "gates.json"), "utf8")) as GatesFile;
const pkg = "io.rasheed.svelteqa";

/** A device that records every command it is given. */
function recorder(answer = "Success") {
	const commands: string[] = [];
	return { commands, shell: async (command: string) => { commands.push(command); return { stdout: answer, stderr: "" }; } };
}

describe("a phone is never cleared or uninstalled", () => {
	test("the roles come from gates.json: both phones are phones, the OVH emulator is the lab", () => {
		const roles = deviceRoles(gates, ["R58Y90KNGRP", "E74A5608-BF8E-5806-8699-1605F82ADED9", "localhost:5555", "unlisted"]);
		expect(roles).toEqual({ R58Y90KNGRP: "phone", "E74A5608-BF8E-5806-8699-1605F82ADED9": "phone", "localhost:5555": "lab", unlisted: null });
	});

	test("for a phone-role device nothing is sent: pm clear and uninstall are refused with a message that says why and what to do", async () => {
		for (const serial of ["R58Y90KNGRP", "E74A5608-BF8E-5806-8699-1605F82ADED9"]) {
			const role = deviceRoles(gates, [serial])[serial] ?? null;
			const device = recorder();
			await expect(clearAppData(device.shell, serial, role, pkg)).rejects.toThrow(`refusing to pm clear on ${serial}`);
			expect(device.commands).toEqual([]);
			expect(() => assertMayClear(serial, role, "uninstall")).toThrow("never cleared or uninstalled");
			expect(() => assertMayClear(serial, role, "pm clear")).toThrow("install -r");
		}
	});

	test("the lab emulator and an unlisted device may be cleared, with one command", async () => {
		for (const serial of ["localhost:5555", "unlisted"]) {
			const device = recorder();
			await clearAppData(device.shell, serial, deviceRoles(gates, [serial])[serial] ?? null, pkg);
			expect(device.commands).toEqual([`pm clear ${pkg}`]);
		}
	});

	test("a clear the device does not confirm is an error", async () => {
		await expect(clearAppData(recorder("Failed").shell, "localhost:5555", "lab", pkg)).rejects.toThrow("failed");
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
