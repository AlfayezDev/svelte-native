import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchOf } from "../commands/foreign.ts";
import { labRunFrom } from "../lib/lab-run.ts";
import { analyseSources, bundleChecks, describeForeign, failedChecks, foreignMetrics, libraryModules, missingPlaces } from "../lib/foreign.ts";
import { checkGatesFile, evaluate, type GatesFile } from "../lib/gates.ts";
import { platformDir } from "../lib/paths.ts";
import { findButton, parsePress } from "../lib/foreign-press.ts";
import { parseForeignChecks } from "../parse/foreign.ts";
import { argb, arrivedInOrder, clear, distance, hex, near, numberIn, riveBackdrop, riveFitDetail, riveFitPainted, riveMiddle, riveSides, show, solid, tookNote, untilTaken } from "../../src/lib/native/dev/foreign-pixels.ts";
import { raceAttempts, runRace, type Race } from "../../src/lib/native/dev/foreign-race.ts";
import type { ForeignCheck, ForeignFile, ForeignLaunch } from "../lib/types.ts";
import { sample } from "./sample.ts";

const gates = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as GatesFile;
const libraries = gates.foreign?.libraries.android ?? [];

const line = (message: string) => `11-01 12:00:00.123  4242  4290 I ReactNativeJS: ${message}`;
/** A string argument of `console.info` as React Native's console prints it to logcat: in single quotes, a quote as `\\'` and a backslash as `\\\\` (so a JSON `\\"` is `\\\\"` there). */
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

	test("a line as the console prints it parses: an apostrophe, a backslash, and a detail that is JSON itself", () => {
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

describe("a foreign run whose failed checks have an apostrophe in their names", () => {
	// The emulator's run of 4 November: the summary line named two failed rive checks, one of them "the animation's background is there", and read as JSON as it was printed it threw.
	const summary = sample("foreign-summary-apostrophe.log").trimEnd();
	const failedNames = ["rive row: capture: the animation is in the image (its middle is painted, not a hole)", "rive row: capture: the animation's background is there (opaque, pink at one of three points)"];
	/** A clean run's checks, two of rive's row checks replaced by the two that failed. */
	const logged = (): ForeignCheck[] => {
		let replaced = 0;
		const kept = cleanChecks().filter((value) => value.library !== "rive" || value.where !== "row" || replaced++ >= failedNames.length);
		return [...kept, ...failedNames.map((name): ForeignCheck => ({ library: "rive", where: "row", name, passed: false, detail: "pink at 0 of 3 points" }))];
	};
	const log = [summary, ...logged().map((value) => entry(value.library, value.where, value.name, value.passed, value.detail)), line(`'[Svelte stress] complete', '{"periodMs":16.7,"results":[{"name":"foreign-libraries","verdict":"fail"}]}'`)].join("\n");
	const capture = { text: log, matched: true, startedAt: new Date("2026-11-04T12:30:00Z"), durationMs: 600_000, logFile: "runs/foreign-libraries.log" };

	test("the lab run is read: the summary is its scenario, failed, and the launch is complete", () => {
		const run = labRunFrom(capture, "io.rasheed.svelteqa", true);
		expect(run.complete).toBe(true);
		expect(run.scenarios.map((scenario) => [scenario.name, scenario.verdict])).toEqual([["foreign-libraries", "fail"]]);
		const detail = run.scenarios[0]?.detail as { failed: string[] } | null | undefined;
		expect(detail?.failed).toEqual(failedNames);
	});

	test("the failed checks are read from their own lines, apostrophes included", () => {
		const { checks, unparsed } = parseForeignChecks(log);
		expect(unparsed).toEqual([]);
		expect(checks.filter((value) => !value.passed).map((value) => value.name)).toEqual(failedNames);
	});

	test("the run file's gates fail for rive and pass for the others, and nothing is not measured", () => {
		const run = labRunFrom(capture, "io.rasheed.svelteqa", true);
		const { checks, skips, unparsed } = parseForeignChecks(log);
		const metrics = foreignMetrics(file({ checks, skips, unparsed, launches: [launchOf("libraries", "foreign-libraries,drive:adb", run), launch("leftovers")] }), { libraries });
		const rows = evaluate(gates.gates.filter((gate) => gate.metric.startsWith("foreign.")), { "localhost:5555": { platform: "android", role: "lab", runs: ["foreign"], metrics } }, "android");
		expect(metrics["foreign.rive.failedChecks"]).toBe(2);
		expect(rows.filter((row) => row.verdict === "not measured").map((row) => row.id)).toEqual([]);
		expect(rows.filter((row) => row.verdict === "fail").map((row) => row.id)).toEqual(["foreign.rive.failedChecks"]);
		expect(rows.find((row) => row.id === "foreign.image.failedChecks")?.verdict).toBe("pass");
	});
});

describe("a foreign run whose summary line logcat cut", () => {
	// Without the harness reading the summary, the run used to stop before it wrote its file. Now the launch carries the line it could not read, and the gate fails.
	const cutSummary = sample("foreign-summary-apostrophe.log").trimEnd().slice(0, 700);
	const log = [cutSummary, ...cleanChecks().map((value) => entry(value.library, value.where, value.name, value.passed, value.detail)), line(`'[Svelte stress] complete', '{"periodMs":16.7,"results":[{"name":"foreign-libraries","verdict":"pass"}]}'`)].join("\n");
	const capture = { text: log, matched: true, startedAt: new Date("2026-11-04T12:30:00Z"), durationMs: 600_000, logFile: "runs/foreign-libraries.log" };

	test("the launch is recorded with the unreadable line, and its checks are all read", () => {
		const run = labRunFrom(capture, "io.rasheed.svelteqa", true);
		expect(run.complete).toBe(true);
		expect(run.scenarios).toEqual([]);
		expect(run.unparsedLines).toHaveLength(1);
		const launched = launchOf("libraries", "foreign-libraries,drive:adb", run);
		expect(launched.unparsedLines).toEqual(run.unparsedLines);
		expect(launchOf("libraries", "foreign-libraries,drive:adb", labRunFrom({ ...capture, text: log.split("\n").slice(1).join("\n") }, "io.rasheed.svelteqa", true)).unparsedLines).toBeUndefined();
		expect(parseForeignChecks(log).checks).toHaveLength(cleanChecks().length);
	});

	test("foreign.unparsedLines counts it, the gate fails, and the run says so in its lines", () => {
		const run = labRunFrom(capture, "io.rasheed.svelteqa", true);
		const withLine = file({ launches: [launchOf("libraries", "foreign-libraries,drive:adb", run), launch("leftovers")] });
		const rows = (value: ForeignFile) => evaluate(gates.gates.filter((gate) => gate.metric.startsWith("foreign.")), { "localhost:5555": { platform: "android", role: "lab", runs: ["foreign"], metrics: foreignMetrics(value, { libraries }) } }, "android");
		const verdict = (value: ForeignFile) => rows(value).find((row) => row.id === "foreign.unparsedLines")?.verdict;
		expect(foreignMetrics(withLine, { libraries })["foreign.unparsedLines"]).toBe(1);
		expect(verdict(withLine)).toBe("fail");
		expect(verdict(file())).toBe("pass");
		expect(describeForeign(withLine, { libraries }).some((entry) => entry.includes("UNREADABLE LINE malformed [Svelte stress] line"))).toBe(true);
		// the line of the launch and the lines of the checks add up
		expect(foreignMetrics(file({ unparsed: ["x"], launches: withLine.launches }), { libraries })["foreign.unparsedLines"]).toBe(2);
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

describe("untilTaken: the capture that is asked again until a late paint has arrived", () => {
	/** A clock the pauses move, so that the loop runs in no time. */
	const clock = () => {
		let time = 0;
		return { now: () => time, pause: async (milliseconds: number) => { time += milliseconds; } };
	};
	const given = (...results: (string | null)[]) => {
		let index = 0;
		return async () => results[Math.min(index++, results.length - 1)] ?? null;
	};

	test("a result that is wanted at once is one call and no wait", async () => {
		const { now, pause } = clock();
		expect(await untilTaken(given("painted"), (taken) => taken === "painted", 5000, pause, 400, now)).toEqual({ taken: "painted", calls: 1, waited: 0 });
	});

	test("an animation that paints after onPlay is waited for: holes, then the paint", async () => {
		const { now, pause } = clock();
		const outcome = await untilTaken(given("hole", "hole", "hole", "painted"), (taken) => taken === "painted", 5000, pause, 400, now);
		expect(outcome).toEqual({ taken: "painted", calls: 4, waited: 1200 });
	});

	test("a view that never paints ends at the deadline with its last capture, which the check names", async () => {
		const { now, pause } = clock();
		const outcome = await untilTaken(given("hole"), (taken) => taken === "painted", 2000, pause, 400, now);
		expect(outcome).toEqual({ taken: "hole", calls: 6, waited: 2000 });
	});

	test("a capture that failed or gave nothing ends it at once, whatever time is left", async () => {
		const { now, pause } = clock();
		expect(await untilTaken(given("hole", null, "painted"), (taken) => taken === "painted", 5000, pause, 400, now)).toEqual({ taken: null, calls: 2, waited: 400 });
	});

	test("with no time to settle it is one capture, wanted or not (every check that does not wait)", async () => {
		const { now, pause } = clock();
		expect(await untilTaken(given("hole", "painted"), (taken) => taken === "painted", 0, pause, 400, now)).toEqual({ taken: "hole", calls: 1, waited: 0 });
	});
});

describe("riveBackdrop: what the settle loop of the Rive capture waits for is what the next check asserts", () => {
	const truck = 0xff223344;
	const pink = 0xffd62a5c;
	const hole = 0x00000000;

	test("opaque everywhere with the artboard's pink at one point is a painted capture", () => {
		expect(riveBackdrop([truck, pink, truck])).toBe(true);
		expect(riveBackdrop([pink, pink, pink])).toBe(true);
	});

	test("opaque everywhere but no pink anywhere is not painted yet (the loop must keep asking; the middle being opaque was not enough)", () => {
		expect(riveBackdrop([truck, truck, truck])).toBe(false);
	});

	test("a hole at any point, pink or not, and a capture with no points are not painted", () => {
		expect(riveBackdrop([pink, hole, pink])).toBe(false);
		expect(riveBackdrop([hole, hole, hole])).toBe(false);
		expect(riveBackdrop([])).toBe(false);
	});

	test("the loop and the check agree: a capture that ends the loop passes the check, and the deadline keeps the last capture", async () => {
		const looks = [[truck, truck, truck], [hole, pink, pink], [truck, pink, truck]];
		let index = 0;
		let time = 0;
		const outcome = await untilTaken(async () => looks[Math.min(index++, looks.length - 1)] ?? null, riveBackdrop, 5000, async (milliseconds) => { time += milliseconds; }, 400, () => time);
		expect(outcome).toEqual({ taken: [truck, pink, truck], calls: 3, waited: 800 });
		expect(riveBackdrop(outcome.taken ?? [])).toBe(true);
		time = 0;
		const never = await untilTaken(async () => [truck, truck, truck], riveBackdrop, 5000, async (milliseconds) => { time += milliseconds; }, 400, () => time);
		expect(never).toEqual({ taken: [truck, truck, truck], calls: 14, waited: 5200 });
	});
});

describe("riveFitPainted: the fit check waits for a painted frame of each fit, not for any capture", () => {
	const pink = 0xffeb3a60;
	const truck = 0xff384e70;
	const hole = 0x00000000;
	const white = 0xffffffff;
	const dark = 0xff101010;
	/** The pixels of one capture as the check reads them: the two sides, then the three points of the middle. */
	const frame = (sides: [number, number], middle: [number, number, number]): number[] => [...sides, ...middle];

	test("the points are the sides, then the middle, as many as the check reads", () => {
		expect(riveSides).toHaveLength(2);
		expect(riveMiddle).toHaveLength(3);
	});

	test("contain: a painted middle with bare sides is the frame of contain", () => {
		expect(riveFitPainted("contain", frame([hole, hole], [truck, pink, truck]))).toBe(true);
	});

	test("contain: a view that has not drawn is transparent at every point, and the sides alone do not make it a frame", () => {
		expect(riveFitPainted("contain", frame([hole, hole], [hole, hole, hole]))).toBe(false);
		expect(riveFitPainted("contain", frame([hole, hole], [pink, hole, pink]))).toBe(false);
	});

	test("contain: painted sides are another fit's frame, not contain's", () => {
		expect(riveFitPainted("contain", frame([pink, pink], [truck, pink, truck]))).toBe(false);
		expect(riveFitPainted("contain", frame([hole, pink], [truck, pink, truck]))).toBe(false);
	});

	test("contain: an opaque white or dark side is bare, as the check always counted it", () => {
		expect(riveFitPainted("contain", frame([white, dark], [truck, pink, truck]))).toBe(true);
	});

	test("fill: opaque pink sides are the frame of fill", () => {
		expect(riveFitPainted("fill", frame([pink, pink], [truck, pink, truck]))).toBe(true);
	});

	test("fill: the transparent capture of the failed run (and the stale frame of contain) is not a frame of fill", () => {
		expect(riveFitPainted("fill", frame([hole, hole], [hole, hole, hole]))).toBe(false);
		expect(riveFitPainted("fill", frame([hole, hole], [truck, pink, truck]))).toBe(false);
		expect(riveFitPainted("fill", frame([pink, hole], [truck, pink, truck]))).toBe(false);
	});

	test("fill: opaque sides that are not the artboard's pink are not painted as fill either", () => {
		expect(riveFitPainted("fill", frame([dark, dark], [truck, pink, truck]))).toBe(false);
	});

	test("a capture that lacks points is not a frame of either fit", () => {
		expect(riveFitPainted("contain", [])).toBe(false);
		expect(riveFitPainted("fill", [])).toBe(false);
		expect(riveFitPainted("fill", [pink])).toBe(false);
	});

	/** The loop of the check on a clock the pauses move, over the captures it is given in turn (the last one repeats). */
	const settle = (fit: "contain" | "fill", ms: number, ...captures: number[][]) => {
		let index = 0;
		let time = 0;
		return untilTaken(async () => captures[Math.min(index++, captures.length - 1)] ?? null, (colors) => riveFitPainted(fit, colors), ms, async (milliseconds) => { time += milliseconds; }, 400, () => time);
	};

	test("a fit that paints late is waited for: the stale frame of the old fit and the hole before it do not end the wait", async () => {
		const stale = frame([hole, hole], [truck, pink, truck]);
		const unpainted = frame([hole, hole], [hole, hole, hole]);
		const painted = frame([pink, pink], [truck, pink, truck]);
		const outcome = await settle("fill", 10000, stale, unpainted, painted);
		expect(outcome).toEqual({ taken: painted, calls: 3, waited: 800 });
		expect(riveFitPainted("fill", outcome.taken ?? [])).toBe(true);
	});

	test("a contain that paints late is waited for: a transparent capture is not contain's frame", async () => {
		const unpainted = frame([hole, hole], [hole, hole, hole]);
		const painted = frame([hole, hole], [truck, pink, truck]);
		expect(await settle("contain", 5000, unpainted, unpainted, painted)).toEqual({ taken: painted, calls: 3, waited: 800 });
	});

	test("a view that never draws ends at the deadline with its last capture, and that capture fails the check", async () => {
		const unpainted = frame([hole, hole], [hole, hole, hole]);
		for (const fit of ["contain", "fill"] as const) {
			const outcome = await settle(fit, 5000, unpainted);
			expect(outcome).toEqual({ taken: unpainted, calls: 14, waited: 5200 });
			expect(riveFitPainted(fit, outcome.taken ?? [])).toBe(false);
		}
	});

	test("a wrong fit fails too: contain showing the frame of fill, and fill showing the frame of contain, wait out the time", async () => {
		const filled = frame([pink, pink], [truck, pink, truck]);
		const contained = frame([hole, hole], [truck, pink, truck]);
		const wrongContain = await settle("contain", 2000, filled);
		expect(wrongContain.waited).toBe(2000);
		expect(riveFitPainted("contain", wrongContain.taken ?? [])).toBe(false);
		const wrongFill = await settle("fill", 2000, contained);
		expect(wrongFill.waited).toBe(2000);
		expect(riveFitPainted("fill", wrongFill.taken ?? [])).toBe(false);
	});

	test("the detail says how long the paint took, and names a fit that did not get painted", () => {
		expect(tookNote(3, 800)).toBe("on capture 3, 800 ms in");
		expect(riveFitDetail("fill", frame([pink, pink], [truck, pink, truck]), 3, 800)).toBe("fill sides #eb3a60 #eb3a60, middle #384e70 #eb3a60 #384e70 | painted on capture 3, 800 ms in");
		expect(riveFitDetail("contain", frame([hole, hole], [truck, pink, truck]), 1, 0)).toBe("contain sides #000000/0 #000000/0, middle #384e70 #eb3a60 #384e70 | painted on capture 1, 0 ms in");
		expect(riveFitDetail("fill", frame([hole, hole], [hole, hole, hole]), 26, 10000)).toBe("fill sides #000000/0 #000000/0, middle #000000/0 #000000/0 #000000/0 | not painted as fill after 26 captures, 10000 ms");
	});
});

describe("arrivedInOrder: both messages of one event name reached JavaScript, in the order they were raised", () => {
	const history = [
		{ event: "video-progress" },
		{ event: "video-state", detail: false },
		{ event: "video-progress" },
		{ event: "video-state", detail: true },
	];

	test("two messages of one name with other events between them arrive in order", () => {
		expect(arrivedInOrder(history, 0, [["video-state", false], ["video-state", true]])).toBe(true);
	});

	test("one of the two is not both: the coalesced queue delivered the last message alone", () => {
		expect(arrivedInOrder([{ event: "video-state", detail: true }], 0, [["video-state", false], ["video-state", true]])).toBe(false);
		expect(arrivedInOrder([{ event: "lottie-finish", detail: true }], 0, [["lottie-finish", true], ["lottie-finish", true]])).toBe(false);
	});

	test("the same detail twice needs two events, not one counted twice", () => {
		const twice = [{ event: "lottie-finish", detail: true }, { event: "lottie-finish", detail: true }];
		expect(arrivedInOrder(twice, 0, [["lottie-finish", true], ["lottie-finish", true]])).toBe(true);
	});

	test("the wrong order, and events from before the check began, do not count", () => {
		expect(arrivedInOrder(history, 0, [["video-state", true], ["video-state", false]])).toBe(false);
		expect(arrivedInOrder(history, 2, [["video-state", false], ["video-state", true]])).toBe(false);
		expect(arrivedInOrder(history, 1, [["video-state", false], ["video-state", true]])).toBe(true);
	});

	test("nothing wanted is trivially there", () => {
		expect(arrivedInOrder([], 0, [])).toBe(true);
	});
});

describe("runRace: the event checks hold the thread only once the native side has the messages, and count only the attempts that forced the race", () => {
	type Entry = { event: string; detail?: unknown };
	/**
	 * A stand-in for the lab and React Native's queue. `send` raises messages: at once for a native module call, or at the end of the task (in `pause(0)`) for a commit or a view command. What was raised
	 * reaches the history when the JavaScript thread reads the queue: one by one in a `pause(0)` listed in `slowHops` (a timer hop that took long enough for the events to be read before the hold, which
	 * leaves the queue nothing to replace), and all at once in `until` after a hold, where `coalescing` has the queue keep only the last of a run of messages of one name.
	 */
	function lab(options: { android?: boolean; coalescing: boolean; slowHops?: readonly boolean[] }) {
		const history: Entry[] = [];
		const raised: Entry[] = [];
		const deferred: Entry[] = [];
		const log: string[] = [];
		const checks: { name: string; passed: boolean; detail?: string }[] = [];
		const only: string[] = [];
		let hops = 0;
		const readOneByOne = () => { history.push(...raised); raised.length = 0; };
		const readAfterHold = () => {
			for (const entry of raised) {
				const last = history[history.length - 1];
				if (options.coalescing && last && last.event === entry.event && batch.has(last)) history[history.length - 1] = entry;
				else history.push(entry);
				batch.add(entry);
			}
			raised.length = 0;
		};
		const batch = new Set<Entry>();
		const world = {
			android: options.android ?? true,
			history: () => history,
			pause: async (milliseconds: number) => {
				log.push(`pause ${milliseconds}`);
				if (milliseconds === 0) {
					raised.push(...deferred);
					deferred.length = 0;
					if (options.slowHops?.[hops++]) readOneByOne();
				}
			},
			until: async (test: () => boolean) => { readAfterHold(); return test(); },
			check: (name: string, passed: boolean, detail?: string) => { checks.push({ name, passed, detail }); },
			androidOnly: (name: string, why: string) => { only.push(`${name}: ${why}`); },
		};
		const hold = (milliseconds: number) => { log.push(`hold ${milliseconds}`); };
		const raise = (afterTask: boolean, ...entries: Entry[]) => { (afterTask ? deferred : raised).push(...entries); };
		return { world, hold, raise, log, checks, only, history: () => history };
	}
	const pair = (attempt: number): [Entry, Entry] => [{ event: "x-event", detail: `first ${attempt}` }, { event: "x-event", detail: `second ${attempt}` }];
	const race = (l: ReturnType<typeof lab>, afterTask: boolean, extra: Partial<Race> = {}): Race => ({
		send: (attempt) => { l.raise(afterTask, ...pair(attempt)); },
		names: ["x-event"],
		arrived: (from, attempt) => arrivedInOrder(l.history(), from, [["x-event", `first ${attempt}`], ["x-event", `second ${attempt}`]]),
		milliseconds: 1000,
		...extra,
	});

	test("a library whose event does not coalesce passes: the messages are raised after the task, the thread is held next, and both arrive in order", async () => {
		const l = lab({ coalescing: false });
		await runRace(l.world, l.hold, "name", "why", race(l, true));
		expect(l.log).toEqual(["pause 0", "hold 1000"]);
		expect(l.checks).toEqual([{ name: "name", passed: true, detail: "attempt 1; got x-event first 0, x-event second 0" }]);
	});

	test("a library whose event coalesces fails: held, the first message is replaced by the second and only that one arrives", async () => {
		const l = lab({ coalescing: true });
		await runRace(l.world, l.hold, "name", "why", race(l, true));
		expect(l.log).toEqual(["pause 0", "hold 1000"]);
		expect(l.checks).toEqual([{ name: "name", passed: false, detail: "attempt 1; got x-event second 0" }]);
	});

	test("a native module call (posted) raises its messages at once and is held in the same task, with no hop: the queue is read only after the hold", async () => {
		const coalescing = lab({ coalescing: true });
		await runRace(coalescing.world, coalescing.hold, "name", "why", race(coalescing, false, { posted: true }));
		expect(coalescing.log).toEqual(["hold 1000"]);
		expect(coalescing.checks).toEqual([{ name: "name", passed: false, detail: "attempt 1; got x-event second 0" }]);
		const kept = lab({ coalescing: false });
		await runRace(kept.world, kept.hold, "name", "why", race(kept, false, { posted: true }));
		expect(kept.checks).toEqual([{ name: "name", passed: true, detail: "attempt 1; got x-event first 0, x-event second 0" }]);
	});

	test("a native module call sent through the timer hop can be read in it every time, so the race is never forced (the Samsung A16, 8 Nov 2026); posted, it is forced at once", async () => {
		const slow = Array.from({ length: raceAttempts + 1 }, () => true);
		const hopped = lab({ coalescing: true, slowHops: slow });
		await runRace(hopped.world, hopped.hold, "name", "why", race(hopped, false));
		expect(hopped.log.filter((line) => line.startsWith("hold"))).toEqual([]);
		expect(hopped.checks[0]?.detail).toContain("could not be forced");
		const posted = lab({ coalescing: true, slowHops: slow });
		await runRace(posted.world, posted.hold, "name", "why", race(posted, false, { posted: true }));
		expect(posted.log).toEqual(["hold 1000"]);
		expect(posted.checks).toEqual([{ name: "name", passed: false, detail: "attempt 1; got x-event second 0" }]);
	});

	test("an attempt in which the events were read before the hold began is thrown away, and the next one is the check", async () => {
		const l = lab({ coalescing: true, slowHops: [true, false] });
		await runRace(l.world, l.hold, "name", "why", race(l, true));
		// attempt 1: the slow hop read both before any hold, which a pass would prove nothing by; attempt 2: forced and held, so the coalescing queue fails it
		expect(l.log).toEqual(["pause 0", "pause 500", "pause 0", "hold 1000"]);
		expect(l.checks).toHaveLength(1);
		expect(l.checks[0]?.detail).toMatch(/^attempt 2;/);
		expect(l.checks[0]?.passed).toBe(false);
	});

	test("when no attempt can be forced the check fails and says so, and the thread is never held", async () => {
		const l = lab({ coalescing: false, slowHops: Array.from({ length: raceAttempts + 1 }, () => true) });
		await runRace(l.world, l.hold, "name", "why", race(l, true));
		expect(l.log.filter((line) => line.startsWith("hold"))).toEqual([]);
		expect(l.log.filter((line) => line === "pause 0")).toHaveLength(raceAttempts);
		expect(l.checks).toHaveLength(1);
		expect(l.checks[0]?.passed).toBe(false);
		expect(l.checks[0]?.detail).toContain("could not be forced");
	});

	test("a send that is not ready (a prop the host did not commit) does not count either", async () => {
		const l = lab({ coalescing: false });
		let ready = false;
		await runRace(l.world, l.hold, "name", "why", race(l, true, { send: (attempt) => { ready = attempt > 0; l.raise(true, ...pair(attempt)); }, ready: () => ready }));
		expect(l.log).toEqual(["pause 0", "pause 500", "pause 0", "hold 1000"]);
		expect(l.checks.map((entry) => [entry.passed, entry.detail?.slice(0, 9)])).toEqual([[true, "attempt 2"]]);
	});

	test("on a platform that is not Android the check is Android-only with its reason, and nothing is sent or held", async () => {
		const l = lab({ android: false, coalescing: true });
		await runRace(l.world, l.hold, "name", "the iPhone cannot lose them", race(l, true));
		expect(l.only).toEqual(["name: the iPhone cannot lose them"]);
		expect(l.log).toEqual([]);
		expect(l.checks).toEqual([]);
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
		expect(parsePress(line(`'[Svelte foreign press]', ${logcatString(JSON.stringify({ id: "date's ok", resourceId: "android:id/button1" }))}`))).toEqual({ id: "date's ok", resourceId: "android:id/button1" });
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
