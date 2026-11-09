import { describe, expect, test } from "bun:test";
import {
	parseAmStart,
	parseBaseApkPath,
	parseDevices,
	parseGetprop,
	parsePackageDump,
	parseRefreshRate,
} from "../parse/adb.ts";
import { sample } from "./sample.ts";

describe("adb parsers", () => {
	test("adb devices lists serial and state, skipping the header", () => {
		expect(parseDevices(sample("adb-devices.txt"))).toEqual([
			{ serial: "R5XXXXXXXXX", state: "device" },
			{ serial: "localhost:5555", state: "device" },
		]);
	});
	test("adb devices reports an offline device", () => {
		expect(parseDevices("List of devices attached\nlocalhost:5555\toffline\n\n")).toEqual([
			{ serial: "localhost:5555", state: "offline" },
		]);
	});
	test("getprop output becomes a map", () => {
		const props = parseGetprop(sample("getprop.txt"));
		expect(props["ro.product.model"]).toBe("sdk_gphone64_x86_64");
		expect(props["ro.kernel.qemu"]).toBe("1");
		expect(props["ro.build.version.sdk"]).toBe("36");
		expect(props["ro.product.cpu.abilist"]).toBe("x86_64,arm64-v8a");
		expect(props["bluetooth.device.class_of_device"]).toBe("90,2,12");
	});
	test("am start -W gives TotalTime and the launch state", () => {
		expect(parseAmStart(sample("am-start.txt"))).toEqual({
			status: "ok",
			launchState: "COLD",
			totalTimeMs: 776,
			waitTimeMs: 780,
			thisTimeMs: null,
		});
	});
	test("am start -W without timings leaves them null", () => {
		expect(parseAmStart("Error: Activity class does not exist.\n").totalTimeMs).toBeNull();
	});
	test("dumpsys package identifies the installed build", () => {
		expect(parsePackageDump(sample("dumpsys-package.txt"))).toEqual({
			versionName: "0.1.0",
			versionCode: 1,
			lastUpdateTime: "2026-10-25 20:20:10",
		});
	});
	test("dumpsys display gives the render frame rate", () => {
		expect(parseRefreshRate(sample("dumpsys-display.txt"))).toBe(60);
		expect(parseRefreshRate("no display here")).toBeNull();
	});
	test("pm path gives the base APK", () => {
		expect(parseBaseApkPath(sample("pm-path.txt"))).toBe(
			"/data/app/~~E_w38z7eX4_0csmdoatE7Q==/io.example.svelteqa-WTic2Uwr_vgAvpAx3feKQw==/base.apk",
		);
		expect(
			parseBaseApkPath("package:/data/app/x/split_config.apk\npackage:/data/app/x/base.apk\n"),
		).toBe("/data/app/x/base.apk");
		expect(parseBaseApkPath("")).toBeNull();
	});
});
