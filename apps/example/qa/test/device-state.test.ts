import { describe, expect, test } from "bun:test";
import { harnessLeftovers, stateDifferences, type DeviceState } from "../lib/device.ts";
import {
	deviceKindName,
	parseAppLocales,
	parseDisplay,
	parseLayoutDirection,
	parseNightMode,
	parsePids,
	parseSetting,
	parseStatusBarFrame,
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
