/**
 * Reanimated on the Fabric host, without React.
 *
 * `createAnimatedComponent` attaches Reanimated to a view in `componentDidMount`/`componentDidUpdate`/
 * `componentWillUnmount`; this module does the same from the host's build and flush steps, keyed by the
 * Svelte node. Three things can be attached to one node, each optional:
 *
 * - `animatedStyle`, a worklet (or an array of them) returning a style object: `useAnimatedStyle` without
 *   the hook. One view-descriptor set and one mapper per node; the mapper runs `styleUpdater` on the UI runtime.
 * - `animatedProps`, the same for props that are not style (`useAnimatedProps` without the hook): a worklet returning
 *   `{ text }` for a text view. A second set and mapper per node; the updater writes with `updateProps(..., true)`, which
 *   hands the values to Reanimated as they are instead of building them as style, and the first-run values go in the
 *   node's props (not its style) so the first commit already shows them.
 * - Reanimated CSS keys (`animationName`, `transitionProperty`, ...) in `style` or as top-level props: one `CSSManager`.
 * - SharedValues inside `style` (animated props): Reanimated's own `InlinePropManager`.
 * - `entering`, `exiting`, `layout`: layout animations, configured through `updateLayoutAnimations` like
 *   `AnimatedComponent._configureLayoutAnimation`. Reanimated's C++ proxy does the work (it runs before the
 *   engine's mounting delegate, see the svelte-engine SPEC). `entering` is keyed by a `nativeID` the view carries
 *   (the proxy moves the config to the tag when the view is inserted) and is read on the first build only;
 *   `exiting` and `layout` are keyed by tag, registered after the commit that mounts the node and re-registered
 *   when the prop changes. Removal needs nothing: the proxy intercepts the Remove.
 *
 * `animationProps` runs while the Fabric node is built and returns the props the native payload is made from
 * (animation keys removed, first-run values merged in). `commitAnimations` runs after `completeRoot`, when the
 * shadow nodes exist, and starts or updates the native side. `detachAnimation` undoes everything for a node.
 */
import { mark } from "../boot-marks.ts";
import { makeMutable, startMapper, stopMapper, type SharedValue } from "react-native-reanimated";
import { makeShareable } from "react-native-worklets";
import { CSSManager, filterCSSAndStyleProperties, getInlineStyle, hasInlineStyles, initialUpdaterRun, InlinePropManager, isAnimated, LayoutAnimationType, makeViewDescriptorsSet, markNodeAsRemovable, maybeBuild, processColorsInProps, shallowEqual, updateLayoutAnimations, updateProps, validateAnimatedStyles, type ViewDescriptorsSet } from "./reanimated-internals.js";

/** What the host keeps per element that the animation layer reads: its tag, Fabric component name and current shadow node handle. */
export type AnimationTarget = {
  tag: number;
  viewName: string;
  node: object | null;
  propsDirty: boolean;
  /**
   * A foreign view, or a node inside one (SPEC.md, "Foreign views"): its top-level props are its library's own. `transition` is expo-image's, `animationName` is
   * Rive's, and neither is one of Reanimated's CSS keys; only the `style` of such a node can carry those.
   */
  foreign?: boolean;
};
type Values = Record<string, unknown>;
type Updater = (() => Values) & { __closure?: Values };
type StyleRuntime = {
  /** The updater's values are props (`animatedProps`), not style: `updateProps`' `isAnimatedProps`. */
  animatedProps: boolean;
  descriptors: ViewDescriptorsSet;
  remoteState: SharedValue<unknown>;
  active: SharedValue<boolean>;
  initial: Values;
  updaters: Updater[];
  mounted: Updater[] | null;
  mapperId: number | null;
};
type Record_ = {
  target: AnimationTarget;
  first: boolean;
  wrapper: object | null;
  wantsStyle: boolean;
  wantsProps: boolean;
  wantsInline: boolean;
  /** The style with Reanimated CSS keys merged in, handed to `CSSManager.update`; null when the node has none. */
  css: Values | null;
  cssChanged: boolean;
  rawStyle: unknown;
  style: StyleRuntime | null;
  /** The runtime of `animatedProps`; null without it. */
  props: StyleRuntime | null;
  inline: InlinePropManager | null;
  cssManager: CSSManager | null;
  /** `nativeID` of the entering config (Reanimated reads it off the inserted view); null without `entering`. */
  enteringId: number | null;
  /** The `exiting`/`layout` props of the latest build, and the ones last handed to `updateLayoutAnimations`. */
  layoutProps: LayoutProps;
  layoutRegistered: LayoutProps;
};
type LayoutProps = { exiting?: unknown; layout?: unknown };

// Reanimated numbers its own `nativeID`s from 0 upwards; ours start high so the two never meet in one config map.
let nextEnteringId = 0x40000000;
const records = new Map<object, Record_>();
const pending = new Set<object>();

const isCssKey = (key: string) => key.startsWith("animation") || key.startsWith("transition");
const flatten = (style: unknown, into: unknown[] = []): unknown[] => {
  if (Array.isArray(style)) for (const item of style) flatten(item, into);
  else if (style && typeof style === "object") into.push(style);
  return into;
};
const updatersOf = (value: unknown, into: Updater[] = []): Updater[] => {
  if (Array.isArray(value)) for (const item of value) updatersOf(item, into);
  else if (typeof value === "function") into.push(value as Updater);
  return into;
};

/** One updater from many: later styles win, as in a flattened style array. */
function combine(updaters: Updater[]): Updater {
  if (updaters.length === 1) return updaters[0] as Updater;
  return (() => {
    "worklet";
    const merged: Values = {};
    for (let index = 0; index < updaters.length; index++) Object.assign(merged, (updaters[index] as Updater)());
    return merged;
  }) as Updater;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// biome-ignore-start lint: Reanimated's worklets, kept as close to the original as possible
// The next three functions are `useAnimatedStyle`'s worklets from react-native-reanimated/src/hook/useAnimatedStyle.ts,
// which does not export them; only the web and Jest branches and the `isAnimatedProps` flag are left out.
function prepareAnimation(frameTimestamp: number, animatedProp: any, lastAnimation: any, lastValue: any): void {
  "worklet";
  if (Array.isArray(animatedProp)) {
    animatedProp.forEach((prop, index) => {
      prepareAnimation(frameTimestamp, prop, lastAnimation && lastAnimation[index], lastValue && lastValue[index]);
    });
  }
  if (typeof animatedProp === "object" && animatedProp.onFrame) {
    const animation = animatedProp;
    let value = animation.current;
    if (lastValue !== undefined && lastValue !== null) {
      if (typeof lastValue === "object") {
        if (lastValue.value !== undefined) {
          value = lastValue.value; // previously it was a shared value
        } else if (lastValue.onFrame !== undefined) {
          if (lastAnimation?.current !== undefined) value = lastAnimation.current; // it was an animation before, copy its state
          else if (lastValue?.current !== undefined) value = lastValue.current; // it was initialized
        }
      } else {
        value = lastValue; // previously it was a plain value, just set it as starting point
      }
    }
    animation.callStart = (timestamp: number) => {
      animation.onStart(animation, value, timestamp, lastAnimation);
    };
    animation.callStart(frameTimestamp);
    animation.callStart = null;
  } else if (typeof animatedProp === "object") {
    Object.keys(animatedProp).forEach((key) => prepareAnimation(frameTimestamp, animatedProp[key], lastAnimation && lastAnimation[key], lastValue && lastValue[key]));
  }
}

function runAnimations(animation: any, timestamp: number, key: number | string, result: any, animationsActive: SharedValue<boolean>, forceCopyAnimation?: boolean): boolean {
  "worklet";
  if (!animationsActive.value) return true;
  if (Array.isArray(animation)) {
    result[key] = [];
    let allFinished = true;
    forceCopyAnimation = key === "boxShadow";
    animation.forEach((entry, index) => {
      if (!runAnimations(entry, timestamp, index, result[key], animationsActive, forceCopyAnimation)) allFinished = false;
    });
    return allFinished;
  } else if (typeof animation === "object" && animation.onFrame) {
    let finished = true;
    if (!animation.finished) {
      if (animation.callStart) {
        animation.callStart(timestamp);
        animation.callStart = null;
      }
      finished = animation.onFrame(animation, timestamp);
      animation.timestamp = timestamp;
      if (finished) {
        animation.finished = true;
        animation.callback?.(true);
      }
    }
    // A boxShadow animation is copied so that nested colours stay unparsed for the next frame.
    if (forceCopyAnimation && typeof animation.current === "object") result[key] = { ...animation.current };
    else result[key] = animation.current;
    return finished;
  } else if (typeof animation === "object") {
    result[key] = {};
    let allFinished = true;
    Object.keys(animation).forEach((k) => {
      if (!runAnimations(animation[k], timestamp, k, result[key], animationsActive, forceCopyAnimation)) allFinished = false;
    });
    return allFinished;
  }
  result[key] = animation;
  return true;
}

function styleUpdater(viewDescriptors: SharedValue<any>, updater: Updater, state: any, animationsActive: SharedValue<boolean>, forceUpdate?: boolean, isAnimatedProps?: boolean): void {
  "worklet";
  const animations = state.animations ?? {};
  const newValues = updater() ?? {};
  const oldValues = state.last;
  const nonAnimatedNewValues: Values = {};
  let hasAnimations = false;
  let frameTimestamp: number | undefined;
  let hasNonAnimatedValues = false;
  for (const key in newValues) {
    const value = newValues[key];
    if (isAnimated(value)) {
      frameTimestamp = (globalThis as any).__frameTimestamp || (globalThis as any)._getAnimationTimestamp();
      prepareAnimation(frameTimestamp as number, value, animations[key], oldValues[key]);
      animations[key] = value;
      hasAnimations = true;
    } else {
      hasNonAnimatedValues = true;
      nonAnimatedNewValues[key] = value;
      delete animations[key];
    }
  }
  if (hasAnimations) {
    const frame = (timestamp: number) => {
      const { animations, last, isAnimationCancelled } = state;
      if (isAnimationCancelled) {
        state.isAnimationRunning = false;
        return;
      }
      const updates: any = {};
      let allFinished = true;
      for (const propName in animations) {
        const finished = runAnimations(animations[propName], timestamp, propName, updates, animationsActive);
        if (finished) {
          // An animated array prop is copied property by property so a colour never stays linked to its `toValue`.
          if (Array.isArray(updates[propName])) {
            updates[propName].forEach((entry: Values) => {
              for (const prop in entry) {
                if (!last[propName] || typeof last[propName] !== "object") last[propName] = {};
                last[propName][prop] = entry[prop];
              }
            });
          } else {
            last[propName] = updates[propName];
          }
          delete animations[propName];
        } else {
          allFinished = false;
        }
      }
      if (updates) updateProps(viewDescriptors, updates, isAnimatedProps === true);
      if (!allFinished) requestAnimationFrame(frame);
      else state.isAnimationRunning = false;
    };
    state.animations = animations;
    if (!state.isAnimationRunning) {
      state.isAnimationCancelled = false;
      state.isAnimationRunning = true;
      frame(frameTimestamp as number);
    }
    if (hasNonAnimatedValues) updateProps(viewDescriptors, nonAnimatedNewValues, isAnimatedProps === true);
  } else {
    state.isAnimationCancelled = true;
    state.animations = [];
    if (!shallowEqual(oldValues, newValues) || forceUpdate) updateProps(viewDescriptors, newValues, isAnimatedProps === true);
  }
  state.last = newValues;
}
// biome-ignore-end lint: Reanimated's worklets
/* eslint-enable @typescript-eslint/no-explicit-any */

function createStyleRuntime(updaters: Updater[], animatedProps = false): StyleRuntime {
  const returned = { ...initialUpdaterRun(combine(updaters)) } as Values;
  validateAnimatedStyles(returned);
  // `updateProps(..., true)` turns the colours of animated props (`fill`, `stroke`, `floodColor`, `backgroundColor`, ...) into the platform's integer before the native view
  // gets them; the first values reach it in the node's props, so they are given the same treatment (a colour the worklet returns as `{ type: 0, payload }` throws, as it does there).
  const initial = animatedProps ? { ...returned } : returned;
  if (animatedProps) processColorsInProps(initial);
  return {
    animatedProps,
    descriptors: makeViewDescriptorsSet(),
    remoteState: makeShareable({ last: returned, animations: {}, isAnimationCancelled: false, isAnimationRunning: false }) as unknown as SharedValue<unknown>,
    active: makeMutable(true),
    initial,
    updaters,
    mounted: null,
    mapperId: null,
  };
}

const sameList = (a: readonly unknown[], b: readonly unknown[] | null) => b !== null && a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The props the native payload is built from. A node without animation props comes back unchanged and costs one key scan.
 * Otherwise `animatedStyle` and the CSS keys are removed and the first-run style values (and, on the first build only,
 * the current values of SharedValues in `style`) are merged into `style`, so the first commit already shows them.
 */
export function animationProps(node: object, target: AnimationTarget, props: Record<string, unknown>): Record<string, unknown> {
  let record = records.get(node);
  const updaters = updatersOf(props.animatedStyle);
  const propUpdaters = updatersOf(props.animatedProps);
  const styles = flatten(props.style);
  let cssTop: Values | null = null;
  const own = target.foreign === true;
  for (const key in props) {
    if (own || !isCssKey(key) || props[key] === undefined) continue;
    cssTop ??= {};
    cssTop[key] = props[key];
  }
  const layoutAnimated = props.entering !== undefined || props.exiting !== undefined || props.layout !== undefined;
  const inline = styles.some((style) => hasInlineStyles(style as Values));
  const cssInStyle = styles.some((style) => Object.keys(style as Values).some(isCssKey));
  if (!record && updaters.length === 0 && propUpdaters.length === 0 && !cssTop && !cssInStyle && !inline && !layoutAnimated) return props;

  if (!record) {
    record = { target, first: true, wrapper: null, wantsStyle: false, wantsProps: false, wantsInline: false, css: null, cssChanged: false, rawStyle: undefined, style: null, props: null, inline: null, cssManager: null, enteringId: null, layoutProps: {}, layoutRegistered: {} };
    records.set(node, record);
    if (props.entering !== undefined) {
      // Before the commit that inserts the view, like the constructor in AnimatedComponent.
      record.enteringId = nextEnteringId++;
      updateLayoutAnimations(record.enteringId, LayoutAnimationType.ENTERING, maybeBuild(props.entering) as never);
    }
  }
  record.layoutProps = { exiting: props.exiting, layout: props.layout };
  record.target = target;
  record.wantsStyle = updaters.length > 0;
  if (record.wantsStyle) {
    if (!record.style) record.style = createStyleRuntime(updaters);
    record.style.updaters = updaters;
  }
  record.wantsProps = propUpdaters.length > 0;
  if (record.wantsProps) {
    if (!record.props) record.props = createStyleRuntime(propUpdaters, true);
    record.props.updaters = propUpdaters;
  }
  record.wantsInline = inline;
  record.rawStyle = props.style;

  const mapped = styles.map((style) => (hasInlineStyles(style as Values) ? getInlineStyle(style as Values, record.first) : style)) as Values[];
  const out: Record<string, unknown> = { ...props };
  delete out.animatedStyle;
  delete out.animatedProps;
  delete out.entering;
  delete out.exiting;
  delete out.layout;
  if (record.enteringId !== null) out.nativeID = String(record.enteringId);
  if (!own) for (const key in props) if (isCssKey(key)) delete out[key];
  let style: unknown = props.style;
  if (cssTop || cssInStyle || record.cssManager) {
    const merged: Values = Object.assign({}, ...mapped, cssTop);
    if (record.css === null || !shallowEqual(record.css, merged)) record.cssChanged = true;
    record.css = merged;
    style = cssInStyle || cssTop ? [filterCSSAndStyleProperties(merged)[4]] : mapped;
  } else {
    if (record.css !== null) record.cssChanged = true;
    record.css = null;
    if (inline) style = mapped;
  }
  if (record.style) style = [style, record.style.initial];
  if (style === undefined) delete out.style;
  else out.style = style;
  if (record.props) Object.assign(out, record.props.initial);
  pending.add(node);
  return out;
}

/** Starts or refreshes the native side of every node `animationProps` touched; call after `completeRoot`, when their shadow nodes are committed. */
export function commitAnimations(): void {
  for (const node of pending) attachAnimation(node);
  pending.clear();
}

/**
 * Attaches Reanimated to one node whose Fabric node exists (`target.node`): view descriptors and mapper for `animatedStyle`
 * and for `animatedProps`, the inline-prop mapper, and the CSS manager. Safe to repeat; each call re-points descriptors at the latest shadow node
 * (a clone replaces the handle) and refreshes only what changed.
 */
export function attachAnimation(node: object): void {
  const record = records.get(node);
  const wrapper = record?.target.node;
  if (!record || !wrapper) return;
  const { tag, viewName } = record.target;
  syncLayoutConfigs(record, tag);
  const moved = record.wrapper !== wrapper;
  record.wrapper = wrapper;

  if (record.style) record.style = syncRuntime(record.style, record.wantsStyle, moved, tag, wrapper);
  if (record.props) record.props = syncRuntime(record.props, record.wantsProps, moved, tag, wrapper);

  if (record.wantsInline) {
    record.inline ??= new InlinePropManager();
    const info = { viewTag: tag, shadowNodeWrapper: wrapper as never };
    record.inline.attachInlineProps({ props: { style: record.rawStyle } }, info);
    if (moved) record.inline._inlinePropsViewDescriptors?.add({ tag, shadowNodeWrapper: wrapper as never });
  } else if (record.inline) {
    record.inline.detachInlineProps();
    record.inline = null;
  }

  if (record.css !== null || record.cssManager) {
    record.cssManager ??= new CSSManager({ shadowNodeWrapper: wrapper as never, viewTag: tag, reactViewName: viewName });
    if (record.cssChanged || record.first) record.cssManager.update((record.css ?? {}) as never);
    record.cssChanged = false;
  }
  record.first = false;
}

/**
 * Attaches one updater runtime (`animatedStyle` or `animatedProps`) to the node's shadow node: the descriptor re-pointed at a clone,
 * the mapper started again when the updaters changed. Returns the runtime, or null when the node no longer wants it (stopped).
 */
function syncRuntime(runtime: StyleRuntime, wanted: boolean, moved: boolean, tag: number, wrapper: object): StyleRuntime | null {
  if (!wanted) {
    stopStyle(runtime, tag);
    return null;
  }
  if (moved) runtime.descriptors.add({ tag, shadowNodeWrapper: wrapper as never });
  if (!sameList(runtime.updaters, runtime.mounted)) {
    if (runtime.mapperId !== null) stopMapper(runtime.mapperId);
    const updater = combine(runtime.updaters);
    const { descriptors, remoteState, active, animatedProps } = runtime;
    const shareable = descriptors.shareableViewDescriptors;
    const run = (forceUpdate?: boolean) => {
      "worklet";
      styleUpdater(shareable, updater, remoteState, active, forceUpdate, animatedProps);
    };
    runtime.mapperId = startMapper(run, runtime.updaters.flatMap((entry) => Object.values(entry.__closure ?? {})));
    runtime.mounted = runtime.updaters;
  }
  return runtime;
}

/** `exiting` and `layout` by view tag, once the shadow node exists and again whenever the prop changed; `undefined` removes a config. */
function syncLayoutConfigs(record: Record_, tag: number): void {
  for (const [key, type] of [["exiting", LayoutAnimationType.EXITING], ["layout", LayoutAnimationType.LAYOUT]] as const) {
    const next = record.layoutProps[key];
    if (next === record.layoutRegistered[key]) continue;
    updateLayoutAnimations(tag, type, next === undefined ? undefined : (maybeBuild(next) as never));
    record.layoutRegistered[key] = next;
  }
}

function stopStyle(style: StyleRuntime, tag: number): void {
  if (style.mapperId !== null) stopMapper(style.mapperId);
  style.mapperId = null;
  style.active.value = false;
  style.descriptors.remove(tag);
}

/**
 * Reanimated keeps the last animated props of every node in a registry (`UpdatesRegistry`) and empties a node's entry when
 * the node was marked removable and a mount finds it gone from the tree. A mapper's batch that was collected before the
 * node left (one per animated frame) is flushed into that registry one frame later, after the entry was emptied, and
 * puts it back with nothing left to remove it: the shadow node family, its props and a `folly::dynamic` stay for the life
 * of the process (about 1.4 KB for each of the ~10 % of removed tiles that had an update pending, measured under
 * `malloc_debug`). Marking the node again after that frame makes the next mount remove the late entry.
 */
const REMARK_AFTER_MS = 400;
let remarks: { wrapper: unknown; due: number }[] = [];
let remarkTimer: ReturnType<typeof setTimeout> | undefined;
function remark(): void {
  remarkTimer = undefined;
  const now = Date.now();
  const due = remarks.filter((entry) => entry.due <= now);
  remarks = remarks.filter((entry) => entry.due > now);
  if (remarks.length) remarkTimer = setTimeout(remark, Math.max(50, (remarks[0]?.due ?? now) - now));
  for (const entry of due) markNodeAsRemovable(entry.wrapper as never);
}
function markRemovable(wrapper: unknown): void {
  markNodeAsRemovable(wrapper as never);
  remarks.push({ wrapper, due: Date.now() + REMARK_AFTER_MS });
  if (remarkTimer === undefined) remarkTimer = setTimeout(remark, REMARK_AFTER_MS);
}

/** Stops the mapper, drops the view descriptors, cleans up CSS animations and transitions, and forgets the node. */
export function detachAnimation(node: object): void {
  const record = records.get(node);
  if (!record) return;
  records.delete(node);
  pending.delete(node);
  const { tag } = record.target;
  if (record.style) stopStyle(record.style, tag);
  if (record.props) stopStyle(record.props, tag);
  record.inline?.detachInlineProps();
  record.cssManager?.unmountCleanup();
  if (record.wrapper) markRemovable(record.wrapper);
}

/** Detaches every animated node for which `live` is false; the host calls it after commits that removed children. */
export function sweepAnimations(live: (node: never) => boolean): void {
  for (const node of [...records.keys()]) if (!live(node as never)) detachAnimation(node);
}
mark("animation");
