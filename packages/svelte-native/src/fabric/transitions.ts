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
 * - `cancel()` takes the animation off the node and has the node's own values written back (`restoreValues`: every key the animation wrote), until the UI thread has applied them (a mapper
 *   of its own tells JavaScript), and then lets the worklet go: Reanimated keeps the last values it wrote to a view, and the node must not stay where the animation left it.
 * - Reanimated also keeps those last values in a props registry, and puts them over the props of every later commit of the node (by shadow node family). So the first frame of the next
 *   animation, committed with the new layout, would be overruled by the last frame of the previous one until the mapper writes again: a frame of the new order with no inverse
 *   transform in a `flip`. When the node's own values are back, `forget` lets the registry go (`animation.ts`, `forgetAnimatedValues`), so the next commit is the node's alone, unless the node
 *   has animated values of its own (an `animatedStyle`, CSS animations, shared values in `style`) that the registry also holds: then it is left, and the keys the transition wrote were
 *   written back with the node's own values (`restoreValues`; `null` for a key the node has no value for, which resets it).
 *
 * Limits of that: the registry is released after the node's own values were written, not before, so a frame can still show the last frame of the animation that ended in two places. A reorder
 * made while a flip runs commits the new first frame, but the registry still holds the running flip's frame (the UI thread writes it each frame) and the commit hook puts it over that commit, so
 * the first frame of the new flip can show the old one's position for a frame. And for about three frames after an animation ends (the node's own values acknowledged by the UI thread, the
 * commit that takes the worklet away, the mount that lets the registry go) a reorder or a new animation starts from the registry's last frame too. Both show as a one-frame blip of an item, not as
 * a lasting wrong state: the mapper writes the right frame next.
 *
 * A flip also needs two commits: the new order, which the host commits when Svelte reads the layout of the new order (`getBoundingClientRect`), and the items' first frames, in the next
 * one (`host.ts`: `waitForAnimations` makes that one commit for the whole list). The Android engine applies each commit in a message of its own, and a frame drawn between the two showed the
 * new order untransformed, for a frame or two. The host asks the engine to hold its mounts at the first layout read and to apply them together after the second commit
 * (`holdMounts`, the engine's SPEC.md "Transaction order"). What remains is the first reorder after the app starts, which can still flash a frame or two while the animation layer runs
 * for the first time.
 */
import { cancelAnimation, Easing, makeMutable, startMapper, stopMapper, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { InstantAnimation, NativeNode, type AnimationOptions, type Keyframe, type NativeAnimation } from "../renderer.ts";
import { animationProps, detachAnimation } from "./animation.ts";
import { effectiveStyle, entriesToOps, type TransformOp } from "./dom-style.ts";
import { affectsLayout, hasTransform, parseKeyframes, restoreValues, sampleSpec, type Spec } from "./keyframes.ts";

type Values = Record<string, unknown>;
type Updater = () => Values;
type State = {
  /** Every animation of the node that was not cancelled and still has an effect: what `getAnimations()` returns. */
  animations: Set<Playback>;
  /** The ones that draw something, in the order they were made. */
  entries: Playback[];
  /** The node's own values for what a cancelled animation wrote, written until the UI thread has applied them. */
  restore: Values | null;
  /** Which restore is waited for: the acknowledgement of an older one means nothing. */
  generation: number;
  updater: Updater | null;
};

const warned = new Set<string>();
/** Something that cannot be played, once per `key`, in development. */
function warn(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof __DEV__ !== "undefined" && __DEV__) console.warn(`[Svelte transitions] ${message}`);
}

function stateOf(node: NativeNode): State {
  const dom = node.domState();
  dom.animation ??= { animations: new Set(), entries: [], restore: null, generation: 0, updater: null } satisfies State;
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
    this.invalidation = affectsLayout(spec) ? "props" : "animation";
    // Whatever can throw (the shared value, the animation) comes first, so that a failure leaves nothing registered on the node.
    if (!spec.empty && !spec.constant && spec.total > 0) {
      const progress = makeMutable(0);
      const done = () => this.finish();
      progress.value = withTiming(1, { duration: spec.total, easing: Easing.linear }, (finished) => {
        "worklet";
        if (finished) scheduleOnRN(done);
      });
      this.progress = progress;
    } else if (spec.total > 0) this.timer = setTimeout(() => this.finish(), spec.total);
    // `element.animate` returns before Svelte sets `onfinish`: an animation of no length finishes in a microtask, after the host has committed what it drew.
    else queueMicrotask(() => this.finish());
    const state = stateOf(node);
    state.animations.add(this);
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
    // A fill that does not hold the last keyframe (`none`, `backwards`) leaves no effect after the end: the node is its own again, as it is for a cancelled animation.
    if (!this.spec.forwards) release(this.node, this);
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

/** Takes an animation off its node and has the node's own values written back until the UI thread has applied them. */
function release(node: NativeNode, playback: Playback): void {
  const state = stateOf(node);
  state.animations.delete(playback);
  const at = state.entries.indexOf(playback);
  if (at < 0) return;
  state.entries.splice(at, 1);
  state.updater = null;
  const own = effectiveStyle(node.peekProps(), node.dom?.inline ?? null);
  state.restore = { ...state.restore, ...restoreValues(playback.spec, own) };
  node.invalidate(playback.invalidation);
  expectRestored(node, state);
}

/**
 * Waits until the UI thread has written `state.restore`, and then lets it go: the node's worklet stops, the node's committed props are its own, and Reanimated's registry forgets the
 * node's last values. Not a timer: a mapper of its own is started right after the host has committed the node (which started the node's mapper, with the restoring values: the two run in
 * the same frame, in this order), and tells JavaScript when it first runs.
 */
function expectRestored(node: NativeNode, state: State): void {
  const generation = ++state.generation;
  queueMicrotask(() => {
    if (state.generation !== generation || state.restore === null) return;
    let id = -1;
    const applied = () => {
      stopMapper(id);
      if (state.generation !== generation || state.restore === null) return;
      state.restore = null;
      state.updater = null;
      node.invalidate("props");
      // Forgetting is housekeeping: a node that cannot do it (no shadow node to make a ghost of) is no worse off than before, and the mapper's callback must not throw.
      try {
        if (state.entries.length === 0) node.forgetAnimated();
      } catch (error) {
        warn("forget", `Reanimated's last values of a node could not be released: ${String(error)}`);
      }
    };
    id = startMapper(() => {
      "worklet";
      scheduleOnRN(applied);
    }, []);
  });
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

let failed = false;
/** `element.animate(keyframes, options)` for a node. An animation that cannot be started (a shared value or an animation Reanimated refuses) ends at once, so that an outro still ends. */
export function animate(node: NativeNode, keyframes: readonly Keyframe[], options: AnimationOptions = {}): NativeAnimation {
  const spec = parseKeyframes(keyframes, options, warn);
  try {
    return new Playback(node, spec);
  } catch (error) {
    if (!failed) {
      failed = true;
      console.warn("[Svelte transitions] an animation could not be started with Reanimated, so it ends at once instead of playing", error);
    }
    return new InstantAnimation();
  }
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
  // Later worklets win. Over the node's own while an animation plays, as the animation draws the node; under it while the node's own values are only being written back (`restore`), because
  // a key the node's worklet writes is the node's own value, and the transition's default for it would show for the frames until the node's worklet writes it again.
  props.animatedStyle = own === undefined || own === null ? state.updater : state.entries.length === 0 ? [state.updater, own] : [own, state.updater];
  props.collapsable = false;
}

/**
 * The first shared value, animation and mapper of an app cost the JavaScript thread more than the next ones. An `animate:` would pay them between the commit that changes the tree and
 * the commit that starts its animations, which the screen shows as a frame of the changed tree with the items in their new places. The host calls this when it loads the animation
 * layer (the first layout read of a tree that is about to change, or the first animation), with an animation of a node that is on no screen, so that part of the cost is paid before.
 * What the first run of the native side and of the UI runtime's worklets costs cannot be paid here: the first reorder after an app starts can still show that frame.
 */
export function warmUp(): void {
  try {
    const spare = new NativeNode("element", "native-view");
    new Playback(spare, parseKeyframes([{ opacity: "0", transform: "translate(0px, 4px)" }, { opacity: "1", transform: "translate(0px, 0px)" }], { duration: 16, fill: "forwards" }, warn)).cancel();
    animationProps(spare, { tag: -1, viewName: "RCTView", node: null, propsDirty: false }, { animatedStyle: () => ({ opacity: 1 }) });
    detachAnimation(spare);
  } catch {
    // A failure surfaces with the first real animation, with its warning.
  }
}

/**
 * What the animations of a node draw it with now: the transform (as operations) and the origin it is about, when one of them has a track for it; null when none does, and the node's
 * own style is what it is drawn with. The committed tree does not have this (the UI thread draws it), so a layout read adds it (`getBoundingClientRect`).
 */
export function drawnTransform(node: NativeNode): { ops: TransformOp[] | null; origin: unknown } | null {
  const state = node.dom?.animation as State | null | undefined;
  if (!state?.entries.some((entry) => hasTransform(entry.spec) || entry.spec.keys.includes("transformOrigin"))) return null;
  const drawn: Values = {};
  for (const entry of state.entries) sampleSpec(entry.spec, entry.at(), drawn);
  return { ops: Array.isArray(drawn.transform) ? entriesToOps(drawn.transform as Record<string, number | string>[]) : null, origin: drawn.transformOrigin };
}
