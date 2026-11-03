import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { analyseSources, bundleChecks, describeForeign, failedChecks, foreignMetrics, libraryModules, missingPlaces } from "../lib/foreign.ts";
import { checkGatesFile, evaluate, type GatesFile } from "../lib/gates.ts";
import { platformDir } from "../lib/paths.ts";
import { findButton, parsePress } from "../lib/foreign-press.ts";
import { parseForeignChecks } from "../parse/foreign.ts";
import { argb, clear, distance, hex, near, numberIn, show, solid } from "../../src/lib/native/dev/foreign-pixels.ts";
import type { ForeignCheck, ForeignFile, ForeignLaunch } from "../lib/types.ts";

const gates = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as GatesFile;
const libraries = gates.foreign?.libraries.android ?? [];

const line = (message: string) => `11-01 12:00:00.123  4242  4290 I ReactNativeJS: ${message}`;
/** A string argument of `console.info` as Hermes prints it to logcat: in single quotes, a quote as `\\'` and a backslash as `\\\\` (so a JSON `\\"` is `\\\\"` there). */
const logcatString = (text: string) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const entry = (library: string, where: string, name: string, passed: boolean, detail = "") => line(`'[Svelte foreign library]', ${logcatString(JSON.stringify({ library, where, name, passed, detail }))}`);

const launch = (name: ForeignLaunch["name"], overrides: Partial<ForeignLaunch> = {}): ForeignLaunch => ({
	name, run: name, startedAt: "2026-11-01T12:00:00Z", durationMs: 1000, complete: true, crashes: [], jsErrors: [], engineWarnings: [], logFile: `runs/${name}.log`, ...overrides,
});
const check = (library: string, where: ForeignCheck["where"], passed = true): ForeignCheck => ({ library, where, name: `${where}: a check`, passed, detail: "" });
/** What `foreign.<library>.checks` must reach, as gates.json pins it (null when it pins nothing). */
const pinnedChecks = (library: string): number | null => gates.gates.find((gate) => gate.metric === `foreign.${library}.checks`)?.bar.android?.min ?? null;
/** The checks of a library in the three places: [perPlace] each, one by default; a clean run makes as many as the gates expect. */
const everywhere = (library: string, passed = true, perPlace = 1): ForeignCheck[] => (["inline", "row", "sheet"] as const).flatMap((where) => Array.from({ length: perPlace }, (_, index) => ({ ...check(library, where, passed), name: `${where}: check ${index}` })));
const cleanChecks = (): ForeignCheck[] => libraries.flatMap((library) => everywhere(library, true, (pinnedChecks(library) ?? 3) / 3));
const cleanBundle = { map: "m", sources: 1330, reactFiles: ["/node_modules/react/index.js"], forbidden: [], matchesBuild: true };
function file(overrides: Partial<ForeignFile> = {}): ForeignFile {
	return {
		schema: 1, kind: "foreign", startedAt: "2026-11-01T12:00:00Z", finishedAt: "2026-11-01T12:10:00Z", source: { commit: "abc", dirty: false },
		device: { serial: "localhost:5555", platform: "android" } as ForeignFile["device"], app: { package: "io.rasheed.svelteqa", installedSha256: "x" } as ForeignFile["app"],
		asked: libraries, checks: cleanChecks(), skips: [], leftovers: [check("capture", "inline")],
		launches: [launch("libraries"), launch("leftovers")], bundle: cleanBundle, ...overrides,
	};
}

describe("the foreign run's log", () => {
	test("reads every check line and every skipped one, and nothing else", () => {
		const text = [
			line("'[Svelte stress]', '{\"name\":\"foreign-libraries\"}'"),
			entry("image", "inline", "inline: mounts", true, "ExpoImageView"),
			entry("image", "row", "row: onLoad arrives", false, "0 onLoad, it's quoted"),
			line(`'[Svelte foreign library skipped]', ${logcatString(JSON.stringify({ library: "datetime", where: "inline", name: "inline: events", why: "the iPhone's finger" }))}`),
		].join("\n");
		const { checks, skips, unparsed } = parseForeignChecks(text);
		expect(unparsed).toEqual([]);
		expect(checks.map((value) => [value.library, value.where, value.passed])).toEqual([["image", "inline", true], ["image", "row", false]]);
		expect(checks[1]?.detail).toBe("0 onLoad, it's quoted");
		expect(skips).toEqual([{ library: "datetime", where: "inline", name: "inline: events", why: "the iPhone's finger" }]);
	});

	test("a line as Hermes prints it parses: an apostrophe, a backslash, and a detail that is JSON itself", () => {
		const stats = JSON.stringify({ frames: 0, registryLeaks: 0, nodes: 0 });
		const lines = [
			// copied from `qa/runs/foreign-localhost_5555-20261101T134713Z-libraries.log`
			`11-01 13:47:40.407 11714 11736 I ReactNativeJS: '[Svelte foreign library]', '{"library":"image","where":"inline","name":"inline: mounts: it is the library\\'s view (ExpoImageView)","passed":true,"detail":"expo.modules.image.ExpoImageViewWrapper; inside: FrameLayout 1032x247 clip=true"}'`,
			`11-01 13:47:42.372 11714 11736 I ReactNativeJS: '[Svelte foreign library]', '{"library":"image","where":"inline","name":"inline: leaving drops every frame and node","passed":true,"detail":"{\\\\"frames\\\\":0,\\\\"registryLeaks\\\\":0,\\\\"nodes\\\\":0}"}'`,
			entry("blur", "row", "row: leaving drops every frame and node", false, stats),
			entry("text", "sheet", "sheet: a path C:\\temp and a 'quoted' word", true, "it's \\n"),
		].join("\n");
		const { checks, unparsed } = parseForeignChecks(lines);
		expect(unparsed).toEqual([]);
		expect(checks.map((value) => value.name)).toEqual([
			"inline: mounts: it is the library's view (ExpoImageView)",
			"inline: leaving drops every frame and node",
			"row: leaving drops every frame and node",
			"sheet: a path C:\\temp and a 'quoted' word",
		]);
		expect(JSON.parse(checks[1]?.detail ?? "")).toEqual({ frames: 0, registryLeaks: 0, nodes: 0 });
		expect(JSON.parse(checks[2]?.detail ?? "")).toEqual({ frames: 0, registryLeaks: 0, nodes: 0 });
		expect(checks[3]?.detail).toBe("it's \\n");
	});

	test("a tagged line that does not parse is reported, never dropped, and fails the run's metric", () => {
		const cut = line("'[Svelte foreign library]', '{\"library\":\"image\",\"where\":\"sheet\",\"na");
		const broken = line("'[Svelte foreign library skipped]', 'not json'");
		const { checks, unparsed } = parseForeignChecks([entry("image", "inline", "x", true), cut, broken].join("\n"));
		expect(checks).toHaveLength(1);
		expect(unparsed).toHaveLength(2);
		expect(unparsed[0]).toContain('"na');
		const metrics = foreignMetrics(file({ unparsed }), { libraries });
		expect(metrics["foreign.unparsedLines"]).toBe(2);
		expect(foreignMetrics(file(), { libraries })["foreign.unparsedLines"]).toBe(0);
	});

	test("a check at a place the lab does not have is not a check", () => {
		const result = parseForeignChecks(entry("image", "attic", "x", true));
		expect(result.checks).toEqual([]);
		expect(result.unparsed).toHaveLength(1);
	});
});

describe("foreign metrics", () => {
	test("a clean run has no failed check anywhere and every launch complete", () => {
		const metrics = foreignMetrics(file(), { libraries });
		for (const library of libraries) expect(metrics[`foreign.${library}.failedChecks`]).toBe(0);
		expect(metrics["foreign.launches"]).toBe(2);
		expect(metrics["foreign.incompleteLaunches"]).toBe(0);
		expect(metrics["foreign.fatals"]).toBe(0);
		expect(metrics["foreign.leftovers.failed"]).toBe(0);
		expect(metrics["foreign.libraries.missing"]).toBe(0);
		expect(metrics["foreign.react.files"]).toBe(1);
	});

	test("a failed check counts for its library only", () => {
		const checks = libraries.flatMap((library) => everywhere(library, library !== "video"));
		const metrics = foreignMetrics(file({ checks }), { libraries });
		expect(metrics["foreign.video.failedChecks"]).toBe(3);
		expect(metrics["foreign.image.failedChecks"]).toBe(0);
	});

	test("a library with no check is not measured, and a place that never opened is a failure", () => {
		const checks = libraries.filter((library) => library !== "pdf").flatMap((library) => (library === "rive" ? [check("rive", "inline"), check("rive", "row")] : everywhere(library)));
		const run = file({ checks });
		const metrics = foreignMetrics(run, { libraries });
		expect(metrics["foreign.pdf.failedChecks"]).toBeNull();
		expect(metrics["foreign.rive.failedChecks"]).toBe(1);
		expect(missingPlaces(run, "rive")).toEqual(["sheet"]);
		expect(metrics["foreign.libraries.missing"]).toBe(1);
	});

	test("the bundle's checks belong to their library, and no source map is a failure for every one", () => {
		const held = { ...cleanBundle, forbidden: [{ library: "video", module: "/node_modules/react-native-video/src/Video.tsx" }] };
		const metrics = foreignMetrics(file({ bundle: held }), { libraries });
		expect(metrics["foreign.video.failedChecks"]).toBe(1);
		expect(metrics["foreign.lottie.failedChecks"]).toBe(0);
		const none = foreignMetrics(file({ bundle: null }), { libraries });
		expect(none["foreign.image.failedChecks"]).toBe(1);
		expect(none["foreign.react.files"]).toBeNull();
		expect(bundleChecks(null, ["image"])[0]?.detail).toContain("no source map");
	});

	test("an incomplete launch, a crash and a leftover launch that did not run are what the gates see", () => {
		const metrics = foreignMetrics(file({ launches: [launch("libraries", { complete: false, crashes: ["FATAL EXCEPTION"], jsErrors: ["E ReactNativeJS"] })], leftovers: [] }), { libraries });
		expect(metrics["foreign.launches"]).toBe(0);
		expect(metrics["foreign.incompleteLaunches"]).toBe(1);
		expect(metrics["foreign.fatals"]).toBe(2);
		expect(metrics["foreign.leftovers.failed"]).toBeNull();
		const failed = foreignMetrics(file({ leftovers: [check("capture", "inline", false)] }), { libraries });
		expect(failed["foreign.leftovers.failed"]).toBe(1);
	});

	test("--only: the libraries not asked for are not measured, not missing, and an asked one that logged nothing is missing", () => {
		const asked = ["image", "video"];
		const checks = cleanChecks().filter((entry) => asked.includes(entry.library) && entry.library !== "video");
		const metrics = foreignMetrics(file({ asked, checks }), { libraries });
		for (const library of libraries.filter((name) => !asked.includes(name))) {
			expect(metrics[`foreign.${library}.failedChecks`]).toBeNull();
			expect(metrics[`foreign.${library}.checks`]).toBeNull();
			expect(metrics[`foreign.${library}.skipped`]).toBeNull();
		}
		expect(metrics["foreign.image.checks"]).toBe(pinnedChecks("image"));
		expect(metrics["foreign.video.checks"]).toBe(0);
		expect(metrics["foreign.libraries.missing"]).toBe(1);
	});

	test("failedChecks is null for a library the run never reported", () => {
		expect(failedChecks(file({ checks: [] }), "image")).toBeNull();
	});

	test("the printed lines name every failed check", () => {
		const lines = describeForeign(file({ checks: [...libraries.flatMap((library) => everywhere(library)), { library: "blur", where: "row", name: "row: blurred", passed: false, detail: "#e5484d | #f5d90a" }] }), { libraries });
		expect(lines.some((value) => value.includes("FAIL blur row: row: blurred"))).toBe(true);
		expect(lines.some((value) => value.startsWith("  blur") && value.includes("1 failed"))).toBe(true);
	});
});

describe("what the release bundle may hold", () => {
	const sources = [
		"/node_modules/react/index.js", "/node_modules/react/cjs/react.production.js", "/node_modules/react-native/Libraries/Core/setUpGlobals.js",
		"/node_modules/react-native-svg/src/lib/extract/extractProps.ts", "/node_modules/expo-image-picker/src/ImagePicker.ts", "/node_modules/react-native-reanimated/src/hook/useSharedValue.ts",
	];
	test("react's own files are counted, the library extractors of react-native-svg and unrelated packages are not forbidden", () => {
		const result = analyseSources(sources);
		expect(result.reactFiles).toEqual(["/node_modules/react/index.js", "/node_modules/react/cjs/react.production.js"]);
		expect(result.forbidden).toEqual([]);
	});

	test("a library's own modules are forbidden, react-native-svg's elements too, a pnpm path as well", () => {
		const result = analyseSources([
			"/node_modules/react-native-video/src/Video.tsx", "/node_modules/react-native-svg/src/elements/Svg.tsx", "/node_modules/.pnpm/rive-react-native@9.7.1/node_modules/rive-react-native/src/Rive.tsx",
			"/node_modules/@react-native-community/datetimepicker/src/datetimepicker.android.js", "/node_modules/react-native-blob-util/index.js",
		]);
		expect(result.forbidden.map((value) => value.library).sort()).toEqual(["datetime", "pdf", "rive", "svg", "video"]);
	});

	test("every pinned library has a module pattern, and expo-image does not match expo-image-picker", () => {
		for (const library of libraries) expect(libraryModules[library]?.length ?? 0).toBeGreaterThan(0);
		expect(analyseSources(["/node_modules/expo-image-picker/src/ImagePicker.ts"]).forbidden).toEqual([]);
		expect(analyseSources(["/node_modules/expo-image/src/ExpoImage.tsx"]).forbidden.map((value) => value.library)).toEqual(["image"]);
	});
});

describe("gates.json", () => {
	test("pins the thirteen libraries for both platforms and keeps the file valid", () => {
		expect(() => checkGatesFile(gates)).not.toThrow();
		expect(libraries).toHaveLength(13);
		expect(gates.foreign?.libraries.ios).toEqual(libraries);
	});

	test("has a failedChecks gate per library, judged for the emulator and the Samsung and measured by a clean run", () => {
		for (const library of libraries) expect(gates.gates.some((gate) => gate.metric === `foreign.${library}.failedChecks` && gate.bar.android?.max === 0)).toBe(true);
		const metrics = foreignMetrics(file(), { libraries });
		const rows = evaluate(gates.gates.filter((gate) => gate.metric.startsWith("foreign.")), { "localhost:5555": { platform: "android", role: "lab", runs: gates.devices["localhost:5555"]?.runs ?? null, metrics } }, "android");
		const bad = rows.filter((row) => row.verdict !== "pass");
		expect(bad.map((row) => `${row.id} ${row.verdict}`)).toEqual([]);
		expect(rows.length).toBeGreaterThan(13);
	});

	test("pins how many checks each library makes and that none is skipped or unreadable, so a check that stops running is a failure, not a pass", () => {
		for (const library of libraries) {
			const expected = pinnedChecks(library);
			expect([library, expected]).not.toEqual([library, null]);
			expect((expected ?? 0) % 3).toBe(0);
			expect(expected ?? 0).toBeGreaterThanOrEqual(21);
			expect(gates.gates.some((gate) => gate.metric === `foreign.${library}.skipped` && gate.bar.android?.max === 0)).toBe(true);
		}
		expect(gates.gates.some((gate) => gate.metric === "foreign.unparsedLines" && gate.bar.android?.max === 0)).toBe(true);
		const ask = (run: ForeignFile) => evaluate(gates.gates.filter((gate) => gate.metric.startsWith("foreign.")), { "localhost:5555": { platform: "android", role: "lab", runs: ["foreign"], metrics: foreignMetrics(run, { libraries }) } }, "android");
		const verdict = (rows: ReturnType<typeof ask>, id: string) => rows.find((row) => row.id === id)?.verdict;
		const clean = ask(file());
		expect(verdict(clean, "foreign.video.checks")).toBe("pass");
		expect(verdict(clean, "foreign.video.skipped")).toBe("pass");
		expect(verdict(clean, "foreign.unparsedLines")).toBe("pass");
		const dropped = [...cleanChecks()];
		dropped.splice(dropped.findIndex((entry) => entry.library === "video"), 1);
		expect(verdict(ask(file({ checks: dropped })), "foreign.video.checks")).toBe("fail");
		expect(verdict(ask(file({ checks: dropped })), "foreign.video.failedChecks")).toBe("pass");
		expect(verdict(ask(file({ skips: [{ library: "datetime", where: "inline", name: "inline: events", why: "no finger" }] })), "foreign.datetime.skipped")).toBe("fail");
		expect(verdict(ask(file({ unparsed: ["'[Svelte foreign library]', '{\"library\""] })), "foreign.unparsedLines")).toBe("fail");
	});

	test("a failed library fails its own gate and a missing one is not measured", () => {
		const checks = libraries.filter((library) => library !== "pdf").flatMap((library) => everywhere(library, library !== "video", (pinnedChecks(library) ?? 3) / 3));
		const metrics = foreignMetrics(file({ checks }), { libraries });
		const rows = evaluate(gates.gates.filter((gate) => gate.metric.startsWith("foreign.")), { "localhost:5555": { platform: "android", role: "lab", runs: ["foreign"], metrics } }, "android");
		const verdict = (id: string) => rows.find((row) => row.id === id)?.verdict;
		expect(verdict("foreign.video.failedChecks")).toBe("fail");
		expect(verdict("foreign.pdf.failedChecks")).toBe("not measured");
		expect(verdict("foreign.image.failedChecks")).toBe("pass");
	});

	test("both phones and the emulator provide the foreign run kind", () => {
		expect(gates.devices["R58Y90KNGRP"]?.runs).toContain("foreign");
		expect(gates.devices["localhost:5555"]?.runs).toContain("foreign");
		expect(gates.devices["E74A5608-BF8E-5806-8699-1605F82ADED9"]?.runs).toContain("foreign");
	});
});

describe("the colour helpers the lab's pixel checks use", () => {
	test("an ARGB integer, signed or not, reads as its channels", () => {
		expect(argb(0xffe5484d)).toEqual({ a: 255, r: 229, g: 72, b: 77 });
		expect(argb(0xffe5484d | 0)).toEqual({ a: 255, r: 229, g: 72, b: 77 });
		expect(argb(0)).toEqual({ a: 0, r: 0, g: 0, b: 0 });
	});

	test("near compares opaque pixels within a tolerance, and a transparent pixel is near nothing", () => {
		expect(near(0xffe5484d, "#e5484d", 0)).toBe(true);
		expect(near(0xffe0504a, "#e5484d", 10)).toBe(true);
		expect(near(0xffe0504a, "#e5484d", 5)).toBe(false);
		expect(near(0x00e5484d, "#e5484d", 255)).toBe(false);
		expect(distance(hex("#000000"), hex("#ffffff"))).toBe(255);
	});

	test("clear and solid tell a hole from a drawn pixel, show names both", () => {
		expect(clear(0x00000000)).toBe(true);
		expect(clear(0x14000000)).toBe(false);
		expect(solid(0xff102030)).toBe(true);
		expect(solid(0x80102030)).toBe(false);
		expect(show(0xff102030)).toBe("#102030");
		expect(show(0x80102030)).toBe("#102030/128");
		expect(() => hex("red")).toThrow();
	});

	test("numberIn reads the count out of the animated text", () => {
		expect(numberIn("count 23")).toBe(23);
		expect(numberIn("hello")).toBeNull();
		expect(numberIn(undefined)).toBeNull();
	});
});

describe("what the lab asks the harness to press", () => {
	const dump = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="io.rasheed.svelteqa" bounds="[0,0][1080,2400]">
<node index="1" text="Cancel" resource-id="android:id/button2" class="android.widget.Button" package="io.rasheed.svelteqa" bounds="[500,1700][740,1830]" />
<node index="2" text="OK" resource-id="android:id/button1" class="android.widget.Button" package="io.rasheed.svelteqa" bounds="[760,1700][900,1830]" />
<node index="3" text="" resource-id="android:id/button3" class="android.widget.Button" package="io.rasheed.svelteqa" bounds="[0,0][0,0]" />
</node></hierarchy>`;

	test("a press request is read from the lab's line, and any other line is not one", () => {
		const request = line(`'[Svelte foreign press]', '{"id":"date-ok","resourceId":"android:id/button1"}'`);
		expect(parsePress(request)).toEqual({ id: "date-ok", resourceId: "android:id/button1" });
		expect(parsePress(line("'[Svelte foreign press]', '{\"id\":3}'"))).toBeNull();
		expect(parsePress(line("'[Svelte stress]', '{}'"))).toBeNull();
		expect(parsePress("not a logcat line")).toBeNull();
	});

	test("the middle of the button is found by its resource id, and an empty box is not a button", () => {
		expect(findButton(dump, "android:id/button1")).toEqual({ x: 830, y: 1765 });
		expect(findButton(dump, "android:id/button2")).toEqual({ x: 620, y: 1765 });
		expect(findButton(dump, "android:id/button3")).toBeNull();
		expect(findButton(dump, "android:id/nothing")).toBeNull();
	});
});
