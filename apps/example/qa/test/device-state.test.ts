import { describe, expect, test } from "bun:test";
import { stateDifferences, type DeviceState } from "../lib/device.ts";
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
