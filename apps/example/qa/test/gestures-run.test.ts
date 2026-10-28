import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AdbDriver, adbInputCommands, aimProblems, inputDurationMs, qaPlan } from "../lib/inject-android.ts";
import {
	agreement,
	describeLaunch,
	failedChecks,
	gesturesMetrics,
	launchFromLogcat,
	leaked,
	namesFor,
	resultFrom,
	runValue,
	scenarioNamesFrom,
	type LaunchCapture,
} from "../lib/gestures.ts";
import { evaluate, type GatesFile } from "../lib/gates.ts";
import { gatesPath } from "../lib/paths.ts";
import { parseStressScenarios } from "../parse/logcat.ts";
import { findScenario, scenarioNames, type Input, type Ready, type Rects } from "../../src/lib/native/dev/gestures-lab.ts";
import type { DeviceInfo, GestureInput, GestureLaunch, GestureResult, GesturesFile } from "../lib/types.ts";

const rects: Rects = { box: { x: 100, y: 400, w: 240, h: 240 } };
const screen = { x: 0, y: 0, w: 1080, h: 2400 };
const drag: Input = { kind: "drag", from: { target: "box", fx: 0.5, fy: 0.5 }, by: [160, 96], durationMs: 400 };

function ready(input: Input | null, over: Partial<Ready> = {}): Ready {
	return { scenario: "gestures-box", mode: "box", round: 0, rounds: 1, step: 0, steps: 1, drive: "adb", density: 2.625, screen, rects, input, stepName: "drag the box", ...over };
}

describe("adb input", () => {
	test("a tap, a drag, a hold and a drift are one command each, in whole pixels", () => {
		expect(adbInputCommands({ kind: "tap", at: { target: "box", fx: 0.5, fy: 0.5 } }, rects, 2.625)).toEqual(["input tap 220 520"]);
		expect(adbInputCommands(drag, rects, 2.625)).toEqual(["input swipe 220 520 640 772 400"]);
		expect(adbInputCommands({ kind: "hold", at: { target: "box", fx: 0.5, fy: 0.5 }, durationMs: 700 }, rects, 2.625)).toEqual(["input swipe 220 520 220 520 700"]);
		expect(adbInputCommands({ kind: "hold", at: { target: "box", fx: 0.5, fy: 0.5 }, durationMs: 700, drift: [0, 16] }, rects, 2.625)).toEqual(["input swipe 220 520 220 562 700"]);
	});

	test("an edge swipe starts at x = 8 dp of the box", () => {
		const edge: Input = { kind: "drag", from: { target: "box", fx: 0, fy: 0.5, dx: 8 }, by: [220, 0], durationMs: 300 };
		expect(adbInputCommands(edge, { box: { x: 0, y: 300, w: 1080, h: 525 } }, 2.625)).toEqual(["input swipe 21 563 599 563 300"]);
	});

	test("two fingers are not for adb", () => {
		const pinch: Input = { kind: "twoFinger", at: { target: "box", fx: 0.5, fy: 0.5 }, distance: [80, 240], angle: [0, 40], durationMs: 600 };
		expect(() => adbInputCommands(pinch, rects, 2)).toThrow(/one pointer/);
	});

	test("the shell call is given the input's time", () => {
		expect(inputDurationMs(drag)).toBe(400);
		expect(inputDurationMs({ kind: "tap", at: { target: "box", fx: 0, fy: 0 } })).toBe(100);
	});

	test("what the in-app injector is handed is the plan in pixels", () => {
		const plan = JSON.parse(qaPlan(drag, rects, 2.625)) as { durationMs: number; pointers: { waypoints: number[][] }[] };
		expect(plan.durationMs).toBe(400);
		expect(plan.pointers[0]?.waypoints).toEqual([[0, 220, 520], [400, 220 + 160 * 2.625, 520 + 96 * 2.625]]);
	});

	test("an overlay away from the origin, or an input off the screen, cannot be aimed at", () => {
		expect(aimProblems(ready(drag))).toEqual([]);
		expect(aimProblems(ready(drag, { screen: { ...screen, y: 63 } }))[0]).toMatch(/overlay is at \(0, 63\)/);
		const off: Input = { kind: "drag", from: { target: "box", fx: 0.5, fy: 0.5 }, by: [400, 0], durationMs: 300 };
		expect(aimProblems(ready(off))[0]).toMatch(/leaves the screen/);
	});
});

const line = (message: string, time = "10-28 13:00:01.000") => `${time}  4242  4300 I ReactNativeJS: ${message}`;
const readyLine = (r: Ready) => line(`'[Svelte gesture] ready', '${JSON.stringify(r)}'`);

describe("the adb driver", () => {
	function driver() {
		const commands: string[] = [];
		const said: string[] = [];
		const instance = new AdbDriver("emulator-5554", (message) => said.push(message), async (command) => { commands.push(command); });
		return { instance, commands, said };
	}

	test("performs the input of a ready line once, however often it is logged", async () => {
		const { instance, commands } = driver();
		instance.onLine(readyLine(ready(drag)));
		instance.onLine(readyLine(ready(drag)));
		instance.onLine(readyLine(ready(drag, { step: 1, steps: 2 })));
		await instance.idle();
		expect(commands).toEqual(["input swipe 220 520 640 772 400", "input swipe 220 520 640 772 400"]);
		expect(instance.log.map((entry) => entry.step)).toEqual([0, 1]);
	});

	test("leaves a page that another driver drives, a step without input, and other lines alone", async () => {
		const { instance, commands } = driver();
		instance.onLine(readyLine(ready(drag, { drive: "qa" })));
		instance.onLine(readyLine(ready(null, { scenario: "gestures-churn", mode: "churn", steps: 0 })));
		instance.onLine(line("'[Svelte stress]', '{\"name\":\"idle\",\"verdict\":\"pass\"}'"));
		instance.onLine("not a logcat line");
		await instance.idle();
		expect(commands).toEqual([]);
	});

	test("records a line it cannot read and an injection that fails, and goes on", async () => {
		const failing: string[] = [];
		const instance = new AdbDriver("emulator-5554", () => undefined, async (command) => { failing.push(command); throw new Error("adb: device offline"); });
		instance.onLine(line(`'[Svelte gesture] ready', '${JSON.stringify(ready(drag)).slice(0, 80)}}'`));
		instance.onLine(readyLine(ready(drag)));
		await instance.idle();
		expect(instance.parseErrors).toHaveLength(1);
		expect(instance.log[0]?.error).toMatch(/device offline/);
		expect(failing).toHaveLength(1);
	});

	test("notes a step it cannot aim at but still performs it", async () => {
		const { instance, commands } = driver();
		instance.onLine(readyLine(ready(drag, { screen: { ...screen, x: 40 } })));
		await instance.idle();
		expect(commands).toHaveLength(1);
		expect(instance.log[0]?.problems[0]).toMatch(/overlay/);
	});
});

describe("choosing scenarios", () => {
	test("none asked is all of them, short names and full names are the same", () => {
		expect(scenarioNamesFrom(undefined)).toEqual(scenarioNames);
		expect(scenarioNamesFrom("box,gestures-row,box")).toEqual(["gestures-box", "gestures-row"]);
		expect(() => scenarioNamesFrom("box,spin")).toThrow(/unknown gestures scenario gestures-spin/);
	});

	test("adb takes the single pointer scenarios, the injector and the XCUITest all of them", () => {
		const all = scenarioNamesFrom(undefined);
		expect(namesFor(all, "adb")).not.toContain("gestures-pinch-rotate");
		expect(namesFor(all, "adb")).toContain("gestures-box");
		expect(namesFor(all, "qa")).toEqual(all);
		expect(namesFor(all, "xctest")).toEqual(all);
	});

	test("the lab's run value lists them and says who drives", () => {
		expect(runValue(["gestures-box", "gestures-row"], "adb")).toBe("gestures-box,gestures-row,drive:adb");
	});
});

const frames = (smooth: boolean, over: Partial<NonNullable<GestureResult["frames"]>> = {}) => ({
	periodMs: 16.67, durationMs: 4000, count: 240, p50: 17, p95: 17, p99: 18, max: smooth ? 18 : 90, droppedPct: smooth ? 0 : 4.2, smooth, ...over,
});

function result(name: string, over: Partial<GestureResult> = {}): GestureResult {
	const spec = findScenario(name) as NonNullable<ReturnType<typeof findScenario>>;
	return {
		name,
		verdict: spec.info ? "info" : "pass",
		summary: "ok",
		frames: spec.judgesFrames ? frames(true) : null,
		observedFrames: null,
		checks: [{ name: "one", ok: true, value: null }, { name: "two", ok: true, value: "1" }],
		counters: [{ pan: [1, 1, 24, 1, 1, 1, 1] }],
		marks: [name === "gestures-churn" ? { mounted: 200, unmounted: 200, records: 0, handlers: 0, eventHandlers: 0, alive: 40, aliveBaseline: 40 } : {}],
		timedOut: false,
		error: null,
		injections: [],
		...over,
	};
}

function launch(input: GestureInput, over: Partial<GestureLaunch> = {}, change: (name: string) => Partial<GestureResult> = () => ({})): GestureLaunch {
	const asked = namesFor(scenarioNames, input);
	return {
		input, asked, startedAt: "2026-10-28T10:00:00.000Z", durationMs: 200_000, complete: true,
		scenarios: asked.map((name) => result(name, change(name))), crashes: [], jsErrors: [], engineWarnings: [], harnessErrors: [], logFile: "runs/x.log", ...over,
	};
}

const device: DeviceInfo = { serial: "emulator-5554", platform: "android", kind: "emulator", model: "sdk", osVersion: "16", sdk: 36, abi: "x86_64", refreshHz: 60 };
function file(launches: GestureLaunch[]): GesturesFile {
	return {
		schema: 1, kind: "gestures", startedAt: "2026-10-28T10:00:00.000Z", finishedAt: "2026-10-28T10:10:00.000Z", source: { commit: "abc", dirty: false }, device,
		app: { package: "io.rasheed.svelteqa", versionName: "1", versionCode: 1, lastUpdateTime: null, installedSha256: "ff", apk: null },
		run: scenarioNames, inputs: [...new Set(launches.map((entry) => entry.input))], launches,
	};
}

describe("results from the lab's lines", () => {
	const detail = { mode: "box", busy: false, drive: "adb", timedOut: null, checks: [["one", 1], ["two", 0, "7"]], counters: [{ pan: [1, 1, 24, 1, 1, 1, 1] }], marks: [{ peakX: 158 }], observed: { frames: { periodMs: 16.67, p50: 17, p95: 17, max: 18, droppedPct: 0 } } };
	const text = [
		line(`'[Svelte stress]', '${JSON.stringify({ name: "gestures-box", verdict: "fail", summary: "1/2 checks", frames: { periodMs: 16.67, durationMs: 4000, count: 240, p50: 17, p95: 17, p99: 18, max: 18, droppedPct: 0, smooth: true }, detail, periodMs: 16.67 })}'`),
		line(`'[Svelte stress]', '${JSON.stringify({ name: "gestures-row", verdict: "fail", summary: "Error · the page of gestures-row round 0 did not open within 8000 ms" })}'`),
		line(`'[Svelte stress]', '${JSON.stringify({ name: "gestures-sheet", verdict: "fail", summary: "3/4 checks · TIMED OUT: 26 s", detail: { checks: [["a", 0]], timedOut: "26 s" } })}'`),
	].join("\n");

	test("checks, counters, marks, frames and the way it was driven come from the detail", () => {
		const [box] = parseStressScenarios(text).map((scenario) => resultFrom(scenario));
		expect(box?.checks).toEqual([{ name: "one", ok: true, value: null }, { name: "two", ok: false, value: "7" }]);
		expect(box?.counters).toEqual([{ pan: [1, 1, 24, 1, 1, 1, 1] }]);
		expect(box?.marks).toEqual([{ peakX: 158 }]);
		expect(box?.frames?.smooth).toBe(true);
		expect(box?.observedFrames?.max).toBe(18);
		expect(box && failedChecks(box)).toBe(1);
	});

	test("a scenario that threw, and one that ran out of time, are failures", () => {
		const [, row, sheet] = parseStressScenarios(text).map((scenario) => resultFrom(scenario));
		expect(row?.error).toMatch(/did not open/);
		expect(row && failedChecks(row)).toBe(1);
		expect(sheet?.timedOut).toBe(true);
		expect(sheet && failedChecks(sheet)).toBe(2);
	});

	test("a launch is complete when the lab reached its end with every asked scenario", () => {
		const done = line(`'[Svelte stress] complete', '${JSON.stringify({ periodMs: 16.67, results: [{ name: "gestures-box", verdict: "fail" }, { name: "gestures-row", verdict: "fail" }] })}'`);
		const capture = (extra: Partial<LaunchCapture>): LaunchCapture => ({
			input: "adb", asked: ["gestures-box", "gestures-row"], text: `${text}\n${done}`, matched: true, startedAt: new Date("2026-10-28T10:00:00Z"), durationMs: 5000, logFile: "runs/x.log",
			packageName: "io.rasheed.svelteqa", injections: {}, harnessErrors: [], ...extra,
		});
		expect(launchFromLogcat(capture({})).complete).toBe(true);
		expect(launchFromLogcat(capture({ matched: false })).complete).toBe(false);
		expect(launchFromLogcat(capture({ asked: ["gestures-box", "gestures-row", "gestures-carousel"] })).complete).toBe(false);
		const lines = describeLaunch(launchFromLogcat(capture({ asked: ["gestures-box", "gestures-carousel"] })));
		expect(lines.some((entry) => /gestures-carousel\s+no result/.test(entry))).toBe(true);
	});

	test("an app that crashed during the launch is on the launch", () => {
		const crash = `${line("FATAL EXCEPTION: main").replace("ReactNativeJS", "AndroidRuntime")}\n${line("Process: io.rasheed.svelteqa, PID: 4242").replace("ReactNativeJS", "AndroidRuntime")}`;
		const out = launchFromLogcat({ input: "qa", asked: [], text: `${text}\n${crash}`, matched: false, startedAt: new Date(), durationMs: 1, logFile: "x", packageName: "io.rasheed.svelteqa", injections: {}, harnessErrors: [] });
		expect(out.crashes).toHaveLength(1);
	});
});

describe("two ways of driving one scenario", () => {
	test("agree when the checks and the counters do, whatever the number of updates", () => {
		const a = launch("adb", {}, () => ({ counters: [{ pan: [1, 1, 80, 1, 1, 1, 1] }] }));
		const b = launch("qa", {}, () => ({ counters: [{ pan: [1, 1, 24, 1, 1, 1, 1] }] }));
		expect(agreement([a, b])).toEqual([]);
	});

	test("disagree on a check, on a count and on a handler only one reported", () => {
		const a = launch("adb");
		const b = launch("qa", {}, (name) => (name === "gestures-box" ? { checks: [{ name: "one", ok: false, value: null }, { name: "two", ok: true, value: "1" }], counters: [{ pan: [1, 1, 24, 1, 0, 2, 1], extra: [1, 0, 0, 0, 0, 1, 0] }] } : {}));
		const mismatches = agreement([a, b]);
		expect(mismatches).toContain('gestures-box: "one" held by adb and failed by qa');
		expect(mismatches.some((entry) => /pan counted 1 by adb and 0 by qa/.test(entry))).toBe(true);
		expect(mismatches.some((entry) => /extra reported by qa only/.test(entry))).toBe(true);
	});

	test("an incomplete launch, a scenario the lab only records and a single way of driving have nothing to compare", () => {
		expect(agreement([launch("adb"), launch("qa", { complete: false })])).toEqual([]);
		expect(agreement([launch("adb")])).toEqual([]);
		const a = launch("adb", {}, (name) => (name === "gestures-box-js-busy" ? { checks: [{ name: "one", ok: false, value: null }] } : {}));
		expect(agreement([a, launch("qa")])).toEqual([]);
	});
});

describe("metrics", () => {
	const both = () => file([launch("adb"), launch("qa")]);

	test("a clean run: every scenario has no failed check, the frames of the judged ones are recorded, the churn leaks nothing", () => {
		const metrics = gesturesMetrics(both(), scenarioNames);
		expect(metrics["gestures.launches"]).toBe(2);
		expect(metrics["gestures.incompleteLaunches"]).toBe(0);
		expect(metrics["gestures.scenarios.missing"]).toBe(0);
		expect(metrics["gestures.box.failedChecks"]).toBe(0);
		expect(metrics["gestures.pinch-rotate.failedChecks"]).toBe(0);
		expect(metrics["gestures.box.droppedPct"]).toBe(0);
		expect(metrics["gestures.box-busy.maxMs"]).toBe(18);
		expect(metrics["gestures.row.droppedPct"]).toBeUndefined();
		expect(metrics["gestures.box-js-busy.failedChecks"]).toBeUndefined();
		expect(metrics["gestures.box-js-busy.observedFailedChecks"]).toBe(0);
		expect(metrics["gestures.churn.leaked"]).toBe(0);
		expect(metrics["gestures.agreement.mismatches"]).toBe(0);
		expect(metrics["gestures.fatals"]).toBe(0);
	});

	test("the worst launch counts: a failed check, longer frames, a leak", () => {
		const metrics = gesturesMetrics(
			file([launch("adb"), launch("qa", {}, (name) => (name === "gestures-box" ? { checks: [{ name: "one", ok: false, value: null }], frames: frames(false) } : name === "gestures-churn" ? { marks: [{ records: 1, handlers: 3, eventHandlers: 0, alive: 45, aliveBaseline: 40 }] } : {}))]),
			scenarioNames,
		);
		expect(metrics["gestures.box.failedChecks"]).toBe(1);
		expect(metrics["gestures.box.droppedPct"]).toBe(4.2);
		expect(metrics["gestures.box.maxPeriodRatio"]).toBeCloseTo(90 / 16.67, 3);
		expect(metrics["gestures.churn.leaked"]).toBe(9);
		expect(metrics["gestures.agreement.mismatches"] as number > 0).toBe(true);
	});

	test("a scenario that never ran, one that timed out and one that threw are not passes", () => {
		const metrics = gesturesMetrics(file([launch("qa", { scenarios: launch("qa").scenarios.filter((entry) => entry.name !== "gestures-row" && entry.name !== "gestures-sheet").map((entry) => (entry.name === "gestures-box" ? { ...entry, timedOut: true } : entry.name === "gestures-carousel" ? { ...entry, error: "Error · boom", checks: [] } : entry)) })]), scenarioNames);
		expect(metrics["gestures.row.failedChecks"]).toBeNull();
		expect(metrics["gestures.sheet.failedChecks"]).toBeNull();
		expect(metrics["gestures.scenarios.missing"]).toBe(2);
		expect(metrics["gestures.box.failedChecks"]).toBe(1);
		expect(metrics["gestures.carousel.failedChecks"]).toBe(1);
		expect(metrics["gestures.agreement.mismatches"]).toBeUndefined();
	});

	test("a pinned scenario no launch asked for is missing", () => {
		const metrics = gesturesMetrics(file([launch("qa", { asked: ["gestures-box"], scenarios: [result("gestures-box")] })]), scenarioNames);
		expect(metrics["gestures.scenarios.missing"]).toBe(scenarioNames.length - 1);
		expect(metrics["gestures.row.failedChecks"]).toBeNull();
	});

	test("fatals, engine warnings and harness errors are summed over the launches", () => {
		const metrics = gesturesMetrics(file([launch("adb", { crashes: ["x"], jsErrors: ["y", "z"], engineWarnings: ["w"], harnessErrors: ["h"] }), launch("qa")]), scenarioNames);
		expect(metrics["gestures.fatals"]).toBe(3);
		expect(metrics["gestures.engineWarnings"]).toBe(1);
		expect(metrics["gestures.harnessErrors"]).toBe(1);
	});

	test("what the churn left is the sum of what it counts, an unknown count as one, and the views above the baseline", () => {
		expect(leaked(result("gestures-churn"))).toBe(0);
		expect(leaked(result("gestures-churn", { marks: [{ records: 2, handlers: 4, eventHandlers: 1, alive: 52, aliveBaseline: 40 }] }))).toBe(19);
		expect(leaked(result("gestures-churn", { marks: [{ records: -1, handlers: 0, eventHandlers: 0 }] }))).toBe(1);
		expect(leaked(result("gestures-churn", { marks: [{ mounted: 200 }] }))).toBeNull();
		expect(leaked(result("gestures-churn", { marks: null }))).toBeNull();
	});
});

describe("the gestures gates", () => {
	const gates = JSON.parse(readFileSync(gatesPath, "utf8")) as GatesFile;
	const ids = gates.gates.filter((gate) => gate.metric.startsWith("gestures.")).map((gate) => gate.id);
	const verdicts = (metrics: Record<string, number | string | null>, serial: string, role: "phone" | "lab", platform: "android" | "ios" = "android") =>
		Object.fromEntries(
			evaluate(gates.gates.filter((gate) => ids.includes(gate.id)), { [serial]: { platform, role, runs: gates.devices[serial]?.runs ?? null, metrics } }, platform).map((row) => [`${row.id}${row.metric === row.id ? "" : `:${row.metric}`}`, row.verdict]),
		);

	test("the list of scenarios the full run holds is the lab's", () => {
		expect(gates.gestures?.android).toEqual(scenarioNames);
		expect(gates.gestures?.ios).toEqual(scenarioNames);
	});

	test("a clean run passes every gate on the phone and on the emulator", () => {
		const metrics = gesturesMetrics(file([launch("adb"), launch("qa")]), gates.gestures?.android ?? []);
		for (const [serial, role] of [["R58Y90KNGRP", "phone"], ["localhost:5555", "lab"]] as const) {
			const judged = verdicts(metrics, serial, role);
			expect(Object.values(judged).filter((verdict) => verdict !== "pass")).toEqual(role === "phone" ? [] : Object.values(judged).filter((verdict) => verdict === "informational"));
			expect(Object.keys(judged).some((key) => key.startsWith("gestures.checks:"))).toBe(true);
		}
	});

	test("frames that are not smooth fail the phone and are only shown for the emulator; a failed check fails both", () => {
		const metrics = gesturesMetrics(file([launch("adb"), launch("qa", {}, (name) => (name === "gestures-pinch-rotate" ? { frames: frames(false), checks: [{ name: "one", ok: false, value: null }] } : {}))]), scenarioNames);
		const phone = verdicts(metrics, "R58Y90KNGRP", "phone");
		expect(phone["gestures.frames.droppedPct:gestures.pinch-rotate.droppedPct"]).toBe("fail");
		expect(phone["gestures.frames.maxMs:gestures.pinch-rotate.maxMs"]).toBe("fail");
		expect(phone["gestures.checks:gestures.pinch-rotate.failedChecks"]).toBe("fail");
		const emulator = verdicts(metrics, "localhost:5555", "lab");
		expect(emulator["gestures.frames.droppedPct:gestures.pinch-rotate.droppedPct"]).toBe("informational");
		expect(emulator["gestures.checks:gestures.pinch-rotate.failedChecks"]).toBe("fail");
	});

	test("what was not measured fails: no gestures run, no second way of driving, a scenario missing", () => {
		expect(Object.values(verdicts({}, "R58Y90KNGRP", "phone")).every((verdict) => verdict === "not measured")).toBe(true);
		const single = verdicts(gesturesMetrics(file([launch("qa")]), scenarioNames), "localhost:5555", "lab");
		expect(single["gestures.agreement:gestures.agreement.mismatches"]).toBe("not measured");
		expect(single["gestures.launches"]).toBe("fail");
		const missing = verdicts(gesturesMetrics(file([launch("adb"), launch("qa", { scenarios: launch("qa").scenarios.slice(1) })]), scenarioNames), "localhost:5555", "lab");
		expect(missing["gestures.scenarios.missing"]).toBe("fail");
	});

	test("the iPhone is judged on one way of driving and no agreement", () => {
		const metrics = gesturesMetrics({ ...file([launch("xctest")]), device: { ...device, platform: "ios", serial: "E74A5608-BF8E-5806-8699-1605F82ADED9" } }, gates.gestures?.ios ?? []);
		const judged = verdicts(metrics, "E74A5608-BF8E-5806-8699-1605F82ADED9", "phone", "ios");
		expect(Object.keys(judged).some((key) => key.startsWith("gestures.agreement"))).toBe(false);
		expect(Object.values(judged).every((verdict) => verdict === "pass")).toBe(true);
	});
});
