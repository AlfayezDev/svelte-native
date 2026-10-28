import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	CHURN_ROUNDS,
	SECOND_POINTER_MS,
	Session,
	counterOf,
	delta,
	detailOf,
	expectedTwoFinger,
	findScenario,
	outcomeOf,
	parseGestureLine,
	pxPath,
	resolveAnchor,
	sampleAt,
	scenarioFor,
	scenarioNames,
	scenarios,
	type EvalContext,
	type Hooks,
	type Input,
	type Ready,
	type Rects,
	type Snapshot,
} from "../../src/lib/native/dev/gestures-lab.ts";
import { platformDir } from "../lib/paths.ts";

const rects: Rects = {
	box: { x: 100, y: 400, w: 240, h: 240 },
	screen: { x: 0, y: 0, w: 1080, h: 2400 },
};

describe("anchors and paths", () => {
	test("an anchor is a fraction of its rectangle plus dp", () => {
		expect(resolveAnchor({ target: "box", fx: 0.5, fy: 0.25 }, rects, 3)).toEqual({ x: 220, y: 460 });
		expect(resolveAnchor({ target: "box", fx: 0, fy: 0.5, dx: 8, dy: -2 }, rects, 3)).toEqual({ x: 124, y: 514 });
	});

	test("a missing rectangle names what the page did report", () => {
		expect(() => resolveAnchor({ target: "nope", fx: 0, fy: 0 }, rects, 1)).toThrow(/no rectangle named "nope".*box, screen/);
	});

	test("a drag is one pointer from the anchor by dp times the density", () => {
		const path = pxPath({ kind: "drag", from: { target: "box", fx: 0.5, fy: 0.5 }, by: [160, 96], durationMs: 400 }, rects, 2.625);
		expect(path.durationMs).toBe(400);
		expect(path.pointers).toHaveLength(1);
		expect(path.pointers[0]?.waypoints).toEqual([[0, 220, 520], [400, 220 + 160 * 2.625, 520 + 96 * 2.625]]);
	});

	test("a hold stays down for its duration and may drift", () => {
		const still = pxPath({ kind: "hold", at: { target: "box", fx: 0.5, fy: 0.5 }, durationMs: 700 }, rects, 2);
		expect(still.pointers[0]?.waypoints).toEqual([[0, 220, 520], [700, 220, 520]]);
		const drifting = pxPath({ kind: "hold", at: { target: "box", fx: 0.5, fy: 0.5 }, durationMs: 700, drift: [0, 16] }, rects, 2);
		expect(drifting.pointers[0]?.waypoints[1]).toEqual([700, 220, 552]);
	});

	test("a tap is a short stay", () => {
		const path = pxPath({ kind: "tap", at: { target: "box", fx: 0.5, fy: 0.5 } }, rects, 2);
		expect(path.pointers[0]?.waypoints).toEqual([[0, 220, 520], [60, 220, 520]]);
	});

	test("two fingers keep their distance and angle on the arc, the second one late", () => {
		const input: Input = { kind: "twoFinger", at: { target: "box", fx: 0.5, fy: 0.5 }, distance: [80, 240], angle: [0, 40], durationMs: 600 };
		const path = pxPath(input, rects, 2);
		const [a, b] = path.pointers;
		expect(a?.waypoints[0]).toEqual([0, 140, 520]);
		expect(b?.waypoints[0]).toEqual([SECOND_POINTER_MS, 300, 520]);
		expect(a?.waypoints[1]).toEqual([SECOND_POINTER_MS, 140, 520]);
		expect(b?.waypoints.at(-1)?.[0]).toBe(600);
		expect(a?.waypoints.at(-1)?.[0]).toBe(600);
		// From the second pointer's start on, at every waypoint time, the pair is centred on the anchor, as far apart as asked and at the angle asked.
		for (let index = 0; index < (b?.waypoints.length ?? 0); index++) {
			const q = b?.waypoints[index] as [number, number, number];
			const p = a?.waypoints[index + 1] as [number, number, number];
			expect(p[0]).toBe(q[0]);
			const fraction = (q[0] - SECOND_POINTER_MS) / (600 - SECOND_POINTER_MS);
			expect(((p[1] + q[1]) / 2)).toBeCloseTo(220, 1);
			expect(((p[2] + q[2]) / 2)).toBeCloseTo(520, 1);
			expect(Math.hypot(q[1] - p[1], q[2] - p[2])).toBeCloseTo((80 + 160 * fraction) * 2, 0);
			expect((Math.atan2(q[2] - p[2], q[1] - p[1]) * 180) / Math.PI).toBeCloseTo(40 * fraction, 0);
		}
	});

	test("sampleAt interpolates and clamps", () => {
		const waypoints: [number, number, number][] = [[0, 0, 0], [100, 100, 50], [300, 100, 250]];
		expect(sampleAt(waypoints, -5)).toEqual({ x: 0, y: 0 });
		expect(sampleAt(waypoints, 50)).toEqual({ x: 50, y: 25 });
		expect(sampleAt(waypoints, 200)).toEqual({ x: 100, y: 150 });
		expect(sampleAt(waypoints, 900)).toEqual({ x: 100, y: 250 });
	});
});

describe("what a pinch and a rotation report", () => {
	const input: Input = { kind: "twoFinger", at: { target: "box", fx: 0.5, fy: 0.5 }, distance: [80, 240], angle: [0, 40], durationMs: 600 };
	const path = pxPath(input, rects, 2.625);
	const frames = (periodMs: number) => Array.from({ length: Math.floor(600 / periodMs) + 1 }, (_, index) => index * periodMs).concat([600]);

	test("the span slop is not counted: 3x injected reads below 3", () => {
		const slop = 8 * 2.625;
		const expected = expectedTwoFinger(path, frames(16.67), slop);
		expect(expected.scale).toBeGreaterThan(2.0);
		expect(expected.scale < 2.8).toBe(true);
		expect(expected.spanBegin > 80 * 2.625 + 2 * slop).toBe(true);
		expect(expected.rotationDeg).toBeCloseTo(40, 1);
	});

	test("without a slop the whole spread counts", () => {
		const expected = expectedTwoFinger(path, frames(16.67), 0);
		expect(expected.scale).toBeCloseTo(2.97, 1);
		expect(expected.rotationDeg).toBeCloseTo(40, 1);
	});

	test("a slop larger than the spread means no scaling began", () => {
		expect(expectedTwoFinger(path, frames(16.67), 10_000).scale).toBe(1);
	});
});

describe("the handshake lines", () => {
	const ready: Ready = {
		scenario: "gestures-box", mode: "box", round: 0, rounds: 1, step: 0, steps: 1, drive: "adb", density: 2.625,
		screen: { x: 0, y: 0, w: 1080, h: 2400 }, rects,
		input: { kind: "drag", from: { target: "box", fx: 0.5, fy: 0.5 }, by: [160, 96], durationMs: 400 }, stepName: "drag the box",
	};

	test("a ready line as logcat prints it parses back", () => {
		const line = `'[Svelte gesture] ready', '${JSON.stringify(ready)}'`;
		expect(parseGestureLine(line)).toEqual({ event: "ready", ready });
	});

	test("a ready line without quotes parses too", () => {
		expect(parseGestureLine(`[Svelte gesture] ready ${JSON.stringify(ready)}`)).toEqual({ event: "ready", ready });
	});

	test("a scenario that drives itself has no input", () => {
		const own = { ...ready, input: null };
		expect(parseGestureLine(`'[Svelte gesture] ready', '${JSON.stringify(own)}'`)).toEqual({ event: "ready", ready: own });
	});

	test("step and result lines carry their payload", () => {
		expect(parseGestureLine(`'[Svelte gesture] step', '{"scenario":"gestures-box","step":0,"marks":{"peakX":158}}'`)).toEqual({ event: "step", payload: { scenario: "gestures-box", step: 0, marks: { peakX: 158 } } });
		expect(parseGestureLine(`'[Svelte gesture] result', '{"round":0}'`)).toEqual({ event: "result", payload: { round: 0 } });
	});

	test("another line is not part of it", () => {
		expect(parseGestureLine("'[Svelte stress]', '{\"name\":\"idle\"}'")).toBeNull();
		expect(parseGestureLine("[Svelte gesture] unknown {}")).toBeNull();
	});

	test("a cut line is refused, not read as a partial one", () => {
		const cut = `'[Svelte gesture] ready', '${JSON.stringify(ready).slice(0, 120)}}'`;
		expect(() => parseGestureLine(cut)).toThrow(/malformed \[Svelte gesture\] ready line/);
	});

	test("a ready line with a wrong field says which", () => {
		const bad = { ...ready, density: "2.6" };
		expect(() => parseGestureLine(`'[Svelte gesture] ready', '${JSON.stringify(bad)}'`)).toThrow(/density is not a number/);
		const unknown = { ...ready, input: { kind: "swipe" } };
		expect(() => parseGestureLine(`'[Svelte gesture] ready', '${JSON.stringify(unknown)}'`)).toThrow(/unknown input kind "swipe"/);
		const nobody = { ...ready, drive: "robot" };
		expect(() => parseGestureLine(`'[Svelte gesture] ready', '${JSON.stringify(nobody)}'`)).toThrow(/unknown drive "robot"/);
	});
});

/** A clock the tests turn by hand, and the lines a page would log. */
function harness(drive: "none" | "adb" | "qa" = "adb") {
	const timers: { at: number; fn: () => void; live: boolean }[] = [];
	const state = { now: 0 };
	const logged: { event: string; payload: Record<string, unknown> }[] = [];
	const injected: Input[] = [];
	const hooks: Hooks = {
		measure: async () => ({ rects, screen: rects.screen as NonNullable<Rects["screen"]> }),
		inject: async (input) => { injected.push(input); },
		log: (event, payload) => { logged.push({ event, payload }); },
		schedule: (fn, ms) => {
			const timer = { at: state.now + ms, fn, live: true };
			timers.push(timer);
			return () => { timer.live = false; };
		},
	};
	async function advance(ms: number) {
		const until = state.now + ms;
		for (;;) {
			const next = timers.filter((timer) => timer.live && timer.at <= until).sort((a, b) => a.at - b.at)[0];
			if (!next) break;
			state.now = next.at;
			next.live = false;
			next.fn();
			for (let turn = 0; turn < 20; turn++) await Promise.resolve();
		}
		state.now = until;
		for (let turn = 0; turn < 20; turn++) await Promise.resolve();
	}
	const open = (name: string, round = 0) => new Session(findScenario(name) as NonNullable<ReturnType<typeof findScenario>>, round, drive, 2.625, hooks);
	return { hooks, logged, injected, advance, open };
}

const readyLines = (logged: { event: string; payload: Record<string, unknown> }[]) => logged.filter((line) => line.event === "ready").map((line) => line.payload);

describe("a session", () => {
	test("announces the first step, completes it when it is done and settled, then finishes", async () => {
		const { logged, advance, open } = harness("adb");
		const session = open("gestures-box");
		await session.start();
		expect(readyLines(logged)).toHaveLength(1);
		const first = readyLines(logged)[0] as Record<string, unknown>;
		expect(first.scenario).toBe("gestures-box");
		expect(first.step).toBe(0);
		expect(first.steps).toBe(1);
		expect((first.input as { kind: string }).kind).toBe("drag");
		session.count("pan", "begin");
		session.count("pan", "start");
		session.count("pan", "update", true, 24);
		session.count("pan", "end", true);
		await advance(5000);
		expect(logged.filter((line) => line.event === "step")).toHaveLength(0);
		session.count("pan", "finalize", true);
		await advance(1199);
		expect(logged.filter((line) => line.event === "step")).toHaveLength(0);
		await advance(2);
		expect(logged.filter((line) => line.event === "step")).toHaveLength(1);
		const snapshot = await session.finished;
		expect(counterOf(snapshot, "pan")).toEqual({ begin: 1, start: 1, update: 24, end: 1, endOk: 1, finalize: 1, finalizeOk: 1 });
		expect(logged.filter((line) => line.event === "result")).toHaveLength(1);
		expect(session.steps).toHaveLength(1);
	});

	test("a failed end and a failed finalize are not successes", async () => {
		const { advance, open } = harness();
		const session = open("gestures-box");
		await session.start();
		session.count("pan", "end", false);
		session.count("pan", "finalize", false);
		await advance(2000);
		const snapshot = await session.finished;
		expect(counterOf(snapshot, "pan")).toEqual({ begin: 0, start: 0, update: 0, end: 1, endOk: 0, finalize: 1, finalizeOk: 0 });
	});

	test("announces each step with the page's own measurement and keeps the marks of every step", async () => {
		const { logged, advance, open } = harness();
		const session = open("gestures-row");
		await session.start();
		expect(readyLines(logged).map((line) => line.step)).toEqual([0]);
		session.mark("scrollY", 0);
		session.mark("removed.3", 1);
		await advance(499);
		expect(readyLines(logged)).toHaveLength(1);
		await advance(2);
		expect(readyLines(logged).map((line) => line.step)).toEqual([0, 1]);
		session.mark("scrollY", 240);
		session.count("row-5", "begin");
		session.count("row-5", "finalize", false);
		await advance(1100);
		const snapshot = await session.finished;
		expect(session.steps.map((entry) => entry.marks.scrollY)).toEqual([0, 240]);
		expect(snapshot.marks.scrollY).toBe(240);
	});

	test("a step that never completes is given up on after its limit, and says so", async () => {
		const { logged, advance, open } = harness();
		const session = open("gestures-sheet");
		await session.start();
		await advance(7999);
		expect(logged.filter((line) => line.event === "step")).toHaveLength(0);
		await advance(2);
		expect(session.marks["timeout.0"]).toBe(1);
		expect(readyLines(logged).map((line) => line.step)).toEqual([0, 1]);
	});

	test("the app drives itself: the next input is injected after the step before it", async () => {
		const { injected, advance, open } = harness("qa");
		const session = open("gestures-carousel");
		await session.start();
		expect(injected).toHaveLength(1);
		expect((injected[0] as { kind: string }).kind).toBe("drag");
		session.count("pager", "finalize", true);
		await advance(700);
		expect(injected).toHaveLength(2);
		session.count("pager", "finalize", true);
		await advance(700);
		session.count("pager", "finalize", false);
		await advance(1000);
		expect(injected).toHaveLength(3);
		expect((await session.finished).counters.pager?.finalize).toBe(3);
	});

	test("an external driver is not injected for", async () => {
		const { injected, open } = harness("adb");
		await open("gestures-box").start();
		expect(injected).toHaveLength(0);
	});

	test("the page's settle hook runs before the step is recorded, and a start hook before the first step is announced", async () => {
		const { logged, advance, open } = harness();
		const session = open("gestures-box");
		const order: string[] = [];
		session.onStart(() => { order.push(`start, ${logged.length} lines`); });
		session.onSettle(() => { session.mark("restX", 0.2); order.push("settle"); });
		await session.start();
		session.count("pan", "finalize", true);
		await advance(1300);
		expect(order).toEqual(["start, 0 lines", "settle"]);
		expect(session.steps[0]?.marks.restX).toBe(0.2);
	});

	test("two handlers started and not ended are active together; a press is not one", async () => {
		const { open } = harness();
		const session = open("gestures-pinch-rotate");
		await session.start();
		session.press("exclusive.press");
		session.count("pinch", "start");
		expect(session.marks.maxActive).toBe(1);
		session.count("rotation", "start");
		expect(session.marks.maxActive).toBe(2);
		session.count("pinch", "end");
		session.count("rotation", "finalize");
		session.count("pinch", "start");
		expect(session.marks.maxActive).toBe(2);
		expect(counterOf(session.snapshot(), "exclusive.press").start).toBe(1);
	});

	test("a round that ran out of time resolves with what it has and says why", async () => {
		const { logged, open } = harness();
		const session = open("gestures-box");
		await session.start();
		session.count("pan", "begin");
		session.abort("20 s");
		const snapshot = await session.finished;
		expect(snapshot.counters.pan?.begin).toBe(1);
		expect(session.timedOut).toBe("20 s");
		expect(logged.filter((line) => line.event === "result")).toHaveLength(1);
	});

	test("a scenario without steps finishes when the page says so", async () => {
		const { open } = harness();
		const session = open("gestures-churn");
		await session.start();
		session.mark("mounted", CHURN_ROUNDS);
		session.finish();
		expect((await session.finished).marks.mounted).toBe(CHURN_ROUNDS);
	});
});

const snapshot = (counters: Record<string, number[]>, marks: Record<string, number> = {}): Snapshot => ({
	counters: Object.fromEntries(Object.entries(counters).map(([name, c]) => [name, { begin: c[0] ?? 0, start: c[1] ?? 0, update: c[2] ?? 0, end: c[3] ?? 0, endOk: c[4] ?? 0, finalize: c[5] ?? 0, finalizeOk: c[6] ?? 0 }])),
	marks,
});
const context: EvalContext = { platform: "android", drive: "adb", density: 2.625 };
const evaluate = (name: string, rounds: Snapshot[], steps: Snapshot[][] = [], ctx = context) => (findScenario(name) as NonNullable<ReturnType<typeof findScenario>>).evaluate(rounds, steps, ctx);
const failing = (checks: ReturnType<typeof evaluate>) => checks.filter((entry) => !entry.ok).map((entry) => entry.name);

describe("verdicts", () => {
	test("box: a clean drag passes every check", () => {
		const s = snapshot({ pan: [1, 1, 24, 1, 1, 1, 1] }, { peakX: 160, peakY: 96, restX: 0, restY: 0 });
		expect(failing(evaluate("gestures-box", [s]))).toEqual([]);
	});

	test("box: each way to fail is named", () => {
		const s = snapshot({ pan: [1, 1, 6, 1, 0, 2, 0] }, { peakX: 40, peakY: 20, restX: 12, restY: 0 });
		expect(failing(evaluate("gestures-box", [s]))).toEqual(["one end, success", "one finalize", "at least 10 updates", "peak reaches the drag", "rests at 0"]);
	});

	test("pinch-rotate: judged against what the injector delivered, and by the commanded values without it", () => {
		const s = snapshot({ pinch: [1, 1, 30, 1, 1, 1, 1], rotation: [1, 1, 30, 1, 1, 1, 1] }, { scale: 2.5, rotationDeg: 40.5, maxActive: 2, expectedScale: 2.52, expectedRotation: 40 });
		expect(failing(evaluate("gestures-pinch-rotate", [s]))).toEqual([]);
		const off = snapshot({ pinch: [1, 1, 30, 1, 1, 1, 1], rotation: [1, 1, 30, 1, 1, 1, 1] }, { scale: 2.5, rotationDeg: 40, maxActive: 2 });
		expect(failing(evaluate("gestures-pinch-rotate", [off])).length).toBe(1);
		const ios = snapshot({ pinch: [1, 1, 30, 1, 1, 1, 1], rotation: [1, 1, 30, 1, 1, 1, 1] }, { scale: 2.9, rotationDeg: 38 });
		expect(failing(evaluate("gestures-pinch-rotate", [ios], [], { ...context, platform: "ios" }))).toEqual([]);
	});

	test("row: the first row goes, the second pan fails, the list scrolls", () => {
		const first = snapshot({ "row-3": [1, 1, 20, 1, 1, 0, 0] }, { scrollY: 0, "removed.3": 1, removedTotal: 1 });
		const last = snapshot({ "row-3": [1, 1, 20, 1, 1, 0, 0], "row-5": [1, 0, 0, 0, 0, 1, 0] }, { scrollY: 190, "removed.3": 1, removedTotal: 1 });
		expect(failing(evaluate("gestures-row", [last], [[first, last]]))).toEqual([]);
		const stuck = snapshot({ "row-3": [1, 1, 20, 1, 1, 0, 0], "row-5": [1, 1, 9, 1, 1, 1, 1] }, { scrollY: 20, "removed.3": 1, removedTotal: 1 });
		expect(failing(evaluate("gestures-row", [stuck], [[first, stuck]]))).toEqual(["row 5 pan failed, never started", "list scrolled over 100"]);
	});

	test("carousel: each swipe is judged by what it moved", () => {
		const horizontal = snapshot({ pager: [1, 1, 20, 1, 1, 1, 1] }, { page: 1, scrollY: 0 });
		const diagonal = snapshot({ pager: [2, 2, 40, 2, 2, 2, 2] }, { page: 2, scrollY: 0 });
		const vertical = snapshot({ pager: [3, 2, 40, 2, 2, 3, 2] }, { page: 2, scrollY: 220 });
		expect(failing(evaluate("gestures-carousel", [vertical], [[horizontal, diagonal, vertical]]))).toEqual([]);
		const scrolled = snapshot({ pager: [2, 2, 40, 2, 2, 2, 2] }, { page: 2, scrollY: 30 });
		expect(failing(evaluate("gestures-carousel", [vertical], [[horizontal, scrolled, vertical]]))).toEqual(["diagonal swipe goes to the dominant axis"]);
	});

	test("pushed-edge: the first round pops without a pan, the second pans without a pop", () => {
		const edge = snapshot({ pan: [1, 0, 0, 0, 0, 1, 0] }, { popped: 1 });
		const inside = snapshot({ pan: [1, 1, 20, 1, 1, 1, 1] });
		expect(failing(evaluate("gestures-pushed-edge", [edge, inside]))).toEqual([]);
		expect(failing(evaluate("gestures-pushed-edge", [snapshot({ pan: [1, 1, 5, 1, 1, 1, 1] }), snapshot({}, { popped: 1 })]))).toEqual([
			"edge swipe popped the screen", "edge swipe: the pan never started", "swipe from 100 dp started the pan", "swipe from 100 dp did not pop",
		]);
	});

	test("sheet: the default pan loses on Android and is only recorded on iOS", () => {
		const grabber = snapshot({}, { detent: 1, detentChanges: 1, scrollY: 0 });
		const scroll = snapshot({}, { detent: 1, detentChanges: 1, scrollY: 200 });
		const down = snapshot({ boxDefault: [1, 0, 0, 0, 0, 1, 0] }, { detent: 0, detentChanges: 2, scrollY: 200 });
		const fast = snapshot({ boxDefault: [1, 0, 0, 0, 0, 1, 0], boxFast: [1, 1, 12, 1, 1, 1, 1] }, { detent: 0, detentChanges: 2, scrollY: 200 });
		expect(failing(evaluate("gestures-sheet", [fast], [[grabber, scroll, down, fast]]))).toEqual([]);
		const panWon = snapshot({ boxDefault: [1, 1, 12, 1, 1, 1, 1] }, { detent: 1, detentChanges: 1, scrollY: 200 });
		const steps = [[grabber, scroll, panWon, { ...fast, marks: { ...fast.marks, detent: 1, detentChanges: 1 } }]];
		expect(failing(evaluate("gestures-sheet", [fast], steps))).toEqual(["default pan loses to the sheet"]);
		expect(failing(evaluate("gestures-sheet", [fast], steps, { ...context, platform: "ios" }))).toEqual([]);
	});

	test("longpress-tap: a tap, a hold and a drift on each box, each judged by what it added", () => {
		const names = ["exclusive", "race"] as const;
		const snaps: Snapshot[] = [];
		const total: Record<string, number[]> = {};
		const add = (name: string, by: number[]) => { const c = total[name] ?? [0, 0, 0, 0, 0, 0, 0]; total[name] = c.map((value, index) => value + (by[index] ?? 0)); };
		for (const name of names) {
			// tap: the tap activates and ends, the long press begins and fails; the Pressable presses once
			add(`${name}.tap`, [1, 1, 0, 1, 1, 1, 1]); add(`${name}.long`, [1, 0, 0, 0, 0, 1, 0]); add(`${name}.press`, [0, 1, 0, 0, 0, 0, 0]);
			snaps.push(snapshot(JSON.parse(JSON.stringify(total)) as Record<string, number[]>));
			// hold: the long press activates and ends, the tap is cancelled, the press is cancelled
			add(`${name}.long`, [1, 1, 0, 1, 1, 1, 1]); add(`${name}.tap`, [1, 0, 0, 0, 0, 1, 0]);
			snaps.push(snapshot(JSON.parse(JSON.stringify(total)) as Record<string, number[]>));
			// drift: both fail
			add(`${name}.long`, [1, 0, 0, 0, 0, 1, 0]); add(`${name}.tap`, [1, 0, 0, 0, 0, 1, 0]);
			snaps.push(snapshot(JSON.parse(JSON.stringify(total)) as Record<string, number[]>));
		}
		expect(failing(evaluate("gestures-longpress-tap", [snaps[5] as Snapshot], [snaps]))).toEqual([]);
		expect(delta(snaps[1] as Snapshot, snaps[0] as Snapshot, "exclusive.long").start).toBe(1);
		const missing = evaluate("gestures-longpress-tap", [snaps[5] as Snapshot], [snaps.slice(0, 2)]);
		expect(failing(missing)).toContain("race tap was injected");
	});

	test("scroll-native: both recognisers and the offset", () => {
		const s = snapshot({ pan: [1, 1, 20, 1, 1, 1, 1], native: [1, 1, 0, 1, 1, 1, 1] }, { scrollY: 240, maxActive: 2 });
		expect(failing(evaluate("gestures-scroll-native", [s]))).toEqual([]);
		expect(failing(evaluate("gestures-scroll-native", [snapshot({ pan: [1, 0, 0, 0, 0, 1, 0], native: [1, 1, 0, 1, 1, 1, 1] }, { scrollY: 240, maxActive: 1 })]))).toEqual(["pan starts", "both active together"]);
	});

	test("churn: nothing left behind", () => {
		const left = { mounted: CHURN_ROUNDS, unmounted: CHURN_ROUNDS, records: 0, handlers: 0, eventHandlers: 0, alive: 40, aliveBaseline: 40 };
		expect(failing(evaluate("gestures-churn", [snapshot({}, left)]))).toEqual([]);
		expect(failing(evaluate("gestures-churn", [snapshot({}, { ...left, handlers: 3, eventHandlers: 1, alive: 55 })]))).toEqual(["no native handler left", "no UI-thread registration left", "engine views back to baseline"]);
		expect(failing(evaluate("gestures-churn", [snapshot({}, { ...left, alive: undefined as unknown as number })]))).toEqual([]);
	});
});

describe("the outcome", () => {
	const frames = (smooth: boolean) => ({ smooth, droppedPct: smooth ? 0 : 3.2, max: smooth ? 18 : 120, p95: 17, periodMs: 16.67 });
	const box = findScenario("gestures-box") as NonNullable<ReturnType<typeof findScenario>>;
	const ok = [{ name: "a", ok: true }, { name: "b", ok: true }];

	test("a judged scenario needs its checks and smooth frames", () => {
		expect(outcomeOf(box, ok, frames(true), null).verdict).toBe("pass");
		const notSmooth = outcomeOf(box, ok, frames(false), null);
		expect(notSmooth.verdict).toBe("fail");
		expect(notSmooth.summary).toMatch(/NOT SMOOTH/);
		expect(outcomeOf(box, ok, null, null).verdict).toBe("fail");
		expect(outcomeOf(box, [...ok, { name: "c", ok: false, value: "3" }], frames(true), null).summary).toMatch(/2\/3 checks · FAILED c \(3\)/);
	});

	test("a timed out round fails whatever it counted", () => {
		const outcome = outcomeOf(box, ok, frames(true), "20 s");
		expect(outcome.verdict).toBe("fail");
		expect(outcome.summary).toMatch(/TIMED OUT: 20 s/);
	});

	test("frames of a scenario that does not judge them are shown and ignored", () => {
		const row = findScenario("gestures-row") as NonNullable<ReturnType<typeof findScenario>>;
		expect(outcomeOf(row, ok, frames(false), null).verdict).toBe("pass");
	});

	test("an info scenario is never a pass or a fail", () => {
		const busy = findScenario("gestures-box-js-busy") as NonNullable<ReturnType<typeof findScenario>>;
		expect(outcomeOf(busy, [{ name: "a", ok: false }], frames(false), null).verdict).toBe("info");
	});

	test("the detail stays under what a logcat line holds, dropping the counters first", () => {
		const row = findScenario("gestures-row") as NonNullable<ReturnType<typeof findScenario>>;
		const counters: Record<string, number[]> = {};
		for (let index = 0; index < 120; index++) counters[`row-${index}`] = [1, 1, 20, 1, 1, 1, 1];
		const big = snapshot(counters, { scrollY: 190 });
		const outcome = outcomeOf(row, [{ name: "x".repeat(40), ok: true, value: "1" }], null, null);
		const detail = detailOf(row, outcome, [big], "adb");
		expect(JSON.stringify(detail).length < 3000).toBe(true);
		expect("counters" in detail).toBe(false);
		const small = detailOf(row, outcome, [snapshot({ "row-3": [1, 1, 20, 1, 1, 0, 0] })], "qa");
		expect(small.counters).toEqual([{ "row-3": [1, 1, 20, 1, 1, 0, 0] }]);
		expect(small.drive).toBe("qa");
	});
});

describe("the scenario table", () => {
	test("names are unique, one per mode and busy variant", () => {
		expect(new Set(scenarioNames).size).toBe(scenarioNames.length);
		for (const entry of scenarios) expect(scenarioFor(entry.mode, entry.busy)?.name).toBe(entry.name);
		expect(scenarioNames).toEqual([
			"gestures-box", "gestures-box-busy", "gestures-box-js", "gestures-box-js-busy", "gestures-pinch-rotate", "gestures-row", "gestures-carousel",
			"gestures-pushed-edge", "gestures-sheet", "gestures-longpress-tap", "gestures-scroll-native", "gestures-churn",
		]);
	});

	test("a scenario that only the in-app injector can drive has a multi-pointer step, and no other does", () => {
		for (const entry of scenarios) {
			const multi = entry.rounds.some((round) => round.steps.some((entryStep) => entryStep.input?.kind === "twoFinger"));
			expect(entry.inputs.includes("adb")).toBe(!multi);
			expect(entry.inputs.includes("qa")).toBe(true);
		}
	});

	test("every step has a limit above its settle time, and every input resolves against the rectangles its page reports", () => {
		const page = readdirSync(join(platformDir, "src/lib/native/dev/gestures"))
			.filter((file) => file.endsWith(".svelte"))
			.map((file) => readFileSync(join(platformDir, "src/lib/native/dev/gestures", file), "utf8"))
			.join("\n") + readFileSync(join(platformDir, "src/routes/__dev/gestures/+mobile.svelte"), "utf8");
		for (const entry of scenarios) {
			for (const round of entry.rounds) {
				for (const entryStep of round.steps) {
					expect(entryStep.maxMs > entryStep.settleMs).toBe(true);
					const input = entryStep.input;
					if (!input) continue;
					const target = input.kind === "drag" ? input.from.target : input.at.target;
					// A row's rectangle is named from its id (`row-3`): the page aims at the rows the scenario names.
					const row = /^row-(\d+)$/.exec(target)?.[1];
					expect(page.includes(`"${target}"`) || (row !== undefined && page.includes(`id === ${row}`))).toBe(true);
				}
			}
		}
	});

	test("every round of a scenario has its own id", () => {
		for (const entry of scenarios) {
			const ids = entry.rounds.map((round) => round.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});
});
