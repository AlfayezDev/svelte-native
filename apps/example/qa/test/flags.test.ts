import { describe, expect, test } from "bun:test";
import { integerFlag, parseFlags, requireString } from "../lib/flags.ts";
import { isEmulatorSerial, lockFor } from "../lib/lock.ts";

describe("flags", () => {
	test("parses string and boolean flags", () => {
		const { values } = parseFlags(["--device", "localhost:5555", "--no-install"], {
			device: { type: "string" },
			"no-install": { type: "boolean" },
		});
		expect(values.device).toBe("localhost:5555");
		expect(values["no-install"]).toBe(true);
	});
	test("an unknown flag is an error, not an ignored typo", () => {
		expect(() => parseFlags(["--devise", "x"], { device: { type: "string" } })).toThrow();
	});
	test("a required flag", () => {
		expect(requireString("x", "device")).toBe("x");
		expect(() => requireString(undefined, "device")).toThrow("--device is required");
	});
	test("integer flags", () => {
		expect(integerFlag("10", "warm", 30)).toBe(10);
		expect(integerFlag(undefined, "warm", 30)).toBe(30);
		expect(() => integerFlag("ten", "warm", 30)).toThrow("--warm must be a non-negative integer");
		expect(() => integerFlag("-1", "warm", 30)).toThrow();
	});
});

describe("emulator lock", () => {
	test("the tunnel and local emulators take the lock, a phone does not", () => {
		expect(isEmulatorSerial("localhost:5555")).toBe(true);
		expect(isEmulatorSerial("127.0.0.1:5555")).toBe(true);
		expect(isEmulatorSerial("emulator-5554")).toBe(true);
		expect(isEmulatorSerial("R5XXXXXXXXX")).toBe(false);
		expect(lockFor("localhost:5555")).toBe("/tmp/svelte-qa-emulator.lock");
		expect(lockFor("R5XXXXXXXXX")).toBeNull();
	});
});
