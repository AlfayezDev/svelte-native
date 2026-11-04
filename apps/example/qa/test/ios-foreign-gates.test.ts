import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foreignMetrics } from "../lib/foreign.ts";
import { checkGatesFile, deviceRoles, deviceRuns, evaluate, type Gate, type GatesFile } from "../lib/gates.ts";
import { deviceMetrics } from "../lib/metrics.ts";
import { platformDir } from "../lib/paths.ts";
import type { CrashReport, ForeignCheck, ForeignFile, ForeignLaunch, ForeignSkip } from "../lib/types.ts";

const gates = JSON.parse(readFileSync(join(platformDir, "qa/gates.json"), "utf8")) as GatesFile;
const iphone = "E74A5608-BF8E-5806-8699-1605F82ADED9";
const libraries = gates.foreign?.libraries.ios ?? [];
const foreignGates = gates.gates.filter((gate) => gate.metric.startsWith("foreign."));
const gateOf = (library: string, field: string): Gate | undefined => gates.gates.find((gate) => gate.metric === `foreign.${library}.${field}`);

/**
 * The structure of the first iPhone run (3 Nov 2026, `foreign-E74A5608-...-20261103T122249Z.json`, 393 checks, 84 skips): per library the checks it made in the three places, the ones that
 * failed, the skips a finger would have avoided and the checks that exist on Android only. Failures there were the pins of four views (fixed since) and events, captures and layouts that other
 * work owns; the counts of checks are the structure the bars pin, and do not depend on which of them pass. One change since: the video's "frame is in the
 * image" capture check is Android-only on iOS (4 Nov 2026; an AVPlayerLayer's frames are not in a snapshot), so video's three places moved from checks to Android-only. The PDF's "onLoadComplete
 * arrives although the JS thread was busy" check is Android-only too (4 Nov 2026; the event coalescing it guards is the Android view's), so pdf has three more Android-only entries. So have
 * video, Lottie and Rive, one check each per place (the busy-JavaScript checks of the event patches of video and Lottie and the guard on Rive's interop path: "pause() then resume() raise both
 * onPlaybackStateChanged", "two cancelled animations raise both onAnimationFinish", "two animations played in turn raise both onPlay"; iOS dispatches their events with `dispatchEvent`, which React Native's queue never replaces).
 */
const first: Record<string, { checks: number; failed: number; skipped: number; androidOnly: number }> = {
	image: { checks: 33, failed: 0, skipped: 0, androidOnly: 3 },
	blur: { checks: 18, failed: 3, skipped: 0, androidOnly: 3 },
	gradient: { checks: 18, failed: 0, skipped: 0, androidOnly: 3 },
	video: { checks: 51, failed: 18, skipped: 0, androidOnly: 15 },
	datetime: { checks: 30, failed: 0, skipped: 0, androidOnly: 24 },
	lottie: { checks: 30, failed: 6, skipped: 0, androidOnly: 6 },
	pdf: { checks: 36, failed: 3, skipped: 0, androidOnly: 6 },
	capture: { checks: 48, failed: 9, skipped: 0, androidOnly: 3 },
	rive: { checks: 30, failed: 9, skipped: 0, androidOnly: 6 },
	conic: { checks: 18, failed: 6, skipped: 0, androidOnly: 3 },
	shadow: { checks: 18, failed: 3, skipped: 3, androidOnly: 15 },
	text: { checks: 30, failed: 0, skipped: 0, androidOnly: 3 },
	svg: { checks: 30, failed: 0, skipped: 3, androidOnly: 3 },
};

const places = ["inline", "row", "sheet"] as const;
const launch = (name: ForeignLaunch["name"]): ForeignLaunch => ({ name, run: name, startedAt: "2026-11-04T10:00:00Z", durationMs: 1000, complete: true, crashes: [], jsErrors: [], engineWarnings: [], logFile: `runs/${name}.log` });
const checksOf = (library: string, count: number, failed = 0): ForeignCheck[] =>
	Array.from({ length: count }, (_, index) => ({ library, where: places[index % 3] as ForeignCheck["where"], name: `${places[index % 3]}: check ${index}`, passed: index >= failed, detail: "" }));
const skipsOf = (library: string, skipped: number, androidOnly: number): ForeignSkip[] => [
	...Array.from({ length: skipped }, (_, index): ForeignSkip => ({ library, where: places[index % 3] ?? "inline", name: `skip ${index}`, why: "a press needs a finger" })),
	...Array.from({ length: androidOnly }, (_, index): ForeignSkip => ({ library, where: places[index % 3] ?? "inline", name: `android ${index}`, why: "Android only", androidOnly: true })),
];

/** A clean iPhone run with the first run's structure: every library's checks passed. */
function cleanRun(overrides: Partial<ForeignFile> = {}): ForeignFile {
	return {
		schema: 1, kind: "foreign", startedAt: "2026-11-04T10:00:00Z", finishedAt: "2026-11-04T10:12:00Z", source: { commit: "abc", dirty: false },
		device: { serial: iphone, platform: "ios" } as ForeignFile["device"], app: { package: "io.rasheed.svelteqa" } as ForeignFile["app"],
		asked: libraries,
		checks: libraries.flatMap((library) => checksOf(library, first[library]?.checks ?? 0)),
		skips: libraries.flatMap((library) => skipsOf(library, first[library]?.skipped ?? 0, first[library]?.androidOnly ?? 0)),
		leftovers: [{ library: "capture", where: "inline", name: "inline: gone", passed: true, detail: "" }],
		launches: [launch("libraries"), launch("leftovers")],
		bundle: { map: "m", sources: 1371, reactFiles: [], forbidden: [], matchesBuild: true },
		...overrides,
	};
}

/** What `native-qa gates --platform ios` would say about the foreign rows of the iPhone with these metrics. */
function judged(metrics: ReturnType<typeof foreignMetrics>, runs = deviceRuns(gates, [iphone])[iphone] ?? null) {
	const rows = evaluate(foreignGates, { [iphone]: { platform: "ios", role: deviceRoles(gates, [iphone])[iphone] ?? null, runs, metrics } }, "ios");
	return { rows, verdict: (id: string) => rows.find((row) => row.id === id)?.verdict };
}
const metricsOf = (file: ForeignFile) => foreignMetrics(file, { libraries });

describe("the iPhone's foreign gates", () => {
	test("the iPhone provides the foreign run kind, and a gate of that kind is judged for it, not informational", () => {
		expect(gates.devices[iphone]?.runs).toContain("foreign");
		const { rows } = judged(metricsOf(cleanRun()));
		expect(rows.length).toBe(foreignGates.length);
		expect(rows.filter((row) => row.verdict === "informational")).toEqual([]);
	});

	test("every foreign gate of a pinned library has a bar for the iPhone (a gate without one is never judged there)", () => {
		for (const library of libraries) {
			for (const field of ["failedChecks", "checks", "skipped"]) expect([library, field, gateOf(library, field)?.bar.ios !== undefined]).toEqual([library, field, true]);
		}
		for (const gate of foreignGates) expect([gate.id, gate.bar.ios !== undefined]).toEqual([gate.id, true]);
	});

	test("the bars are the counts the first iPhone run made: its checks as a minimum, its skips as a maximum, no failure", () => {
		for (const library of libraries) {
			const made = first[library];
			expect(made).toBeDefined();
			expect([library, gateOf(library, "checks")?.bar.ios]).toEqual([library, { min: made?.checks }]);
			expect([library, gateOf(library, "skipped")?.bar.ios]).toEqual([library, { max: made?.skipped }]);
			expect([library, gateOf(library, "failedChecks")?.bar.ios]).toEqual([library, { max: 0 }]);
		}
		// Android makes one more check per place for each of the four event guards (video, Lottie and Rive new, pdf before).
		expect([gateOf("video", "checks"), gateOf("lottie", "checks"), gateOf("rive", "checks"), gateOf("pdf", "checks")].map((gate) => gate?.bar.android?.min)).toEqual([66, 36, 36, 42]);
		expect(foreignGates.find((gate) => gate.id === "foreign.launches")?.bar.ios).toEqual({ min: 2 });
	});

	test("a clean run of that structure passes every foreign row of the iPhone", () => {
		const { rows } = judged(metricsOf(cleanRun()));
		expect(rows.filter((row) => row.verdict !== "pass").map((row) => `${row.id} ${row.verdict}`)).toEqual([]);
	});

	test("the first run itself fails exactly the libraries that had a failed check", () => {
		const failedFile = cleanRun({ checks: libraries.flatMap((library) => checksOf(library, first[library]?.checks ?? 0, first[library]?.failed ?? 0)) });
		const { rows } = judged(metricsOf(failedFile));
		const failing = rows.filter((row) => row.verdict === "fail").map((row) => row.id).sort();
		expect(failing).toEqual(libraries.filter((library) => (first[library]?.failed ?? 0) > 0).map((library) => `foreign.${library}.failedChecks`).sort());
	});

	test("a check that stops running, a skip that appears and an unreadable entry fail their gates", () => {
		const dropped = cleanRun();
		dropped.checks.splice(dropped.checks.findIndex((entry) => entry.library === "video"), 1);
		const missing = judged(metricsOf(dropped));
		expect(missing.verdict("foreign.video.checks")).toBe("fail");
		expect(missing.verdict("foreign.video.failedChecks")).toBe("pass");

		const skipped = judged(metricsOf(cleanRun({ skips: [...cleanRun().skips, ...skipsOf("image", 1, 0)] })));
		expect(skipped.verdict("foreign.image.skipped")).toBe("fail");
		// the shadow's three presses are the pinned skips; a fourth is a hole
		expect(judged(metricsOf(cleanRun())).verdict("foreign.shadow.skipped")).toBe("pass");
		expect(judged(metricsOf(cleanRun({ skips: [...cleanRun().skips, ...skipsOf("shadow", 1, 0)] }))).verdict("foreign.shadow.skipped")).toBe("fail");
		expect(judged(metricsOf(cleanRun({ unparsed: ["{\"library\""] }))).verdict("foreign.unparsedLines")).toBe("fail");
	});

	test("a check moved to Android-only is neither a pass nor a skip, so the count of checks catches it", () => {
		const moved = cleanRun();
		const index = moved.checks.findIndex((entry) => entry.library === "blur");
		const [gone] = moved.checks.splice(index, 1);
		moved.skips.push({ library: "blur", where: gone?.where ?? "inline", name: gone?.name ?? "", why: "Android only", androidOnly: true });
		const { verdict } = judged(metricsOf(moved));
		expect(verdict("foreign.blur.checks")).toBe("fail");
		expect(verdict("foreign.blur.skipped")).toBe("pass");
	});

	test("a launch that did not finish, a crash and a library that logged nothing fail theirs", () => {
		const crashed = judged(metricsOf(cleanRun({ launches: [{ ...launch("libraries"), complete: false, crashes: ["Terminating app due to uncaught exception"] }, launch("leftovers")] })));
		expect(crashed.verdict("foreign.launches")).toBe("fail");
		expect(crashed.verdict("foreign.incomplete")).toBe("fail");
		expect(crashed.verdict("foreign.fatals")).toBe("fail");
		const silent = judged(metricsOf(cleanRun({ checks: cleanRun().checks.filter((entry) => entry.library !== "pdf") })));
		expect(silent.verdict("foreign.libraries.missing")).toBe("fail");
		expect(silent.verdict("foreign.pdf.failedChecks")).toBe("not measured");
	});

	test("an iPhone that was not run on the foreign kind has every row not measured, which fails", () => {
		const { rows } = judged({});
		expect(new Set(rows.map((row) => row.verdict))).toEqual(new Set(["not measured"]));
	});

	test("a device that does not provide the kind reads the same rows as informational", () => {
		const { rows } = judged(metricsOf(cleanRun()), ["lab", "boot"]);
		expect(new Set(rows.map((row) => row.verdict))).toEqual(new Set(["informational"]));
	});

	test("a pull of the phone's crash log during the foreign run counts for the iPhone's crash reports", () => {
		const report: CrashReport = { file: "RasheedSvelteQA-2026-11-04-100000.ips", capturedAt: null, processStartedAt: null, pid: 1, exceptionType: "EXC_CRASH", signal: "SIGABRT", reason: null, framesOf: null, topFrames: [] };
		const measure = (file: ForeignFile) => deviceMetrics(null, null, [], null, null, { parity: null, a11y: null, resilience: null }, null, null, [], null, [], null, { file, pins: { libraries } });
		expect(measure(cleanRun({ crashReports: [report] }))["log.crashReports"]).toBe(1);
		expect(measure(cleanRun({ crashReports: [] }))["log.crashReports"]).toBe(0);
		expect(measure(cleanRun({ crashReports: undefined, crashReportsError: "after the run: No device found" }))["log.crashReports"]).toBeNull();
		expect("log.crashReports" in measure(cleanRun({ device: { serial: "emulator-5554", platform: "android" } as ForeignFile["device"], crashReports: [report] }))).toBe(false);
	});
});

describe("the gates file refuses a foreign table that would hide a hole", () => {
	const copy = (): GatesFile => structuredClone(gates);
	const barOf = (file: GatesFile, library: string, field: string): Gate["bar"] => {
		const gate = file.gates.find((candidate) => candidate.metric === `foreign.${library}.${field}`);
		if (!gate) throw new Error(`no gate for ${library} ${field}`);
		return gate.bar;
	};

	test("the file as it is passes", () => {
		expect(() => checkGatesFile(gates)).not.toThrow();
	});

	test("a pinned library without an iPhone bar on any of its three gates", () => {
		for (const field of ["failedChecks", "checks", "skipped"]) {
			const file = copy();
			delete barOf(file, "pdf", field).ios;
			expect(() => checkGatesFile(file)).toThrow(new RegExp(`foreign\\.pdf\\.${field} has no ios bar`));
		}
	});

	test("an iPhone count that is not Android's with no reason, and a reason for a count that is", () => {
		const unexplained = copy();
		delete unexplained.foreign?.ios?.video;
		expect(() => checkGatesFile(unexplained)).toThrow(/counts of video .* not Android's and foreign\.ios gives no reason/);
		const stale = copy();
		barOf(stale, "video", "checks").ios = { min: 66 };
		expect(() => checkGatesFile(stale)).toThrow(/reason for video, whose counts on the iPhone are Android's/);
		const blank = copy();
		if (blank.foreign?.ios) blank.foreign.ios.video = "  ";
		expect(() => checkGatesFile(blank)).toThrow(/says nothing for video/);
		const stranger = copy();
		if (stranger.foreign?.ios) stranger.foreign.ios.webview = "x";
		expect(() => checkGatesFile(stranger)).toThrow(/explains webview/);
	});

	test("every library whose iPhone counts are not Android's says why, and the reasons name what differs", () => {
		const reasons = gates.foreign?.ios ?? {};
		expect(Object.keys(reasons).sort()).toEqual([...libraries].sort());
		for (const library of libraries) expect([library, (reasons[library] ?? "").length > 40]).toEqual([library, true]);
		expect(reasons.shadow).toContain("skipped");
		expect(reasons.svg).toContain("finger");
		expect(reasons.datetime).toContain("UIDatePicker");
	});
});
