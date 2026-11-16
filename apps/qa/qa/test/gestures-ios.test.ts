import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScript, defaultEdgeX, edgeReleaseFrom, edgeReleases, inBackground, onUsb, injectionsFrom, launchFromIos, launchesWithCrashes, parseUiTestOutput, profileStale, sourceFiles, sourcesDigest, testCommand, uiTestLeftovers, uiTestsLocal, coreDeviceDaemons, describeUiTestLeftovers } from "../lib/iphone/gestures.ts";
import { describeStories, storiesFrom, type TraceFile } from "../lib/iphone/gesture-trace.ts";
import { macFrom } from "../lib/iphone/mac.ts";
import type { IosLabResults } from "../lib/iphone/lab-results.ts";
import type { CrashReport, GestureLaunch } from "../lib/types.ts";

const output = [
	"Test Suite 'GesturesUITests' started at 2026-10-28 13:00:00.000.",
	'GESTURES-ACTION {"scenario":"gestures-box","round":0,"step":0,"kind":"drag","beganMs":1000,"endedMs":1500}',
	'GESTURES-ACTION {"scenario":"gestures-row","round":0,"step":0,"kind":"drag","error":"no element with the identifier gesture.row-3"}',
	"/tmp/x/GesturesUITests.swift:41: error: -[GesturesUITests.GesturesUITests testDrive] : failed - gesture.row-3 not found",
	"Test Case '-[GesturesUITests.GesturesUITests testDrive]' failed (31.2 seconds).",
].join("\n");

describe("the XCUITest bundle on the Mac", () => {
	test("the digest follows the sources", () => {
		expect(sourcesDigest(["a", "b"])).toBe(sourcesDigest(["a", "b"]));
		expect(sourcesDigest(["a", "b"])).not.toBe(sourcesDigest(["ab", ""]));
		expect(sourcesDigest(["a", "b"])).toHaveLength(16);
	});

	test("a runner whose profile has expired or cannot be read is built again; a valid one is kept, however soon it expires", () => {
		const now = new Date("2026-11-15T10:00:00Z");
		expect(profileStale("2026-11-20T09:00:00Z", now)).toBeNull();
		expect(profileStale("2026-11-15T10:00:01Z", now)).toBeNull();
		expect(profileStale("2026-11-15T10:00:00Z", now)).toBe("its provisioning profile expired at 2026-11-15T10:00:00.000Z");
		expect(profileStale("2026-11-15T09:59:59Z", now)).toBe("its provisioning profile expired at 2026-11-15T09:59:59.000Z");
		expect(profileStale(null, now)).toBe("its provisioning profile could not be read");
		expect(profileStale("not a date", now)).toBe("its provisioning profile could not be read");
	});

	test("the build script goes to the project, generates it, builds for testing and records its status", () => {
		const script = buildScript({ dir: "/tmp/native-qa-ios/gestures-ui-tests", team: "ABCDE12345", udid: "00008110-001E10593410401E", exitFile: "/tmp/b.exit", logFile: "/tmp/b.log", digest: "0123456789abcdef" });
		expect(script.startsWith("#!/bin/bash\n")).toBe(true);
		expect(script).toContain("cd '/tmp/native-qa-ios/gestures-ui-tests'");
		expect(script).toContain("export DEVELOPMENT_TEAM='ABCDE12345'");
		expect(script).toContain("ruby make-project.rb && xcodebuild build-for-testing -project GesturesUITests.xcodeproj -scheme GesturesUITests -destination 'id=00008110-001E10593410401E' -derivedDataPath DerivedData -allowProvisioningUpdates DEVELOPMENT_TEAM='ABCDE12345'");
		expect(script).toContain("echo '0123456789abcdef' > .built");
		expect(script).toContain("echo $status > '/tmp/b.exit'");
	});

	test("the test command runs the built runner against the phone with the app, the lab's link and the time handed in", () => {
		const url = "example-svelte:///__dev?run=gestures-box,drive:xctest&token=abc";
		const command = testCommand({ dir: "/tmp/t", udid: "UDID", bundleId: "io.example.svelteqa", seconds: 900, outFile: "/tmp/t/out.log", url, trace: true });
		expect(command).toContain("cd '/tmp/t'");
		expect(command).toContain(`TEST_RUNNER_GESTURES_SECONDS=900 TEST_RUNNER_GESTURES_BUNDLE_ID='io.example.svelteqa' TEST_RUNNER_GESTURES_URL='${url}' TEST_RUNNER_GESTURES_TRACE=1`);
		expect(command).toContain("xcodebuild test-without-building -xctestrun");
		expect(command).toContain("-destination 'id=UDID' -only-testing:GesturesUITests/GesturesUITests/testDrive > '/tmp/t/out.log' 2>&1");
		expect(testCommand({ dir: "/tmp/t", udid: "UDID", bundleId: "b", seconds: 1, outFile: "/o", url }).includes("GESTURES_TRACE=0")).toBe(true);
	});

	test("the pushed-edge swipe starts inside UIKit's edge zone unless told otherwise, and the test reads it from the environment", () => {
		expect(defaultEdgeX).toBe("2");
		expect(Number(defaultEdgeX) <= 3).toBe(true);
		const command = testCommand({ dir: "/tmp/t", udid: "U", bundleId: "b", seconds: 1, outFile: "/o", url: "u", edgeX: defaultEdgeX });
		expect(command).toContain("TEST_RUNNER_GESTURES_EDGE_X='2'");
		const swift = readFileSync(join(uiTestsLocal, "GesturesUITests/GesturesUITests.swift"), "utf8");
		expect(swift).toContain('"GESTURES_EDGE_X"');
	});

	test("a background command is quoted whole and prints its process id", () => {
		expect(inBackground("cd '/tmp/a b' && run")).toBe("nohup sh -c 'cd '\\''/tmp/a b'\\'' && run' > /dev/null 2>&1 & echo $!");
	});

	test("the Swift test reads the element and the identifiers the page writes", () => {
		const swift = readFileSync(join(uiTestsLocal, "GesturesUITests/GesturesUITests.swift"), "utf8");
		const page = readFileSync(join(uiTestsLocal, "../../src/routes/__dev/gestures/+mobile.svelte"), "utf8");
		expect(swift).toContain('app.staticTexts["gestures.status"]');
		expect(page).toContain('testID="gestures.status"');
		expect(swift).toContain('"gesture.\\(target)"');
		expect(page).toContain("testID: `gesture.${name}`");
		expect(swift).toContain("GESTURES-ACTION");
		expect(swift).toContain('ready["drive"] as? String == "xctest"');
	});

	test("the project generator names the target the test command selects", () => {
		const ruby = readFileSync(join(uiTestsLocal, "make-project.rb"), "utf8");
		expect(ruby).toContain("'GesturesUITests'");
		expect(ruby).toContain("DEVELOPMENT_TEAM");
	});

	test("every source of the runner is in the digest, so that a change to any of them builds the runner again", () => {
		const sources = readdirSync(join(uiTestsLocal, "GesturesUITests")).filter((file) => /\.(swift|m|h)$/.test(file)).map((file) => `GesturesUITests/${file}`);
		expect(sources).toContain("GesturesUITests/SvelteQAEvents.m");
		for (const file of [...sources, "make-project.rb"]) expect(sourceFiles).toContain(file);
		const contents = sourceFiles.map((file) => readFileSync(join(uiTestsLocal, file), "utf8"));
		const index = sourceFiles.indexOf("GesturesUITests/SvelteQAEvents.m");
		expect(sourcesDigest(contents.map((content, at) => (at === index ? `${content} ` : content)))).not.toBe(sourcesDigest(contents));
	});

	test("the Objective-C drag is compiled into the runner and the Swift test reaches it through the bridging header", () => {
		const ruby = readFileSync(join(uiTestsLocal, "make-project.rb"), "utf8");
		const swift = readFileSync(join(uiTestsLocal, "GesturesUITests/GesturesUITests.swift"), "utf8");
		expect(ruby).toContain("group.new_file('SvelteQAEvents.m')");
		expect(ruby).toContain("settings['SWIFT_OBJC_BRIDGING_HEADER'] = 'GesturesUITests/SvelteQAEvents.h'");
		expect(swift).toContain("SvelteQAEvents.drag(from:");
	});

	test("--edge-release takes the four ways a swipe can end and refuses anything else, which the test would take for the default", () => {
		expect([...edgeReleases]).toEqual(["moving", "eased", "rest", "fling"]);
		for (const release of edgeReleases) expect(edgeReleaseFrom(release)).toBe(release);
		expect(edgeReleaseFrom(undefined)).toBeUndefined();
		expect(() => edgeReleaseFrom("esaed")).toThrow('--edge-release is one of moving, eased, rest, fling, not "esaed"');
		const swift = readFileSync(join(uiTestsLocal, "GesturesUITests/GesturesUITests.swift"), "utf8");
		expect(swift).toContain('["eased", "rest", "fling"].contains(release) ? release : "moving"');
	});
});

describe("what the test printed", () => {
	test("actions, failures and the test case's verdict", () => {
		const parsed = parseUiTestOutput(output);
		expect(parsed.actions).toEqual([
			{ scenario: "gestures-box", round: 0, step: 0, kind: "drag", error: null, beganMs: 1_000, endedMs: 1_500 },
			{ scenario: "gestures-row", round: 0, step: 0, kind: "drag", error: "no element with the identifier gesture.row-3", beganMs: null, endedMs: null },
		]);
		expect(parsed.failures).toEqual(["failed - gesture.row-3 not found"]);
		expect(parsed.ended).toBe("failed");
		expect(injectionsFrom(parsed)["gestures-row"]?.[0]?.error).toMatch(/no element/);
	});

	test("a run the harness stopped has no verdict, and an unreadable action is a failure", () => {
		const parsed = parseUiTestOutput('GESTURES-ACTION {"scenario":"gestures-box"\nGESTURES-ACTION {"scenario":"gestures-box","round":0,"step":0,"kind":"tap"}');
		expect(parsed.ended).toBeNull();
		expect(parsed.failures).toHaveLength(1);
		expect(parsed.actions).toHaveLength(1);
	});
});

const stress = (name: string, verdict: string, checks: [string, number][]): IosLabResults["stress"][number] => ({
	name, verdict, summary: "x", detail: { mode: "box", drive: "xctest", timedOut: null, checks, counters: [{ pan: [1, 1, 24, 1, 1, 1, 1] }], marks: [{}] },
});
const results = (done: boolean, entries: IosLabResults["stress"]): IosLabResults => ({
	phase: done ? "done" : "stress", token: "t", finishedAt: "", platform: "ios", osVersion: "26", appVersion: "1", build: null, jsErrors: 0, checks: [], stress: entries, stressDone: done,
});

describe("a launch from what the app wrote", () => {
	const capture = (over: Partial<Parameters<typeof launchFromIos>[0]> = {}) => ({
		asked: ["gestures-box", "gestures-row"], results: results(true, [stress("idle", "pass", []), stress("gestures-box", "pass", [["a", 1]]), stress("gestures-row", "fail", [["b", 0]])]),
		startedAt: new Date("2026-10-28T10:00:00Z"), durationMs: 9000, died: null, pid: 77, output: parseUiTestOutput(output), testText: output, logFile: "runs/x.log", ...over,
	});

	test("only the gestures scenarios, each with its checks, are the launch's", () => {
		const launch = launchFromIos(capture());
		expect(launch.input).toBe("xctest");
		expect(launch.scenarios.map((entry) => entry.name)).toEqual(["gestures-box", "gestures-row"]);
		expect(launch.scenarios[1]?.checks).toEqual([{ name: "b", ok: false, value: null }]);
		expect(launch.scenarios[1]?.injections[0]?.error).toMatch(/no element/);
		expect(launch.complete).toBe(true);
		expect(launch.pid).toBe(77);
		expect(launch.harnessErrors).toContain("failed - gesture.row-3 not found");
	});

	test("incomplete when the lab did not finish, the app died, or a scenario has no result", () => {
		expect(launchFromIos(capture({ results: results(false, []) })).complete).toBe(false);
		expect(launchFromIos(capture({ died: "the app (pid 77) was not running" })).complete).toBe(false);
		expect(launchFromIos(capture({ asked: ["gestures-box", "gestures-carousel"] })).complete).toBe(false);
		expect(launchFromIos(capture({ results: null })).complete).toBe(false);
	});

	test("a test that did nothing says so", () => {
		const launch = launchFromIos(capture({ output: parseUiTestOutput("xcodebuild: error: Failed to find a device"), testText: "xcodebuild: error: Failed to find a device" }));
		expect(launch.harnessErrors.join(" ")).toMatch(/performed no action: xcodebuild: error: Failed to find a device/);
		expect(launchFromIos(capture({ output: null, testText: "" })).harnessErrors).toContain("the test run produced no output");
	});

	test("a runner the phone refused for its expired profile says so", () => {
		const text = "Recovery Suggestion: Failed to install embedded profile for io.example.svelteqa.gesturesuitests.xctrunner : 0xe8008011 (This provisioning profile has expired.)\n** TEST EXECUTE FAILED **";
		const launch = launchFromIos(capture({ output: parseUiTestOutput(text), testText: text }));
		expect(launch.harnessErrors).toContain("the phone refused the XCUITest runner: its provisioning profile has expired (the next run builds it again)");
		expect(launchFromIos(capture()).harnessErrors.join(" ")).not.toMatch(/provisioning profile/);
	});
});

describe("crash reports on the launches", () => {
	const launch = (pid: number, startedAt: string): GestureLaunch => ({ input: "xctest", asked: [], startedAt, durationMs: 1, complete: true, scenarios: [], crashes: [], jsErrors: [], engineWarnings: [], harnessErrors: [], pid, logFile: "x" });
	const report = (pid: number, capturedAt: string): CrashReport => ({ file: `app-${pid}.ips`, capturedAt, processStartedAt: null, pid, exceptionType: "EXC_CRASH", signal: "SIGABRT", reason: "boom", framesOf: null, topFrames: [] });

	test("a launch whose process crashed is incomplete and says why; a report no launch owns stays unattributed", () => {
		const { launches, reports } = launchesWithCrashes([launch(10, "2026-10-28T10:00:00Z"), launch(11, "2026-10-28T10:05:00Z")], [report(11, "2026-10-28T10:06:00Z"), report(99, "2026-10-28T10:06:00Z")]);
		expect(launches[0]?.complete).toBe(true);
		expect(launches[1]?.complete).toBe(false);
		expect(launches[1]?.crashes[0]).toMatch(/the app aborted: boom/);
		expect(reports.map((entry) => entry.attributedTo)).toEqual(["gestures 2", "unattributed"]);
	});
});

describe("the recognizer recording against the test's actions", () => {
	const trace: TraceFile = {
		meta: [
			{ id: 0, class: "RNBetterPanGestureRecognizer", delegate: "RNPanGestureHandler", view: "RCTViewComponentView", handlerTag: 7 },
			{ id: 1, class: "_UIParallaxTransitionPanGestureRecognizer", delegate: "SvelteStackView", view: "UILayoutContainerView" },
		],
		// [t, id, state, touches, tx, ty]: the pan has the touch from t = 10_000, begins 96 ms later at 10 points, the edge recognizer fails on the first frame.
		rows: [
			[10_000, 0, 0, 1, 0, 0],
			[10_000, 1, 0, 1, 0, 0],
			[10_016, 1, 5, 1, 0, 0],
			[10_050, 0, 0, 1, 6, 0],
			[10_096, 0, 1, 1, 10, 0.5],
			[10_112, 0, 2, 1, 14, 0.5],
			[10_300, 0, 3, 0, 220, 1],
			[12_000, 0, 0, 1, 0, 0],
		],
		context: [
			[9_000, JSON.stringify({ navigation: [{ depth: 2, transitioning: false }] })],
			[10_300, JSON.stringify({ navigation: [{ depth: 2, transitioning: false }], sheet: { detent: "medium", y: 400, visualY: 400 } })],
			[10_400, JSON.stringify({ navigation: [{ depth: 2, transitioning: false }], sheet: { detent: "large", y: 200, visualY: 250 } })],
		],
	};
	const action = { scenario: "gestures-pushed-edge", round: 1, step: 0, kind: "drag", beganMs: 9_900, endedMs: 10_400 };

	test("when the touch came down, and when each recognizer began, ended or failed, relative to it", () => {
		const [story] = storiesFrom(trace, [action]);
		expect(story?.touchDownMs).toBe(10_000);
		const pan = story?.recognizers.find((entry) => entry.handlerTag === 7);
		expect([pan?.downAfterMs, pan?.beganAfterMs, pan?.endedAfterMs, pan?.endedAs, pan?.updates, pan?.translationAtBegan, pan?.translationBeforeBegan]).toEqual([0, 96, 300, "ended", 1, [10, 0.5], [6, 0]]);
		const pop = story?.recognizers.find((entry) => entry.class.startsWith("_UIParallax"));
		expect([pop?.beganAfterMs, pop?.endedAs, pop?.endedAfterMs]).toEqual([null, "failed", 16]);
		// Ordered by when they began: the pan first, the one that never began after it.
		expect(story?.recognizers.map((entry) => entry.id)).toEqual([0, 1]);
	});

	test("the context at the start and the end, and how far the sheet travelled", () => {
		const [story] = storiesFrom(trace, [action]);
		expect([story?.contextAtStart?.depth, story?.contextAtStart?.detent]).toEqual([[2], null]);
		expect([story?.contextAtEnd?.detent, story?.contextAtEnd?.y]).toEqual(["large", 200]);
		// No sheet when the action began: nothing to measure a travel against.
		expect(story?.sheetTravel).toBeNull();
		const [moved] = storiesFrom(trace, [{ ...action, beganMs: 10_320 }]);
		expect(moved?.contextAtStart?.detent).toBe("medium");
		expect(moved?.sheetTravel).toBe(150);
	});

	test("the window's touch probe says where the first touch landed and what it hit, and dates the touch down", () => {
		const withTouches: TraceFile = {
			...trace,
			touches: [
				[9_000, "began", 40, 200, "UIView#gesture.other"],
				[10_005, "began", 88, 203, "RCTViewComponentView#gesture.box < RCTViewComponentView < UIView"],
				[10_030, "moved", 90, 203, "-"],
				[10_300, "ended", 248, 299, "-"],
			],
		};
		const [story] = storiesFrom(withTouches, [{ ...action, beganMs: 9_995 }]);
		expect(story?.touchDownMs).toBe(10_005);
		expect(story?.firstTouch).toEqual({ x: 88, y: 203, hit: "RCTViewComponentView#gesture.box < RCTViewComponentView < UIView" });
		expect(story?.touchEvents).toEqual({ began: 1, moved: 1, ended: 1 });
		expect(describeStories([story as NonNullable<typeof story>]).join("\n")).toContain("first touch at (88, 203) hit RCTViewComponentView#gesture.box");
	});

	test("how a recognizer ended by its own target, and what UIKit's transition did after the finger let go", () => {
		const withPop: TraceFile = {
			...trace,
			touches: [[10_000, "began", 2, 231, "-"], [10_300, "ended", 250, 231, "-"]],
			events: [[10_096, 1, 1, 80, 0], [10_300, 1, 3, 210.5, 0], [10_096, 0, 1, 0, 0], [10_310, 0, 4, 0, 0]],
			context: [
				[9_000, JSON.stringify({ navigation: [{ depth: 2, transitioning: false }] })],
				[10_250, JSON.stringify({ navigation: [{ depth: 1, transitioning: true, interactive: true, cancelled: false, percent: 0.66, velocity: 0 }] })],
				[10_320, JSON.stringify({ navigation: [{ depth: 1, transitioning: true, interactive: false, cancelled: true, percent: 0.62, velocity: -0.4 }] })],
				[10_900, JSON.stringify({ navigation: [{ depth: 2, transitioning: false }] })],
			],
		};
		const [story] = storiesFrom(withPop, [{ ...action, beganMs: 9_995 }]);
		const pan = story?.recognizers.find((entry) => entry.handlerTag === 7);
		const pop = story?.recognizers.find((entry) => entry.class.startsWith("_UIParallax"));
		expect(pop?.terminal).toEqual({ as: "ended", velocity: [210.5, 0] });
		expect(pan?.terminal).toEqual({ as: "cancelled", velocity: [0, 0] });
		expect(story?.pop).toEqual({ percentAtRelease: 0.66, cancelled: true, completionVelocity: -0.4 });
		expect(describeStories([story as NonNullable<typeof story>]).join("\n")).toContain("66 % when the finger let go, CANCELLED by UIKit");
	});

	test("the recogniser's own target tells ended from cancelled", () => {
		const withEvents: TraceFile = { ...trace, touches: [[10_000, "began", 88, 203, "-"]], events: [[10_300, 0, 4, 0, 0], [10_300, 1, 3, 210.5, 1]] };
		const [story] = storiesFrom(withEvents, [action]);
		expect(story?.recognizers.find((entry) => entry.id === 0)?.terminal).toEqual({ as: "cancelled", velocity: [0, 0] });
		expect(story?.recognizers.find((entry) => entry.id === 1)?.terminal).toEqual({ as: "ended", velocity: [210.5, 1] });
	});

	test("a row outside every action's window belongs to none", () => {
		const [story] = storiesFrom(trace, [{ ...action, beganMs: 13_000, endedMs: 13_100 }]);
		expect(story?.touchDownMs).toBeNull();
		expect(story?.recognizers).toEqual([]);
	});

	test("the lines name the recognizers and the times", () => {
		const text = describeStories(storiesFrom(trace, [action])).join("\n");
		expect(text).toContain("gestures-pushed-edge round 1 step 1 (drag), touch down 10000; stack depth 2");
		expect(text).toContain("RNBetterPanGestureRecognizer #7 (RNPanGestureHandler): touch +0 ms, began +96 ms at (10, 0.5) (the frame before: (6, 0)), ended +300 ms, 1 updates");
		expect(text).toContain("_UIParallaxTransitionPanGestureRecognizer (SvelteStackView): touch +0 ms, never began, failed +16 ms");
	});
});

describe("the phone on USB", () => {
	test("idevice_id -l names the phones on USB, one per line", () => {
		expect(onUsb("00008110-001E10593410401E\n", "00008110-001E10593410401E")).toBe(true);
		expect(onUsb("00008110-AAAAAAAAAAAAAAAA\n00008110-001E10593410401E\n", "00008110-001E10593410401E")).toBe(true);
		expect(onUsb("", "00008110-001E10593410401E")).toBe(false);
		expect(onUsb("00008110-001E10593410401E-extra\n", "00008110-001E10593410401E")).toBe(false);
	});
});

describe("what a finished UI test leaves on the Mac", () => {
	const listing = [
		"  PID  PPID     ELAPSED COMMAND",
		"    1     0 8-12:14:21 /sbin/launchd",
		" 4711  4700       00:41 xcodebuild test-without-building -xctestrun DerivedData/Build/Products/GesturesUITests.xctestrun -destination id=00008110-001E10593410401E",
		" 4733  4711       00:40 /Applications/Xcode.app/Contents/Developer/usr/libexec/testmanagerd --root",
		" 4800  4712       00:01 ps -axo pid,ppid,etime,command",
		" 5000     1  3-01:00:00 /usr/libexec/CoreDeviceService",
	].join("\n");

	test("names the processes of UI testing and nothing else, and not its own listing", () => {
		expect(uiTestLeftovers(listing)).toEqual([
			"4711  4700       00:41 xcodebuild test-without-building -xctestrun DerivedData/Build/Products/GesturesUITests.xctestrun -destination id=00008110-001E10593410401E",
			"4733  4711       00:40 /Applications/Xcode.app/Contents/Developer/usr/libexec/testmanagerd --root",
		]);
		// CoreDevice's daemon runs all the time: it is shown on its own, not counted as something the test left.
		expect(coreDeviceDaemons(listing)).toEqual(["5000     1  3-01:00:00 /usr/libexec/CoreDeviceService"]);
		expect(uiTestLeftovers("  PID  PPID     ELAPSED COMMAND\n    1     0 8-12:14:21 /sbin/launchd\n")).toEqual([]);
	});

	test("a long command line is cut", () => {
		expect(uiTestLeftovers(`1 1 00:01 xcodebuild ${"x".repeat(500)}`)[0]).toHaveLength(220);
	});

	test("waits for the processes it was told to end before it looks, and shows the daemon apart from the leftovers", async () => {
		const asked: number[] = [];
		const began = Date.now();
		const mac = macFrom("me@mac", async () => {
			asked.push(Date.now() - began);
			return { code: 0, stdout: `${listing}\n__native_qa_status=0\n`, stderr: "" };
		});
		const lines = await describeUiTestLeftovers(mac, 300);
		expect(asked).toHaveLength(1);
		expect(asked[0]).toBeGreaterThanOrEqual(290);
		expect(lines[0]).toBe("after the test: 2 process(es) of UI testing on the Mac:");
		expect(lines.filter((line) => line.includes("CoreDeviceService"))).toEqual(["  CoreDeviceService (a daemon, not a leftover): 5000 1 3-01:00:00"]);
		const quiet = await describeUiTestLeftovers(macFrom("me@mac", async () => ({ code: 0, stdout: "  PID  PPID ELAPSED COMMAND\n    1     0 1-00:00:00 /sbin/launchd\n\n__native_qa_status=0\n", stderr: "" })), 0);
		expect(quiet).toEqual(["after the test: no xcodebuild, xctest or testmanagerd process is left on the Mac", "  CoreDeviceService is not running"]);
		const failed = await describeUiTestLeftovers(macFrom("me@mac", async () => ({ code: 0, stdout: "\n__native_qa_status=1\n", stderr: "" })), 0);
		expect(failed).toEqual(["after the test: the process list of the Mac could not be read (exit 1)"]);
	});
});
