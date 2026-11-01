/**
 * react-native-gesture-handler on the Fabric host, without React.
 *
 * RNGH's `GestureDetector` is a React component that creates, updates and drops native handlers from effects; this module does
 * the same from the host's build and flush steps, keyed by the Svelte node, like `animation.ts` does for Reanimated. A node
 * with a `gesture` attribute (`Gesture.Pan()`, `Gesture.Race(...)`, ...) gets one record:
 *
 * - `gestureProps` runs while the Fabric node is built: it takes `gesture` out of the props, forces `collapsable: false` (a
 *   flattened view has no native view and no tag) and notes a new, changed or removed gesture.
 * - `commitGestures` runs after `completeRoot`, when the node's tag exists on the native side: it creates and attaches the handlers
 *   (`attachHandlers`), updates them (`updateHandlers`) or drops them, and one deferred batch then sends the relations and the one
 *   `flushOperations` that makes the native module run everything queued.
 * - `sweepGestures` drops the handlers of nodes that left the tree (a removed block, a popped screen, a hot remount).
 *
 * The native calls, their order and their payloads are RNGH's own (`tests/gestures/golden`). Callbacks that are all worklets run
 * on the UI thread through Reanimated (`gestures/animated.ts`); the others run here on the JS thread (`gestures/events.ts`).
 */
import { mark } from "../boot-marks.ts";
import type { AnimationTarget } from "./animation.ts";
import { createUiPath, disposeUiPath, rebuildUiPath, shareHandlers, type UiPath } from "../gestures/animated.ts";
import { ALLOWED_PROPS, extractGestureRelations, filterConfig, needsToReattach } from "../gestures/config.ts";
import { forgetHandler, startListening } from "../gestures/events.ts";
import { checkGestureCallbacksForWorklets, checkUiClosures } from "../gestures/guards.ts";
import { defer, enableNative, nativeModule } from "../gestures/native.ts";
import { ActionType, MountRegistry, registerHandler, unregisterHandler, type ComposedGesture, type GestureRef, type GestureType } from "../gestures/rngh.js";

type Gesture = ComposedGesture | GestureType;
type Live = (node: never) => boolean;
type Props = Record<string, unknown>;

type GestureRecord = {
  node: object;
  /** The host's state of the node: `tag` is what native attaches to, and it never changes. */
  target: AnimationTarget;
  /** The `gesture` attribute of the latest build; `undefined` once it was removed. */
  gesture: Gesture | undefined;
  /** The gesture the attached handlers were last created or updated from. */
  applied: Gesture | null;
  /** The gestures with a native handler (RNGH's `attachedGestures`). After an update they are the first objects, carrying the latest config. */
  attached: GestureType[];
  mounted: boolean;
  ui: UiPath | null;
  /** A step of the next batch is waiting for this record, and what it has to do. */
  queued: boolean;
  fresh: boolean;
  next: GestureType[] | null;
};

const dev = () => typeof __DEV__ !== "undefined" && __DEV__;
const records = new Map<object, GestureRecord>();
const pending = new Set<GestureRecord>();
/** Which record owns a gesture object: one object cannot drive two views, because its `handlerTag` is the handler. */
const owners = new WeakMap<GestureType, GestureRecord>();
const collapsableWarned = new WeakSet<object>();

const isGesture = (value: unknown): value is Gesture =>
  typeof value === "object" && value !== null && typeof (value as Gesture).toGestureArray === "function" && typeof (value as Gesture).initialize === "function";

/**
 * The props the native payload is made from. A node without a `gesture` attribute and without a record comes back unchanged.
 * Otherwise `gesture` is removed and `collapsable: false` forced, and the record notes what the commit has to do.
 */
export function gestureProps(node: object, target: AnimationTarget, props: Props): Props {
  let record = records.get(node);
  const value = props.gesture;
  if (value === undefined || value === null) {
    if (record && record.gesture !== undefined) { record.gesture = undefined; pending.add(record); }
    if (!("gesture" in props)) return props;
    const rest = { ...props };
    delete rest.gesture;
    return rest;
  }
  if (!isGesture(value)) throw new TypeError(`[svelte-native gestures] The gesture attribute takes a Gesture object (Gesture.Pan(), Gesture.Race(...), ...), not ${typeof value === "object" ? "this object" : typeof value}.`);
  if (!record) {
    record = { node, target, gesture: undefined, applied: null, attached: [], mounted: false, ui: null, queued: false, fresh: false, next: null };
    records.set(node, record);
  }
  record.target = target;
  if (record.gesture !== value) { record.gesture = value; pending.add(record); }
  if (props.collapsable === true && dev() && !collapsableWarned.has(node)) {
    collapsableWarned.add(node);
    console.warn("[svelte-native gestures] collapsable={true} on a view with a gesture is ignored: a flattened view has no native view for the gesture to attach to, so the view stays uncollapsed.");
  }
  const rest = { ...props };
  delete rest.gesture;
  rest.collapsable = false;
  return rest;
}

/**
 * Creates, updates and drops the native handlers of every node `gestureProps` touched; call after `completeRoot`, when their
 * tags exist natively. `live` says whether a node is still in a mounted tree: a gesture object that moved from a node that just
 * left to a new one is not shared, only its old owner has not been swept yet. Every record is processed; the first failure is thrown at the end.
 */
export function commitGestures(live: Live): void {
  if (pending.size === 0) return;
  const work = [...pending];
  pending.clear();
  let failure: unknown;
  // Removals first, so a gesture object handed from one node to another within a commit is free when the second one attaches.
  for (const record of work.filter((entry) => entry.gesture === undefined).concat(work.filter((entry) => entry.gesture !== undefined))) {
    try {
      if (record.gesture === undefined) detach(record);
      else if (!record.mounted) attachHandlers(record, record.gesture, live);
      else if (record.gesture !== record.applied) updateAttached(record, record.gesture, live);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) throw failure;
}

/** Drops the handlers of every node for which `live` is false; the host calls it after commits that removed children. */
export function sweepGestures(live: Live): void {
  for (const record of [...records.values()]) if (!live(record.node as never)) detach(record);
}

/** Drops everything a node's gestures own: native handlers, registry entries, the UI-thread registration, the record. */
export function detachGesture(node: object): void {
  const record = records.get(node);
  if (record) detach(record);
}

/** What is alive, for the lab and the leak checks: records, native handlers, UI-thread event registrations. */
export function stats(): { records: number; handlers: number; eventHandlers: number } {
  let handlers = 0;
  let eventHandlers = 0;
  for (const record of records.values()) { handlers += record.attached.length; if (record.ui) eventHandlers++; }
  return { records: records.size, handlers, eventHandlers };
}

function claim(record: GestureRecord, gestures: readonly GestureType[], live: Live): void {
  for (const gesture of gestures) {
    const owner = owners.get(gesture);
    if (!owner || owner === record) continue;
    if (!live(owner.node as never)) detach(owner);
    else throw new Error(`[svelte-native gestures] Handler with tag ${gesture.handlerTag} already exists. Please ensure that no Gesture instance is used across multiple GestureDetectors.`);
  }
  for (const gesture of gestures) owners.set(gesture, record);
}

function release(record: GestureRecord): void {
  const leaves = [...record.attached, ...(record.gesture ? record.gesture.toGestureArray() : []), ...(record.applied ? record.applied.toGestureArray() : [])];
  for (const gesture of leaves) if (owners.get(gesture) === record) owners.delete(gesture);
}

/** The UI-thread registration follows the gestures: made when one runs there, rebuilt when the handlers were attached again, dropped when none does. */
function syncUi(record: GestureRecord, gestures: readonly GestureType[], rebuild: boolean): void {
  if (gestures.some((gesture) => gesture.shouldUseReanimated)) {
    if (!record.ui) record.ui = createUiPath(record.target.tag);
    else if (rebuild) rebuildUiPath(record.ui);
    shareHandlers(record.ui, gestures);
  } else if (record.ui) {
    disposeUiPath(record.ui);
    record.ui = null;
  }
}

/** RNGH's `attachHandlers`: tags, then `createGestureHandler` for each, then `attachGestureHandler` for each with its action type. */
function attachHandlers(record: GestureRecord, gesture: Gesture, live: Live): void {
  const gestures = gesture.toGestureArray();
  claim(record, gestures, live);
  const rebuild = record.ui !== null;
  try {
    for (const handler of gestures) { checkGestureCallbacksForWorklets(handler); checkUiClosures(handler); }
    enableNative();
    startListening();
    gesture.initialize();
    syncUi(record, gestures, rebuild);
    const native = nativeModule();
    for (const handler of gestures) {
      native.createGestureHandler(handler.handlerName, handler.handlerTag, filterConfig(handler.config, ALLOWED_PROPS));
      registerHandler(handler.handlerTag, handler, handler.config.testId);
    }
    for (const handler of gestures) {
      native.attachGestureHandler(handler.handlerTag, record.target.tag, handler.shouldUseReanimated ? ActionType.REANIMATED_WORKLET : ActionType.JS_FUNCTION_NEW_API);
      MountRegistry.gestureWillMount(handler);
    }
  } catch (error) {
    for (const handler of gestures) if (owners.get(handler) === record) owners.delete(handler);
    if (record.ui && !record.mounted) { disposeUiPath(record.ui); record.ui = null; }
    throw error;
  }
  record.attached = gestures;
  record.mounted = true;
  record.applied = gesture;
  record.fresh = true;
  record.next = null;
  queue(record);
}

/** RNGH's `dropHandlers`: the native handler, the registry entry and the unmount notice of each attached gesture; the flush is the batch's. */
function dropHandlers(record: GestureRecord): void {
  const native = nativeModule();
  for (const handler of record.attached) {
    native.dropGestureHandler(handler.handlerTag);
    unregisterHandler(handler.handlerTag, handler.config.testId);
    MountRegistry.gestureWillUnmount(handler);
    forgetHandler(handler.handlerTag);
  }
  release(record);
  record.attached = [];
  record.next = null;
  schedule();
}

/** A new gesture object for a node that has handlers: attach again when the shape or the thread changed, otherwise only update. */
function updateAttached(record: GestureRecord, gesture: Gesture, live: Live): void {
  const next = gesture.toGestureArray();
  if (needsToReattach(record.attached, next)) {
    dropHandlers(record);
    attachHandlers(record, gesture, live);
    return;
  }
  updateHandlers(record, gesture, next, live);
}

/** RNGH's `updateHandlers`, first half: the new objects take over the attached handlers' tags now; the config follows in the batch. */
function updateHandlers(record: GestureRecord, gesture: Gesture, next: GestureType[], live: Live): void {
  gesture.prepare();
  claim(record, next, live);
  for (let index = 0; index < next.length; index++) {
    const handler = record.attached[index] as GestureType;
    const source = next[index] as GestureType;
    checkGestureCallbacksForWorklets(source);
    checkUiClosures(source);
    // Only when it differs: a gesture object that was kept (memoised) already has the tag.
    if (source.handlerTag !== handler.handlerTag) {
      source.handlerTag = handler.handlerTag;
      source.handlers.handlerTag = handler.handlerTag;
    }
  }
  record.next = next;
  record.applied = gesture;
  queue(record);
}

function detach(record: GestureRecord): void {
  records.delete(record.node);
  pending.delete(record);
  if (record.mounted) dropHandlers(record);
  release(record);
  record.mounted = false;
  record.gesture = undefined;
  record.applied = null;
  record.fresh = false;
  record.next = null;
  if (record.ui) { disposeUiPath(record.ui); record.ui = null; }
}

// A handler's relations name other handlers by tag, and every gesture of a commit has its tag only after its own attach, so what
// goes into `updateGestureHandler` waits for the whole commit: one deferred batch (RNGH's `ghQueueMicrotask`) per burst of changes.
const batch: GestureRecord[] = [];
let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  defer(runBatch);
}
function queue(record: GestureRecord): void {
  if (!record.queued) { record.queued = true; batch.push(record); }
  schedule();
}
function runBatch(): void {
  scheduled = false;
  let failure: unknown;
  for (const record of batch.splice(0)) {
    try { step(record); } catch (error) { failure ??= error; }
  }
  nativeModule().flushOperations();
  if (failure !== undefined) throw failure;
}

/** The deferred half of `attachHandlers` and `updateHandlers`: relations resolved, config sent. */
function step(record: GestureRecord): void {
  record.queued = false;
  if (!record.mounted) return;
  const native = nativeModule();
  const attached = record.attached;
  if (record.fresh) { record.fresh = false; record.applied?.prepare(); }
  const next = record.next;
  record.next = null;
  // The worklet reads the callbacks from a shared value: the new ones are sent when a gesture object was replaced and any side runs on the UI thread.
  let shareAgain = false;
  for (let index = 0; index < attached.length; index++) {
    const handler = attached[index] as GestureType;
    const source = next?.[index];
    if (source) {
      if (handler.handlers.gestureId !== source.handlers.gestureId && (source.shouldUseReanimated || handler.shouldUseReanimated)) shareAgain = true;
      handler.config = source.config;
      handler.handlers = source.handlers;
    }
    native.updateGestureHandler(handler.handlerTag, filterConfig(handler.config, ALLOWED_PROPS, extractGestureRelations(handler)));
    if (source) registerHandler(handler.handlerTag, handler, handler.config.testId);
  }
  if (record.ui && shareAgain) shareHandlers(record.ui, attached);
}

// When a gesture mounts that another detector's gestures name in a relation (`simultaneousWithExternalGesture`, ...), that detector
// sends its relations again: RNGH's `useMountReactions`. Until the other gesture has a tag the relation resolves to nothing. A record
// does not react to its own gestures: `attached` is empty while it attaches (nothing yet on a first attach, `dropHandlers` emptied it
// on a new one), so there is nothing for the loop to compare; the last test of `tests/gestures/lifecycle.test.ts` pins that.
const names = (relation: GestureRef[] | undefined, gesture: GestureType) => relation !== undefined && relation.some((entry) => (typeof entry === "number" ? entry : (entry as GestureType).handlerTag ?? (entry as { current?: { handlerTag?: number } }).current?.handlerTag) === gesture.handlerTag);
MountRegistry.addMountListener((mounted) => {
  const gesture = mounted as GestureType;
  for (const record of records.values()) {
    if (!record.mounted || !record.gesture) continue;
    for (const attached of record.attached) {
      const { blocksHandlers, requireToFail, simultaneousWith } = attached.config;
      if (names(blocksHandlers, gesture) || names(requireToFail, gesture) || names(simultaneousWith, gesture)) {
        updateAttached(record, record.gesture, () => true);
        break;
      }
    }
  }
});
mark("gestures");
