import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DeviceSession,
	DeviceStateError,
	endsRun,
	newSessionNotes,
	withSession,
	type SessionOptions,
} from "../lib/device.ts";
import {
	assertDeviceState,
	guardAnchorFailure,
	launchCase,
	NodeNotFoundError,
	retryCase,
} from "../lib/drive.ts";
import { cases, type ScreenCase } from "../lib/screens.ts";
import { FakeDevice } from "./fake-device.ts";

const normalScreen = cases.find((entry) => entry.network === "normal") as ScreenCase;
const hangScreen = cases.find((entry) => entry.network === "hang") as ScreenCase;

async function withDevice<T>(
	device: FakeDevice,
	body: (setup: { options: SessionOptions; warnings: string[]; dir: string }) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "native-qa-session-"));
	const warnings: string[] = [];
	try {
		return await body({
			options: { run: device.run, stateDir: dir, warn: (message) => warnings.push(message), notes: newSessionNotes() },
			warnings,
			dir,
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** The way a command sees a device that is lost while it runs: the errors go to the log, not the test output. */
async function quietly<T>(body: () => Promise<T>): Promise<T> {
	const error = console.error;
	console.error = () => undefined;
	try {
		return await body();
	} finally {
		console.error = error;
	}
}

describe("a session open on a device an earlier run did not restore", () => {
	test("a proxy to a loopback port is the harness's own: warned about naming it, cleared, and never the original", async () => {
		const device = new FakeDevice();
		device.set("global/http_proxy", "localhost:33699");
		await withDevice(device, async ({ options, warnings, dir }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			expect(session.originalState.proxy).toBeNull();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("http_proxy was \"localhost:33699\"");
			expect(warnings[0]).toContain(device.serial);
			expect(device.get("global/http_proxy")).toBeNull();
			expect(options.notes?.leftovers).toHaveLength(1);
			const saved = JSON.parse(await readFile(join(dir, "device-state-localhost_5555.json"), "utf8"));
			expect(saved.proxy).toBeNull();
			await session.close();
			expect(device.get("global/http_proxy")).toBeNull();
		});
	});

	test("127.0.0.1 counts, and a proxy that is not on this machine is the device's own and comes back on close", async () => {
		const loopback = new FakeDevice();
		loopback.set("global/http_proxy", "127.0.0.1:8081");
		await withDevice(loopback, async ({ options }) => {
			const session = await DeviceSession.open(loopback.serial, loopback.packageName, options);
			expect(session.originalState.proxy).toBeNull();
			await session.close();
		});
		const corporate = new FakeDevice();
		corporate.set("global/http_proxy", "proxy.corp:3128");
		await withDevice(corporate, async ({ options, warnings }) => {
			const session = await DeviceSession.open(corporate.serial, corporate.packageName, options);
			expect(session.originalState.proxy).toBe("proxy.corp:3128");
			expect(warnings).toEqual([]);
			await session.networkMode("hang");
			await session.close();
			expect(corporate.get("global/http_proxy")).toBe("proxy.corp:3128");
		});
	});

	test("the text size, the app language and the rotation the suites set are leftovers too, each named in the run file", async () => {
		const device = new FakeDevice();
		device.set("system/font_scale", "2.00");
		device.set("system/user_rotation", "1");
		device.locales = "ar-SA";
		await withDevice(device, async ({ options, warnings }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			expect(session.originalState).toEqual({
				night: "no",
				fontScale: null,
				appLocales: "",
				accelerometerRotation: null,
				userRotation: null,
				proxy: null,
			});
			expect(warnings).toHaveLength(3);
			const leftovers = options.notes?.leftovers ?? [];
			expect(leftovers.map((line) => line.split(" ")[0])).toEqual(["font_scale", "the", "user_rotation"]);
			expect(leftovers[0]).toContain("font_scale was 2.00");
			expect(device.get("system/font_scale")).toBeNull();
			expect(device.locales).toBe("");
			expect(device.get("system/user_rotation")).toBeNull();
			await session.close();
		});
	});

	test("a clean device has nothing to warn about, and the device's own text size of 1.0 is kept", async () => {
		const device = new FakeDevice();
		device.set("system/font_scale", "1.0");
		await withDevice(device, async ({ options, warnings }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			expect(warnings).toEqual([]);
			expect(options.notes?.leftovers).toEqual([]);
			expect(session.originalState.fontScale).toBe("1.0");
			await session.close();
		});
	});
});

describe("the network mode is read back", () => {
	test("a proxy that took is the mode, and the device's proxy comes back with normal", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			await session.networkMode("hang");
			expect(device.get("global/http_proxy")).toMatch(/^localhost:\d+$/);
			await session.networkMode("refuse");
			await session.networkMode("normal");
			expect(device.get("global/http_proxy")).toBeNull();
			await session.close();
		});
	});

	test("a proxy that did not take is an error naming what the device holds, before anything is launched", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			device.ignoreProxyWrites = true;
			await expect(session.networkMode("hang")).rejects.toThrow(
				'the proxy on localhost:5555 is "none" after switching to hang',
			);
			await expect(launchCase(session, hangScreen, "ltr")).rejects.toThrow("after switching to hang");
			expect(device.commands("am start")).toEqual([]);
			expect(device.commands("force-stop")).toEqual([]);
			device.ignoreProxyWrites = false;
			await session.close();
		});
	});

	test("a proxy changed behind the session's back is found before the next case, even in the mode already set", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			await session.networkMode("normal");
			device.set("global/http_proxy", "localhost:1");
			const error = await session.networkMode("normal").catch((caught: unknown) => caught);
			expect(error instanceof DeviceStateError).toBe(true);
			expect((error as Error).message).toBe('the proxy on localhost:5555 is "localhost:1" after switching to normal');
			expect(endsRun(error)).toBe(true);
			await expect(launchCase(session, normalScreen, "ltr")).rejects.toThrow("after switching to normal");
			expect(device.commands("am start")).toEqual([]);
			await session.close();
		});
	});

	test("with the right proxy the case is launched: the old process killed and the screen opened in one call", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			await launchCase(session, normalScreen, "ltr");
			expect(device.commands("am start")).toHaveLength(1);
			expect(device.commands("am force-stop io.rasheed.svelteqa")).toHaveLength(1);
			await session.close();
		});
	});
});

describe("a case that pushes its screen onto the one the launch link opened", () => {
	test("an `open` step is a second link into the running app: no force-stop, the same package, the link given", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			const pushed: ScreenCase = {
				...normalScreen,
				deepLink: "rasheed-svelte:///__dev/screens",
				steps: [{ open: "rasheed-svelte:///__dev/screens?mode=toolbar" }],
			};
			await launchCase(session, pushed, "ltr");
			const starts = device.commands("am start");
			expect(starts).toHaveLength(2);
			expect(starts[0]).toContain("force-stop io.rasheed.svelteqa; sleep 0.3; am start -W -a android.intent.action.VIEW -d 'rasheed-svelte:///__dev/screens' io.rasheed.svelteqa");
			expect(starts[1]).toContain("-d 'rasheed-svelte:///__dev/screens?mode=toolbar' io.rasheed.svelteqa");
			expect(starts[1]).not.toContain("force-stop");
			expect(device.commands("force-stop")).toHaveLength(1);
			await session.close();
		});
	});
});

describe("a case that does not show its anchor", () => {
	test("on the normal network, a proxy or text size the case does not need is the cause, named with what it needed", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			await session.fontScale(1);
			await assertDeviceState(session, normalScreen, 1);
			device.set("global/http_proxy", "localhost:33699");
			await expect(assertDeviceState(session, normalScreen, 1)).rejects.toThrow(
				"the device is not in the state the case needs: http_proxy localhost:33699 (expected none)",
			);
			device.set("system/font_scale", "2.00");
			const error = await assertDeviceState(session, normalScreen, 1).catch((caught: unknown) => caught);
			expect((error as Error).message).toContain(
				"http_proxy localhost:33699 (expected none), font_scale 2.00 (expected 1.00)",
			);
			device.set("global/http_proxy", null);
			await expect(assertDeviceState(session, normalScreen, 1)).rejects.toThrow("font_scale 2.00 (expected 1.00)");
			await assertDeviceState(session, normalScreen, 2);
			await session.close();
		});
	});

	test("an unset text size is 1.0, and a case on a failing proxy is not asked: its proxy is meant to be one", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			await assertDeviceState(session, normalScreen, 1);
			device.set("global/http_proxy", "localhost:33699");
			const before = device.log.length;
			await assertDeviceState(session, hangScreen, 1);
			expect(device.log).toHaveLength(before);
			await session.close();
		});
	});

	test("only a missing anchor sends the case to the device: any other failure is left to the caller", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			device.set("global/http_proxy", "localhost:33699");
			await guardAnchorFailure(session, normalScreen, 1, new Error("uiautomator dump produced no tree"));
			await expect(
				guardAnchorFailure(session, normalScreen, 1, new NodeNotFoundError("no node on screen after 15000 ms")),
			).rejects.toThrow("http_proxy localhost:33699 (expected none)");
			await session.close();
		});
	});

	test("a genuine slow screen is retried once; a device in the wrong state is not retried, and neither is a device that is gone", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			const lines: string[] = [];
			let calls = 0;
			const slow = async () => {
				if (++calls === 1) throw new NodeNotFoundError("no node on screen after 15000 ms");
				return "tree";
			};
			expect(await retryCase(session, normalScreen, 1, "case", slow, (line) => lines.push(line))).toBe("tree");
			expect(calls).toBe(2);
			expect(lines).toHaveLength(1);

			device.set("global/http_proxy", "localhost:33699");
			calls = 0;
			await expect(retryCase(session, normalScreen, 1, "case", slow, () => undefined)).rejects.toThrow(
				"the device is not in the state the case needs",
			);
			expect(calls).toBe(1);

			device.set("global/http_proxy", null);
			calls = 0;
			const gone = async () => {
				calls++;
				throw new Error("device 'localhost:5555' not found");
			};
			await expect(retryCase(session, normalScreen, 1, "case", gone, () => undefined)).rejects.toThrow("not found");
			expect(calls).toBe(1);
			await session.close();
		});
	});

	test("the run stops with the cause after the device is restored, which is what the run file's aborted records", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			let aborted: string | null = null;
			try {
				await withSession(
					device.serial,
					device.packageName,
					async (session) => {
						await session.fontScale(2);
						await session.networkMode("hang");
						device.set("global/http_proxy", "localhost:33699");
						await retryCase(session, normalScreen, 2, "case", async () => {
							throw new NodeNotFoundError("no node on screen after 15000 ms");
						});
					},
					options,
				);
			} catch (error) {
				if (!endsRun(error)) throw error;
				aborted = (error as Error).message;
			}
			expect(aborted).toMatch(
				/^the device is not in the state the case needs: http_proxy localhost:33699 \(expected none\)/,
			);
			expect(device.get("global/http_proxy")).toBeNull();
			expect(device.get("system/font_scale")).toBeNull();
			expect(options.notes?.restoreFailures).toEqual([]);
		});
	});
});

describe("a device that is lost before the session is closed", () => {
	test("what could not be restored is kept for the run file, and the saved state stays for the next run to repair", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options, dir }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			await session.fontScale(2);
			await session.networkMode("refuse");
			device.lost = true;
			await expect(session.close()).rejects.toThrow("could not restore localhost:5555");
			const failures = options.notes?.restoreFailures ?? [];
			expect(failures).toHaveLength(6);
			expect(failures.every((failure) => failure.includes("device 'localhost:5555' not found"))).toBe(true);
			expect(failures[1]).toMatch(/^font_scale: /);
			await session.close();
			expect(options.notes?.restoreFailures).toHaveLength(6);
			await stat(join(dir, "device-state-localhost_5555.json"));
		});
	});

	test("a restore that went through but left a setting different is recorded as what differs", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const session = await DeviceSession.open(device.serial, device.packageName, options);
			await session.networkMode("hang");
			device.ignoreProxyWrites = true;
			await expect(session.close()).rejects.toThrow("is not back to its original settings");
			expect(options.notes?.restoreFailures).toHaveLength(1);
			expect(options.notes?.restoreFailures[0]).toMatch(/^proxy: null -> "localhost:\d+"$/);
		});
	});

	test("the run's own error is the one thrown, and its restore failure is in the notes, not lost", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			await quietly(async () => {
				const error = await withSession(
					device.serial,
					device.packageName,
					async () => {
						device.lost = true;
						throw new Error("uiautomator dump on localhost:5555 produced no tree after 5 attempts (adb: device 'localhost:5555' not found)");
					},
					options,
				).catch((caught: unknown) => caught);
				expect((error as Error).message).toContain("produced no tree after 5 attempts");
				expect(endsRun(error)).toBe(true);
			});
			expect(options.notes?.restoreFailures).toHaveLength(6);
		});
	});

	test("a body that finished is not thrown away when the device was lost at the end: its results are returned, the failure noted", async () => {
		const device = new FakeDevice();
		await withDevice(device, async ({ options }) => {
			const result = await quietly(() =>
				withSession(
					device.serial,
					device.packageName,
					async () => {
						device.lost = true;
						return 42;
					},
					options,
				),
			);
			expect(result).toBe(42);
			expect(options.notes?.restoreFailures.length).toBeGreaterThan(0);
		});
	});
});
