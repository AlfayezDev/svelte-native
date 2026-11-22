import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { gestureOracle } from "./support/oracle.ts";
import { src } from "../support/bundle.ts";
import { load } from "./support/harness.ts";
import { ALLOWED_PROPS, extractGestureRelations, filterConfig, needsToReattach } from "../../src/gestures/config.ts";
import { GestureObjects } from "../../src/gestures/rngh.js";

// The detector's pure helpers are copies of RNGH's (it cannot be imported: `GestureDetector/utils` loads `react-native` and the
// `*GestureHandler` components). Each is run against RNGH's own, bundled as the oracle, so an upgrade that changes one fails here.
// RNGH 3's `normalizeHitSlop` checks its input in development, where React Native defines `__DEV__`.
(globalThis as { __DEV__?: boolean }).__DEV__ ??= true;
const oracle = gestureOracle();
const callback = () => {};

test("ALLOWED_PROPS is RNGH's list, in RNGH's order", () => {
  expect([...ALLOWED_PROPS]).toEqual(oracle().ALLOWED_PROPS);
});

test("filterConfig gives RNGH's config for every builder, hit slop and relation shape", () => {
  const G = oracle().GestureObjects;
  const configs: Record<string, unknown>[] = [
    G.Pan().activeOffsetX([-10, 10]).failOffsetY(5).minPointers(2).maxPointers(3).minDistance(7).minVelocity(100).averageTouches(true).activateAfterLongPress(300).config,
    G.Tap().numberOfTaps(3).maxDistance(9).maxDuration(200).maxDelay(100).maxDeltaX(4).maxDeltaY(5).minPointers(2).hitSlop(8).config,
    G.LongPress().minDuration(400).maxDistance(12).config,
    G.Fling().direction(5).numberOfPointers(2).config,
    G.Native().shouldActivateOnStart(true).disallowInterruption(true).config,
    G.Manual().onTouchesDown(callback).config,
    G.Pan().enabled(false).hitSlop({ left: -20, vertical: 4 }).shouldCancelWhenOutside(true).manualActivation(true).cancelsTouchesInView(false).runOnJS(true).withTestId("x").activeCursor("grab").config,
    { enabled: undefined, hitSlop: null, id: "a", unknown: 1, onGestureEvent: callback },
  ];
  for (const config of configs) {
    expect(filterConfig(config, ALLOWED_PROPS)).toEqual(oracle().filterConfig(config, oracle().ALLOWED_PROPS));
    expect(JSON.stringify(filterConfig(config, ALLOWED_PROPS, { waitFor: [], simultaneousHandlers: [1], blocksHandlers: [] }))).toBe(JSON.stringify(oracle().filterConfig(config, oracle().ALLOWED_PROPS, { waitFor: [], simultaneousHandlers: [1], blocksHandlers: [] })));
  }
});

test("extractGestureRelations resolves gesture objects, refs and tags as RNGH does, and drops what has no tag yet", () => {
  const build = (G: typeof GestureObjects) => {
    const other = G.Native();
    (other as { handlerTag: number }).handlerTag = 7;
    const unmounted = G.Tap();
    const ref = { current: G.Pan() };
    (ref.current as { handlerTag: number }).handlerTag = 9;
    return G.Pan().simultaneousWithExternalGesture(other, unmounted).requireExternalGestureToFail(ref as never, other).blocksExternalGesture(other, other);
  };
  const mine = extractGestureRelations(build(GestureObjects));
  expect(mine).toEqual({ waitFor: [9, 7], simultaneousHandlers: [7], blocksHandlers: [7] });
  expect(mine).toEqual(oracle().extractGestureRelations(build(oracle().GestureObjects)));
});

test("needsToReattach: a different count, handlerName or thread, as RNGH decides", () => {
  const worklet = <T extends () => void>(fn: T) => { (fn as { __workletHash?: number }).__workletHash = 1; return fn; };
  const shapes = (G: typeof GestureObjects) => ({
    pan: [G.Pan().onUpdate(worklet(() => {}))], panAgain: [G.Pan().onEnd(worklet(() => {}))], tap: [G.Tap().onEnd(worklet(() => {}))],
    panJs: [G.Pan().onUpdate(callback)], both: [G.Pan().onUpdate(worklet(() => {})), G.Tap()],
  });
  const mine = shapes(GestureObjects);
  const theirs = shapes(oracle().GestureObjects);
  for (const a of Object.keys(mine) as (keyof typeof mine)[]) {
    for (const b of Object.keys(mine) as (keyof typeof mine)[]) {
      expect(needsToReattach(mine[a], mine[b])).toBe(oracle().needsToReattach({ attachedGestures: theirs[a] }, theirs[b]));
    }
  }
  expect(needsToReattach(mine.pan, mine.panJs)).toBe(true);
  expect(needsToReattach(mine.pan, mine.panAgain)).toBe(false);
});

test("the constants the UI worklet copies are RNGH's, every one of them", async () => {
  // `State`, `TouchEventType` and `CallbackType` of `src/gestures/rngh.js` are RNGH's own modules, so comparing them with the
  // oracle's would compare RNGH with itself. The copies are the numbers in `animated.ts`: the worklet reads those.
  const { probe } = await load({ fixture: "gesture-fixture.svelte" });
  const copies = await probe.copiedConstants();
  expect(copies.State).toEqual(oracle().State);
  expect(copies.TouchEventType).toEqual(oracle().TouchEventType);
  expect(copies.CallbackType).toEqual(oracle().CallbackType);
  // ... and the three objects hold every numeric constant the file declares: a constant added to the worklet and left out of them is a miss.
  const source = await readFile(src("gestures/animated.ts"), "utf8");
  const declared = [...source.matchAll(/^const ([A-Z_]+) = (\d+);$/gm)].map(([, name, value]) => `${name}=${value}`);
  const copied = [...Object.values(copies).flatMap((group) => Object.values(group))];
  expect(declared).toHaveLength(copied.length);
  expect(declared.map((entry) => Number(entry.split("=")[1])).sort((a, b) => a - b)).toEqual([...copied].sort((a, b) => a - b));
});
