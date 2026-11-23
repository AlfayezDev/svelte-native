import { test, expect } from "bun:test";
import { load, anim } from "./support/harness.ts";

/** What the gestures module (`src/gestures/index.ts`, which the main entry `expo-svelte` re-exports) exports, and that its lazy parts resolve to the real thing when first used. */
test("the entry exports the builders, the sugar, the constants and worklets' runOnJS and scheduleOnRN", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  const entry = m.gestures;
  expect(Object.keys(entry).sort()).toEqual(["ActionType", "Directions", "Gesture", "GestureDetector", "GestureStateManager", "PointerType", "State", "TouchEventType", "gesture", "runOnJS", "scheduleOnRN"]);
  expect(anim()).toBeUndefined(); // listing them read nothing lazy

  expect(Object.keys(entry.Gesture).sort()).toEqual(["Exclusive", "Fling", "Hover", "LongPress", "Manual", "Native", "Pan", "Pinch", "Race", "Rotation", "Simultaneous", "Tap"]);
  expect(entry.State).toEqual({ UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5 });
  expect(entry.Directions).toEqual({ RIGHT: 1, LEFT: 2, UP: 4, DOWN: 8 });
  expect(entry.TouchEventType.TOUCHES_MOVE).toBe(2);
  expect(entry.ActionType.REANIMATED_WORKLET).toBe(1);
  expect(entry.PointerType.STYLUS).toBe(1);
  expect(typeof entry.GestureDetector).toBe("function");
  expect(typeof entry.gesture).toBe("function");

  // The two worklets exports are the stub-then-real bindings of `animation.ts`: once Reanimated is loaded they are its own.
  const callback = () => 1;
  expect(entry.runOnJS(callback)).toBe(callback);
  let ran = 0;
  entry.scheduleOnRN((value: number) => { ran = value; }, 5);
  expect(ran).toBe(5);

  // `GestureStateManager.create` is the worklet that asks Reanimated to change a handler's state.
  // RNGH 3 installs `_setGestureStateSync` on the UI runtime (`installUiRuntimeBindings`); the test stands in for it.
  const scope = globalThis as { _setGestureStateSync?: (tag: number, state: number) => void };
  scope._setGestureStateSync = (tag, state) => { (anim().gestureStates ??= []).push([tag, state]); };
  try {
    const manager = entry.GestureStateManager.create(9);
    manager.activate();
    manager.end();
    expect(manager.handlerTag).toBe(9);
    expect(anim().gestureStates).toEqual([[9, 4], [9, 5]]);
  } finally {
    delete scope._setGestureStateSync;
  }
});

test("a Gesture object builds RNGH's gestures: composition, relations and config come out as RNGH's", async () => {
  const m = await load({ fixture: "gesture-fixture.svelte" });
  const G = m.gestures.Gesture;
  const composed = G.Exclusive(G.Tap().numberOfTaps(2), G.Tap());
  expect(composed.toGestureArray().map((gesture) => gesture.handlerName)).toEqual(["TapGestureHandler", "TapGestureHandler"]);
  expect(G.Pan().activeOffsetX([-3, 3]).config).toEqual({ activeOffsetXStart: -3, activeOffsetXEnd: 3 });
});
