import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { checkGatesFile, evaluate, gateKinds, splitGates, type GatesFile } from "../lib/gates.ts";
import { buildFileKey } from "../lib/runs.ts";
import { apkPath, buildLogName, iosBuildName, packageOf, schemeOf, variantFlag } from "../lib/variant.ts";
import { deviceMetrics } from "../lib/metrics.ts";
import { platformDir } from "../lib/paths.ts";
import { describeSmoke, judgeSmoke, missingModules, smokeMetrics, unexpectedSkips, unpinnedModules } from "../lib/smoke.ts";
import type { SmokeFile, SmokeModuleResult } from "../lib/types.ts";
import { parseSmokeBody, parseSmokeCompletion, parseSmokeResults } from "../parse/smoke.ts";
import { moduleResults, parseSmokeResultsFile } from "../commands/ios-smoke.ts";
import { ascii, decodeBase64, encodeBase64, hex, looksRandom } from "../../src/lib/native/dev/smoke-bytes.ts";
import { smokeModules } from "../../src/lib/native/dev/smoke-rules.ts";
import { alwaysLinkedPackages } from "../../../../packages/expo-svelte/src/vendored.ts";
import { formatSmokeLine as format, formatSmokeSummary as summarize, oneLine, type SmokePath } from "../../src/lib/native/dev/smoke-log.ts";

/** The packages only the smoke app links or bundles: the CommonJS file app.config.ts and react-native.config.js read. */
const { smokeOnlyPackages, smokeOnlyBundlePackages, libraryVendoredPackages } = createRequire(import.meta.url)("../smoke-packages.cjs") as { smokeOnlyPackages: string[]; smokeOnlyBundlePackages: string[]; libraryVendoredPackages: string[] };
/** The local Expo modules for the QA lab only (`qaOnlyModules` in app.config.ts), and the ones of them each platform links: the touch injector and the view bench are Android's, SvelteQA is iOS's. */
const qaOnlyModules = ["svelte-qa-android", "svelte-qa-ios", "view-bench"];
const qaOnlyLinked = { android: ["svelte-qa-android", "view-bench"], ios: ["svelte-qa-ios"] };
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
	app: { package: "dev.alfayez.exposvelte.qa", versionName: "0.1.0", versionCode: 1, lastUpdateTime: null, installedSha256: "x", apk: null },
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
		const line = formatSmokeLine(result("hms", "skip", "Android only: the library has no iOS code", "none", 0));
		expect(line).toBe("[Svelte smoke] hms skip path=none ms=0 Android only: the library has no iOS code");
		expect(parseSmokeBody(line.slice("[Svelte smoke] ".length))).toEqual(result("hms", "skip", "Android only: the library has no iOS code", "none", 0));
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
	test("the iPhone's results file carries the build the app reports, which a run judges against the build record; an app that reports none leaves null", () => {
		const build = { jsbundleSha256: "a".repeat(64), cdHash: "b".repeat(40) };
		const text = (extra: Record<string, unknown>) => JSON.stringify({ token: "t1", finishedAt: "2026-11-01T12:00:00Z", os: "ios", results: [result("a")], ...extra });
		expect(parseSmokeResultsFile(text({ build }))?.build).toEqual(build);
		expect(parseSmokeResultsFile(text({}))?.build).toBeNull();
		expect(parseSmokeResultsFile(text({ build: { jsbundleSha256: "short" } }))?.build).toBeNull();
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
		expect(encodeBase64(ascii("Expo Svelte"))).toBe("RXhwbyBTdmVsdGU=");
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
	const pins = { modules: ["a", "b", "c", "d"], skips: ["c"] };
	const pinned = pins.modules;
	test("a clean run: all pinned modules reported, none failed, the listed skip skipped", () => {
		const metrics = smokeMetrics(smokeFile([result("a"), result("b"), result("c", "skip"), result("d")]), pins);
		expect(metrics).toEqual({ "smoke.modules": 4, "smoke.ok": 3, "smoke.failed": 0, "smoke.skipped": 1, "smoke.unexpectedSkips": 0, "smoke.missing": 0, "smoke.unpinned": 0, "smoke.fatals": 0, "smoke.jsErrors": 0, "smoke.complete": 1 });
	});
	test("a failure counts as failed and as reported; a module that never logged is missing", () => {
		const file = smokeFile([result("a"), result("b", "fail")], { complete: false });
		expect(missingModules(file.results, pinned)).toEqual(["c", "d"]);
		const metrics = smokeMetrics(file, pins);
		expect(metrics["smoke.failed"]).toBe(1);
		expect(metrics["smoke.missing"]).toBe(2);
		expect(metrics["smoke.complete"]).toBe(0);
	});
	test("a skip the platform does not list is unexpected; the listed one is not", () => {
		const file = smokeFile([result("a", "skip"), result("b"), result("c", "skip"), result("d")]);
		expect(unexpectedSkips(file.results, pins)).toEqual(["a"]);
		expect(smokeMetrics(file, pins)["smoke.unexpectedSkips"]).toBe(1);
		// A skip of a module the list does not pin is not this metric's (it is `smoke.unpinned`).
		expect(unexpectedSkips([result("x", "skip")], pins)).toEqual([]);
	});
	test("crashes and an interruption are fatals, whatever the run logged before", () => {
		const file = smokeFile([result("a"), result("b"), result("c", "skip"), result("d")], { crashes: ["FATAL EXCEPTION Process: dev.alfayez.exposvelte.qa.smoke", "interrupted by com.android.settings at 12:00:00.000"], complete: false, jsErrorCount: 3 });
		const metrics = smokeMetrics(file, pins);
		expect(metrics["smoke.fatals"]).toBe(2);
		expect(metrics["smoke.complete"]).toBe(0);
		expect(metrics["smoke.jsErrors"]).toBe(3);
		expect(metrics["smoke.ok"]).toBe(3);
	});
	test("a phone's crash log that could not be read leaves the fatals not measured, unless a crash is already counted", () => {
		const unread = { crashReportsError: "after the run: over USB: no phone; through devicectl: the device was not found" };
		expect(smokeMetrics(smokeFile([result("a")], unread), pins)["smoke.fatals"]).toBeNull();
		// A dead app is a fatal whatever the log says; a log that was read (an empty list) is a measured zero.
		expect(smokeMetrics(smokeFile([result("a")], { ...unread, crashes: ["the app (pid 12) was not running before the smoke test finished"] }), pins)["smoke.fatals"]).toBe(1);
		expect(smokeMetrics(smokeFile([result("a")], { crashReports: [] }), pins)["smoke.fatals"]).toBe(0);
	});
	test("a module the list does not pin is reported, not counted as ok or failed", () => {
		const file = smokeFile([result("a"), result("x", "fail"), result("b"), result("c"), result("d")]);
		expect(unpinnedModules(file.results, pinned)).toEqual(["x"]);
		const metrics = smokeMetrics(file, pins);
		expect(metrics["smoke.failed"]).toBe(0);
		expect(metrics["smoke.unpinned"]).toBe(1);
	});
	test("describeSmoke names every failure, skip (unexpected ones marked), missing module and an incomplete run", () => {
		const lines = describeSmoke(smokeFile([result("a", "skip", "why"), result("b", "fail", "boom"), result("c", "skip", "Huawei only")], { crashes: ["FATAL EXCEPTION Process: dev.alfayez.exposvelte.qa"], complete: false }), pins).join("\n");
		expect(lines).toContain("FAIL b (js): boom");
		expect(lines).toContain("UNEXPECTED SKIP a: why");
		expect(lines).toContain("skip c: Huawei only");
		expect(lines).not.toContain("UNEXPECTED SKIP c");
		expect(lines).toContain("MISSING d");
		expect(lines).toContain("fatal: FATAL EXCEPTION");
		expect(lines).toContain("the run did not complete");
		expect(lines).toContain("0 ok, 1 failed, 2 skipped, 1 missing of 4 pinned");
	});
	test("the run kind is smoke, and its gates belong to it", () => {
		expect(gateKinds({ id: "x", title: "", unit: "", metric: "smoke.failed", bar: {} })).toEqual(["smoke"]);
	});
	test("the smoke gates: complete, no fatals, no failure, none missing, no unexpected skip, enough answers; every platform, every role", () => {
		const gate = (id: string) => gatesFile.gates.find((entry) => entry.id === id);
		expect(gate("smoke.complete")?.bar).toEqual({ android: { min: 1 }, ios: { min: 1 } });
		for (const id of ["smoke.fatals", "smoke.failed", "smoke.missing", "smoke.unexpectedSkips"]) expect([id, gate(id)?.bar]).toEqual([id, { android: { max: 0 }, ios: { max: 0 } }]);
		for (const id of ["smoke.complete", "smoke.fatals", "smoke.failed", "smoke.missing", "smoke.unexpectedSkips", "smoke.ok"]) expect([id, gate(id)?.roles]).toEqual([id, undefined]);
		expect(() => checkGatesFile(gatesFile)).not.toThrow();
	});
	test("smoke.ok is every pinned module but the skips listed for the platform", () => {
		for (const platform of ["android", "ios"] as const) {
			const skips = gatesFile.smoke.skips[platform];
			for (const module of skips) expect([module, gatesFile.smoke.modules[platform].includes(module)]).toEqual([module, true]);
			expect(gatesFile.gates.find((entry) => entry.id === "smoke.ok")?.bar[platform]).toEqual({ min: gatesFile.smoke.modules[platform].length - skips.length });
		}
		// Only libraries that have no code, or no service to call, on the platform may skip.
		expect(gatesFile.smoke.skips.android).toEqual(["hms", "web-browser"]);
		expect(gatesFile.smoke.skips.ios).toEqual(["web-browser", "hms"]);
	});
	const clean = { "smoke.complete": 1, "smoke.fatals": 0, "smoke.failed": 0, "smoke.missing": 0, "smoke.unexpectedSkips": 0, "smoke.ok": 33 };
	const verdicts = (serial: string, metrics: Record<string, number | null>) =>
		Object.fromEntries(evaluate(splitGates(gatesFile.gates).smoke, { [serial]: { platform: "android", role: gatesFile.devices[serial]?.role ?? null, runs: gatesFile.devices[serial]?.runs ?? null, metrics } }, "android").map((row) => [row.id, row.verdict]));
	test("the Samsung (phone) and the emulator (lab) pass a clean run, and each deviation fails its own gate and no other", () => {
		const gates = ["smoke.complete", "smoke.fatals", "smoke.failed", "smoke.missing", "smoke.unexpectedSkips", "smoke.ok"];
		for (const serial of ["R58Y90KNGRP", "localhost:5555"]) {
			expect(Object.values(verdicts(serial, clean))).toEqual(gates.map(() => "pass"));
			for (const [metric, value, gate] of [["smoke.complete", 0, "smoke.complete"], ["smoke.fatals", 1, "smoke.fatals"], ["smoke.failed", 1, "smoke.failed"], ["smoke.missing", 2, "smoke.missing"], ["smoke.unexpectedSkips", 1, "smoke.unexpectedSkips"], ["smoke.ok", 32, "smoke.ok"]] as const) {
				const deviated = verdicts(serial, { ...clean, [metric]: value });
				expect([serial, metric, gates.filter((id) => deviated[id] === "fail")]).toEqual([serial, metric, [gate]]);
			}
		}
		// 34 answers (web-browser answered too) is still a pass.
		expect(verdicts("R58Y90KNGRP", { ...clean, "smoke.ok": 34 })["smoke.ok"]).toBe("pass");
	});
	test("a device that never ran the smoke test fails the gates (not measured) rather than skipping them", () => {
		expect(Object.values(verdicts("localhost:5555", {}))).toEqual(["not measured", "not measured", "not measured", "not measured", "not measured", "not measured"]);
	});
	test("a run that did not complete, or crashed, or has too few answers fails the gates the smoke command judges, whatever else it logged", async () => {
		const modules = gatesFile.smoke.modules.android;
		const answered = modules.map((module) => result(module, gatesFile.smoke.skips.android.includes(module) ? "skip" : "ok"));
		expect((await judgeSmoke(smokeFile(answered), gatesFile)).ok).toBe(true);
		const incomplete = await judgeSmoke(smokeFile(answered, { complete: false }), gatesFile);
		expect(incomplete.ok).toBe(false);
		expect(incomplete.lines.join("\n")).toContain("smoke.complete fail");
		const crashed = await judgeSmoke(smokeFile(answered, { complete: false, crashes: ["FATAL EXCEPTION"] }), gatesFile);
		expect(crashed.lines.join("\n")).toContain("smoke.fatals fail");
		const wrongSkip = await judgeSmoke(smokeFile(modules.map((module) => result(module, module === "mmkv" || module === "hms" ? "skip" : "ok"))), gatesFile);
		expect(wrongSkip.lines.join("\n")).toContain("smoke.unexpectedSkips fail");
		// A run with no results at all (the lab never reached the scenario) fails everything that counts them.
		const nothing = await judgeSmoke(smokeFile([]), gatesFile);
		expect(nothing.ok).toBe(false);
		expect(nothing.lines.join("\n")).toContain("smoke.missing fail");
		expect(nothing.lines.join("\n")).toContain("smoke.ok fail");
	});
	test("deviceMetrics carries the smoke metrics next to the others", () => {
		const metrics = deviceMetrics(null, null, [], null, null, { parity: null, a11y: null, resilience: null }, { file: smokeFile([result("a")]), pins: { modules: ["a"], skips: [] } });
		expect(metrics["smoke.failed"]).toBe(0);
		expect(metrics["smoke.missing"]).toBe(0);
		expect(metrics["smoke.ok"]).toBe(1);
	});
	test("checkGatesFile refuses a missing, empty or repeating module list, and skips that are not pinned modules", () => {
		const good = JSON.parse(JSON.stringify(gatesFile)) as GatesFile;
		const without = JSON.parse(JSON.stringify(gatesFile)) as Partial<GatesFile>;
		delete without.smoke;
		expect(() => checkGatesFile(without as GatesFile)).toThrow(/smoke.modules pins no module for android/);
		good.smoke.modules.ios = [];
		expect(() => checkGatesFile(good)).toThrow(/pins no module for ios/);
		good.smoke.modules.ios = ["a", "a"];
		expect(() => checkGatesFile(good)).toThrow(/names a module twice for ios/);
		const other = JSON.parse(JSON.stringify(gatesFile)) as GatesFile;
		other.smoke.skips.android = ["hms", "nope"];
		expect(() => checkGatesFile(other)).toThrow(/smoke.skips names nope/);
		delete (other.smoke as Partial<GatesFile["smoke"]>).skips;
		expect(() => checkGatesFile(other)).toThrow(/smoke.skips lists no skips/);
	});
});

/** The ids the checks report (smoke-checks.ts loads without React Native: each check requires its library when it runs), and the ids the runner and the page list. */
// Loaded by path, not imported: its imports reach the app's own types, which `tsc -p qa` should not take on.
type Check = { module: string; path: string; only?: "android" | "ios" };
const { checks } = (await import(join(platformDir, "src/lib/native/dev/smoke-checks.ts"))) as { checks: Check[] };
const checked = checks.map((check) => check.module);
const listed = [...smokeModules];
const table = JSON.parse(readFileSync(join(platformDir, "qa/smoke-modules.json"), "utf8")) as { modules: { id: string; packages: string[]; link: string; shared: boolean; platforms: string[] }[] };
const packageJson = JSON.parse(readFileSync(join(platformDir, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
/** The library's own package.json: the packages it carries itself (`libraryVendoredPackages`) are no one's dependency, and none is one of its peers. */
const libraryPackageJson = JSON.parse(readFileSync(join(platformDir, "../../packages/expo-svelte/package.json"), "utf8")) as { peerDependencies: Record<string, string> };

describe("the pinned list, the module table and the checks agree", () => {
	test("gates.json pins exactly the modules the page checks, for both platforms, in the order they run", () => {
		expect(checked).toHaveLength(35);
		// The runner lists the ids itself, so the page can show them without carrying the checks (Metro stubs smoke-checks.ts outside the smoke app).
		expect(listed).toEqual(checked);
		expect(gatesFile.smoke.modules.android).toEqual(checked);
		expect(gatesFile.smoke.modules.ios).toEqual(checked);
	});
	test("qa/smoke-modules.json lists the same modules", () => {
		expect(table.modules.map((entry) => entry.id).toSorted()).toEqual([...checked].toSorted());
	});
	test("every package of the table is a dependency of the QA app, at the version a real app uses", () => {
		const used = { ...packageJson.dependencies, ...packageJson.devDependencies };
		for (const entry of table.modules) for (const name of entry.packages) expect([name, name in used]).toEqual([name, true]);
		// Versions the task fixes (a real app's package.json), as specifiers.
		expect(used["@react-native-async-storage/async-storage"]).toBe("2.2.0");
		expect(used["@react-native-community/netinfo"]).toBe("12.0.1");
		expect(used["@react-native-firebase/app"]).toBe("^24.0.0");
		expect(used["@sentry/react-native"]).toBe("~8.28.0");
		expect(used["@intercom/intercom-react-native"]).toBe("10.7.0");
		// The packages the library carries itself (packages/expo-svelte/VENDORING.md) are not stand-ins here any more: the smoke app takes the vendored copy, so no variant lists them, and the table has the modules without a package
		// (the nitro, mmkv, quick-crypto and quick-base64 ones; the animation, gesture and svg packages have no module of the smoke test). The list is the library's own: its always-linked packages (the optional libraries are the app's to turn on), except hermes-intl, which has no module in the smoke test.
		expect([...libraryVendoredPackages].toSorted()).toEqual(alwaysLinkedPackages.map((vendored) => vendored.name).filter((name) => name !== "hermes-intl").toSorted());
		for (const name of libraryVendoredPackages) {
			expect([name, name in used, name in libraryPackageJson.peerDependencies, table.modules.some((entry) => entry.packages.includes(name))]).toEqual([name, false, false, false]);
		}
		expect(table.modules.filter((entry) => ["mmkv", "quick-crypto", "quick-base64", "nitro"].includes(entry.id)).map((entry) => [entry.id, entry.packages, entry.shared])).toEqual([["mmkv", [], true], ["quick-crypto", [], true], ["quick-base64", [], true], ["nitro", [], true]]);
		expect(used["react-native-get-random-values"]).toBe("~2.0.0");
		expect(used["react-native-live-direction"]).toBe("0.1.1");
	});
	test("the packages the product already links are not in the exclusion list; a module on one platform says so", () => {
		for (const shared of ["expo-secure-store", "expo-localization", "expo-constants", "expo-asset", "expo-system-ui", "expo-splash-screen"]) expect(smokeOnlyPackages).not.toContain(shared);
		expect(smokeOnlyPackages).not.toContain("@statsig/react-native-bindings");
		for (const name of ["@react-native-async-storage/async-storage", "@sentry/react-native", "@react-native-firebase/app", "expo-haptics", "@hmscore/react-native-hms-location"]) expect(smokeOnlyPackages).toContain(name);
		// The library carries these four (`crypto` is made of quick-crypto and quick-base64, `localStorage` of MMKV and the Nitro runtime): every app links and bundles all four; the smoke test still checks them.
		for (const name of libraryVendoredPackages) expect([name, smokeOnlyPackages.includes(name), smokeOnlyBundlePackages.includes(name)]).toEqual([name, false, false]);
		for (const module of ["mmkv", "quick-crypto", "quick-base64", "nitro"]) expect([module, checked.includes(module)]).toEqual([module, true]);
		expect(table.modules.find((entry) => entry.id === "hms")?.platforms).toEqual(["android"]);
		// The libraries with code for one platform say so in their check, which then skips on the other.
		expect(checks.filter((check) => check.only !== undefined).map((check) => [check.module, check.only])).toEqual([["web-browser", "android"], ["hms", "android"]]);
		for (const entry of table.modules.filter((module) => module.platforms.length === 1)) expect([entry.id, checks.find((check) => check.module === entry.id)?.only]).toEqual([entry.id, entry.platforms[0]]);
	});
});

/** Runs a command in the QA app and returns its output (the autolinkers print JSON). */
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
		const plugin = config(variant).plugins.find((entry) => pluginName(entry) === "expo-svelte") as [string, { autolinkingExclude: string[] }];
		return plugin[1].autolinkingExclude;
	}
	/** The optional libraries the library carries that a variant turns on (`libraries` of the Svelte native plugin's options, which the evaluated config keeps), and the Expo modules among them. */
	function libraries(variant: keyof typeof variantEnv): { names: string[]; expo: string[] } {
		const plugin = config(variant).plugins.find((entry) => pluginName(entry) === "expo-svelte") as [string, { libraries?: Record<string, unknown> }];
		const names = Object.entries(plugin[1].libraries ?? {}).filter(([, value]) => value !== false).map(([name]) => name);
		return { names, expo: names.filter((name) => /^expo-/.test(name)) };
	}
	/**
	 * The packages each autolinker would link for a platform, given what the build passes both: settings.gradle's `--exclude` list / the Podfile's, the libraries the app turned on (`--link` for the
	 * library's own `android-autolinking` / `ios-autolinking` around React Native's command, and the directory of each Expo module as a search path of Expo's, after the `--` the generated block writes).
	 */
	function linked(platform: "android" | "ios", variant: keyof typeof variantEnv): { rn: string[]; expo: string[]; all: Set<string>; raw: string[] } {
		const flags = configuredExclude(variant).flatMap((name) => ["--exclude", name]);
		const env = { APP_VARIANT: variantEnv[variant], EXPO_NO_TELEMETRY: "1", CI: "1" };
		const on = libraries(variant);
		const cli = join(platformDir, "../../packages/expo-svelte/dist/node/cli.js");
		const vendor = (name: string) => join(platformDir, "../../packages/expo-svelte/vendor", name);
		// What React Native's own config command prints (Expo's), and the same through the library's command: the first is what the app's dependencies give, the second what the build links.
		const raw = JSON.parse(run("node", [autolinking, "react-native-config", "--json", "--platform", platform, ...flags], env)) as { dependencies: Record<string, unknown> };
		const rn = JSON.parse(run("node", [cli, `${platform}-autolinking`, ...on.names.flatMap((name) => ["--link", name]), "node", autolinking, "react-native-config", "--json", "--platform", platform, ...flags], env)) as { dependencies: Record<string, unknown> };
		const expo = JSON.parse(run("node", [autolinking, "resolve", "--json", "--platform", platform === "ios" ? "apple" : "android", ...flags, ...(on.expo.length === 0 ? [] : ["--", ...on.expo.map(vendor)])], env)) as { modules: { packageName: string }[] };
		const names = { rn: Object.keys(rn.dependencies), expo: expo.modules.map((entry) => entry.packageName) };
		return { ...names, all: new Set([...names.rn, ...names.expo]), raw: Object.keys(raw.dependencies) };
	}
	const smokeOnlyFor = (platform: "android" | "ios") => table.modules.filter((entry) => entry.link !== "js" && !entry.shared && entry.platforms.includes(platform)).flatMap((entry) => entry.packages);

	// One exclusion list serves the smoke test's libraries and the QA-only modules (product-modules.test.ts checks the second half).
	test("the product and the QA app exclude every smoke-only package, the product the QA-only modules as well; the smoke app excludes none", () => {
		expect(configuredExclude("production").toSorted()).toEqual([...smokeOnlyPackages, ...qaOnlyModules].toSorted());
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
			// The QA app is the build every gate measures: its autolinked set is the product's, package for package (what it was before the smoke test),
			// plus the QA-only modules the product leaves out (the touch injector, the iOS inspection module, the view bench).
			expect([...qa.all].filter((name) => !qaOnlyModules.includes(name)).toSorted()).toEqual([...product.all].toSorted());
			expect([...qa.all].filter((name) => !product.all.has(name)).toSorted()).toEqual(qaOnlyLinked[platform].toSorted());
			expect([...qa.rn].toSorted()).toEqual([...product.rn].toSorted());
			expect([...smoke.all].filter((name) => !qa.all.has(name)).toSorted()).toEqual(smokeOnlyFor(platform).toSorted());
			expect([...qa.all].filter((name) => !smoke.all.has(name))).toEqual([]);
			// What the product (and so the QA app) keeps: Expo's own modules, the shared packages, and the library's native modules (one package, `expo-svelte`: the engine on Android, the screens pod on iOS) the app ships.
			const kept = ["expo-secure-store", "expo-localization", "expo-constants", "expo-asset", "expo-splash-screen", "expo-system-ui", "expo-svelte"];
			for (const name of kept) expect([name, qa.expo.includes(name)]).toEqual([name, true]);
			for (const name of ["react-native-reanimated", "react-native-webview", "react-native-maps"]) expect([name, qa.rn.includes(name)]).toEqual([name, true]);
			// Expo's own autolinker finds none of the library's vendored packages in the app's dependencies (`react-native-quick-base64` is still in node_modules, for the Buffer package, and found there; so are gesture handler,
			// Reanimated and Worklets, which a package manager installs for Expo Router's peers, and which the library's command replaces): the library's autolinking commands add the copies, so the packages the build links (`rn`)
			// have them all and what the app's dependencies give (`raw`) has none but those.
			const foundAnyway = ["react-native-quick-base64", "react-native-gesture-handler", "react-native-reanimated", "react-native-worklets"];
			for (const name of libraryVendoredPackages.filter((vendored) => !foundAnyway.includes(vendored))) expect([name, qa.raw.includes(name), product.raw.includes(name), smoke.raw.includes(name), qa.rn.includes(name), product.rn.includes(name), smoke.rn.includes(name)]).toEqual([name, false, false, false, true, true, true]);
			for (const name of foundAnyway) expect([name, qa.rn.includes(name), product.rn.includes(name), smoke.rn.includes(name)]).toEqual([name, true, true, true]);
		}, 60_000); // runs both real autolinkers three times: seconds on a busy machine
	}
	test("react-native.config.js, which the React Native community CLI reads, disables the same packages for every app but the smoke app", () => {
		const read = (variant: keyof typeof variantEnv) => JSON.parse(run("node", ["--input-type=module", "-e", "import('./react-native.config.js').then((config) => console.log(JSON.stringify(config.default)))"], { APP_VARIANT: variantEnv[variant] })) as { dependencies: Record<string, { platforms: Record<string, null> }> };
		for (const variant of ["production", "qa"] as const) {
			expect(Object.keys(read(variant).dependencies).toSorted()).toEqual([...smokeOnlyPackages].toSorted());
			expect(read(variant).dependencies["@react-native-async-storage/async-storage"]).toEqual({ platforms: { android: null, ios: null } });
			for (const name of libraryVendoredPackages) expect([name, read(variant).dependencies[name]]).toEqual([name, undefined]);
		}
		expect(read("smoke").dependencies).toEqual({});
	});
	test("each app has its own id, name and scheme; the smoke app alone has the smoke test's plugins and the fake Firebase files", () => {
		expect(config("production").android.package).toBe("dev.alfayez.exposvelte.qaproduct");
		expect(config("production").ios.bundleIdentifier).toBe("dev.alfayez.exposvelte.qaproduct");
		expect(config("qa").android.package).toBe(packageOf.qa);
		expect(config("qa").ios.bundleIdentifier).toBe(packageOf.qa);
		expect(config("smoke").android.package).toBe(packageOf.smoke);
		expect(config("smoke").ios.bundleIdentifier).toBe(packageOf.smoke);
		expect([config("production").name, config("qa").name, config("smoke").name]).toEqual(["Svelte QA product", "Expo Svelte QA", "Svelte smoke"]);
		expect([config("production").scheme, config("qa").scheme, config("smoke").scheme]).toEqual(["svelte-qa-product", schemeOf.qa, schemeOf.smoke]);
		const smokePlugins = ["@react-native-firebase/app", "@react-native-firebase/messaging", "@intercom/intercom-react-native", "expo-build-properties", "expo-notifications", "expo-location", "@config-plugins/react-native-adjust"];
		for (const variant of ["production", "qa"] as const) {
			const plugins = config(variant).plugins.map(pluginName);
			expect(smokePlugins.filter((name) => plugins.includes(name))).toEqual([]);
			expect(config(variant).android.googleServicesFile).toBeUndefined();
			expect(config(variant).ios.googleServicesFile).toBeUndefined();
		}
		const plugins = config("smoke").plugins.map(pluginName);
		expect(smokePlugins.filter((name) => !plugins.includes(name))).toEqual([]);
		// libsodium for `crypto`: a real app's `["react-native-quick-crypto", { sodiumEnabled: true }]` is an option of the library's plugin now, on in the smoke app alone. No app lists quick-crypto's own plugin: the package is not installed.
		const sodiumOf = (variant: keyof typeof variantEnv) => (config(variant).plugins.find((entry) => pluginName(entry) === "expo-svelte") as [string, { sodiumEnabled?: boolean }])[1].sodiumEnabled;
		expect([sodiumOf("production"), sodiumOf("qa"), sodiumOf("smoke")]).toEqual([undefined, undefined, true]);
		for (const variant of ["production", "qa", "smoke"] as const) expect([variant, config(variant).plugins.map(pluginName).includes("react-native-quick-crypto")]).toEqual([variant, false]);
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
		// FirebaseInstallations raises in `FIRApp configure`, at launch, unless the key is 39 url-safe characters that start with `A`: the first iOS smoke app aborted there on a key that was only fake.
		expect(plist).toMatch(/<key>API_KEY<\/key>\s*<string>A[A-Za-z0-9_-]{38}<\/string>/);
	});
});

describe("the variants of the harness", () => {
	test("--variant: absent is the QA app, qa, smoke and production are accepted, anything else is refused", () => {
		expect(variantFlag(undefined)).toBe("qa");
		expect(variantFlag("qa")).toBe("qa");
		expect(variantFlag("smoke")).toBe("smoke");
		expect(variantFlag("production")).toBe("production");
		expect(() => variantFlag("release")).toThrow(/--variant must be qa, smoke or production/);
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
	test("each app's build record has a file of its own, named like its APK, so the product's never replaces the QA app's", () => {
		for (const variant of ["qa", "smoke", "production"] as const) {
			const stem = apkPath(variant, "x86_64").replace(/^.*\/app-/, "").replace(/\.apk$/, "");
			expect(buildFileKey({ abi: "x86_64", variant })).toBe(stem);
			expect(buildLogName(variant, "x86_64")).toBe(`build-${stem}.log`);
		}
		expect(buildFileKey({ abi: "x86_64", variant: "production" })).toBe("production-x86_64");
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
		expect(lanes.smoke.map((gate) => gate.id)).toEqual(["smoke.complete", "smoke.fatals", "smoke.failed", "smoke.missing", "smoke.unexpectedSkips", "smoke.ok"]);
		expect(lanes.standard.some((gate) => gate.metric.startsWith("smoke."))).toBe(false);
		expect(lanes.standard.length + lanes.smoke.length).toBe(gatesFile.gates.length);
		// A QA report with no smoke run passes the QA lane's smoke part by not having it, and the smoke lane reads not measured.
		const device = { "localhost:5555": { platform: "android" as const, role: "lab" as const, runs: gatesFile.devices["localhost:5555"]?.runs ?? null, metrics: {} } };
		expect(evaluate(lanes.standard, device, "android").some((row) => row.id.startsWith("smoke"))).toBe(false);
		expect(evaluate(lanes.smoke, device, "android").map((row) => row.verdict)).toEqual(lanes.smoke.map(() => "not measured"));
	});
});
