import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { product } from "../commands/product.ts";
import { gateKinds, type Gate, type GatesFile } from "../lib/gates.ts";
import { homeLabels, isHomeScreen, parseLaunchMs, productFatals, productMetrics, productProblems, productWindowMs, productPackage, type ProductFile } from "../lib/product.ts";
import { runsDir } from "../lib/paths.ts";
import { assertProductDevice, identify, refusePhone } from "../lib/reset.ts";
import { runKinds } from "../lib/runs.ts";
import { parseHierarchy } from "../lib/uia.ts";
import { appVariantOf, apkPath, packageOf, schemeOf, stemOf, variantFlag } from "../lib/variant.ts";

const gates = JSON.parse(readFileSync(join(import.meta.dirname, "..", "gates.json"), "utf8")) as GatesFile;
const made: string[] = [];
const temporary = (prefix: string): string => {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	made.push(directory);
	return directory;
};
afterAll(() => {
	for (const path of made) rmSync(path, { recursive: true, force: true });
});

const tree = (nodes: { text?: string; desc?: string; pkg: string }[]) =>
	parseHierarchy(
		`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="${nodes[0]?.pkg ?? "x"}" content-desc="" bounds="[0,0][1080,2400]">${nodes
			.map((node) => `<node index="0" text="${node.text ?? ""}" resource-id="" class="android.view.View" package="${node.pkg}" content-desc="${node.desc ?? ""}" clickable="true" enabled="true" bounds="[0,0][100,100]" />`)
			.join("")}</node></hierarchy>`,
	);

describe("the home screen is the first screen of the production variant", () => {
	test("it reads its title and its line of description, in both languages the app has (the title is the same in both)", () => {
		expect(homeLabels()).toEqual([
			"Expo Svelte",
			"Svelte 5 components running as a native Android and iOS app, with no React and no WebView.",
			"مكوّنات Svelte 5 تعمل كتطبيق أصلي على Android وiOS، بلا React وبلا WebView.",
		]);
	});
	test("only the app's own window counts", () => {
		expect(isHomeScreen(tree([{ text: "Expo Svelte", pkg: productPackage }]))).toBe(true);
		expect(isHomeScreen(tree([{ desc: "مكوّنات Svelte 5 تعمل كتطبيق أصلي على Android وiOS، بلا React وبلا WebView.", pkg: productPackage }]))).toBe(true);
		expect(isHomeScreen(tree([{ text: "Expo Svelte", pkg: "io.example.svelteqa" }]))).toBe(false);
		expect(isHomeScreen(tree([{ text: "Loading", pkg: productPackage }, { text: "System UI isn't responding", pkg: "android" }]))).toBe(false);
	});
});

describe("what logcat says about a start", () => {
	const line = (tag: string, message: string, level = "E") => `11-01 12:00:05.000  4242  4290 ${level} ${tag}: ${message}`;
	test("a clean start has no fatal and the errors the app printed are counted, not judged", () => {
		const text = [line("ReactNativeJS", "'[native startup]', 'offline'"), line("SvelteEngine", "ready", "I")].join("\n");
		expect(productFatals(text, true)).toEqual({ fatals: [], jsErrors: 1 });
	});
	test("a Java crash, a native signal, an ANR and a JavaScript fatal of the product are fatals, those of another app are not", () => {
		const java = [line("AndroidRuntime", "FATAL EXCEPTION: main"), line("AndroidRuntime", "Process: io.example.sveltenative.qaproduct, PID: 4242")].join("\n");
		expect(productFatals(java, true).fatals).toHaveLength(1);
		const other = [line("AndroidRuntime", "FATAL EXCEPTION: main"), line("AndroidRuntime", "Process: io.example.svelteqa, PID: 4242")].join("\n");
		expect(productFatals(other, true).fatals).toEqual([]);
		expect(productFatals(line("libc", "Fatal signal 11 (SIGSEGV), code 1, fault addr 0x0 in tid 4290 (mqt_v_js), pid 4242 (io.example.sveltenative.qaproduct)", "F"), true).fatals).toHaveLength(1);
		expect(productFatals(line("ActivityManager", "ANR in io.example.sveltenative.qaproduct (io.example.sveltenative.qaproduct/.MainActivity)", "E"), true).fatals).toHaveLength(1);
	});
	test("a native crash report counts once, with or without the signal line", () => {
		const signal = line("libc", "Fatal signal 6 (SIGABRT), code -1 in tid 4290 (mqt_v_js), pid 4242 (io.example.sveltenative.qaproduct)", "F");
		const report = line("DEBUG", "pid: 4242, tid: 4290, name: mqt_v_js  >>> io.example.sveltenative.qaproduct <<<", "F");
		expect(productFatals([signal, report].join("\n"), true).fatals).toHaveLength(1);
		expect(productFatals(report, true).fatals).toHaveLength(1);
	});
	test("a process that is gone at the end is a fatal, whatever logcat shows", () => {
		expect(productFatals("", false).fatals).toEqual(["the process of io.example.sveltenative.qaproduct was gone when the window ended"]);
	});
	test("am start -W says how long the activity took", () => {
		expect(parseLaunchMs("Starting: Intent { cmp=io.example.sveltenative.qaproduct/.MainActivity }\nStatus: ok\nTotalTime: 1234\nWaitTime: 1250\n")).toBe(1234);
		expect(parseLaunchMs("Error: Activity class does not exist")).toBeNull();
	});
});

describe("the run, its metrics and its gates", () => {
	const file = (overrides: Partial<ProductFile> = {}): ProductFile =>
		({
			schema: 1,
			kind: "product",
			windowMs: productWindowMs,
			firstScreen: { reached: true, atMs: 2300 },
			alive: true,
			fatals: [],
			jsErrorCount: 0,
			app: { package: productPackage, versionName: "0.1.0" },
			...overrides,
		}) as ProductFile;
	test("a start that reached the screen with no fatal passes, with the metrics the gates read", () => {
		expect(productProblems(file())).toEqual([]);
		expect(productMetrics(file())).toEqual({ "product.boot.fatals": 0, "product.boot.firstScreen": 1, "product.boot.firstScreenMs": 2300, "product.boot.jsErrors": 0 });
	});
	test("a fatal, or no screen, is a problem; a screen later than the 15 s of the check is not a screen, whatever window the run had", () => {
		expect(productProblems(file({ fatals: ["FATAL EXCEPTION Process: io.example.sveltenative.qaproduct,"] }))[0]).toContain("fatal:");
		expect(productProblems(file({ firstScreen: { reached: false, atMs: null } }))).toEqual(["the home screen was not reached within 15 s"]);
		expect(productMetrics(file({ firstScreen: { reached: false, atMs: null } }))["product.boot.firstScreen"]).toBe(0);
		expect(productMetrics(file({ windowMs: 60_000, firstScreen: { reached: true, atMs: 20_000 } }))["product.boot.firstScreen"]).toBe(0);
	});
	test("the gates: no fatal, a first screen, for the lab emulator, and nobody else provides the run", () => {
		const byId = new Map(gates.gates.map((gate) => [gate.id, gate] as const));
		const fatals = byId.get("product.boot.fatals") as Gate;
		const screen = byId.get("product.boot.firstScreen") as Gate;
		expect(fatals.bar.android).toEqual({ max: 0 });
		expect(screen.bar.android).toEqual({ min: 1 });
		expect(gateKinds(fatals)).toEqual(["product"]);
		expect(gateKinds(screen)).toEqual(["product"]);
		expect(runKinds).toContain("product");
		expect(gates.devices["localhost:5555"]?.runs).toContain("product");
		expect(gates.devices.R58Y90KNGRP?.runs).not.toContain("product");
		expect(gates.devices["E74A5608-BF8E-5806-8699-1605F82ADED9"]?.runs).not.toContain("product");
	});
});

describe("the product build is a variant of its own", () => {
	test("its id, scheme, APP_VARIANT and file names", () => {
		expect(variantFlag("production")).toBe("production");
		expect(() => variantFlag("product")).toThrow("qa, smoke or production");
		expect(packageOf.production).toBe("io.example.sveltenative.qaproduct");
		expect(schemeOf.production).toBe("example");
		expect(appVariantOf.production).toBe("production");
		expect(stemOf("production", "x86_64")).toBe("production-x86_64");
		expect(apkPath("production", "x86_64", "/out")).toBe("/out/app-production-x86_64.apk");
		expect(apkPath("qa", "x86_64", "/out")).toBe("/out/app-x86_64.apk");
	});
});

describe("the product is never put on a phone", () => {
	const emulatorProps = { "ro.kernel.qemu": "1", "ro.boot.qemu": "1", "ro.serialno": "EMULATOR31X1X1" };
	test("a phone is refused from its serial alone, and by what a forwarded serial says about itself", () => {
		for (const serial of ["R58Y90KNGRP", "E74A5608-BF8E-5806-8699-1605F82ADED9"]) {
			expect(() => refusePhone(identify(serial, {}, gates), "install the product")).toThrow(`refusing to install the product on ${serial}`);
		}
		expect(() => assertProductDevice(identify("localhost:5560", { "ro.serialno": "R58Y90KNGRP" }, gates))).toThrow("is a phone");
	});
	test("only a listed lab emulator that says it is one", () => {
		expect(() => assertProductDevice(identify("localhost:5555", emulatorProps, gates))).not.toThrow();
		expect(() => assertProductDevice(identify("localhost:5555", { "ro.serialno": "SOMETHINGELSE" }, gates))).toThrow("does not say it is an emulator");
		expect(() => assertProductDevice(identify("emulator-5554", emulatorProps, gates))).toThrow("not a lab device");
		expect(() => assertProductDevice(identify("10.0.0.7:5555", {}, gates))).toThrow("does not say it is an emulator");
	});
});

describe("`native-qa product` against a fake adb", () => {
	const packageLine = "io.example.sveltenative.qaproduct";
	/** An `adb` that answers what the command asks and logs every call. The screen, the process and the logcat are the test's. */
	function fakeAdb(directory: string, options: { emulator: boolean }): { bin: string; log: string; logcat: string } {
		const bin = join(directory, "bin");
		mkdirSync(bin, { recursive: true });
		const log = join(directory, "adb.log");
		const logcat = join(directory, "logcat.txt");
		const props = options.emulator
			? "[ro.build.version.sdk]: [36]\\n[ro.product.model]: [sdk_gphone64_x86_64]\\n[ro.build.version.release]: [16]\\n[ro.product.cpu.abi]: [x86_64]\\n[ro.kernel.qemu]: [1]\\n[ro.boot.qemu]: [1]\\n"
			: "[ro.build.version.sdk]: [36]\\n[ro.product.model]: [Fake Phone]\\n[ro.build.version.release]: [16]\\n[ro.product.cpu.abi]: [x86_64]\\n[ro.serialno]: [NOTANEMULATOR]\\n";
		const script = `#!/bin/bash
echo "$*" >> "$FAKE_ADB_LOG"
if [ "$1" = devices ]; then printf 'List of devices attached\\nlocalhost:5555\\tdevice\\nR58Y90KNGRP\\tdevice\\n'; exit 0; fi
shift 2
case "$*" in
  "shell getprop") printf '${props}';;
  "shell dumpsys display") ;;
  "shell pm path "*) echo "package:/data/app/~~x/${packageLine}-y/base.apk";;
  "shell sha256sum "*) echo "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  /data/app/base.apk";;
  *"dumpsys package"*) printf '    versionCode=1 minSdk=24 targetSdk=36\\n    versionName=0.1.0\\n    lastUpdateTime=2026-11-01 00:00:00\\n    [status=speed-profile]\\n';;
  "install -r "*) echo Success;;
  "shell pm clear "*) echo Success;;
  "shell am start -W "*) printf 'Status: ok\\nTotalTime: 1234\\n';;
  *uiautomator*) cat "$FAKE_SCREEN";;
  "shell pidof "*) [ -n "$FAKE_PID" ] && echo "$FAKE_PID";;
  "logcat -d -v threadtime") cat "$FAKE_LOGCAT";;
  *) ;;
esac
`;
		writeFileSync(join(bin, "adb"), script);
		chmodSync(join(bin, "adb"), 0o755);
		return { bin, log, logcat };
	}
	const homeScreen = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="${packageLine}" content-desc="" bounds="[0,0][1080,2400]"><node index="0" text="Expo Svelte" class="android.view.View" package="${packageLine}" content-desc="" clickable="true" enabled="true" bounds="[0,0][100,100]" /></node></hierarchy>`;
	const spinner = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" package="${packageLine}" content-desc="" bounds="[0,0][1080,2400]"><node index="0" text="" content-desc="Loading" class="android.view.View" package="${packageLine}" bounds="[0,0][100,100]" /></node></hierarchy>`;
	const crash = ["11-01 12:00:05.000  4242  4290 E AndroidRuntime: FATAL EXCEPTION: mqt_v_js", `11-01 12:00:05.001  4242  4290 E AndroidRuntime: Process: ${packageLine}, PID: 4242`, "11-01 12:00:05.002  4242  4290 E AndroidRuntime: com.facebook.react.common.JavascriptException: src/lib/native/dev/ is not in this app"].join("\n");

	async function run(options: { screen?: string; pid?: string; logcat?: string; emulator?: boolean; argv?: string[] }) {
		const directory = temporary("native-qa-product-");
		const adb = fakeAdb(directory, { emulator: options.emulator ?? true });
		writeFileSync(adb.logcat, options.logcat ?? "");
		const screen = join(directory, "screen.xml");
		writeFileSync(screen, options.screen ?? homeScreen);
		const apk = join(directory, "product.apk");
		writeFileSync(apk, "apk");
		const lock = join(directory, "emulator.lock");
		const saved = { ...process.env };
		Object.assign(process.env, {
			PATH: `${adb.bin}:${process.env.PATH}`,
			FAKE_ADB_LOG: adb.log,
			FAKE_LOGCAT: adb.logcat,
			FAKE_SCREEN: screen,
			FAKE_PID: options.pid ?? "4242",
			// The emulator lock is a private file this process holds already: nothing here waits for the real emulator.
			NATIVE_QA_LOCK_HOST: "local",
			NATIVE_QA_LOCK_FILE: lock,
			NATIVE_QA_LOCK_HELD: lock,
		});
		const said: string[] = [];
		const log = console.log;
		console.log = (...parts: unknown[]) => void said.push(parts.join(" "));
		let failure: unknown = null;
		try {
			await product(options.argv ?? ["--device", "localhost:5555", "--apk", apk, "--dexopt", "none"], 1500);
		} catch (error) {
			failure = error;
		} finally {
			console.log = log;
			for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
			Object.assign(process.env, saved);
		}
		const status = process.exitCode;
		process.exitCode = 0;
		const output = said.join("\n");
		for (const base of [...output.matchAll(/wrote (qa\/runs\/product-localhost_5555-\S+)\.json/g)].map((match) => join(runsDir, "..", "..", match[1] as string))) {
			for (const suffix of [".json", ".log"]) if (existsSync(base + suffix)) made.push(base + suffix);
		}
		return { output, failure, status, calls: existsSync(adb.log) ? readFileSync(adb.log, "utf8").trim().split("\n") : [], apk };
	}

	test("a clean cold start that reaches the home screen passes, on the product's own package, with its data cleared first", async () => {
		const done = await run({});
		expect(done.failure).toBeNull();
		expect(done.status).not.toBe(1);
		expect(done.output).toContain("product boot: pass");
		expect(done.output).toMatch(/home screen reached after \d+ ms, activity displayed after 1234 ms, 0 fatal\(s\)/);
		expect(done.calls).toContain(`-s localhost:5555 install -r ${done.apk}`);
		expect(done.calls.indexOf("-s localhost:5555 shell pm clear io.example.sveltenative.qaproduct")).toBeGreaterThan(done.calls.findIndex((entry) => entry.includes("install -r")));
		expect(done.calls.some((entry) => entry.includes("am start -W -n io.example.sveltenative.qaproduct/.MainActivity"))).toBe(true);
		// Nothing names the QA app, and nothing is sent to the phone that is on the same adb.
		expect(done.calls.filter((entry) => entry.includes("svelteqa") || entry.includes("R58Y90KNGRP"))).toEqual([]);
		const wrote = /wrote (qa\/runs\/product-\S+)\.json/.exec(done.output);
		expect(wrote).not.toBeNull();
	}, 30_000);

	test("a crash of the app fails the check and names it, and so does a screen that never comes, and a process that is gone", async () => {
		const crashed = await run({ logcat: crash });
		expect(crashed.status).toBe(1);
		expect(crashed.output).toContain("product boot: FAIL");
		expect(crashed.output).toContain("fatal: FATAL EXCEPTION Process: io.example.sveltenative.qaproduct");
		const stuck = await run({ screen: spinner });
		expect(stuck.status).toBe(1);
		expect(stuck.output).toContain("the home screen was not reached within 1.5 s");
		const gone = await run({ pid: "" });
		expect(gone.status).toBe(1);
		expect(gone.output).toContain("was gone when the window ended");
	}, 60_000);

	test("the phone is refused before a single adb command", async () => {
		const done = await run({ argv: ["--device", "R58Y90KNGRP", "--no-install"] });
		expect(String(done.failure)).toContain("refusing to install or start the product app on R58Y90KNGRP");
		expect(done.calls).toEqual([]);
	});

	test("a device that gates.json lists as the lab but that is no emulator is refused once it has said what it is, before anything is installed or cleared", async () => {
		const done = await run({ emulator: false });
		expect(String(done.failure)).toContain("does not say it is an emulator");
		expect(done.calls.some((entry) => /install|pm clear|am start|force-stop|logcat/.test(entry))).toBe(false);
	});
});
