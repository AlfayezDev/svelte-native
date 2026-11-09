import { describe, expect, test } from "bun:test";
import { barsSettleUptimeS, harnessLeftovers, stateDifferences, statusBarRect, type DeviceState } from "../lib/device.ts";
import {
	deviceKindName,
	parseAppLocales,
	parseDisplay,
	parseLayoutDirection,
	parseNightMode,
	parsePids,
	parseSetting,
	parseCutoutTop,
	parseNavigationBarFrame,
	parseStatusBarFrame,
	parseUptimeSeconds,
} from "../parse/device-state.ts";
import { sample } from "./sample.ts";

describe("device state parsers", () => {
	test("settings: a value, or null when the key is unset", () => {
		expect(parseSetting("1.0\n")).toBe("1.0");
		expect(parseSetting("null\n")).toBeNull();
		expect(parseSetting("")).toBeNull();
	});

	test("night mode", () => {
		expect(parseNightMode(sample("cmd-uimode-night.txt"))).toBe("no");
		expect(parseNightMode("Night mode: auto")).toBe("auto");
		expect(() => parseNightMode("Error: nothing")).toThrow("unexpected");
	});

	test("per-app locales", () => {
		expect(parseAppLocales(sample("cmd-locale-app-locales-ar.txt"))).toBe("ar-SA");
		expect(parseAppLocales(sample("cmd-locale-app-locales-none.txt"))).toBe("");
		expect(() => parseAppLocales("Unknown command")).toThrow("unexpected");
	});

	test("display size and density", () => {
		expect(parseDisplay(sample("wm-size.txt"), sample("wm-density.txt"))).toEqual({
			width: 1080,
			height: 2400,
			densityDpi: 420,
		});
		expect(
			parseDisplay(
				"Physical size: 1080x2340\nOverride size: 720x1560",
				"Physical density: 450\nOverride density: 300",
			),
		).toEqual({ width: 1080, height: 2340, densityDpi: 450 });
		expect(() => parseDisplay("", "")).toThrow("cannot read the display");
	});

	test("process ids", () => {
		expect(parsePids("5725\n")).toEqual([5725]);
		expect(parsePids("5725 5801\n")).toEqual([5725, 5801]);
		expect(parsePids("")).toEqual([]);
	});

	test("layout direction from the configuration", () => {
		expect(parseLayoutDirection(sample("dumpsys-activity-config-rtl.txt"))).toBe("rtl");
		expect(parseLayoutDirection(sample("dumpsys-activity-config-ltr.txt"))).toBe("ltr");
		expect(parseLayoutDirection("nothing here")).toBeNull();
	});

	test("the status bar band from the inset sources", () => {
		expect(parseStatusBarFrame(sample("dumpsys-window-insets.txt"))).toEqual({
			x: 0,
			y: 0,
			width: 1080,
			height: 128,
		});
		expect(() => parseStatusBarFrame("no insets")).toThrow("no statusBars");
		expect(parseNavigationBarFrame(sample("dumpsys-window-insets.txt"))).toEqual({ x: 0, y: 2337, width: 1080, height: 63 });
		expect(parseNavigationBarFrame("no insets")).toBeNull();
	});

	test("the device kind names what the pixels depend on", () => {
		const display = parseDisplay(sample("wm-size.txt"), sample("wm-density.txt"));
		expect(
			deviceKindName({
				platform: "android",
				sdk: 36,
				kind: "emulator",
				model: "sdk_gphone64_x86_64",
				display,
			}),
		).toBe("android-api36-emulator-1080x2400-420dpi");
		expect(
			deviceKindName({
				platform: "android",
				sdk: 36,
				kind: "device",
				model: "SM-A165F",
				display: { width: 1080, height: 2340, densityDpi: 450 },
			}),
		).toBe("android-api36-SM-A165F-1080x2340-450dpi");
	});

	test("two captured states are compared setting by setting", () => {
		const was: DeviceState = {
			night: "no",
			fontScale: "1.0",
			appLocales: "",
			accelerometerRotation: "1",
			userRotation: "0",
			proxy: null,
		};
		expect(stateDifferences(was, { ...was })).toEqual([]);
		expect(stateDifferences(was, { ...was, appLocales: "ar-SA", proxy: "localhost:1" })).toEqual([
			'appLocales: "" -> "ar-SA"',
			'proxy: null -> "localhost:1"',
		]);
	});

	test("a text size is compared as a number: the same size written two ways is no difference, another size or none is", () => {
		const was: DeviceState = { night: "no", fontScale: "1.00", appLocales: "", accelerometerRotation: "1", userRotation: "0", proxy: null };
		expect(stateDifferences(was, { ...was, fontScale: "1.0" })).toEqual([]);
		expect(stateDifferences(was, { ...was, fontScale: "1.5" })).toEqual(['fontScale: "1.00" -> "1.5"']);
		expect(stateDifferences(was, { ...was, fontScale: null })).toEqual(['fontScale: "1.00" -> null']);
	});
});

describe("what an earlier run left on the device", () => {
	const clean: DeviceState = {
		night: "no",
		fontScale: null,
		appLocales: "",
		accelerometerRotation: "1",
		userRotation: null,
		proxy: null,
	};
	const pkg = "io.rasheed.svelteqa";

	test("a device the harness never touched has no leftovers", () => {
		expect(harnessLeftovers(clean, pkg)).toEqual({ state: clean, leftovers: [] });
	});

	test("a proxy on this machine's loopback is the harness's; any other proxy is the device's", () => {
		for (const proxy of ["localhost:33699", "127.0.0.1:41000"]) {
			const found = harnessLeftovers({ ...clean, proxy }, pkg);
			expect(found.state.proxy).toBeNull();
			expect(found.leftovers).toHaveLength(1);
			expect(found.leftovers[0]).toContain(`"${proxy}"`);
		}
		for (const proxy of ["proxy.corp:3128", "10.0.2.2:8888", "localhost"]) {
			expect(harnessLeftovers({ ...clean, proxy }, pkg)).toEqual({ state: { ...clean, proxy }, leftovers: [] });
		}
	});

	test("the text size the suites set that is not the default (2.0) is a leftover, whatever its spelling; 1.0 and a size of the user's are not", () => {
		for (const fontScale of ["2.00", "2.0", "2"])
			expect(harnessLeftovers({ ...clean, fontScale }, pkg).state.fontScale).toBeNull();
		for (const fontScale of ["1.0", "1.00", "1.15"])
			expect(harnessLeftovers({ ...clean, fontScale }, pkg)).toEqual({ state: { ...clean, fontScale }, leftovers: [] });
	});

	test("the app languages the suites set, and a rotation they set, are leftovers; the theme and auto-rotate are not judged", () => {
		for (const appLocales of ["en-US", "ar-SA"])
			expect(harnessLeftovers({ ...clean, appLocales }, pkg).state.appLocales).toBe("");
		expect(harnessLeftovers({ ...clean, appLocales: "fr-FR" }, pkg).leftovers).toEqual([]);
		for (const userRotation of ["1", "2", "3"])
			expect(harnessLeftovers({ ...clean, userRotation }, pkg).state.userRotation).toBeNull();
		expect(harnessLeftovers({ ...clean, userRotation: "0" }, pkg).leftovers).toEqual([]);
		const dark: DeviceState = { ...clean, night: "yes", accelerometerRotation: "0" };
		expect(harnessLeftovers(dark, pkg)).toEqual({ state: dark, leftovers: [] });
	});

	test("every leftover is one sentence naming the setting, in the order of the state", () => {
		const found = harnessLeftovers(
			{ ...clean, proxy: "localhost:33699", fontScale: "2.00", userRotation: "3", appLocales: "ar-SA" },
			pkg,
		);
		expect(found.leftovers.map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
			"http_proxy was \"localhost:33699\",",
			"font_scale was 2.00,",
			"the app locales",
			"user_rotation was 3,",
		]);
		expect(found.state).toEqual(clean);
	});
});

describe("the status bar band settles after a boot", () => {
	// What `dumpsys window` said on the OVH emulator in the seconds after a boot (2 Nov, a poll every 2 s): the bar at 63 px with no cutout known, the cutout
	// (128 px) known while the bar is still 63, then the bar at 128 px.
	const first = sample("dumpsys-window-bars-boot-1.txt");
	const second = sample("dumpsys-window-bars-boot-2.txt");
	const settled = sample("dumpsys-window-bars-settled.txt");
	const band = (height: number) => ({ x: 0, y: 0, width: 1080, height });

	/** A device that answers `cat /proc/uptime` with `uptime` and each `dumpsys window` with the next of `dumps`; time is the sum of the waits. */
	function device(uptime: string, dumps: string[]) {
		const waits: number[] = [];
		let clock = 0;
		let read = 0;
		return {
			waits,
			reads: () => read,
			deps: {
				run: async (_serial: string, args: string[]) => (args.includes("/proc/uptime") ? uptime : (dumps[Math.min(read++, dumps.length - 1)] ?? "")),
				wait: async (ms: number) => {
					waits.push(ms);
					clock += ms;
				},
				now: () => clock,
				timeoutMs: 20_000,
			},
		};
	}

	test("the cutout's inset and the uptime are read from what the device says", () => {
		expect(parseCutoutTop(first)).toBe(0);
		expect(parseCutoutTop(second)).toBe(128);
		expect(parseCutoutTop(settled)).toBe(128);
		expect(parseCutoutTop(sample("dumpsys-window-insets.txt"))).toBe(0);
		expect(parseStatusBarFrame(first).height).toBe(63);
		expect(parseStatusBarFrame(second).height).toBe(63);
		expect(parseStatusBarFrame(settled).height).toBe(128);
		expect(parseUptimeSeconds("1234.56 4321.00\n")).toBe(1234.56);
		expect(parseUptimeSeconds("")).toBeNull();
		expect(parseUptimeSeconds("not a number")).toBeNull();
	});

	test("a device that has just booted is waited for before its bars are read", () => {
		const fresh = device("12.5 40.0\n", [settled, settled]);
		return statusBarRect("d", fresh.deps).then((rect) => {
			expect(fresh.waits[0]).toBe(Math.ceil((barsSettleUptimeS - 12.5) * 1000));
			expect(fresh.reads()).toBe(2);
			expect(rect).toEqual(band(128));
		});
	});

	test("a device that has been up long enough is not waited for, and two answers in a row make the band", async () => {
		const up = device("5000.0 9000.0\n", [settled, settled]);
		expect(await statusBarRect("d", up.deps)).toEqual(band(128));
		expect(up.waits).toEqual([1000]);
	});

	test("a bar still shorter than the display cutout is not the band: the answers before it are skipped", async () => {
		const slow = device("100.0 200.0\n", [second, second, second, settled, settled]);
		expect(await statusBarRect("d", slow.deps)).toEqual(band(128));
		expect(slow.reads()).toBe(5);
	});

	test("an answer that goes back to the half-laid-out bar restarts the count", async () => {
		const flicker = device("100.0 200.0\n", [settled, second, settled, settled]);
		expect(await statusBarRect("d", flicker.deps)).toEqual(band(128));
		expect(flicker.reads()).toBe(4);
	});

	test("a band that never settles is an error naming what the window manager says", async () => {
		const stuck = device("100.0 200.0\n", [second]);
		await expect(statusBarRect("d", stuck.deps)).rejects.toThrow("did not settle: the window manager says 1080x63 at 0,0 with a display cutout of 128 px");
	});

	test("a device without a cutout settles on its own band", async () => {
		const plain = device("100.0 200.0\n", [sample("dumpsys-window-insets.txt")]);
		expect(await statusBarRect("d", plain.deps)).toEqual(band(128));
	});
});
