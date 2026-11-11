/**
 * Svelte's transitions and `animate:flip`, played on the UI thread.
 *
 * Svelte drives every transition and every FLIP through `element.animate(keyframes, options)` (see `keyframes.ts`). `NativeNode.animate` lands here: the keyframes become a `Spec`, and
 * the animation is played with Reanimated the way the rest of the animation layer plays a node's `animatedStyle` (`animation.ts`):
 *
 * - One progress shared value per animation, animated `withTiming(1)` over `delay + duration` with a linear easing (the keyframes carry the easing), and one `animatedStyle` worklet per
 *   node that samples every animation the node has (`sampleSpec`, later animations over earlier ones, as the Web Animations composite does) at its progress. The host adds that worklet
 *   to the node's attributes when it builds the node (`injectAnimations`), so the node goes through `animationProps` and `commitAnimations` like an `AnimatedView`: its first commit
 *   already has the values of the first frame (an `in:` that starts at opacity 0 never shows the node whole), and the mapper writes to the view on the UI thread each frame.
 * - Finishing is a `withTiming` callback on the UI runtime that calls back to JS (`scheduleOnRN`): `onfinish` runs on the JS thread, and `playState` is `finished`. `currentTime` reads the
 *   shared value, which is what Svelte turns an `in:` into an `out:` from.
 * - An animation that moves nothing (a `fade`'s dummy delay, a hold of the first keyframe while a `delay` runs, a `tick`-only transition's clock) needs no shared value: it is a timer, and
 *   its values (if any) are held by the same worklet.
 * - `cancel()` takes the animation off the node and writes the node's own values back for a moment (`restoreValues`), then lets the worklet go: Reanimated keeps the last values it wrote to
 *   a view, and the node must not stay where the animation left it.
 */
import { cancelAnimation, Easing, makeMutable, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { AnimationOptions, Keyframe, NativeAnimation, NativeNode } from "../renderer.ts";
import { effectiveStyle, type Rect } from "./dom-style.ts";
import { affectsLayout, hasTransform, parseKeyframes, restoreValues, sampleSpec, type Spec } from "./keyframes.ts";

type Values = Record<string, unknown>;
type Updater = () => Values;
type State = {
  /** Every animation of the node that was not cancelled: what `getAnimations()` returns. */
  animations: Set<Playback>;
  /** The ones that draw something, in the order they were made. */
  entries: Playback[];
  /** The node's own values for what a cancelled animation wrote, written until `settle`. */
  restore: Values | null;
  timer: ReturnType<typeof setTimeout> | null;
  updater: Updater | null;
};

/** How long a cancelled animation's restoring values stay in the node's worklet: long enough for the mapper to run on the UI thread once, whatever frame rate the screen has. */
const RESTORE_MS = 120;

const warned = new Set<string>();
function warn(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[Svelte transitions] ${message}`);
}

function stateOf(node: NativeNode): State {
  const dom = node.domState();
  dom.animation ??= { animations: new Set(), entries: [], restore: null, timer: null, updater: null } satisfies State;
  return dom.animation as State;
}

const now = () => performance.now();

class Playback implements NativeAnimation {
  onfinish: ((event?: unknown) => void) | null = null;
  effect: unknown = {};
  playState: "idle" | "running" | "finished" = "running";
  readonly progress: SharedValue<number> | null = null;
  /** How adding or removing this animation invalidates the node: `animation` when it only paints, so a layout read made meanwhile commits nothing (`animate:` reads one per item). */
  readonly invalidation: "props" | "animation";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly startedAt = now();

  constructor(private readonly node: NativeNode, readonly spec: Spec) {
    const state = stateOf(node);
    this.invalidation = affectsLayout(spec) ? "props" : "animation";
    state.animations.add(this);
    if (!spec.empty && !spec.constant && spec.total > 0) {
      const progress = makeMutable(0);
      this.progress = progress;
      const done = () => this.finish();
      progress.value = withTiming(1, { duration: spec.total, easing: Easing.linear }, (finished) => {
        "worklet";
        if (finished) scheduleOnRN(done);
      });
    } else if (spec.total > 0) this.timer = setTimeout(() => this.finish(), spec.total);
    // `element.animate` returns before Svelte sets `onfinish`: an animation of no length finishes in a microtask, after the host has committed what it drew.
    else queueMicrotask(() => this.finish());
    if (!spec.empty) {
      state.entries.push(this);
      state.updater = null;
      node.invalidate(this.invalidation);
    }
  }

  get currentTime(): number | null {
    if (this.playState === "idle") return null;
    if (this.playState === "finished") return this.spec.total;
    if (this.progress !== null) return Math.min(1, Math.max(0, this.progress.value)) * this.spec.total;
    return Math.min(now() - this.startedAt, this.spec.total);
  }

  finish(): void {
    if (this.playState !== "running") return;
    this.playState = "finished";
    this.timer = null;
    this.onfinish?.();
  }

  cancel(): void {
    if (this.playState === "idle") return;
    this.playState = "idle";
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.progress !== null) cancelAnimation(this.progress);
    release(this.node, this);
  }

  /** The progress the node is drawn at: the shared value, 1 for an animation that only holds. */
  at(): number { return this.progress === null ? 1 : this.progress.value; }
}

/** Takes an animation off its node and puts the node's own values back, for `RESTORE_MS`. */
function release(node: NativeNode, playback: Playback): void {
  const state = stateOf(node);
  state.animations.delete(playback);
  const at = state.entries.indexOf(playback);
  if (at < 0) return;
  state.entries.splice(at, 1);
  state.updater = null;
  const own = effectiveStyle(node.peekProps(), node.dom?.inline ?? null);
  state.restore = { ...state.restore, ...restoreValues(playback.spec, own) };
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    state.restore = null;
    state.updater = null;
    node.invalidate("props");
  }, RESTORE_MS);
  node.invalidate(playback.invalidation);
}

/**
 * The node's `animatedStyle` worklet for its animations now: the values it had put back (`restore`), then each animation sampled at its progress. One function per set of animations; the
 * shared values it reads are what its mapper listens to. Built here and not in a closure over `this`, so that what it captures is plain data and shared values.
 */
function makeUpdater(entries: readonly Playback[], restore: Values | null): Updater {
  const packed = entries.map((entry) => ({ spec: entry.spec, progress: entry.progress }));
  return () => {
    "worklet";
    const out: Values = {};
    if (restore !== null) for (const key in restore) out[key] = restore[key];
    for (let i = 0; i < packed.length; i++) {
      const entry = packed[i] as (typeof packed)[number];
      sampleSpec(entry.spec, entry.progress === null ? 1 : entry.progress.value, out);
    }
    return out;
  };
}

/** `element.animate(keyframes, options)` for a node. */
export function animate(node: NativeNode, keyframes: readonly Keyframe[], options: AnimationOptions = {}): NativeAnimation {
  return new Playback(node, parseKeyframes(keyframes, options, warn));
}

export function getAnimations(node: NativeNode): NativeAnimation[] {
  const state = node.dom?.animation as State | null | undefined;
  return state ? [...state.animations] : [];
}

/**
 * Adds the node's animations to the attributes the host builds it from: `animatedStyle` (after the node's own, which a later worklet overrides), and `collapsable: false`, because a view
 * that Fabric flattens away has nothing for the mapper to write to.
 */
export function injectAnimations(node: NativeNode, props: Record<string, unknown>): void {
  const state = node.dom?.animation as State | null | undefined;
  if (!state) return;
  if (state.updater === null) {
    if (state.entries.length === 0 && state.restore === null) return;
    state.updater = makeUpdater(state.entries, state.restore);
  }
  const own = props.animatedStyle;
  props.animatedStyle = own === undefined || own === null ? state.updater : [own, state.updater];
  props.collapsable = false;
}

/** Whether an animation of the node draws a transform now (so the committed tree, which has the node's own, is not where it is). */
export function drivesTransform(node: NativeNode): boolean {
  const state = node.dom?.animation as State | null | undefined;
  return state?.entries.some((entry) => hasTransform(entry.spec)) === true;
}

/** The box of a node that an animation is moving: `rect` (its layout box) with the translation and the scale the animations draw it with now, about its centre, as the DOM's `getBoundingClientRect` reports it. */
export function compensate(node: NativeNode, rect: Rect): Rect {
  const state = node.dom?.animation as State | null | undefined;
  if (!state) return rect;
  const drawn: Values = {};
  for (const entry of state.entries) sampleSpec(entry.spec, entry.at(), drawn);
  if (!Array.isArray(drawn.transform)) return rect;
  let tx = 0;
  let ty = 0;
  let sx = 1;
  let sy = 1;
  for (const entry of drawn.transform as Record<string, number | string>[]) {
    for (const name in entry) {
      const value = entry[name] as number | string;
      const percent = typeof value === "string" && value.endsWith("%");
      const amount = typeof value === "number" ? value : Number.parseFloat(value);
      if (name === "translateX") tx += sx * (percent ? (amount / 100) * rect.width : amount);
      else if (name === "translateY") ty += sy * (percent ? (amount / 100) * rect.height : amount);
      else if (name === "scale") { sx *= amount; sy *= amount; }
      else if (name === "scaleX") sx *= amount;
      else if (name === "scaleY") sy *= amount;
    }
  }
  const width = rect.width * sx;
  const height = rect.height * sy;
  return { x: rect.x + rect.width / 2 + tx - width / 2, y: rect.y + rect.height / 2 + ty - height / 2, width, height };
}
