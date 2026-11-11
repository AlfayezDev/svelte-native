/**
 * What the transition checks of the native checks lab expect (`/__dev`, "Run all checks": `transition-lab.ts` runs them on the elements of `TransitionsScreen.svelte`). No React Native import, so the
 * harness's tests load it (`qa/test/transition-checks.test.ts` holds the expectations against readings that are right and wrong, `qa/test/transition-probe.test.ts` runs the whole flow against the real host
 * and Reanimated's paths).
 *
 * Svelte's `in:`, `out:`, `transition:` and `animate:flip` on an element are played by the host on the UI thread (`fabric/transitions.ts`): the element gets an `animatedStyle` worklet that a mapper of
 * Reanimated runs, a shared value is the progress, and when the animation is over (or cancelled) the host writes the element's own values back, takes the worklet away and lets Reanimated's registry of the
 * element's last values go. What the checks read of that is what the host and Reanimated hold for the element, not a copy of the logic: `getAnimations()` and its `currentTime` (the shared value's value, read from
 * the UI runtime), the animation state the host keeps on the node (`dom.animation`: the animations that draw, the values it is writing back), the props the host built the view with (`hostState`) and the box of
 * the committed tree that React Native reports for the view (`nativeFabricUIManager.getBoundingClientRect`, with and without the committed transform, which has Reanimated's last values over it).
 */

/** The durations the screen gives its transitions (ms), shared so the checks wait for what the screen plays. */
export const times = { fade: 400, fly: 600, flip: 500, slide: 1200 } as const;

/** The names of the transition checks, in the order the lab runs them: `qa/test/class-checks.test.ts` pins their number and their length (logcat cuts the lab's result line near 4 KB). */
export const transitionCheckNames = [
  "intro ends: the node's own props",
  "outro keeps the node until its end",
  "flip ends in identity, new order",
  "reversed intro removes the node",
  "animation runs while JS is blocked",
] as const;

export type Verdict = { passed: boolean; detail: string };
const verdict = (passed: boolean, detail: string): Verdict => ({ passed, detail: passed ? "" : detail });
const json = (value: unknown): string => JSON.stringify(value) ?? "undefined";
/** Distance in px under which two boxes are the same one (a transform that is not identity moves a box by more). */
export const tolerance = 0.5;

/** What the lab reads of an element whose animations are over: the host's state for it and the committed tree's box. */
export type Settled = {
  /** `getAnimations().length`: the animations that were not cancelled. */
  animations: number;
  /** The animations that draw the node (`dom.animation.entries`) and whether the values it writes back are still pending (`restore`). */
  drawing: number;
  restoring: boolean;
  /** What the host built the view with: whether it still has an `animatedStyle` worklet, and its style's `opacity` and `transform`. */
  animated: boolean;
  opacity: unknown;
  transform: unknown;
  /** How far the committed box with its transform is from the one without it (px), null when the binding cannot read it. */
  moved: number | null;
};
const isIdentityTransform = (transform: unknown): boolean => transform === undefined || transform === null || (Array.isArray(transform) && transform.length === 0);

const said = (settled: Settled): string =>
  `animations ${settled.animations}, drawing ${settled.drawing}, restore ${settled.restoring}, animatedStyle ${settled.animated}, opacity ${json(settled.opacity)}, transform ${json(settled.transform)}, moved ${settled.moved}`;

const own = (settled: Settled): boolean =>
  settled.animations === 0 && settled.drawing === 0 && !settled.restoring && !settled.animated && (settled.opacity === undefined || settled.opacity === 1) && isIdentityTransform(settled.transform)
  && settled.moved !== null && settled.moved < tolerance;

/** What each check asks of what it read. A function answers whether the reading is right, with a message for when it is not (empty when it is). */
export const expectations = {
  /** [ended] counts the intro's `introend`; [settled] is the element a moment after it: its props are its own, no animation or worklet left, no transform in the committed tree. */
  intro: (ended: number, settled: Settled | null): Verdict =>
    verdict(ended === 1 && !!settled && own(settled), `introend ${ended}; ${settled ? said(settled) : "the element is not mounted"}`),

  /** The outro of [duration] ms: the node was still attached at half of it, `outroend` came once, and the node left no sooner than the duration and not much later ([elapsed] is null when it never left). */
  outro: (present: boolean, ended: number, elapsed: number | null, duration: number): Verdict =>
    verdict(present && ended === 1 && elapsed !== null && elapsed >= duration - 100 && elapsed <= duration + 1500,
      `attached at half ${present}; outroend ${ended}; the node left after ${elapsed === null ? "never" : `${Math.round(elapsed)} ms`} of ${duration}`),

  /** The flip: it [played] (an item was drawn off its layout box while it ran), then every item's animations are over and its committed box is the layout box, and the layout is in the new order. */
  flip: (played: boolean, items: { id: number; animations: number; moved: number | null }[], expected: number[], got: number[]): Verdict =>
    verdict(played && items.length === expected.length && items.every((item) => item.animations === 0 && item.moved !== null && item.moved < tolerance) && json(got) === json(expected),
      `flip played ${played}; ${items.map((item) => `item ${item.id}: animations ${item.animations}, moved ${item.moved}`).join("; ")}; order ${json(got)}, wanted ${json(expected)}`),

  /** The reversal: the intro was running when the element was hidden ([midway]), `outroend` came, the node left, and nothing is left to be written back ([restoring]). */
  reversed: (midway: boolean, ended: number, removed: boolean, restoring: boolean): Verdict =>
    verdict(midway && ended === 1 && removed && !restoring, `intro running at the reversal ${midway}; outroend ${ended}; node removed ${removed}; restore pending ${restoring}`),

  /** The animation's progress (the shared value, from the UI runtime) read before and after the JS thread was blocked for [elapsed] ms: it kept moving, as much as the blocked time, and had not just run out. */
  busy: (before: number | null, after: number | null, elapsed: number, total: number): Verdict =>
    verdict(before !== null && after !== null && before > 0 && elapsed >= 250 && after - before >= 0.6 * elapsed && before + elapsed < total,
      `progress ${before} -> ${after} ms of ${total} over ${Math.round(elapsed)} ms of blocked JS`),
};
