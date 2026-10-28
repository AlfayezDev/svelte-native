/**
 * What react-native-gesture-handler's detector does with a gesture's config before the native module sees it, as pure
 * functions: copies of `GestureDetector/utils.ts` (`ALLOWED_PROPS`, `extractGestureRelations`), `GestureDetector/needsToReattach.ts`
 * and `handlers/utils.ts` (`filterConfig`, `transformIntoHandlerTags`, web branches left out). RNGH's own modules import
 * `react-native` and the `*GestureHandler` components, so they cannot load on this host; `tests/gestures/config.test.ts`
 * compares every list and function here with the originals, bundled against stubs, so an RNGH upgrade shows up as a failing test.
 */
import { BaseGesture, type GestureRef, type GestureType } from "./rngh.js";

const commonProps = ["id", "enabled", "shouldCancelWhenOutside", "hitSlop", "cancelsTouchesInView", "userSelect", "activeCursor", "mouseButton", "enableContextMenu", "touchAction"];

/** The config keys the native handlers take, in the order RNGH sends them. */
export const ALLOWED_PROPS: readonly string[] = [
  ...commonProps, "needsPointerData", "manualActivation",
  // Tap
  "maxDurationMs", "maxDelayMs", "numberOfTaps", "maxDeltaX", "maxDeltaY", "maxDist", "minPointers",
  // Pan
  "activeOffsetY", "activeOffsetX", "failOffsetY", "failOffsetX", "minDist", "minVelocity", "minVelocityX", "minVelocityY", "minPointers", "maxPointers", "avgTouches", "enableTrackpadTwoFingerGesture", "activateAfterLongPress",
  "activeOffsetYStart", "activeOffsetYEnd", "activeOffsetXStart", "activeOffsetXEnd", "failOffsetYStart", "failOffsetYEnd", "failOffsetXStart", "failOffsetXEnd",
  // LongPress
  "minDurationMs", "maxDist", "numberOfPointers",
  // ForceTouch
  "minForce", "maxForce", "feedbackOnActivation",
  // Fling
  "numberOfPointers", "direction",
  // Hover
  "hoverEffect",
  // Native
  "shouldActivateOnStart", "disallowInterruption",
];

function isConfigParam(param: unknown, name: string): boolean {
  // `param !== Object(param)` is false for a function or an object and true for null.
  return param !== undefined && (param !== Object(param) || !("__isNative" in (param as Record<string, unknown>))) && name !== "onHandlerStateChange" && name !== "onGestureEvent";
}

const toArray = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

/** Handler ids (old API) or gesture refs to numeric tags; unresolved ones (-1) are dropped. */
export function transformIntoHandlerTags(handlerIDs: unknown): number[] {
  return toArray(handlerIDs as { current?: { handlerTag?: number } }[])
    .map((handlerID) => handlerID.current?.handlerTag || -1)
    .filter((handlerTag) => handlerTag > 0);
}

/** The subset of `props` the native handler takes, over `defaults`; a numeric `hitSlop` becomes the four-sided object. */
export function filterConfig(props: Record<string, unknown>, validProps: readonly string[], defaults: Record<string, unknown> = {}): Record<string, unknown> {
  const filtered = { ...defaults };
  for (const key of validProps) {
    let value = props[key];
    if (isConfigParam(value, key)) {
      if (key === "simultaneousHandlers" || key === "waitFor") value = transformIntoHandlerTags(props[key]);
      else if (key === "hitSlop" && typeof value !== "object") value = { top: value, left: value, bottom: value, right: value };
      filtered[key] = value;
    }
  }
  return filtered;
}

function convertToHandlerTag(ref: GestureRef): number {
  if (typeof ref === "number") return ref;
  if (ref instanceof BaseGesture) return ref.handlerTag;
  return (ref as { current?: { handlerTag?: number } }).current?.handlerTag ?? -1;
}

function extractValidHandlerTags(group: GestureRef[] | undefined): number[] {
  return Array.from(new Set(group?.map(convertToHandlerTag)?.filter((tag) => tag > 0) ?? []));
}

/** Rewrites the relation lists of a gesture's config to tag arrays (as RNGH does, in place) and returns them under the native names. */
export function extractGestureRelations(gesture: GestureType): { waitFor: number[]; simultaneousHandlers: number[]; blocksHandlers: number[] } {
  gesture.config.requireToFail = extractValidHandlerTags(gesture.config.requireToFail);
  gesture.config.simultaneousWith = extractValidHandlerTags(gesture.config.simultaneousWith);
  gesture.config.blocksHandlers = extractValidHandlerTags(gesture.config.blocksHandlers);
  return {
    waitFor: gesture.config.requireToFail as number[],
    simultaneousHandlers: gesture.config.simultaneousWith as number[],
    blocksHandlers: gesture.config.blocksHandlers as number[],
  };
}

/** Whether the handlers already attached must be dropped and created again: a different count, a different `handlerName`, or a change of thread. */
export function needsToReattach(attached: readonly GestureType[], next: readonly GestureType[]): boolean {
  if (next.length !== attached.length) return true;
  for (let index = 0; index < next.length; index++) {
    const before = attached[index] as GestureType;
    const after = next[index] as GestureType;
    if (after.handlerName !== before.handlerName || after.shouldUseReanimated !== before.shouldUseReanimated) return true;
  }
  return false;
}
