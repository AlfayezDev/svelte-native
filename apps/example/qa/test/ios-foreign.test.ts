import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iosBundle, iosLaunchOf } from "../commands/ios-foreign.ts";
import { androidOnlyBy, describeForeign, foreignMetrics, skippedBy } from "../lib/foreign.ts";
import { foreignProgress, foreignRecords } from "../lib/iphone/foreign-results.ts";
import { parseIosLabResults, type IosLabResults } from "../lib/iphone/lab-results.ts";
import type { IosBuildFile } from "../lib/iphone/session.ts";
import type { ForeignCheck, ForeignFile, ForeignSkip, LabRun } from "../lib/types.ts";
import { parseForeignChecks } from "../parse/foreign.ts";
import { detailRecords, progressRecord, skipEntry } from "../../src/lib/native/dev/foreign-records.ts";

const check = (library: string, where: ForeignCheck["where"], passed = true, name = `${where}: a check`): ForeignCheck => ({ library, where, name, passed, detail: "" });
const results = (stress: IosLabResults["stress"]): IosLabResults =>
	parseIosLabResults(JSON.stringify({ phase: "done", token: "t", finishedAt: "2026-11-03T10:00:00Z", platform: "ios", osVersion: "26.1", appVersion: "0.1.0", build: null, jsErrors: 0, checks: [], stress, stressDone: true }));
const entry = (name: string, detail: unknown): IosLabResults["stress"][number] => ({ name, verdict: "pass", summary: "", detail });

describe("the iPhone's foreign results", () => {
	test("every check and skip of the scenario is read back from the lab's results file, an Android-only skip marked as such", () => {
		const records = foreignRecords(
			results([
				entry("idle", { frames: 1 }),
				entry("foreign-libraries", {
					libraries: { image: { checks: 2, failed: 1, skipped: 1 } },
					checks: [check("image", "inline"), check("image", "row", false, "row: it is red")],
					skips: [
						{ library: "video", where: "sheet", name: "sheet: the player draws into a surface of its own", why: "AVPlayerLayer has no surface", androidOnly: true },
						{ library: "datetime", where: "inline", name: "inline: events: a pick", why: "needs a finger" },
					],
				}),
			]),
			"foreign-libraries",
		);
		expect(records.present).toBe(true);
		expect(records.unparsed).toEqual([]);
		expect(records.checks.map((value) => [value.library, value.where, value.passed])).toEqual([["image", "inline", true], ["image", "row", false]]);
		expect(records.skips).toEqual([
			{ library: "video", where: "sheet", name: "sheet: the player draws into a surface of its own", why: "AVPlayerLayer has no surface", androidOnly: true },
			{ library: "datetime", where: "inline", name: "inline: events: a pick", why: "needs a finger" },
		]);
	});

	test("an entry that is not a check or a skip is reported, never dropped, and a detail that is not an object is too", () => {
		const records = foreignRecords(
			results([entry("foreign-libraries", { checks: [check("image", "inline"), { library: "image", where: "attic", name: "x", passed: true }, "text"], skips: [{ name: "no library" }] })]),
			"foreign-libraries",
		);
		expect(records.checks).toHaveLength(1);
		expect(records.unparsed).toHaveLength(3);
		expect(records.unparsed[0]).toContain("attic");
		expect(foreignRecords(results([entry("foreign-libraries", "summary")]), "foreign-libraries").unparsed).toHaveLength(1);
		expect(foreignRecords(results([entry("foreign-libraries", {})]), "foreign-libraries").unparsed).toEqual(["foreign-libraries: detail.checks is not a list", "foreign-libraries: detail.skips is not a list"]);
	});

	test("the leftovers scenario records checks and no skips; a scenario the app never reached is not present", () => {
		const records = foreignRecords(results([entry("foreign-leftovers", { checks: [check("capture", "inline")] })]), "foreign-leftovers");
		expect(records.unparsed).toEqual([]);
		expect(records.checks).toHaveLength(1);
		const none = foreignRecords(results([entry("idle", {})]), "foreign-libraries");
		expect(none).toEqual({ checks: [], skips: [], unparsed: [], present: false });
		expect(foreignRecords(null, "foreign-libraries").present).toBe(false);
	});
});

describe("Android-only checks", () => {
	const skips: ForeignSkip[] = [
		{ library: "video", where: "inline", name: "inline: surface", why: "x", androidOnly: true },
		{ library: "video", where: "inline", name: "inline: seek by finger", why: "y" },
		{ library: "shadow", where: "row", name: "row: canvas clip", why: "z", androidOnly: true },
	];

	test("are counted apart from the skips the platform could still make", () => {
		const file = { asked: ["video", "shadow", "image"], checks: [check("video", "inline"), check("shadow", "row"), check("image", "sheet")], skips } as Partial<ForeignFile> as ForeignFile;
		const metrics = foreignMetrics({ ...file, launches: [], leftovers: [], bundle: null }, { libraries: ["video", "shadow", "image"] });
		expect([metrics["foreign.video.skipped"], metrics["foreign.video.androidOnly"]]).toEqual([1, 1]);
		expect([metrics["foreign.shadow.skipped"], metrics["foreign.shadow.androidOnly"]]).toEqual([0, 1]);
		expect([metrics["foreign.image.skipped"], metrics["foreign.image.androidOnly"]]).toEqual([0, 0]);
		expect(skippedBy(skips)).toEqual({ video: ["inline: seek by finger"] });
		expect(androidOnlyBy(skips)).toEqual({ video: ["inline: surface"], shadow: ["row: canvas clip"] });
	});

	test("are printed as Android-only, and a library not asked for is not measured", () => {
		const file = { asked: ["video"], checks: [check("video", "inline"), check("video", "row"), check("video", "sheet")], skips, launches: [], leftovers: [], unparsed: [], bundle: null } as Partial<ForeignFile> as ForeignFile;
		const line = describeForeign(file, { libraries: ["video"] }).find((value) => value.startsWith("  video"));
		expect(line).toContain("1 skipped, 1 Android-only");
		const metrics = foreignMetrics(file, { libraries: ["video", "image"] });
		expect(metrics["foreign.image.androidOnly"]).toBeNull();
	});

	test("Android's log line for a skip is read with the marker when it has one, and without it as it always was", () => {
		const line = (value: object) => `11-01 12:00:00.123  4242  4290 I ReactNativeJS: '[Svelte foreign library skipped]', '${JSON.stringify(value)}'`;
		const parsed = parseForeignChecks([line({ library: "video", where: "inline", name: "n", why: "w", androidOnly: true }), line({ library: "video", where: "inline", name: "m", why: "w" })].join("\n"));
		expect(parsed.skips).toEqual([{ library: "video", where: "inline", name: "n", why: "w", androidOnly: true }, { library: "video", where: "inline", name: "m", why: "w" }]);
	});
});

describe("what the lab writes for the two harnesses", () => {
	test("a skip is the four fields Android's logcat line has always had, and the marker only when set", () => {
		expect(JSON.stringify(skipEntry("image", "inline", "inline: n", "why", false))).toBe('{"library":"image","where":"inline","name":"inline: n","why":"why"}');
		expect(JSON.stringify(skipEntry("image", "inline", "inline: n", "why", true))).toBe('{"library":"image","where":"inline","name":"inline: n","why":"why","androidOnly":true}');
	});

	test("the progress file holds the launch's token, the place just finished and both lists", () => {
		expect(JSON.parse(progressRecord("t", "image inline", [check("image", "inline")], []))).toEqual({ token: "t", finished: "image inline", checks: [check("image", "inline")], skips: [] });
	});

	test("Android's scenario detail holds no list of checks, and the iPhone's holds both lists", () => {
		const checks = [check("image", "inline")];
		const skips = [skipEntry("image", "inline", "n", "w", false)];
		expect(detailRecords(true, checks, skips)).toEqual({});
		expect(detailRecords(false, checks, skips)).toEqual({ checks, skips });
	});
});

describe("the iPhone's launches", () => {
	const run = (overrides: Partial<LabRun> = {}): LabRun =>
		({ startedAt: "2026-11-03T10:00:00Z", durationMs: 120_000, complete: true, checks: null, boot: null, scenarios: [], expectedScenarios: [], crashes: [], jsErrors: [], jsErrorCount: 0, engineWarnings: [], pid: 7, logFile: "runs/x.log", ...overrides }) as LabRun;

	test("count the app's own console.error calls as JavaScript errors and have no engine warnings", () => {
		const launch = iosLaunchOf("libraries", "foreign-libraries", run({ jsErrorCount: 2 }));
		expect(launch.jsErrors).toHaveLength(1);
		expect(launch.engineWarnings).toEqual([]);
		expect(launch.complete).toBe(true);
		expect(iosLaunchOf("leftovers", "foreign-leftovers,expect:6", run({ jsErrorCount: null })).jsErrors).toEqual([]);
		expect(iosLaunchOf("libraries", "x", run({ complete: false, crashes: ["the app (pid 7) was not running"] })).crashes).toHaveLength(1);
	});
});

describe("the release bundle of the iPhone build", () => {
	const directory = mkdtempSync(join(tmpdir(), "ios-foreign-"));
	const map = join(directory, "ios-bundle.map");
	writeFileSync(map, JSON.stringify({ sources: ["/node_modules/react/index.js", "/node_modules/react-native-video/src/Video.tsx", "/apps/example/src/lib/native/dev/LibrarySet.svelte"] }));
	const record = (overrides: Partial<IosBuildFile> = {}): IosBuildFile => ({
		schema: 1, kind: "ios-build", finishedAt: "", durationMs: 1, source: { commit: "abc", dirty: false }, macCheckout: "/m", appPath: "/m/x.app", bundleSha256: "j", jsbundleSha256: "j", cdHash: "c", bundleBytes: 1,
		sourceMap: { path: map, sizeBytes: 1, sha256: "s", sources: 3 }, logFile: "out/x.log", ...overrides,
	});
	const identity = { jsbundleSha256: "j", cdHash: "c" };

	test("is the map of the build record the app reported, with the library modules it holds", async () => {
		const bundle = await iosBundle(identity, record());
		expect(bundle?.matchesBuild).toBe(true);
		expect(bundle?.sources).toBe(3);
		expect(bundle?.reactFiles).toEqual(["/node_modules/react/index.js"]);
		expect(bundle?.forbidden.map((value) => value.library)).toEqual(["video"]);
	});

	test("does not match a build the app did not report, and is nothing without a map or without the app's identity", async () => {
		expect((await iosBundle({ jsbundleSha256: "j", cdHash: "other" }, record()))?.matchesBuild).toBe(false);
		expect((await iosBundle({ jsbundleSha256: "other", cdHash: "c" }, record()))?.matchesBuild).toBe(false);
		expect(await iosBundle(identity, record({ sourceMap: undefined }))).toBeNull();
		expect(await iosBundle(identity, null)).toBeNull();
		expect(await iosBundle(null, record())).toBeNull();
		rmSync(directory, { recursive: true, force: true });
	});
});

describe("the progress file of a launch that did not finish", () => {
	const progress = (token: string | null, extra: object = {}) => JSON.stringify({ token, finished: "video row", checks: [check("image", "inline"), check("video", "row", false)], skips: [{ library: "video", where: "row", name: "n", why: "w", androidOnly: true }], ...extra });

	test("is read like the finished scenario's records, when it is this launch's", () => {
		const records = foreignProgress(progress("t1"), "t1");
		expect(records?.finished).toBe("video row");
		expect(records?.checks).toHaveLength(2);
		expect(records?.skips).toHaveLength(1);
		expect(records?.unparsed).toEqual([]);
	});

	test("is nothing when it is another launch's, not JSON, absent or without a place", () => {
		expect(foreignProgress(progress("older"), "t1")).toBeNull();
		expect(foreignProgress("{", "t1")).toBeNull();
		expect(foreignProgress(null, "t1")).toBeNull();
		expect(foreignProgress(JSON.stringify({ token: "t1", checks: [], skips: [] }), "t1")).toBeNull();
	});

	test("an unreadable entry in it is reported", () => {
		expect(foreignProgress(progress("t1", { checks: [1] }), "t1")?.unparsed).toHaveLength(1);
	});
});
