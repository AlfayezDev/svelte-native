/**
 * The gesture lab's scenarios, inputs, counters and verdicts (SPEC.md, "Gestures", test plan, "On a device, in the lab").
 *
 * Pure TypeScript with no imports: it runs inside the app (the `/__dev/gestures` route and the `gestures-*` stress scenarios) and in the
 * QA harness (`qa/lib/gestures.ts`, `qa/lib/inject-android.ts`, `qa/test`), so the page, the drivers and the tests share one description of
 * what is injected and what has to come back.
 *
 * The handshake: a page opens a `Session` for its scenario round. The session logs `[Svelte gesture] ready` with the rectangles of the
 * views to aim at (window pixels, from `measureInWindow` times the density) and the next `Input`, in density independent units relative
 * to a named rectangle. Whoever drives (`adb input` from the harness, the in-app injector, an XCUITest) performs it; the page counts what
 * the recognisers report, decides when the step is over (`Step.done`, then `settleMs` for springs and flings) and announces the next one.
 * When the last step is over the session resolves with a `Snapshot` and `evaluate` turns the snapshots of its rounds into checks.
 */

export type Platform = "android" | "ios";
/** Who injects the input: nobody (a person, or a page opened by hand), the harness through `adb`, the app itself (`qa`: `SvelteQaTouch`), an XCUITest. */
export type Drive = "none" | "adb" | "qa" | "xctest";

/** A rectangle in window pixels. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Rects = Record<string, Rect>;

/** A point inside a named rectangle: fractions of its width and height, then extra dp. */
export type Anchor = { target: string; fx: number; fy: number; dx?: number; dy?: number };

/**
 * What to inject, in dp (points on iOS) so one description serves every density. `drag` moves one pointer by `by` in `durationMs`;
 * `hold` keeps one pointer down (a long press) and may drift it by `drift` over the hold; `twoFinger` moves two pointers around the
 * anchor, their distance and the angle of the line through them going from the first value to the second (a pinch, a rotation or both).
 */
export type Input =
  | { kind: "tap"; at: Anchor }
  | { kind: "drag"; from: Anchor; by: [number, number]; durationMs: number }
  | { kind: "hold"; at: Anchor; durationMs: number; drift?: [number, number] }
  | { kind: "twoFinger"; at: Anchor; distance: [number, number]; angle: [number, number]; durationMs: number };

export type Point = { x: number; y: number };

export function resolveAnchor(anchor: Anchor, rects: Rects, density: number): Point {
  const rect = rects[anchor.target];
  if (!rect) throw new Error(`no rectangle named ${JSON.stringify(anchor.target)} (the page reported ${Object.keys(rects).join(", ") || "none"})`);
  return { x: rect.x + anchor.fx * rect.w + (anchor.dx ?? 0) * density, y: rect.y + anchor.fy * rect.h + (anchor.dy ?? 0) * density };
}

/** Pointer paths in window pixels: `[milliseconds from the start, x, y]` waypoints per pointer, joined by straight lines. This is what `SvelteQaTouch.run` takes. */
export type PxPath = { durationMs: number; pointers: { waypoints: [number, number, number][] }[] };

/** The second pointer of a two finger input goes down this long after the first (Android sends two events). */
export const SECOND_POINTER_MS = 32;

const tapMs = 60;

/** An input as pointer paths in pixels. A rotation is sampled every 25 ms or finer, so the straight lines between waypoints stay on the circle to well under a pixel. */
export function pxPath(input: Input, rects: Rects, density: number): PxPath {
  switch (input.kind) {
    case "tap": {
      const p = resolveAnchor(input.at, rects, density);
      return { durationMs: tapMs, pointers: [{ waypoints: [[0, p.x, p.y], [tapMs, p.x, p.y]] }] };
    }
    case "drag": {
      const from = resolveAnchor(input.from, rects, density);
      return { durationMs: input.durationMs, pointers: [{ waypoints: [[0, from.x, from.y], [input.durationMs, from.x + input.by[0] * density, from.y + input.by[1] * density]] }] };
    }
    case "hold": {
      const p = resolveAnchor(input.at, rects, density);
      const [dx, dy] = input.drift ?? [0, 0];
      return { durationMs: input.durationMs, pointers: [{ waypoints: [[0, p.x, p.y], [input.durationMs, p.x + dx * density, p.y + dy * density]] }] };
    }
    case "twoFinger": {
      const c = resolveAnchor(input.at, rects, density);
      const segments = Math.max(12, Math.ceil((input.durationMs - SECOND_POINTER_MS) / 25));
      const geometry = (fraction: number) => {
        const radius = ((input.distance[0] + (input.distance[1] - input.distance[0]) * fraction) / 2) * density;
        const angle = ((input.angle[0] + (input.angle[1] - input.angle[0]) * fraction) * Math.PI) / 180;
        return { dx: radius * Math.cos(angle), dy: radius * Math.sin(angle) };
      };
      // The first pointer goes down at 0 and waits where the pair starts; the second goes down SECOND_POINTER_MS later; from then on the
      // pair moves together to the end, so at any time the two are as far apart, and at the angle, the input says.
      const start = geometry(0);
      const first: [number, number, number][] = [[0, round(c.x - start.dx), round(c.y - start.dy)]];
      const second: [number, number, number][] = [];
      for (let step = 0; step <= segments; step++) {
        const fraction = step / segments;
        const t = round(SECOND_POINTER_MS + fraction * (input.durationMs - SECOND_POINTER_MS));
        const { dx, dy } = geometry(fraction);
        first.push([t, round(c.x - dx), round(c.y - dy)]);
        second.push([t, round(c.x + dx), round(c.y + dy)]);
      }
      return { durationMs: input.durationMs, pointers: [{ waypoints: first }, { waypoints: second }] };
    }
  }
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** A pointer's position at `t` ms along its waypoints (clamped at both ends); the in-app injector interpolates the same way. */
export function sampleAt(waypoints: readonly [number, number, number][], t: number): Point {
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  if (!first || !last) throw new Error("a pointer needs waypoints");
  if (t <= first[0]) return { x: first[1], y: first[2] };
  if (t >= last[0]) return { x: last[1], y: last[2] };
  for (let index = 1; index < waypoints.length; index++) {
    const b = waypoints[index] as [number, number, number];
    if (t > b[0]) continue;
    const a = waypoints[index - 1] as [number, number, number];
    const f = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]);
    return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f };
  }
  return { x: last[1], y: last[2] };
}

/** `RotationGestureHandler.ROTATION_RECOGNITION_THRESHOLD`: 5 degrees. */
const ROTATION_ACTIVATION_DEG = 5;
/** What the rotation recogniser spends beginning, when nothing says exactly (see `pinchChecks`): the 5 degrees and the move that crosses them. */
const ROTATION_BEGIN_LOSS_DEG = 6;

/**
 * What a pinch and a rotation report for a two finger input that was delivered as one event per entry of `frameTimesMs` (the
 * injector's event times: the first pointer goes down at the first, the second at the first from `SECOND_POINTER_MS` on, and every
 * later event is a MOVE of both). The model is react-native-gesture-handler 2.32.0's Android handlers, which count from where they
 * activate, not from where the fingers went down:
 *
 * - `ScaleGestureDetector` takes the span at the second pointer's DOWN as its initial span and begins at the first MOVE whose span
 *   differs from it by more than twice the touch slop (`mSpanSlop`); the begin event reports a factor of 1.
 * - `PinchGestureHandler.onScale` activates at the first later MOVE whose span is a touch slop (`spanSlop`) away from the span at
 *   the begin, and `activate()` calls `resetProgress()`: `scale` is 1 again there, so the reported scale is the end span over the
 *   span at activation.
 * - `RotationGestureDetector` takes the angle of the first MOVE after the second DOWN as its zero (its `previousAngle` is NaN
 *   until then); `RotationGestureHandler.onRotation` activates once the accumulated rotation reaches 5 degrees and `activate()`
 *   resets `rotation` to 0, so the reported rotation is the end angle minus the angle at activation.
 *
 * A handler that never activates reports nothing: scale 1, rotation 0. `touchSlopPx` comes from the injector
 * (`ViewConfiguration.getScaledTouchSlop`). `pinchSpan` is the span the pinch activated at, `rotationFromDeg` the rotation
 * accumulated when the rotation activated (both for tests and for the log).
 */
export function expectedTwoFinger(path: PxPath, frameTimesMs: readonly number[], touchSlopPx: number): { scale: number; rotationDeg: number; pinchSpan: number; rotationFromDeg: number } {
  const [a, b] = path.pointers;
  if (!a || !b) throw new Error("a two finger input has two pointers");
  const spanAndAngle = (t: number) => {
    const p = sampleAt(a.waypoints, t);
    const q = sampleAt(b.waypoints, t);
    return { span: Math.hypot(q.x - p.x, q.y - p.y), angle: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI };
  };
  const secondDown = frameTimesMs.findIndex((t) => t >= SECOND_POINTER_MS);
  const moves = secondDown < 0 ? [] : frameTimesMs.slice(secondDown + 1).map(spanAndAngle);
  const initialSpan = spanAndAngle(frameTimesMs[secondDown] ?? SECOND_POINTER_MS).span;
  const end = moves[moves.length - 1] ?? spanAndAngle(path.durationMs);

  let began: number | null = null;
  let pinchSpan: number | null = null;
  for (const { span } of moves) {
    if (began === null) { if (Math.abs(span - initialSpan) > 2 * touchSlopPx) began = span; continue; }
    if (Math.abs(span - began) >= touchSlopPx) { pinchSpan = span; break; }
  }

  const baseline = moves[0]?.angle;
  let rotationFrom: number | null = null;
  let rotationAngle = 0;
  if (baseline !== undefined) {
    for (const { angle } of moves.slice(1)) {
      if (Math.abs(angle - baseline) >= ROTATION_ACTIVATION_DEG) { rotationFrom = angle - baseline; rotationAngle = angle; break; }
    }
  }
  return {
    scale: pinchSpan === null ? 1 : end.span / pinchSpan,
    rotationDeg: rotationFrom === null ? 0 : end.angle - rotationAngle,
    pinchSpan: pinchSpan ?? 0,
    rotationFromDeg: rotationFrom ?? 0,
  };
}

/* ---- counters, marks and the session ---- */

export type CounterEvent = "begin" | "start" | "update" | "end" | "finalize";
export type Counter = { begin: number; start: number; update: number; end: number; endOk: number; finalize: number; finalizeOk: number };
const emptyCounter = (): Counter => ({ begin: 0, start: 0, update: 0, end: 0, endOk: 0, finalize: 0, finalizeOk: 0 });

/** What the recognisers reported, by handler name, and the page's own readings (scroll offsets, pages, detents), by name. */
export type Snapshot = { counters: Record<string, Counter>; marks: Record<string, number> };

export const copySnapshot = (snapshot: Snapshot): Snapshot => ({
  counters: Object.fromEntries(Object.entries(snapshot.counters).map(([name, counter]) => [name, { ...counter }])),
  marks: { ...snapshot.marks },
});

/** A handler's counter in `snapshot` (all zero for a handler that reported nothing). */
export const counterOf = (snapshot: Snapshot, name: string): Counter => snapshot.counters[name] ?? emptyCounter();

/** What `name` reported between two snapshots (`before` null: since the start). */
export function delta(after: Snapshot, before: Snapshot | null, name: string): Counter {
  const a = counterOf(after, name);
  const b = before ? counterOf(before, name) : emptyCounter();
  return { begin: a.begin - b.begin, start: a.start - b.start, update: a.update - b.update, end: a.end - b.end, endOk: a.endOk - b.endOk, finalize: a.finalize - b.finalize, finalizeOk: a.finalizeOk - b.finalizeOk };
}

export type Check = { name: string; ok: boolean; value?: string };

export type Step = {
  name: string;
  /** What to inject; null for a scenario that drives itself (churn). */
  input: Input | null;
  /** True when the step's effects have been reported; checked after every count or mark. */
  done: (snapshot: Snapshot) => boolean;
  /** Time to let a spring, a fling or a list reflow finish after `done`, before the page reads its settled values and announces the next step. */
  settleMs: number;
  /** The step is given up on after this long if `done` never holds; the checks then say what is missing. */
  maxMs: number;
};

export type Round = { id: string; steps: Step[] };

export type EvalContext = {
  platform: Platform;
  drive: Drive;
  density: number;
};

export type ScenarioSpec = {
  /** The stress scenario's name, `gestures-<mode>`; also the `--run` value. */
  name: string;
  /** The page's `?mode=`. */
  mode: string;
  label: string;
  /** The JavaScript thread is blocked 40 ms of every 50 while the gesture runs (`?js=busy`). */
  busy: boolean;
  presentation?: "sheet";
  rounds: Round[];
  /** The UI-runtime frames of the window count in the verdict (the gesture drives an animation on the UI thread). */
  judgesFrames: boolean;
  /** The verdict is recorded, not judged. */
  info: boolean;
  /** How the harness can inject: `adb input` handles one pointer only. */
  inputs: ("adb" | "qa")[];
  /** One entry per round, in order. */
  evaluate: (rounds: Snapshot[], steps: Snapshot[][], context: EvalContext) => Check[];
};

const at = (target: string, fx = 0.5, fy = 0.5, dx = 0, dy = 0): Anchor => ({ target, fx, fy, ...(dx ? { dx } : {}), ...(dy ? { dy } : {}) });
const drag = (from: Anchor, by: [number, number], durationMs = 400): Input => ({ kind: "drag", from, by, durationMs });
const finalized = (name: string, n = 1) => (s: Snapshot) => counterOf(s, name).finalize >= n;
const marked = (key: string, at: number) => (s: Snapshot) => (s.marks[key] ?? -1) >= at;

const near = (actual: number | undefined, expected: number, tolerance: number): boolean => actual !== undefined && Math.abs(actual - expected) <= tolerance;
const fixed = (value: number | undefined, digits = 1): string => (value === undefined ? "none" : value.toFixed(digits));
const check = (name: string, ok: boolean, value?: string | number): Check => ({ name, ok, ...(value === undefined ? {} : { value: String(value) }) });

/* ---- the scenarios ---- */

const BOX_DRAG: [number, number] = [160, 96];

/**
 * A drag that moves the sheet from one of its detents to the other. The sheet settles at the detent nearest to where the finger
 * lets go (a fling over 1000 dp/s goes one further), and its drag starts after a touch slop, so the finger has to cover more than
 * half the distance between the detents plus the slop. The detents are 0.4 and 0.9 of the height below the status bar: 433 dp on
 * the emulator's 914 dp screen and 308 dp on a 640 dp phone. 330 dp is past half of the first and short of a fling in 400 ms
 * (825 dp/s); the sheet ignores the part of the drag beyond its top.
 */
const SHEET_DRAG = 330;

/**
 * The 30 degree swipe of the carousel. The pager's Pan has `activeOffsetX(10)` and `failOffsetY(10)`; RNGH's `PanGestureHandler`
 * checks `shouldFail` before `shouldActivate`, so a single move that carries the finger past both (more than 17.3 dp across at
 * 30 degrees, when the vertical travel passes 10) fails the pan and the list scrolls. Between the two the finger needs one event
 * in 10 to 17.3 dp across: a flick of 190 dp in 300 ms moves 10.6 dp across per frame and misses that window one time in three.
 * 600 ms (5.3 dp across per 16.7 ms frame) lands an event in it while `adb input swipe` gives a sample every 12 to 18 ms, but not
 * when the injection stalls for 23 ms: on the CI emulator (native-qa on `7d32623`, 10 Nov 2026) the adb launch's diagonal scrolled
 * the list by 107 px and left the page at 1, while the frame-paced `qa` launch passed. The pager turns the page by distance (a
 * quarter of its width), not speed, so the swipe can be slow: 1200 ms, as for the sheet's tie below, moves 2.6 dp across per
 * frame and keeps a sample in the window unless the injection stalls for 46 ms.
 */
const DIAGONAL_MS = 1200;

/**
 * The sheet's tie between its own drag and a pan with `activeOffsetY([-4, 4])`: the sheet claims at its 8 dp slop and the pan wins only if
 * it activated on an earlier sample (SPEC.md, "Android arbitration"), so the finger must give a sample between 4 and 8 dp. `adb input swipe`
 * delivers a sample every 12 to 18 ms (the injection and the 60 Hz frame batching decide which): 120 dp in 400 ms moved 5.4 dp between two of
 * them, which skipped that 4 dp window in 2 of 8 runs on a fresh emulator (`ACTION_MOVE t=12 ms dy=-3.6 dp`, then `t=30 ms dy=-9.0 dp, history=0`:
 * "EngineSheet claims the gesture at sample 0 of 0"), and no engine can keep a gesture for a pan that never saw its distance. At 1200 ms the finger
 * moves 1.8 dp per 18 ms, so a sample lands in the window unless the injection stalls for 40 ms.
 */
const TIE_MS = 1200;

function boxRound(): Round {
  return {
    id: "box",
    steps: [{ name: "drag the box", input: drag(at("box"), BOX_DRAG, 400), done: finalized("pan"), settleMs: 1200, maxMs: 8000 }],
  };
}

/**
 * How much of the drag the box's peak must reach. A Pan's translation starts where it activated (a touch slop along the path, 7 of
 * 160 dp), and `adb shell input swipe` sends its last MOVE before the end of its path (the UP carries the end point): complete
 * drags read 138 to 148 dp there. The injector delivers the whole path, so the bar is higher.
 */
const peakReach = (drive: Drive): number => (drive === "adb" ? 0.8 : 0.9);

function boxChecks(s: Snapshot, context: EvalContext): Check[] {
  const pan = counterOf(s, "pan");
  const reach = peakReach(context.drive);
  return [
    check("begin, start", pan.begin >= 1 && pan.start >= 1, `${pan.begin}, ${pan.start}`),
    check("one end, success", pan.end === 1 && pan.endOk === 1, `${pan.end}, ${pan.endOk}`),
    check("one finalize", pan.finalize === 1, pan.finalize),
    check("at least 10 updates", pan.update >= 10, pan.update),
    check("peak reaches the drag", (s.marks.peakX ?? 0) >= BOX_DRAG[0] * reach && (s.marks.peakY ?? 0) >= BOX_DRAG[1] * reach, `${fixed(s.marks.peakX)}, ${fixed(s.marks.peakY)}`),
    check("rests at 0", near(s.marks.restX, 0, 0.5) && near(s.marks.restY, 0, 0.5), `${fixed(s.marks.restX, 2)}, ${fixed(s.marks.restY, 2)}`),
  ];
}

const PINCH = { distance: [80, 240] as [number, number], angle: [0, 40] as [number, number], durationMs: 600 };

function pinchChecks(rounds: Snapshot[], _steps: Snapshot[][], context: EvalContext): Check[] {
  const s = rounds[0] as Snapshot;
  const pinch = counterOf(s, "pinch");
  const rotation = counterOf(s, "rotation");
  // On Android the injector reports what it delivered, and the expected values follow from that (see `expectedTwoFinger`). Without it
  // (iOS: an XCUITest pinches, then rotates) the expected values are the commanded ones less what the recogniser spent beginning, with the
  // tolerance of a velocity based gesture. RNGH zeroes both when the recogniser begins (Android: `PinchGestureHandler.activate` and
  // `RotationGestureHandler.activate` call `resetProgress`; iOS: `RNPinchHandler.m` sets `scale = 1` and `RNBetterRotationRecognizer.handleGesture`
  // sets `rotation = 0` at `Began`), so the angle before the begin is lost: 5 degrees and the move that crosses them on Android (34.0 measured),
  // UIKit's own threshold on the iPhone (32.5 measured with XCUITest). The pinch's loss is a few percent of 3x and inside its tolerance.
  const exact = context.platform === "android" && s.marks.expectedScale !== undefined;
  const expectedScale = exact ? (s.marks.expectedScale as number) : PINCH.distance[1] / PINCH.distance[0];
  const expectedRotation = exact ? (s.marks.expectedRotation as number) : PINCH.angle[1] - PINCH.angle[0] - ROTATION_BEGIN_LOSS_DEG;
  const scaleTolerance = exact ? 0.05 : 0.1;
  const rotationTolerance = exact ? 3 : 6;
  const scale = s.marks.scale;
  const rotationDeg = s.marks.rotationDeg;
  const checks = [
    check("pinch starts and ends", pinch.start >= 1 && pinch.endOk >= 1, `${pinch.start}, ${pinch.endOk}`),
    check("rotation starts and ends", rotation.start >= 1 && rotation.endOk >= 1, `${rotation.start}, ${rotation.endOk}`),
    check(`scale within ${scaleTolerance * 100}% of ${expectedScale.toFixed(2)}`, scale !== undefined && Math.abs(scale / expectedScale - 1) <= scaleTolerance, fixed(scale, 3)),
    check(`rotation within ${rotationTolerance} degrees of ${expectedRotation.toFixed(1)}`, near(rotationDeg, expectedRotation, rotationTolerance), fixed(rotationDeg)),
  ];
  // Both recognisers active at once is what `Simultaneous` promises; an XCUITest cannot move two fingers on both axes at once.
  if (context.platform === "android") checks.push(check("both active together", (s.marks.maxActive ?? 0) >= 2, s.marks.maxActive));
  return checks;
}

const ROW_SWIPE = -220;
export const ROW_THRESHOLD = 96;

function rowChecks(rounds: Snapshot[], steps: Snapshot[][]): Check[] {
  const s = rounds[0] as Snapshot;
  const first = steps[0]?.[0];
  const rows = Object.keys(s.counters).filter((name) => name.startsWith("row-"));
  const row3 = counterOf(s, "row-3");
  const row5 = counterOf(s, "row-5");
  const touchedElsewhere = rows.filter((name) => name !== "row-3" && name !== "row-5").some((name) => counterOf(s, name).start > 0);
  return [
    check("row 3 removed", s.marks["removed.3"] === 1 && (s.marks.removedTotal ?? 0) === 1, s.marks.removedTotal),
    check("row 3 pan ended in success", row3.endOk === 1 && row3.start >= 1, `${row3.start}, ${row3.endOk}`),
    check("list did not scroll for the swipe", first !== undefined && (first.marks.scrollY ?? 99) <= 1, fixed(first?.marks.scrollY)),
    check("row 5 pan failed, never started", row5.start === 0 && row5.update === 0 && row5.finalize >= 1 && row5.finalizeOk === 0, `${row5.start}, ${row5.finalize}, ${row5.finalizeOk}`),
    check("list scrolled over 100", (s.marks.scrollY ?? 0) > 100, fixed(s.marks.scrollY)),
    check("no other row moved", !touchedElsewhere),
  ];
}

function carouselChecks(rounds: Snapshot[], steps: Snapshot[][]): Check[] {
  const s = rounds[0] as Snapshot;
  const [horizontal, diagonal, vertical] = steps[0] ?? [];
  const pager = counterOf(s, "pager");
  return [
    check("horizontal swipe changes the page", horizontal?.marks.page === 1, horizontal?.marks.page),
    check("horizontal swipe did not scroll", (horizontal?.marks.scrollY ?? 99) <= 1, fixed(horizontal?.marks.scrollY)),
    check("diagonal swipe goes to the dominant axis", diagonal?.marks.page === 2 && (diagonal?.marks.scrollY ?? 99) <= 1, `${diagonal?.marks.page}, ${fixed(diagonal?.marks.scrollY)}`),
    check("vertical swipe scrolls", (vertical?.marks.scrollY ?? 0) > 100, fixed(vertical?.marks.scrollY)),
    check("vertical swipe did not change the page", vertical?.marks.page === 2, vertical?.marks.page),
    check("pager pan: 3 begins, 2 successes, 3 finalizes", pager.begin === 3 && pager.endOk === 2 && pager.finalize === 3 && pager.finalizeOk === 2, `${pager.begin}, ${pager.endOk}, ${pager.finalize}, ${pager.finalizeOk}`),
  ];
}

function edgeChecks(rounds: Snapshot[]): Check[] {
  const [edge, inside] = rounds as [Snapshot, Snapshot];
  const edgePan = counterOf(edge, "pan");
  const insidePan = counterOf(inside, "pan");
  return [
    check("edge swipe popped the screen", edge.marks.popped === 1, edge.marks.popped),
    check("edge swipe: the pan never started", edgePan.start === 0 && edgePan.endOk === 0, `${edgePan.start}, ${edgePan.endOk}`),
    check("swipe from 100 dp started the pan", insidePan.start >= 1 && insidePan.endOk === 1, `${insidePan.start}, ${insidePan.endOk}`),
    check("swipe from 100 dp did not pop", (inside.marks.popped ?? 0) === 0, inside.marks.popped),
  ];
}

function sheetChecks(rounds: Snapshot[], steps: Snapshot[][], context: EvalContext): Check[] {
  const s = rounds[0] as Snapshot;
  const [afterGrabber, afterScroll, afterDefault, afterFast] = steps[0] ?? [];
  const boxDefault = counterOf(s, "boxDefault");
  const boxFast = counterOf(s, "boxFast");
  const checks = [
    check("grabber drag changes the detent", afterGrabber?.marks.detent === 1, afterGrabber?.marks.detent),
    check("scroll view scrolls", (afterScroll?.marks.scrollY ?? 0) > 100 && afterScroll?.marks.detent === 1, `${fixed(afterScroll?.marks.scrollY)}, ${afterScroll?.marks.detent}`),
    check("[-4, 4] pan wins: it starts and ends", boxFast.start >= 1 && boxFast.endOk === 1, `${boxFast.start}, ${boxFast.endOk}`),
    check("[-4, 4] pan leaves the detent alone", afterFast !== undefined && afterDefault !== undefined && afterFast.marks.detent === afterDefault.marks.detent && afterFast.marks.detentChanges === afterDefault.marks.detentChanges, `${afterFast?.marks.detentChanges}`),
  ];
  // The default pan activates at 10 dp, the sheet's drag at the touch slop (8 dp): the sheet wins on Android. UIKit's private drag recogniser decides on iOS: recorded.
  const sheetWins = afterDefault?.marks.detent === 0 && boxDefault.start === 0;
  if (context.platform === "android") checks.push(check("default pan loses to the sheet", sheetWins, `${afterDefault?.marks.detent}, ${boxDefault.start}`));
  else checks.push(check("default pan against the sheet (recorded, not judged)", true, `${afterDefault?.marks.detent}, ${boxDefault.start}`));
  return checks;
}

type LongPressStep = { box: "exclusive" | "race"; kind: "tap" | "hold" | "drift"; index: number };
const longPressSteps: LongPressStep[] = (["exclusive", "race"] as const).flatMap((box) => (["tap", "hold", "drift"] as const).map((kind, index) => ({ box, kind, index })));
const HOLD_MS = 700;
const DRIFT: [number, number] = [0, 16];

function longPressInput({ box, kind }: LongPressStep): Input {
  if (kind === "tap") return { kind: "tap", at: at(box) };
  return { kind: "hold", at: at(box), durationMs: HOLD_MS, ...(kind === "drift" ? { drift: DRIFT } : {}) };
}

function longPressChecks(_rounds: Snapshot[], steps: Snapshot[][]): Check[] {
  const snapshots = steps[0] ?? [];
  const checks: Check[] = [];
  longPressSteps.forEach(({ box, kind }, index) => {
    const after = snapshots[index];
    if (!after) return checks.push(check(`${box} ${kind} was injected`, false));
    const before = index % 3 === 0 ? null : (snapshots[index - 1] ?? null);
    const tap = delta(after, before, `${box}.tap`);
    const long = delta(after, before, `${box}.long`);
    const press = delta(after, before, `${box}.press`);
    if (kind === "tap") {
      checks.push(check(`${box} tap: tap fires once, long press fails`, tap.start === 1 && tap.endOk === 1 && long.start === 0 && long.finalize === 1 && long.finalizeOk === 0, `${tap.start}, ${long.start}, ${long.finalizeOk}`));
      checks.push(check(`${box} tap: the Pressable presses too`, press.start === 1, press.start));
    } else if (kind === "hold") {
      checks.push(check(`${box} hold: long press once, tap cancelled`, long.start === 1 && long.endOk === 1 && tap.start === 0 && tap.finalizeOk === 0, `${long.start}, ${tap.start}`));
      checks.push(check(`${box} hold: the press is cancelled`, press.start === 0, press.start));
    } else {
      checks.push(check(`${box} drift: both end failed`, long.start === 0 && long.finalizeOk === 0 && long.finalize === 1 && tap.start === 0 && tap.finalizeOk === 0, `${long.start}, ${long.finalizeOk}, ${tap.start}, ${tap.finalizeOk}`));
    }
  });
  return checks;
}

const doneAfter = ({ box, index }: LongPressStep) => (s: Snapshot) => counterOf(s, `${box}.long`).finalize >= index + 1 && counterOf(s, `${box}.tap`).finalize >= index + 1;

/**
 * `gestures-span`: three taps on a paragraph of two lines with a link that begins the second. The link's press counts under `link`, the paragraph's under `paragraph`; each step is over when the tap has been
 * counted at all (`area.tap`). A tap on the link goes to the link and not also to the paragraph (a press goes to the span under the finger), a tap on the first line and one on the plain words at the end of the
 * second go to the paragraph and not to the link (a tap beside the link, on its line, is not on it).
 */
const SPAN_STEPS = [
  { name: "tap the link", at: at("sentence", 0, 0.75, 30), link: 1, paragraph: 0 },
  { name: "tap the first line", at: at("sentence", 0, 0.25, 30), link: 0, paragraph: 1 },
  { name: "tap beside the link, on its line", at: at("sentence", 0.97, 0.75), link: 0, paragraph: 1 },
] as const;

function spanChecks(_rounds: Snapshot[], steps: Snapshot[][]): Check[] {
  const snapshots = steps[0] ?? [];
  const checks: Check[] = [];
  SPAN_STEPS.forEach((entry, index) => {
    const after = snapshots[index];
    if (!after) return checks.push(check(`${entry.name} was injected`, false));
    const before = index === 0 ? null : (snapshots[index - 1] ?? null);
    const link = delta(after, before, "link").start;
    const paragraph = delta(after, before, "paragraph").start;
    checks.push(check(`${entry.name}: the link presses ${entry.link}, the paragraph ${entry.paragraph}`, link === entry.link && paragraph === entry.paragraph, `${link}, ${paragraph}`));
  });
  return checks;
}

function scrollNativeChecks(rounds: Snapshot[], _steps: Snapshot[][], context: EvalContext): Check[] {
  const s = rounds[0] as Snapshot;
  const pan = counterOf(s, "pan");
  const native = counterOf(s, "native");
  const checks = [
    check("pan starts", pan.start >= 1, pan.start),
    check("native scroll starts", native.start >= 1, native.start),
    check("scroll offset moved over 100", (s.marks.scrollY ?? 0) > 100, fixed(s.marks.scrollY)),
  ];
  if (context.platform === "android") checks.push(check("both active together", (s.marks.maxActive ?? 0) >= 2, s.marks.maxActive));
  return checks;
}

export const CHURN_ROUNDS = 200;

/**
 * How many engine views the churn left above its baseline (negative: fewer than at the start), or null when the count was not taken.
 * Android's engine counts its live views (`SvelteEngine.stats().alive`, read before and after), so a missing count there is a lost
 * measurement and not a pass; iOS mounts through React Native and has no engine to ask, so it has none to leave.
 */
export function viewsLeft(marks: Record<string, number | undefined>, platform: Platform): number | null {
  const { alive, aliveBaseline } = marks;
  if (typeof alive !== "number" || typeof aliveBaseline !== "number") return platform === "android" ? null : 0;
  return alive - aliveBaseline;
}

function churnChecks(rounds: Snapshot[], _steps: Snapshot[][], context: EvalContext): Check[] {
  const s = rounds[0] as Snapshot;
  const m = s.marks;
  const views = viewsLeft(m, context.platform);
  return [
    check(`${CHURN_ROUNDS} mounted and unmounted`, m.mounted === CHURN_ROUNDS && m.unmounted === CHURN_ROUNDS, `${m.mounted}, ${m.unmounted}`),
    check("no record left", m.records === 0, m.records),
    check("no native handler left", m.handlers === 0, m.handlers),
    check("no UI-thread registration left", m.eventHandlers === 0, m.eventHandlers),
    check("engine views back to baseline", views !== null && views <= 0, views === null ? "not counted" : `${m.alive} of ${m.aliveBaseline}`),
  ];
}

function spec(fields: Partial<ScenarioSpec> & Pick<ScenarioSpec, "name" | "mode" | "label" | "rounds" | "evaluate">): ScenarioSpec {
  return { busy: false, judgesFrames: false, info: false, inputs: ["adb", "qa"], ...fields };
}

const step = (name: string, input: Input | null, done: Step["done"], settleMs = 600, maxMs = 8000): Step => ({ name, input, done, settleMs, maxMs });

const boxEvaluate = (rounds: Snapshot[], _steps: Snapshot[][], context: EvalContext) => boxChecks(rounds[0] as Snapshot, context);
const boxLabel = "A draggable box: Pan on the UI thread, a spring on release";

export const scenarios: ScenarioSpec[] = [
  spec({ name: "gestures-box", mode: "box", label: boxLabel, rounds: [boxRound()], judgesFrames: true, evaluate: boxEvaluate }),
  spec({ name: "gestures-box-busy", mode: "box", label: `${boxLabel}, with the JavaScript thread blocked 40 ms of every 50`, busy: true, rounds: [boxRound()], judgesFrames: true, evaluate: boxEvaluate }),
  spec({ name: "gestures-box-js", mode: "box-js", label: "The same box with runOnJS(true): every callback on the JavaScript thread", rounds: [boxRound()], evaluate: boxEvaluate }),
  spec({ name: "gestures-box-js-busy", mode: "box-js", label: "runOnJS(true) with the JavaScript thread blocked: recorded, not judged", busy: true, info: true, rounds: [boxRound()], evaluate: boxEvaluate }),
  spec({
    name: "gestures-pinch-rotate", mode: "pinch-rotate", label: "Simultaneous(Pinch, Rotation) on an AnimatedView", judgesFrames: true, inputs: ["qa"],
    rounds: [{ id: "pinch-rotate", steps: [step("spread and turn", { kind: "twoFinger", at: at("target"), ...PINCH }, (s) => counterOf(s, "pinch").finalize >= 1 && counterOf(s, "rotation").finalize >= 1, 800)] }],
    evaluate: pinchChecks,
  }),
  spec({
    name: "gestures-row", mode: "row", label: "20 swipe-to-delete rows in a vertical ScrollView",
    rounds: [{
      id: "row",
      steps: [
        step("swipe row 3 left", drag(at("row-3", 0.85, 0.5), [ROW_SWIPE, 0], 350), marked("removed.3", 1), 500),
        step("swipe row 5 up", drag(at("row-5"), [0, -200], 400), finalized("row-5"), 1000),
      ],
    }],
    evaluate: rowChecks,
  }),
  spec({
    name: "gestures-carousel", mode: "carousel", label: "A horizontal Pan pager inside a vertical ScrollView",
    rounds: [{
      id: "carousel",
      steps: [
        step("horizontal swipe", drag(at("pager", 0.85, 0.5), [-220, 0], 300), (s) => counterOf(s, "pager").finalize >= 1, 700),
        step("diagonal swipe, 30 degrees", drag(at("pager", 0.85, 0.5), [-190, -110], DIAGONAL_MS), (s) => counterOf(s, "pager").finalize >= 2, 700),
        step("vertical swipe", drag(at("pager"), [0, -240], 400), (s) => counterOf(s, "pager").finalize >= 3, 1000),
      ],
    }],
    evaluate: carouselChecks,
  }),
  spec({
    name: "gestures-pushed-edge", mode: "pushed-edge", label: "A full-width horizontal Pan on a pushed screen: the edge swipe against the pan",
    rounds: [
      { id: "edge", steps: [step("swipe from x = 8 dp", drag(at("box", 0, 0.5, 8), [220, 0], 300), marked("popped", 1), 500, 6000)] },
      { id: "inside", steps: [step("swipe from x = 100 dp", drag(at("box", 0, 0.5, 100), [220, 0], 300), finalized("pan"), 900, 6000)] },
    ],
    evaluate: (rounds) => edgeChecks(rounds),
  }),
  spec({
    name: "gestures-sheet", mode: "sheet", label: "A two-detent sheet: the grabber, two vertical pans and a scroll view", presentation: "sheet",
    rounds: [{
      id: "sheet",
      steps: [
        step("drag the grabber up", drag(at("grabber"), [0, -SHEET_DRAG], 400), marked("detentChanges", 1), 900),
        step("scroll the content", drag(at("scroll", 0.5, 0.7), [0, -260], 400), (s) => (s.marks.scrollY ?? 0) > 100, 900, 5000),
        step("drag the default pan down", drag(at("boxDefault"), [0, SHEET_DRAG], 400), marked("detentChanges", 2), 900, 5000),
        step("drag the [-4, 4] pan up", drag(at("boxFast"), [0, -120], TIE_MS), finalized("boxFast"), 900, 5000),
      ],
    }],
    evaluate: sheetChecks,
  }),
  spec({
    name: "gestures-longpress-tap", mode: "longpress-tap", label: "Exclusive(LongPress, Tap) and Race(LongPress, Tap), a Pressable inside each",
    rounds: [{ id: "longpress-tap", steps: longPressSteps.map((entry) => step(`${entry.box} ${entry.kind}`, longPressInput(entry), doneAfter(entry), 400, 6000)) }],
    evaluate: longPressChecks,
  }),
  spec({
    name: "gestures-scroll-native", mode: "scroll-native", label: "Pan simultaneous with the Native gesture of a ScrollView",
    rounds: [{ id: "scroll-native", steps: [step("drag the scroll view", drag(at("scroll", 0.5, 0.75), [0, -250], 400), (s) => counterOf(s, "pan").finalize >= 1 && counterOf(s, "native").finalize >= 1, 900)] }],
    evaluate: scrollNativeChecks,
  }),
  spec({
    name: "gestures-span", mode: "span", label: "A paragraph with a link: a press goes to the span under the finger, a press beside it to the paragraph",
    rounds: [{ id: "span", steps: SPAN_STEPS.map((entry, index) => step(entry.name, { kind: "tap", at: entry.at }, (s) => counterOf(s, "area.tap").finalize >= index + 1, 400, 6000)) }],
    evaluate: spanChecks,
  }),
  spec({
    name: "gestures-churn", mode: "churn", label: `${CHURN_ROUNDS} mounts and unmounts of a view with three gestures, half on the UI thread`,
    rounds: [{ id: "churn", steps: [] }],
    inputs: ["adb", "qa"],
    evaluate: churnChecks,
  }),
];

export const scenarioNames: string[] = scenarios.map((entry) => entry.name);
export const findScenario = (name: string): ScenarioSpec | undefined => scenarios.find((entry) => entry.name === name);
/** The scenario a page opened with `?mode=` and `?js=busy` stands for. */
export const scenarioFor = (mode: string, busy: boolean): ScenarioSpec | undefined => scenarios.find((entry) => entry.mode === mode && entry.busy === busy);

/* ---- the handshake ---- */

export type Ready = {
  scenario: string;
  mode: string;
  round: number;
  rounds: number;
  step: number;
  steps: number;
  drive: Drive;
  density: number;
  /** The engine overlay (the surface) in window pixels. */
  screen: Rect;
  rects: Rects;
  /** What to inject next; null when the scenario drives itself. */
  input: Input | null;
  stepName: string;
};

export const GESTURE_TAG = "[Svelte gesture]";

/** `ready`, `step` and `result` are the lines of the handshake; the payload is one JSON object. */
export type GestureLine = { event: "ready"; ready: Ready } | { event: "step" | "result"; payload: Record<string, unknown> };

/**
 * The line a console call produced, in the form logcat shows it for a React Native app (`'[Svelte gesture] ready', '{...}'`), or the
 * text a bare call would print (`[Svelte gesture] ready {...}`): the event and its JSON payload, or null for any other line.
 */
export function parseGestureLine(message: string): GestureLine | null {
  const match = /^(?:'\[Svelte gesture\] (ready|step|result)', '|\[Svelte gesture\] (ready|step|result) )(\{.*\})'?\s*$/s.exec(message);
  if (!match) return null;
  const event = (match[1] ?? match[2]) as "ready" | "step" | "result";
  let payload: unknown;
  try {
    payload = JSON.parse(match[3] as string);
  } catch {
    throw new Error(`malformed ${GESTURE_TAG} ${event} line (logcat cuts lines near 4 KB): ${(match[3] as string).slice(0, 160)}`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw new Error(`${GESTURE_TAG} ${event} payload is not an object`);
  if (event === "ready") return { event, ready: readyFrom(payload as Record<string, unknown>) };
  return { event, payload: payload as Record<string, unknown> };
}

const num = (value: unknown, what: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${GESTURE_TAG} ready: ${what} is not a number`);
  return value;
};
const text = (value: unknown, what: string): string => {
  if (typeof value !== "string") throw new Error(`${GESTURE_TAG} ready: ${what} is not a string`);
  return value;
};
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function rectFrom(value: unknown, what: string): Rect {
  if (!isObject(value)) throw new Error(`${GESTURE_TAG} ready: ${what} is not a rectangle`);
  return { x: num(value.x, `${what}.x`), y: num(value.y, `${what}.y`), w: num(value.w, `${what}.w`), h: num(value.h, `${what}.h`) };
}

function anchorFrom(value: unknown, what: string): Anchor {
  if (!isObject(value)) throw new Error(`${GESTURE_TAG} ready: ${what} is not an anchor`);
  return { target: text(value.target, `${what}.target`), fx: num(value.fx, `${what}.fx`), fy: num(value.fy, `${what}.fy`), ...(value.dx === undefined ? {} : { dx: num(value.dx, `${what}.dx`) }), ...(value.dy === undefined ? {} : { dy: num(value.dy, `${what}.dy`) }) };
}

const pair = (value: unknown, what: string): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${GESTURE_TAG} ready: ${what} is not a pair`);
  return [num(value[0], `${what}[0]`), num(value[1], `${what}[1]`)];
};

function inputFrom(value: unknown): Input | null {
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new Error(`${GESTURE_TAG} ready: input is not an object`);
  switch (value.kind) {
    case "tap": return { kind: "tap", at: anchorFrom(value.at, "input.at") };
    case "drag": return { kind: "drag", from: anchorFrom(value.from, "input.from"), by: pair(value.by, "input.by"), durationMs: num(value.durationMs, "input.durationMs") };
    case "hold": return { kind: "hold", at: anchorFrom(value.at, "input.at"), durationMs: num(value.durationMs, "input.durationMs"), ...(value.drift === undefined ? {} : { drift: pair(value.drift, "input.drift") }) };
    case "twoFinger": return { kind: "twoFinger", at: anchorFrom(value.at, "input.at"), distance: pair(value.distance, "input.distance"), angle: pair(value.angle, "input.angle"), durationMs: num(value.durationMs, "input.durationMs") };
    default: throw new Error(`${GESTURE_TAG} ready: unknown input kind ${JSON.stringify(value.kind)}`);
  }
}

const drives: readonly string[] = ["none", "adb", "qa", "xctest"];

function readyFrom(value: Record<string, unknown>): Ready {
  if (!isObject(value.rects)) throw new Error(`${GESTURE_TAG} ready: rects is not an object`);
  const rects: Rects = {};
  for (const [name, rect] of Object.entries(value.rects)) rects[name] = rectFrom(rect, `rects.${name}`);
  const drive = text(value.drive, "drive");
  if (!drives.includes(drive)) throw new Error(`${GESTURE_TAG} ready: unknown drive ${JSON.stringify(drive)}`);
  return {
    scenario: text(value.scenario, "scenario"),
    mode: text(value.mode, "mode"),
    round: num(value.round, "round"),
    rounds: num(value.rounds, "rounds"),
    step: num(value.step, "step"),
    steps: num(value.steps, "steps"),
    drive: drive as Drive,
    density: num(value.density, "density"),
    screen: rectFrom(value.screen, "screen"),
    rects,
    input: inputFrom(value.input),
    stepName: typeof value.stepName === "string" ? value.stepName : "",
  };
}

/** What a page hands its scenario to aim at: `{...probe("box")}` on a view names its rectangle, makes it a view of its own (`collapsable: false`) and gives it the `testID` an XCUITest finds it by. */
export type Probe = (name: string) => { ref: (handle: unknown) => void; testID: string; collapsable: false };

/* ---- the session ---- */

export type Hooks = {
  /** The rectangles of the views to aim at, and the surface, in window pixels, as they are now. */
  measure: () => Promise<{ rects: Rects; screen: Rect }>;
  /** Injects the input from inside the app (`drive` `qa`); resolves with what the injector reports of it. */
  inject?: (input: Input, rects: Rects, density: number) => Promise<unknown>;
  log: (event: "ready" | "step" | "result", payload: Record<string, unknown>) => void;
  /** Runs `fn` after `ms` and returns what cancels it; setTimeout when absent (tests pass a manual clock). */
  schedule?: (fn: () => void, ms: number) => () => void;
};

/** One round of one scenario, on one page: counts what the page reports, announces the steps and resolves with what it saw. */
export class Session {
  readonly spec: ScenarioSpec;
  readonly round: number;
  readonly drive: Drive;
  readonly density: number;
  readonly counters: Record<string, Counter> = {};
  readonly marks: Record<string, number> = {};
  /** The counters and marks as they were when each step was over. */
  readonly steps: Snapshot[] = [];
  timedOut: string | null = null;
  readonly finished: Promise<Snapshot>;
  private hooks: Hooks;
  private index = 0;
  private started = false;
  private completing = false;
  private over = false;
  private injecting: Promise<unknown> = Promise.resolve();
  private readonly live = new Set<string>();
  private readonly starters: (() => void | Promise<void>)[] = [];
  private readonly settlers: ((step: number) => void | Promise<void>)[] = [];
  private resolveFinished: (snapshot: Snapshot) => void = () => undefined;
  private cancelStepTimer: (() => void) | null = null;

  constructor(spec: ScenarioSpec, round: number, drive: Drive, density: number, hooks: Hooks) {
    this.spec = spec;
    this.round = round;
    this.drive = drive;
    this.density = density;
    this.hooks = hooks;
    this.finished = new Promise((resolve) => { this.resolveFinished = resolve; });
  }

  get roundSpec(): Round {
    return this.spec.rounds[this.round] as Round;
  }

  get currentStep(): number {
    return this.index;
  }

  /**
   * A recogniser reported `event` for the handler `name`; `ok` is the `success` flag of `end` and `finalize`; `n` counts several updates
   * at once. `start` puts the handler among the active ones and `end` or `finalize` takes it out: the most active at once is the mark
   * `maxActive` (what `Simultaneous` promises).
   */
  count(name: string, event: CounterEvent, ok = true, n = 1): void {
    const counter = (this.counters[name] ??= emptyCounter());
    counter[event] += n;
    if (event === "end" && ok) counter.endOk += n;
    if (event === "finalize" && ok) counter.finalizeOk += n;
    if (event === "start") {
      this.live.add(name);
      if (this.live.size > (this.marks.maxActive ?? 0)) this.marks.maxActive = this.live.size;
    } else if (event === "end" || event === "finalize") this.live.delete(name);
    this.changed();
  }

  /** A `Pressable` inside a gesture view pressed (not a recogniser: it is not among the active ones). */
  press(name: string): void {
    (this.counters[name] ??= emptyCounter()).start += 1;
    this.changed();
  }

  /** Runs when the round starts, before the first step is announced: the scenario that drives itself (churn), the busy JavaScript thread. */
  onStart(fn: () => void | Promise<void>): void {
    this.starters.push(fn);
  }

  /** Runs after every step's settle time and before the step is recorded: a page reads what needs the UI thread (a spring at rest). */
  onSettle(fn: (step: number) => void | Promise<void>): void {
    this.settlers.push(fn);
  }

  mark(key: string, value: number): void {
    this.marks[key] = value;
    this.changed();
  }

  /** Keeps the largest value seen. */
  peak(key: string, value: number): void {
    if (this.marks[key] === undefined || value > (this.marks[key] as number)) this.mark(key, value);
  }

  snapshot(): Snapshot {
    return copySnapshot({ counters: this.counters, marks: this.marks });
  }

  /** Announces the first step (and injects it when the app drives itself). A scenario without steps finishes when the page calls `finish`. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const starter of this.starters) await starter();
    await this.announce();
    this.changed();
  }

  /** The page decided the round is over (churn), or gave up. */
  finish(): void {
    if (this.over) return;
    this.over = true;
    this.cancelTimer();
    const snapshot = this.snapshot();
    this.hooks.log("result", { scenario: this.spec.name, round: this.round, steps: this.steps.length, timedOut: this.timedOut, marks: snapshot.marks });
    this.resolveFinished(snapshot);
  }

  /** The scenario ran out of time: whatever was counted is the result. */
  abort(reason: string): void {
    if (this.over) return;
    this.timedOut = reason;
    this.finish();
  }

  private schedule(fn: () => void, ms: number): () => void {
    if (this.hooks.schedule) return this.hooks.schedule(fn, ms);
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  }

  private cancelTimer(): void {
    this.cancelStepTimer?.();
    this.cancelStepTimer = null;
  }

  private changed(): void {
    if (!this.started || this.completing || this.over) return;
    const current = this.roundSpec.steps[this.index];
    if (current && current.done(this.snapshot())) this.complete(current.settleMs);
  }

  private complete(settleMs: number): void {
    this.completing = true;
    this.cancelTimer();
    this.schedule(() => { void this.finishStep(); }, settleMs);
  }

  private async finishStep(): Promise<void> {
    if (this.over) return;
    await this.injecting.catch(() => undefined);
    for (const settler of this.settlers) await settler(this.index);
    this.steps.push(this.snapshot());
    this.hooks.log("step", { scenario: this.spec.name, round: this.round, step: this.index, marks: this.marks });
    this.index++;
    this.completing = false;
    await this.announce();
    this.changed();
  }

  private async announce(): Promise<void> {
    const steps = this.roundSpec.steps;
    const current = steps[this.index];
    if (!current) {
      if (steps.length > 0) this.finish();
      return;
    }
    const { rects, screen } = await this.hooks.measure();
    this.hooks.log("ready", {
      scenario: this.spec.name, mode: this.spec.mode, round: this.round, rounds: this.spec.rounds.length, step: this.index, steps: steps.length, drive: this.drive, density: this.density,
      screen, rects, input: current.input, stepName: current.name,
    });
    this.cancelTimer();
    const announced = this.index;
    this.cancelStepTimer = this.schedule(() => {
      if (this.index !== announced || this.over) return;
      this.marks[`timeout.${announced}`] = 1;
      this.complete(0);
    }, current.maxMs);
    if (this.drive === "qa" && current.input && this.hooks.inject) {
      const input = current.input;
      const inject = this.hooks.inject;
      this.injecting = this.injecting.then(() => inject(input, rects, this.density));
      await this.injecting.catch((error: unknown) => { this.marks[`injectError.${announced}`] = 1; this.hooks.log("step", { scenario: this.spec.name, round: this.round, step: announced, error: String(error) }); });
    }
  }
}

/* ---- the lab's registry: the page opens a session, the stress scenario waits for it ---- */

type Waiter = { scenario: string; round: number; resolve: (session: Session) => void };
const open = new Map<string, Session>();
const waiters: Waiter[] = [];
const keyOf = (scenario: string, round: number) => `${scenario}#${round}`;

export const lab = {
  /** A page opens its round; a scenario waiting for it is released. */
  open(session: Session): void {
    open.set(keyOf(session.spec.name, session.round), session);
    for (const waiter of waiters.splice(0)) {
      const found = open.get(keyOf(waiter.scenario, waiter.round));
      if (found) waiter.resolve(found);
      else waiters.push(waiter);
    }
  },
  close(session: Session): void {
    if (open.get(keyOf(session.spec.name, session.round)) === session) open.delete(keyOf(session.spec.name, session.round));
  },
  /** The session of `scenario` round `round` once its page has opened it; rejects after `timeoutMs`. */
  wait(scenario: string, round: number, timeoutMs: number): Promise<Session> {
    const existing = open.get(keyOf(scenario, round));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === done);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`the page of ${scenario} round ${round} did not open within ${timeoutMs} ms`));
      }, timeoutMs);
      const done = (session: Session) => { clearTimeout(timer); resolve(session); };
      waiters.push({ scenario, round, resolve: done });
    });
  },
};

/* ---- verdict and the line the harness reads ---- */

export type FrameVerdict = { smooth: boolean; droppedPct: number; max: number; p95: number; periodMs: number };

export type Outcome = {
  verdict: "pass" | "fail" | "info";
  summary: string;
  checks: Check[];
  /** Why a round was given up on (its budget, or "stopped"); null when every round finished. */
  timedOut: string | null;
};

/** The scenario's verdict from its checks (and its frames when they count); `timedOut` names a round that ran out of time. */
export function outcomeOf(spec: ScenarioSpec, checks: Check[], frames: FrameVerdict | null, timedOut: string | null): Outcome {
  const failed = checks.filter((entry) => !entry.ok);
  const framesOk = !spec.judgesFrames || (frames !== null && frames.smooth);
  const ok = failed.length === 0 && framesOk && timedOut === null;
  const parts = [`${checks.length - failed.length}/${checks.length} checks`];
  if (timedOut) parts.push(`TIMED OUT: ${timedOut}`);
  for (const entry of failed.slice(0, 4)) parts.push(`FAILED ${entry.name}${entry.value === undefined ? "" : ` (${entry.value})`}`);
  if (frames) parts.push(`frames ${frames.droppedPct.toFixed(1)}% dropped, p95 ${frames.p95}, max ${frames.max.toFixed(0)} ms${spec.judgesFrames && !frames.smooth ? " NOT SMOOTH" : ""}`);
  return { verdict: spec.info ? "info" : ok ? "pass" : "fail", summary: parts.join(" · "), checks, timedOut };
}

const compactCounter = (c: Counter): number[] => [c.begin, c.start, c.update, c.end, c.endOk, c.finalize, c.finalizeOk];

/**
 * The `detail` of the scenario's `[Svelte stress]` line. logcat cuts a line near 4 KB and the parser refuses a cut line, so this stays
 * well under that: counters as `[begin, start, update, end, endOk, finalize, finalizeOk]`, checks as `[name, 1 | 0, value]`.
 */
export function detailOf(spec: ScenarioSpec, outcome: Outcome, rounds: Snapshot[], drive: Drive, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const detail = (withCounters: boolean): Record<string, unknown> => ({
    mode: spec.mode,
    busy: spec.busy,
    drive,
    timedOut: outcome.timedOut,
    checks: [...outcome.checks].sort((a, b) => Number(a.ok) - Number(b.ok)).map((entry) => [entry.name, entry.ok ? 1 : 0, ...(entry.value === undefined ? [] : [entry.value])]),
    ...(withCounters ? { counters: rounds.map((round) => Object.fromEntries(Object.entries(round.counters).map(([name, counter]) => [name, compactCounter(counter)]))) } : {}),
    marks: rounds.map((round) => round.marks),
    ...extra,
  });
  const full = detail(true);
  return JSON.stringify(full).length <= 2800 ? full : detail(false);
}
