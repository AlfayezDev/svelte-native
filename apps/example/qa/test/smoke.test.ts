import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { generatedFor, selectVariantProject } from "../commands/build.ts";
import { checkGatesFile, evaluate, gateKinds, splitGates, type GatesFile } from "../lib/gates.ts";
import { defaultApkPath } from "../lib/app.ts";
import { buildFileKey } from "../lib/runs.ts";
import { apkPath, appVariantOf, buildLogName, iosBuildName, packageOf, schemeOf, variantFlag } from "../lib/variant.ts";
import { deviceMetrics } from "../lib/metrics.ts";
import { platformDir } from "../lib/paths.ts";
import { describeSmoke, missingModules, smokeMetrics, unpinnedModules } from "../lib/smoke.ts";
import type { SmokeFile, SmokeModuleResult } from "../lib/types.ts";
import { parseSmokeBody, parseSmokeCompletion, parseSmokeResults } from "../parse/smoke.ts";
import { moduleResults, parseSmokeResultsFile } from "../commands/ios-smoke.ts";
import { ascii, decodeBase64, encodeBase64, hex, looksRandom } from "../../src/lib/native/dev/smoke-bytes.ts";
import { formatSmokeLine as format, formatSmokeSummary as summarize, oneLine, type SmokePath } from "../../src/lib/native/dev/smoke-log.ts";

/** The packages only the QA app links: the CommonJS file app.config.ts and react-native.config.js read. */
const { smokeOnlyPackages } = createRequire(import.meta.url)("../smoke-packages.cjs") as { smokeOnlyPackages: string[] };
const gatesFile = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as GatesFile;
/** The app's formatter takes a path of its own type; the harness's results carry the text the log had. */
const formatSmokeLine = (entry: SmokeModuleResult): string => format({ ...entry, path: entry.path as SmokePath, ms: entry.ms ?? 0 });
const formatSmokeSummary = (entries: SmokeModuleResult[], os: string): string => summarize(entries.map((entry) => ({ ...entry, path: entry.path as SmokePath, ms: entry.ms ?? 0 })), os);
const logcat = (message: string, tag = "ReactNativeJS", level = "I") => `11-01 12:00:00.123  4242  4290 ${level} ${tag}: ${message}`;

const result = (module: string, status: SmokeModuleResult["status"] = "ok", detail = "a call", path = "js", ms: number | null = 3): SmokeModuleResult => ({ module, status, path, ms, detail });
const smokeFile = (results: SmokeModuleResult[], patch: Partial<SmokeFile> = {}): SmokeFile => ({
	schema: 1,
	kind: "smoke",
	startedAt: "2026-11-01T12:00:00.000Z",
	finishedAt: "2026-11-01T12:00:20.000Z",
	source: { commit: "abc", dirty: false },
	device: { serial: "localhost:5555", platform: "android", kind: "emulator", model: "sdk", osVersion: "16", sdk: 36, abi: "x86_64", refreshHz: 60 },
	app: { package: "io.rasheed.svelteqa", versionName: "0.1.0", versionCode: 1, lastUpdateTime: null, installedSha256: "x", apk: null },
	run: "smoke",
	complete: true,
	results,
	completion: null,
	crashes: [],
	jsErrorCount: 0,
	durationMs: 20_000,
	logFile: "runs/smoke.log",
	...patch,
});

describe("the log lines", () => {
	test("a line the app formats is the line the parser reads, with logcat's prefix", () => {
		const sent: SmokeModuleResult = { module: "quick-crypto", status: "ok", path: "js", ms: 12, detail: 'randomBytes(16) and createHash("sha256") of "abc" = ba7816bf8f01cfea… as expected' };
		expect(parseSmokeResults(logcat(formatSmokeLine(sent)))).toEqual([sent]);
		// A console call with several arguments logs each as a quoted string; the parser takes the trailing quote off.
		expect(parseSmokeResults(logcat(`'${formatSmokeLine(sent)}'`))).toEqual([sent]);
	});
	test("fail and skip carry their reason; a detail can hold a colon, a path and an equals sign", () => {
		const failed = result("sentry", "fail", "Error: Invariant Violation: TurboModule 'RNSentry' not found path=/x ms=3", "direct", 0);
		const skipped = result("hms", "skip", "loaded, 5 native modules registered (HMSFusedLocation, …); the calls need HMS Core", "js+direct", 4);
		const text = [formatSmokeLine(failed), formatSmokeLine(skipped)].map((line) => logcat(line)).join("\n");
		expect(parseSmokeResults(text)).toEqual([failed, skipped]);
	});
	test("a skip on the other platform has no path and no detail beyond the reason", () => {
		const line = formatSmokeLine(result("samsung-pay", "skip", "Android only: the library has no iOS code", "none", 0));
		expect(line).toBe("[Svelte smoke] samsung-pay skip path=none ms=0 Android only: the library has no iOS code");
		expect(parseSmokeBody(line.slice("[Svelte smoke] ".length))).toEqual(result("samsung-pay", "skip", "Android only: the library has no iOS code", "none", 0));
	});
	test("lines of other tags and other prefixes are not modules; the completion line is not one either", () => {
		const text = [
			logcat("[Svelte stress] complete {\"periodMs\":16}"),
			logcat("[Svelte boot] init 1 · total 7 ms"),
			logcat("[Svelte smoke] complete {\"os\":\"android\",\"total\":2,\"ok\":1,\"fail\":1,\"skip\":0}"),
			logcat("[Svelte smoke] async-storage ok path=js ms=5 round trip"),
			"--------- beginning of main",
			"garbage",
		].join("\n");
		expect(parseSmokeResults(text).map((entry) => entry.module)).toEqual(["async-storage"]);
	});
	test("a module that reports twice keeps the later line, in the position of the first", () => {
		const text = [
			logcat(formatSmokeLine(result("a", "fail", "first"))),
			logcat(formatSmokeLine(result("b", "ok"))),
			logcat(formatSmokeLine(result("a", "ok", "second"))),
		].join("\n");
		expect(parseSmokeResults(text)).toEqual([result("a", "ok", "second"), result("b", "ok")]);
	});
	test("a line with no path or timing (an older app) still parses", () => {
		expect(parseSmokeBody("mmkv ok set and get")).toEqual({ module: "mmkv", status: "ok", path: "none", ms: null, detail: "set and get" });
		expect(parseSmokeBody("mmkv fail")).toEqual({ module: "mmkv", status: "fail", path: "none", ms: null, detail: "" });
		expect(parseSmokeBody("complete {}")).toBeNull();
		expect(parseSmokeBody("MMKV ok")).toBeNull();
		expect(parseSmokeBody("mmkv maybe")).toBeNull();
	});
	test("the detail is one bounded line", () => {
		expect(oneLine("a\n  b\tc")).toBe("a b c");
		expect(oneLine("x".repeat(1000))).toHaveLength(300);
		expect(formatSmokeLine(result("a", "fail", `Error\n${"stack ".repeat(200)}`))).not.toMatch(/\n/);
	});
	test("the completion line reports the counts; a line logcat cut off is no completion", () => {
		const results = [result("a"), result("b", "fail"), result("c", "skip")];
		const line = formatSmokeSummary(results, "android");
		expect(parseSmokeCompletion(logcat(line))).toEqual({ os: "android", total: 3, ok: 1, fail: 1, skip: 1 });
		expect(parseSmokeCompletion(logcat(line.slice(0, line.length - 8)))).toBeNull();
		expect(parseSmokeCompletion(logcat("[Svelte smoke] a ok path=js ms=1 x"))).toBeNull();
		expect(parseSmokeCompletion("")).toBeNull();
	});
	test("the iPhone's results file is read for its token and its module entries", () => {
		const text = JSON.stringify({ token: "t1", finishedAt: "2026-11-01T12:00:00Z", os: "ios", results: [result("a"), { module: "b", status: "weird", path: "js", ms: 1, detail: "" }, result("c", "skip", "Android only", "none", 0)] });
		const parsed = parseSmokeResultsFile(text);
		expect(parsed?.token).toBe("t1");
		expect(moduleResults(parsed as NonNullable<typeof parsed>).map((entry) => `${entry.module}:${entry.status}`)).toEqual(["a:ok", "c:skip"]);
		expect(parseSmokeResultsFile("{\"results\":")).toBeNull();
		expect(parseSmokeResultsFile("{\"os\":\"ios\"}")).toBeNull();
	});
});

describe("the byte helpers", () => {
	test("base64 encodes and decodes like Node's, for every length", () => {
		for (let length = 0; length < 40; length++) {
			const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + length * 11) & 0xff);
			const expected = Buffer.from(bytes).toString("base64");
			expect(encodeBase64(bytes)).toBe(expected);
			expect(Array.from(decodeBase64(expected))).toEqual(Array.from(bytes));
		}
		expect(encodeBase64(ascii("Svelte Native"))).toBe("U3ZlbHRlIE5hdGl2ZQ==");
		expect(() => decodeBase64("ab$d")).toThrow(/not base64/);
	});
	test("hex and the randomness check", () => {
		expect(hex([0, 1, 171, 255])).toBe("0001abff");
		expect(looksRandom([1, 2, 3])).toBe(true);
		expect(looksRandom([0, 0, 0, 0])).toBe(false);
		expect(looksRandom([7, 7, 7])).toBe(false);
		expect(looksRandom([])).toBe(false);
	});
});

describe("metrics and gates", () => {
	const pinned = ["a", "b", "c", "d"];
	test("a clean run: all pinned modules reported, none failed", () => {
		const metrics = smokeMetrics(smokeFile([result("a"), result("b"), result("c", "skip"), result("d")]), pinned);
		expect(metrics).toEqual({ "smoke.modules": 4, "smoke.ok": 3, "smoke.failed": 0, "smoke.skipped": 1, "smoke.missing": 0, "smoke.unpinned": 0, "smoke.complete": 1 });
	});
	test("a failure counts as failed and as reported; a module that never logged is missing", () => {
		const file = smokeFile([result("a"), result("b", "fail")], { complete: false });
		expect(missingModules(file.results, pinned)).toEqual(["c", "d"]);
		const metrics = smokeMetrics(file, pinned);
		expect(metrics["smoke.failed"]).toBe(1);
		expect(metrics["smoke.missing"]).toBe(2);
		expect(metrics["smoke.complete"]).toBe(0);
	});
	test("a module the list does not pin is reported, not counted as ok or failed", () => {
		const file = smokeFile([result("a"), result("x", "fail"), result("b"), result("c"), result("d")]);
		expect(unpinnedModules(file.results, pinned)).toEqual(["x"]);
		const metrics = smokeMetrics(file, pinned);
		expect(metrics["smoke.failed"]).toBe(0);
		expect(metrics["smoke.unpinned"]).toBe(1);
	});
	test("describeSmoke names every failure, skip and missing module", () => {
		const lines = describeSmoke(smokeFile([result("a"), result("b", "fail", "boom"), result("c", "skip", "Huawei only")], { crashes: ["FATAL EXCEPTION Process: io.rasheed.svelteqa"] }), pinned);
		expect(lines.join("\n")).toContain("FAIL b (js): boom");
		expect(lines.join("\n")).toContain("skip c: Huawei only");
		expect(lines.join("\n")).toContain("MISSING d");
		expect(lines.join("\n")).toContain("fatal: FATAL EXCEPTION");
		expect(lines[0]).toContain("1 ok, 1 failed, 1 skipped, 1 missing of 4 pinned");
	});
	test("the run kind is smoke, and its gates belong to it", () => {
		expect(gateKinds({ id: "x", title: "", unit: "", metric: "smoke.failed", bar: {} })).toEqual(["smoke"]);
	});
	test("smoke.failed and smoke.missing are gated at zero for every platform and every role", () => {
		const bar = (id: string) => gatesFile.gates.find((gate) => gate.id === id);
		for (const id of ["smoke.failed", "smoke.missing"]) {
			expect(bar(id)?.bar).toEqual({ android: { max: 0 }, ios: { max: 0 } });
			expect(bar(id)?.roles).toBeUndefined();
		}
		expect(() => checkGatesFile(gatesFile)).not.toThrow();
	});
	const rows = (serial: string, metrics: Record<string, number | null>) =>
		evaluate(gatesFile.gates.filter((gate) => gate.metric.startsWith("smoke.")), { [serial]: { platform: "android", role: gatesFile.devices[serial]?.role ?? null, runs: gatesFile.devices[serial]?.runs ?? null, metrics } }, "android");
	test("the Samsung (phone) and the emulator (lab) both pass a clean run and fail a failure or a missing module", () => {
		for (const serial of ["R58Y90KNGRP", "localhost:5555"]) {
			expect(rows(serial, { "smoke.failed": 0, "smoke.missing": 0 }).map((row) => row.verdict)).toEqual(["pass", "pass"]);
			expect(rows(serial, { "smoke.failed": 1, "smoke.missing": 0 }).map((row) => row.verdict)).toEqual(["fail", "pass"]);
			expect(rows(serial, { "smoke.failed": 0, "smoke.missing": 2 }).map((row) => row.verdict)).toEqual(["pass", "fail"]);
		}
	});
	test("a device that never ran the smoke test fails the gates (not measured) rather than skipping them", () => {
		expect(rows("localhost:5555", {}).map((row) => row.verdict)).toEqual(["not measured", "not measured"]);
	});
	test("deviceMetrics carries the smoke metrics next to the others", () => {
		const metrics = deviceMetrics(null, null, [], null, null, { parity: null, a11y: null, resilience: null }, { file: smokeFile([result("a")]), pinned: ["a"] });
		expect(metrics["smoke.failed"]).toBe(0);
		expect(metrics["smoke.missing"]).toBe(0);
		expect(metrics["smoke.ok"]).toBe(1);
	});
	test("checkGatesFile refuses a missing, empty or repeating module list", () => {
		const good = JSON.parse(JSON.stringify(gatesFile)) as GatesFile;
		const without = JSON.parse(JSON.stringify(gatesFile)) as Partial<GatesFile>;
		delete without.smoke;
		expect(() => checkGatesFile(without as GatesFile)).toThrow(/smoke.modules pins no module for android/);
		good.smoke.modules.ios = [];
		expect(() => checkGatesFile(good)).toThrow(/pins no module for ios/);
		good.smoke.modules.ios = ["a", "a"];
		expect(() => checkGatesFile(good)).toThrow(/names a module twice for ios/);
	});
});

/** The module ids the checks report, from their source: the file needs React Native to load, so the test reads it. */
const smokeSource = readFileSync(join(platformDir, "src/lib/native/dev/smoke-checks.ts"), "utf8");
const checked = [...smokeSource.matchAll(/^\t\tmodule: "([a-z0-9-]+)"/gm)].map((match) => match[1] as string);
/** The ids the runner and the page list (`smokeModules` in smoke.ts). */
const runnerSource = readFileSync(join(platformDir, "src/lib/native/dev/smoke.ts"), "utf8");
const listed = [...(/export const smokeModules: readonly string\[\] = \[([^\]]*)\]/.exec(runnerSource)?.[1] ?? "").matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1] as string);
const table = JSON.parse(readFileSync(join(platformDir, "qa/smoke-modules.json"), "utf8")) as { modules: { id: string; packages: string[]; link: string; shared: boolean; platforms: string[] }[] };
const packageJson = JSON.parse(readFileSync(join(platformDir, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

describe("the pinned list, the module table and the checks agree", () => {
	test("gates.json pins exactly the modules the page checks, for both platforms, in the order they run", () => {
		expect(checked).toHaveLength(36);
		// The runner lists the ids itself, so the page can show them without carrying the checks (Metro stubs smoke-checks.ts outside the smoke app).
		expect(listed).toEqual(checked);
		expect(gatesFile.smoke.modules.android).toEqual(checked);
		expect(gatesFile.smoke.modules.ios).toEqual(checked);
	});
	test("qa/smoke-modules.json lists the same modules", () => {
		expect(table.modules.map((entry) => entry.id).toSorted()).toEqual([...checked].toSorted());
	});
	test("every package of the table is a dependency of the platform app, at the version the production app uses", () => {
		const used = { ...packageJson.dependencies, ...packageJson.devDependencies };
		for (const entry of table.modules) for (const name of entry.packages) expect([name, name in used]).toEqual([name, true]);
		// Versions the task fixes (the production app's package.json), as specifiers.
		expect(used["@react-native-async-storage/async-storage"]).toBe("2.2.0");
		expect(used["@react-native-community/netinfo"]).toBe("12.0.1");
		expect(used["@react-native-firebase/app"]).toBe("^24.0.0");
		expect(used["@sentry/react-native"]).toBe("~7.11.0");
		expect(used["@intercom/intercom-react-native"]).toBe("10.7.0");
		expect(used["react-native-mmkv"]).toBe("4.3.1");
		expect(used["react-native-quick-crypto"]).toBe("1.1.3");
		expect(used["react-native-quick-base64"]).toBe("2.2.2");
		expect(used["react-native-get-random-values"]).toBe("~2.0.0");
		expect(used["react-native-live-direction"]).toBe("0.1.1");
	});
	test("the packages the product already links are not in the exclusion list; a module on one platform says so", () => {
		for (const shared of ["expo-secure-store", "expo-localization", "expo-constants", "expo-asset", "expo-system-ui", "expo-splash-screen"]) expect(smokeOnlyPackages).not.toContain(shared);
		expect(smokeOnlyPackages).not.toContain("@statsig/react-native-bindings");
		for (const name of ["react-native-mmkv", "@sentry/react-native", "@react-native-firebase/app", "expo-haptics", "expo-samsung-pay", "@hmscore/react-native-hms-location"]) expect(smokeOnlyPackages).toContain(name);
		expect(table.modules.find((entry) => entry.id === "hms")?.platforms).toEqual(["android"]);
		expect(table.modules.find((entry) => entry.id === "samsung-pay")?.platforms).toEqual(["android"]);
		expect(smokeSource).toContain('only: "android"');
	});
});

/** Runs a command in the platform app and returns its output (the autolinkers print JSON). */
function run(command: string, args: string[], env: Record<string, string> = {}): string {
	const done = spawnSync(command, args, { cwd: platformDir, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
	if (done.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${done.stderr.slice(0, 400)}`);
	return done.stdout;
}

type Evaluated = { name: string; scheme: string; ios: { bundleIdentifier: string; googleServicesFile?: string }; android: { package: string; googleServicesFile?: string }; plugins: unknown[] };
const pluginName = (entry: unknown): string => (Array.isArray(entry) ? String(entry[0]) : String(entry));

describe("three apps: the product and the QA app link the product's native modules, the smoke app adds the smoke test's", () => {
	const autolinking = join(platformDir, "../../node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js");
	/** The variants of app.config.ts as an `APP_VARIANT`: the product, the QA app (none) and the smoke app. */
	const variantEnv = { production: "production", qa: "", smoke: "smoke" } as const;
	const evaluated = new Map<string, Evaluated>();
	function config(variant: keyof typeof variantEnv): Evaluated {
		let cached = evaluated.get(variant);
		if (!cached) {
			cached = JSON.parse(run("pnpm", ["exec", "expo", "config", "--json", "--type", "introspect"], { APP_VARIANT: variantEnv[variant], EXPO_NO_TELEMETRY: "1", CI: "1" })) as Evaluated;
			evaluated.set(variant, cached);
		}
		return cached;
	}
	/** The `autolinkingExclude` the Svelte native plugin gets from app.config.ts for a variant: what it writes into settings.gradle and the Podfile. */
	function configuredExclude(variant: keyof typeof variantEnv): string[] {
		const plugin = config(variant).plugins.find((entry) => pluginName(entry) === "@rasheed/svelte-native/expo") as [string, { autolinkingExclude: string[] }];
		return plugin[1].autolinkingExclude;
	}
	/** The packages each autolinker would link for a platform, given the excludes the build passes both (settings.gradle's `--exclude` list / the Podfile's). */
	function linked(platform: "android" | "ios", variant: keyof typeof variantEnv): { rn: string[]; expo: string[]; all: Set<string> } {
		const flags = configuredExclude(variant).flatMap((name) => ["--exclude", name]);
		const env = { APP_VARIANT: variantEnv[variant], EXPO_NO_TELEMETRY: "1", CI: "1" };
		const rn = JSON.parse(run("node", [autolinking, "react-native-config", "--json", "--platform", platform, ...flags], env)) as { dependencies: Record<string, unknown> };
		const expo = JSON.parse(run("node", [autolinking, "resolve", "--json", "--platform", platform === "ios" ? "apple" : "android", ...flags], env)) as { modules: { packageName: string }[] };
		const names = { rn: Object.keys(rn.dependencies), expo: expo.modules.map((entry) => entry.packageName) };
		return { ...names, all: new Set([...names.rn, ...names.expo]) };
	}
	const smokeOnlyFor = (platform: "android" | "ios") => table.modules.filter((entry) => entry.link !== "js" && !entry.shared && entry.platforms.includes(platform)).flatMap((entry) => entry.packages);

	test("the product and the QA app exclude every smoke-only package; the smoke app excludes none", () => {
		expect(configuredExclude("production").toSorted()).toEqual([...smokeOnlyPackages].toSorted());
		expect(configuredExclude("qa").toSorted()).toEqual([...smokeOnlyPackages].toSorted());
		expect(configuredExclude("smoke")).toEqual([]);
	});
	for (const platform of ["android", "ios"] as const) {
		test(`${platform}: the QA app links exactly what the product links; the smoke app links that and the smoke-only packages with ${platform} code`, () => {
			const product = linked(platform, "production");
			const qa = linked(platform, "qa");
			const smoke = linked(platform, "smoke");
			expect([...product.all].filter((name) => smokeOnlyPackages.includes(name))).toEqual([]);
			expect([...qa.all].filter((name) => smokeOnlyPackages.includes(name))).toEqual([]);
			// The QA app is the build every gate measures: its autolinked set is the product's, package for package (what it was before the smoke test).
			expect([...qa.all].toSorted()).toEqual([...product.all].toSorted());
			expect([...qa.rn].toSorted()).toEqual([...product.rn].toSorted());
			expect([...smoke.all].filter((name) => !qa.all.has(name)).toSorted()).toEqual(smokeOnlyFor(platform).toSorted());
			expect([...qa.all].filter((name) => !smoke.all.has(name))).toEqual([]);
			// What the product (and so the QA app) keeps: Expo's own modules, the shared packages, and the native modules the app ships.
			const kept = ["expo-secure-store", "expo-localization", "expo-constants", "expo-asset", "expo-splash-screen", "expo-system-ui", platform === "android" ? "svelte-engine" : "svelte-screens-ios"];
			for (const name of kept) expect([name, qa.expo.includes(name)]).toEqual([name, true]);
			for (const name of ["react-native-reanimated", "react-native-webview", "react-native-maps"]) expect([name, qa.rn.includes(name)]).toEqual([name, true]);
		});
	}
	test("react-native.config.js, which the React Native community CLI reads, disables the same packages for every app but the smoke app", () => {
		const read = (variant: keyof typeof variantEnv) => JSON.parse(run("node", ["--input-type=module", "-e", "import('./react-native.config.js').then((config) => console.log(JSON.stringify(config.default)))"], { APP_VARIANT: variantEnv[variant] })) as { dependencies: Record<string, { platforms: Record<string, null> }> };
		for (const variant of ["production", "qa"] as const) {
			expect(Object.keys(read(variant).dependencies).toSorted()).toEqual([...smokeOnlyPackages].toSorted());
			expect(read(variant).dependencies["react-native-mmkv"]).toEqual({ platforms: { android: null, ios: null } });
		}
		expect(read("smoke").dependencies).toEqual({});
	});
	test("each app has its own id, name and scheme; the smoke app alone has the smoke test's plugins and the fake Firebase files", () => {
		expect(config("production").android.package).toBe("io.rasheed.app");
		expect(config("production").ios.bundleIdentifier).toBe("io.rasheed.app");
		expect(config("qa").android.package).toBe(packageOf.qa);
		expect(config("qa").ios.bundleIdentifier).toBe(packageOf.qa);
		expect(config("smoke").android.package).toBe(packageOf.smoke);
		expect(config("smoke").ios.bundleIdentifier).toBe(packageOf.smoke);
		expect([config("production").name, config("qa").name, config("smoke").name]).toEqual(["Rasheed", "Rasheed Svelte QA", "Svelte smoke"]);
		expect([config("production").scheme, config("qa").scheme, config("smoke").scheme]).toEqual(["rasheed", schemeOf.qa, schemeOf.smoke]);
		const smokePlugins = ["@react-native-firebase/app", "@react-native-firebase/messaging", "react-native-quick-crypto", "expo-samsung-pay", "@intercom/intercom-react-native", "expo-build-properties", "expo-notifications", "expo-location", "@config-plugins/react-native-adjust"];
		for (const variant of ["production", "qa"] as const) {
			const plugins = config(variant).plugins.map(pluginName);
			expect(smokePlugins.filter((name) => plugins.includes(name))).toEqual([]);
			expect(config(variant).android.googleServicesFile).toBeUndefined();
			expect(config(variant).ios.googleServicesFile).toBeUndefined();
		}
		const plugins = config("smoke").plugins.map(pluginName);
		expect(smokePlugins.filter((name) => !plugins.includes(name))).toEqual([]);
		expect(config("smoke").android.googleServicesFile).toBe("./qa/firebase-fake/google-services.json");
		expect(config("smoke").ios.googleServicesFile).toBe("./qa/firebase-fake/GoogleService-Info.plist");
	});
	test("Expo's own prebuild plugins (location and biometric permissions, notifications, screen orientation) do not run for the product and the QA app", () => {
		const script = `require("@expo/prebuild-config").getPrebuildConfigAsync(process.cwd(), { platforms: ["android", "ios"] }).then(({ exp }) => console.log(JSON.stringify(Object.fromEntries(["expo-location", "expo-local-authentication", "expo-notifications", "expo-screen-orientation"].map((name) => [name, exp._internal.pluginHistory[name]?.version ?? null])))))`;
		const history = (variant: keyof typeof variantEnv) => JSON.parse(run("node", ["-e", script], { APP_VARIANT: variantEnv[variant], EXPO_NO_TELEMETRY: "1", CI: "1" }).trim().split("\n").at(-1) as string) as Record<string, string | null>;
		// They would add ACCESS_FINE_LOCATION, USE_BIOMETRIC and the like to a manifest whose app does not link the module: a QA app that is not the product's.
		for (const variant of ["production", "qa"] as const)
			for (const [name, version] of Object.entries(history(variant))) expect([name, version]).toEqual([name, "left out of autolinking"]);
		for (const [name, version] of Object.entries(history("smoke"))) expect([name, version === null || version === "left out of autolinking"]).toEqual([name, false]);
	});
	test("the fake Firebase files are for the smoke app's id and hold no real key", () => {
		const android = JSON.parse(readFileSync(join(platformDir, "qa/firebase-fake/google-services.json"), "utf8")) as { client: { client_info: { android_client_info: { package_name: string } }; api_key: { current_key: string }[] }[] };
		expect(android.client[0]?.client_info.android_client_info.package_name).toBe(packageOf.smoke);
		expect(android.client[0]?.api_key[0]?.current_key).toContain("fake");
		const plist = readFileSync(join(platformDir, "qa/firebase-fake/GoogleService-Info.plist"), "utf8");
		expect(plist).toContain(`<string>${packageOf.smoke}</string>`);
		expect(plist).not.toMatch(/AIza/);
	});
});

describe("the variants of the harness", () => {
	test("--variant: absent is the QA app, qa and smoke are accepted, anything else is refused", () => {
		expect(variantFlag(undefined)).toBe("qa");
		expect(variantFlag("qa")).toBe("qa");
		expect(variantFlag("smoke")).toBe("smoke");
		expect(() => variantFlag("production")).toThrow(/--variant must be qa or smoke/);
	});
	test("the QA app keeps the file names every other command reads; the smoke app's carry the variant", () => {
		expect(apkPath("qa", "x86_64").endsWith("/qa/out/app-x86_64.apk")).toBe(true);
		expect(apkPath("smoke", "x86_64").endsWith("/qa/out/app-smoke-x86_64.apk")).toBe(true);
		expect(buildLogName("qa", "arm64-v8a")).toBe("build-arm64-v8a.log");
		expect(buildLogName("smoke", "arm64-v8a")).toBe("build-smoke-arm64-v8a.log");
		expect(iosBuildName("qa")).toBe("ios-build.json");
		expect(iosBuildName("smoke")).toBe("ios-build-smoke.json");
		expect(buildFileKey({ abi: "x86_64" })).toBe("x86_64");
		expect(buildFileKey({ abi: "x86_64", variant: "qa" })).toBe("x86_64");
		expect(buildFileKey({ abi: "x86_64", variant: "smoke" })).toBe("smoke-x86_64");
	});
	test("android/ holds one variant; building the other parks it as android-<variant> and brings the other back", async () => {
		const base = mkdtempSync(join(tmpdir(), "native-qa-variant-"));
		const dir = join(base, "android");
		const project = (variant: string, content: string) => {
			mkdirSync(join(dir, "app"), { recursive: true });
			writeFileSync(join(dir, "app/build.gradle"), content);
			writeFileSync(join(dir, ".native-qa-variant"), `${variant}\n`);
		};
		const entries = () => readdirSync(base).toSorted();
		// Nothing there: the caller prebuilds.
		expect(await generatedFor(dir)).toBeNull();
		expect(await selectVariantProject("qa", dir)).toMatch(/is missing/);
		// A project made before variants existed (no marker) is the QA app.
		mkdirSync(join(dir, "app"), { recursive: true });
		writeFileSync(join(dir, "app/build.gradle"), "qa 1");
		expect(await generatedFor(dir)).toBe("qa");
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(entries()).toEqual(["android"]);
		// The smoke app is asked for: the QA project is parked and the caller prebuilds the smoke one.
		expect(await selectVariantProject("smoke", dir)).toMatch(/was generated for the qa app, and none is parked for smoke/);
		expect(entries()).toEqual(["android-qa"]);
		project("smoke", "smoke 1");
		expect(await generatedFor(dir)).toBe("smoke");
		// Back to the QA app: its own project returns, with its own files, and the smoke one is parked.
		expect(await selectVariantProject("qa", dir)).toBeNull();
		expect(entries()).toEqual(["android", "android-smoke"]);
		expect(await generatedFor(dir)).toBe("qa");
		expect(await generatedFor(`${dir}-smoke`)).toBe("smoke");
		// And forth again.
		expect(await selectVariantProject("smoke", dir)).toBeNull();
		expect(await generatedFor(dir)).toBe("smoke");
		expect(entries()).toEqual(["android", "android-qa"]);
	});
	test("build.ts sets APP_VARIANT itself, so the shell's cannot change which app is built", () => {
		expect(appVariantOf).toEqual({ qa: "", smoke: "smoke" });
		const source = readFileSync(join(platformDir, "qa/commands/build.ts"), "utf8");
		expect(source).toContain("APP_VARIANT: appVariantOf[variant]");
	});
	test("the iOS build prebuilds the variant on the Mac, into its own record", () => {
		const source = readFileSync(join(platformDir, "qa/commands/ios-build.ts"), "utf8");
		expect(source).toContain("APP_VARIANT=${appVariantOf[variant]}`");
		expect(source).toContain("writeIosBuild(");
		expect(source).toContain("}, variant);");
	});
	test("the smoke command installs and launches the smoke app, not the QA app", () => {
		const source = readFileSync(join(platformDir, "qa/commands/smoke.ts"), "utf8");
		expect(source).toContain("packageOf.smoke");
		expect(source).toContain('variant: "smoke"');
		expect(source).toContain("schemeOf.smoke");
		expect(source).not.toContain("defaultPackage");
		expect(defaultApkPath("x86_64", "smoke")).toBe(apkPath("smoke", "x86_64"));
		expect(defaultApkPath("x86_64")).toBe(apkPath("qa", "x86_64"));
	});
	test("the QA lanes do not run the smoke test; the smoke lane builds the smoke app first", () => {
		const scripts = (JSON.parse(readFileSync(join(platformDir, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
		expect(scripts["native-qa:emulator"]).not.toContain("smoke");
		expect(scripts["native-qa:suites"]).not.toContain("smoke");
		expect(scripts["native-qa:smoke"]).toContain("build --abi x86_64 --variant smoke && node qa/native-qa.ts smoke");
		expect(scripts["native-qa:smoke"]).toContain("gates --platform android --smoke");
	});
	test("the smoke gates are their own lane: the QA lane has none of them, the smoke lane only them", () => {
		const lanes = splitGates(gatesFile.gates);
		expect(lanes.smoke.map((gate) => gate.id)).toEqual(["smoke.failed", "smoke.missing"]);
		expect(lanes.standard.some((gate) => gate.metric.startsWith("smoke."))).toBe(false);
		expect(lanes.standard.length + lanes.smoke.length).toBe(gatesFile.gates.length);
		// A QA report with no smoke run passes the QA lane's smoke part by not having it, and the smoke lane reads not measured.
		const device = { "localhost:5555": { platform: "android" as const, role: "lab" as const, runs: gatesFile.devices["localhost:5555"]?.runs ?? null, metrics: {} } };
		expect(evaluate(lanes.standard, device, "android").some((row) => row.id.startsWith("smoke"))).toBe(false);
		expect(evaluate(lanes.smoke, device, "android").map((row) => row.verdict)).toEqual(["not measured", "not measured"]);
	});
});
