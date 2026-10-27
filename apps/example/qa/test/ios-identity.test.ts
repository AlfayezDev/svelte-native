import { describe, expect, test } from "bun:test";
import { readLaunchReport, staleReport } from "../commands/ios-boot.ts";
import { buildKey, buildWarnings, type ReportFile } from "../commands/report.ts";
import { reportProblems, type RunFileState } from "../commands/gates.ts";
import { parseCaptureIndex } from "../lib/iphone/capture.ts";
import { IdentityMismatch, identityMismatch, reportedIdentity, withIdentity } from "../lib/iphone/identity.ts";
import { labRunFromIos, parseIosLabResults } from "../lib/iphone/lab-results.ts";
import { buildRecordOf, type IosBuildFile } from "../lib/iphone/session.ts";
import type { AppInfo, BuildIdentity, BuildRecord } from "../lib/types.ts";
import { launchFromReport, parseBootReport, parseIdentity } from "../parse/ios.ts";
import { sample } from "./sample.ts";

const digest = (seed: string) => seed.repeat(64).slice(0, 64);
/** A code directory hash is 20 bytes: the first 40 hex digits of a digest stand in. */
const cd = (seed: string) => digest(seed).slice(0, 40);
const identity = (js = "a", executable = "b"): BuildIdentity => ({ jsbundleSha256: digest(js), cdHash: cd(executable) });
const record = (js = "a", executable: string | null = "b"): BuildRecord => ({ commit: "afabc2ad7", dirty: false, jsbundleSha256: digest(js), cdHash: executable === null ? null : cd(executable) });

describe("the identity the app reports", () => {
	test("both digests, or nothing: a build field that is missing, partial or not a digest is not an identity", () => {
		expect(parseIdentity(identity())).toEqual(identity());
		expect(parseIdentity(undefined)).toBeNull();
		expect(parseIdentity(null)).toBeNull();
		expect(parseIdentity({ jsbundleSha256: digest("a") })).toBeNull();
		expect(parseIdentity({ jsbundleSha256: "abc", cdHash: cd("b") })).toBeNull();
		expect(parseIdentity({ jsbundleSha256: digest("a"), cdHash: digest("b") })).toBeNull();
	});

	test("lab results, the boot report and the capture index carry it, and an older app's files read as not reported", () => {
		const labText = JSON.stringify({ ...JSON.parse(sample("ios-lab-results.json")), build: identity(), jsErrors: 4 });
		const results = parseIosLabResults(labText);
		expect([results.build, results.jsErrors]).toEqual([identity(), 4]);
		const older = parseIosLabResults(sample("ios-lab-results.json"));
		expect([older.build, older.jsErrors]).toEqual([null, null]);
		const boot = { pid: 1, processStartMs: 10, launchedMs: 20, contentAppearedMs: 30, displayedMs: 40, javaScript: "total 5 ms", build: identity(), jsErrors: 2 };
		expect(parseBootReport(JSON.stringify(boot))).toEqual(expect.objectContaining({ build: identity(), jsErrors: 2 }));
		expect(parseBootReport(JSON.stringify({ ...boot, build: undefined, jsErrors: undefined }))).toEqual(expect.objectContaining({ build: null, jsErrors: null }));
		const index = { schema: 1, token: "t", startedAt: "x", finishedAt: null, done: false, themes: ["light"], entries: [], error: null };
		expect(parseCaptureIndex(JSON.stringify({ ...index, build: identity() })).build).toEqual(identity());
		expect(parseCaptureIndex(JSON.stringify(index)).build).toBeNull();
	});

	test("the lab run keeps the app's console.error count, and null when the app reports none", () => {
		const capture = (text: string) => ({ results: parseIosLabResults(text), startedAt: new Date(), durationMs: 1, died: null, logFile: "x" });
		const reported = JSON.stringify({ ...JSON.parse(sample("ios-lab-results.json")), build: identity(), jsErrors: 3 });
		expect(labRunFromIos(capture(reported), true).jsErrorCount).toBe(3);
		expect(labRunFromIos(capture(sample("ios-lab-results.json")), true).jsErrorCount).toBeNull();
		expect(labRunFromIos({ ...capture(reported), results: null, died: "gone" }, true).jsErrorCount).toBeNull();
	});
});

describe("the reported build against the build record", () => {
	test("the same digests match; a different bundle or executable is named in the mismatch", () => {
		expect(identityMismatch(identity(), record())).toBeNull();
		expect(identityMismatch(identity("c"), record())).toContain("main.jsbundle cccccccccccc on the phone, aaaaaaaaaaaa in the build record");
		expect(identityMismatch(identity("a", "d"), record())).toContain("executable dddddddddddd on the phone, bbbbbbbbbbbb");
	});

	test("a record made before the executable digest was taken is compared on the bundle alone", () => {
		expect(identityMismatch(identity("a", "z"), record("a", null))).toBeNull();
		expect(identityMismatch(identity("c"), record("a", null))).not.toBeNull();
	});

	test("a build that is not the recorded one fails the run, install or --no-install alike", () => {
		expect(() => reportedIdentity([identity("c")], record(), "lab")).toThrow(IdentityMismatch);
		expect(() => reportedIdentity([identity("c")], record(), "lab")).toThrow("lab: the app on the phone is not the recorded build");
		expect(reportedIdentity([identity(), identity()], record(), "lab")).toEqual(identity());
	});

	test("every file of a run says the same build, or the run fails; a build with no record is only recorded", () => {
		expect(() => reportedIdentity([identity(), identity("c")], record(), "boot")).toThrow("changed during the run");
		expect(() => reportedIdentity([identity(), null], record(), "boot")).toThrow("in 1 of 2 files");
		expect(reportedIdentity([identity("c")], null, "boot")).toEqual(identity("c"));
	});

	test("an app that reports nothing leaves the run file with installed: null", () => {
		expect(reportedIdentity([null, null], record(), "boot")).toBeNull();
		expect(reportedIdentity([], record(), "lab")).toBeNull();
		const app = { package: "io.rasheed.svelteqa", versionName: "0.1.0", versionCode: 1, lastUpdateTime: null, installedSha256: "stale", apk: null } satisfies AppInfo;
		expect(withIdentity(app, null)).toEqual({ ...app, installed: null, installedSha256: null });
		expect(withIdentity(app, identity())).toEqual({ ...app, installed: identity(), installedSha256: cd("b") });
	});

	test("the record is read from ios-build.json, with the bundle digest under either of its names", () => {
		const file = { schema: 1, kind: "ios-build", finishedAt: "", durationMs: 1, source: { commit: "afabc2ad7", dirty: true }, macCheckout: "/m", appPath: "/m/App.app", bundleSha256: digest("a"), bundleBytes: 1, logFile: "x" } satisfies IosBuildFile;
		expect(buildRecordOf(file)).toEqual({ commit: "afabc2ad7", dirty: true, jsbundleSha256: digest("a"), cdHash: null });
		expect(buildRecordOf({ ...file, jsbundleSha256: digest("c"), cdHash: cd("d") })).toEqual({ commit: "afabc2ad7", dirty: true, jsbundleSha256: digest("c"), cdHash: cd("d") });
	});
});

describe("a boot report that is not this launch's", () => {
	const report = { pid: 321, processStartMs: 1_000_000, launchedMs: 1_000_080, contentAppearedMs: 1_000_190, displayedMs: 1_000_207, javaScript: "total 98 ms", osVersion: "26.6" };
	const text = (fields: object = {}) => JSON.stringify({ ...report, ...fields });

	test("one the previous launch left behind is refused even when the pid is the same, by the phone's own clock", () => {
		const parsed = parseBootReport(text());
		expect(staleReport(parsed, 321, null)).toBeNull();
		expect(staleReport(parsed, 321, 999_000)).toBeNull();
		expect(staleReport(parsed, 321, 1_000_000)).toContain("started 0 ms before the one measured before it");
		expect(staleReport(parsed, 321, 1_004_500)).toContain("started 4500 ms before the one measured before it");
		expect(staleReport(parsed, 322, 999_000)).toContain("from process 321, not 322");
	});

	test("reading a copy: a half-written one is not ready yet, a stale one is named, a fresh one is the sample", () => {
		expect(readLaunchReport('{"pid":321,"processSt', 321, null)).toBeNull();
		expect(readLaunchReport("", 321, null)).toBeNull();
		expect(readLaunchReport("{}", 321, null)).toBeNull();
		expect(readLaunchReport(text(), 321, 1_100_000)).toEqual({ stale: expect.stringContaining("before the one measured before it") });
		const fresh = readLaunchReport(text(), 321, 900_000);
		expect(fresh && "report" in fresh ? launchFromReport(fresh.report).displayMs : null).toBe(207);
	});
});

describe("which build a run measured, across the runs of a device", () => {
	const app = (fields: Partial<AppInfo> = {}): AppInfo => ({ package: "io.rasheed.svelteqa", versionName: "0.1.0", versionCode: 1, lastUpdateTime: null, installedSha256: null, apk: null, ...fields });
	const run = (fields: Partial<AppInfo> = {}, commit = "afabc2ad7") => ({ app: app(fields), source: { commit, dirty: false } });
	const reported = (js = "a", executable = "b") => run({ installed: identity(js, executable), installedSha256: cd(executable), build: record(js, executable) });

	test("iOS runs are told apart by what the app reported, Android runs by the APK's digest", () => {
		expect(buildKey(app({ installed: identity("a", "b") }))).toBe("main.jsbundle aaaaaaaaaaaa, CDHash bbbbbbbbbbbb");
		expect(buildKey(app({ installedSha256: digest("c") }))).toBe("sha256 cccccccccccc");
		expect(buildKey(app({ installed: null }))).toBeNull();
	});

	test("runs of one build and one commit have nothing to warn about", () => {
		expect(buildWarnings("E74A", [["lab", reported()], ["boot", reported()], ["parity", reported()]])).toEqual([]);
	});

	test("a run that cannot say which build it measured is a warning, and iOS runs without the identity are not skipped", () => {
		const warnings = buildWarnings("E74A", [["lab", run()], ["boot", run({ installed: null })], ["soak", null]]);
		expect(warnings).toEqual([
			"E74A: the lab run does not identify its build (build identity not reported)",
			"E74A: the boot run does not identify its build (build identity not reported)",
		]);
	});

	test("runs of different builds are one warning that names which run measured which", () => {
		const warnings = buildWarnings("E74A", [["lab", reported("a", "b")], ["boot", reported("c", "d")], ["a11y", reported("a", "b")]]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("different builds");
		expect(warnings[0]).toContain("lab and a11y: main.jsbundle aaaaaaaaaaaa");
		expect(warnings[0]).toContain("boot: main.jsbundle cccccccccccc");
	});

	test("the lab and the boot run must be of one commit: the build's on iOS, the harness's checkout on Android", () => {
		const lab = run({ installedSha256: digest("a") }, "aaa1111");
		const boot = run({ installedSha256: digest("a") }, "bbb2222");
		expect(buildWarnings("emulator", [["lab", lab], ["boot", boot]])).toEqual(["emulator: the lab ran at aaa1111 and the boot run at bbb2222"]);
		// the harness checkout moved between two runs of one iOS build: not a mix, the build record says which commit it was
		const sameBuild = { ...reported(), source: { commit: "later", dirty: true } };
		expect(buildWarnings("E74A", [["lab", reported()], ["boot", sameBuild]])).toEqual([]);
	});

	test("a build record without the CDHash is a warning", () => {
		const old = run({ installed: identity(), installedSha256: cd("b"), build: record("a", null) });
		expect(buildWarnings("E74A", [["lab", old]])).toEqual(["E74A: the build record (qa/out/ios-build.json) has no CDHash: build again"]);
	});
});

describe("gates on a report that is not current", () => {
	const generatedAt = "2026-10-27T10:00:00.000Z";
	const report = (warnings: string[] = []) =>
		({
			schema: 1,
			generatedAt,
			builds: {},
			devices: { E74A: { platform: "ios" }, "localhost:5555": { platform: "android" } },
			warnings,
			gates: [],
			verdict: { rows: { pass: 0, fail: 0, notMeasured: 0 }, gates: { pass: 0, fail: 0, notMeasured: 0 }, ok: false },
		}) as unknown as ReportFile;
	const file = (name: string, platform: RunFileState["platform"], modifiedAt: string): RunFileState => ({ file: `runs/${name}`, platform, modifiedAt: new Date(modifiedAt) });

	test("a clean, current report has no problem", () => {
		expect(reportProblems(report(), [file("lab-E74A-1.json", "ios", "2026-10-27T09:59:00.000Z")])).toEqual([]);
	});

	test("a run file written after the report was generated makes it stale, with the file and the time named", () => {
		const problems = reportProblems(report(), [file("lab-E74A-20261027T100500Z.json", "ios", "2026-10-27T10:05:00.000Z")]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("runs/lab-E74A-20261027T100500Z.json was written 2026-10-27T10:05:00.000Z, after the report (2026-10-27T10:00:00.000Z)");
	});

	test("only the runs of the judged platform count: a newer Android run does not stale an iOS verdict", () => {
		const runs = [file("lab-localhost_5555-x.json", "android", "2026-10-27T11:00:00.000Z")];
		expect(reportProblems(report(), runs, "ios")).toEqual([]);
		expect(reportProblems(report(), runs, "android")).toHaveLength(1);
		expect(reportProblems(report(), runs)).toHaveLength(1);
	});

	test("every warning of the report is a problem: runs of different builds or commits, or of a build nobody identified", () => {
		const warnings = ["E74A: the lab run does not identify its build (build identity not reported)", "localhost:5555: the lab ran at a and the boot run at b"];
		expect(reportProblems(report(warnings), [])).toEqual(warnings.map((warning) => `the report warns: ${warning}`));
		expect(reportProblems(report(warnings), [], "ios")).toEqual([`the report warns: ${warnings[0]}`]);
		expect(reportProblems(report(warnings), [], "android")).toEqual([`the report warns: ${warnings[1]}`]);
	});
});
