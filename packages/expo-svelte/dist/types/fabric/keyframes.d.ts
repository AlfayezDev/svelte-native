/**
 * CSS keyframes as tracks, and the worklet that samples them.
 *
 * Svelte plays a transition or `animate:flip` through `element.animate(keyframes, options)`: an array of camelCased CSS property objects it has sampled from the transition's
 * `css(t, u)` (the easing is in the samples, so playback between two keyframes is linear). `parseKeyframes` turns that array into a `Spec`, one track per React Native style key, with
 * plain numbers and strings in it so it can be handed to the UI runtime; `sampleSpec` is the worklet that reads a spec at a progress and writes the values of that moment. The same
 * function runs on the JS thread (the first values of a node, the layout `getBoundingClientRect` reports while an animation moves a node) and in the mapper on the UI thread.
 *
 * What a track can be: a number (`opacity`, a length in px or a percentage, `height`, `paddingTop`, ...), a colour in hex, `rgb()`, `hsl()` or `transparent` (`backgroundColor`, ...; a name or `oklch()` is shown, not blended, with a warning), a transform list whose functions are the same in
 * every keyframe (`translate`, `scale`, `rotate`, `skew`, `perspective`), a transform list that is not (the keyframes are shown one after the other), or a string (shown one after the other).
 * What cannot be played is dropped with a warning and the rest plays: `filter` (React Native has no filter on a view for `blur`), the SVG stroke properties (`draw`), `matrix()` and the 3D
 * transform functions. `overflow` is not a track: Svelte also writes it to `element.style`, which a node applies for the length of the transition (`NativeNode.style`).
 */
import { type NativeTransform, type Unit } from "./dom-style.js";
export type Keyframe = Readonly<Record<string, string | number | null | undefined>>;
/** What Svelte passes to `element.animate`: `{ duration, fill: "forwards" }`. `delay` and the other fill modes are honoured too. */
export type AnimationOptions = {
    duration?: number;
    delay?: number;
    fill?: "none" | "forwards" | "backwards" | "both" | "auto";
};
type Scalar = {
    key: string;
    unit: "" | "%";
    values: number[];
};
type Colour = {
    key: string;
    values: number[][];
};
type Discrete = {
    key: string;
    values: unknown[];
};
export type Spec = {
    /** The number of keyframes, at least 1; they are evenly spaced over the active time (Svelte's offsets are). */
    frames: number;
    /** The style keys the tracks write. */
    keys: string[];
    scalars: Scalar[];
    colours: Colour[];
    discrete: Discrete[];
    /** The transform functions every keyframe has, and their values per keyframe (`transform[frame][op]`); null when there is no transform or the lists differ (`transforms`). */
    ops: {
        name: string;
        unit: Unit;
    }[] | null;
    transform: number[][] | null;
    transforms: NativeTransform[][] | null;
    delay: number;
    duration: number;
    /** `delay + duration`: the time the progress shared value runs from 0 to 1 over. */
    total: number;
    forwards: boolean;
    backwards: boolean;
    /** Nothing to draw: no keyframe has a property that can be played. */
    empty: boolean;
    /** Every track has the same value in every keyframe: the animation holds a state for its length and moves nothing. */
    constant: boolean;
};
/** Whether playing the spec changes layout (a length, a discrete value such as `position`), not only paint (opacity, transforms, colours). */
export declare function affectsLayout(spec: Spec): boolean;
export type Warn = (key: string, message: string) => void;
/** Reads `keyframes` and `options` as a `Spec`. Properties that cannot be played are reported through `warn` and left out. */
export declare function parseKeyframes(keyframes: readonly Keyframe[], options: AnimationOptions, report: Warn): Spec;
/**
 * Writes the values the spec has at `progress` (0 to 1 of `delay + duration`) into `out`, key by key: the style of that moment. Before the delay it writes nothing unless the fill is
 * backwards, and after the end nothing unless it is forwards, as a Web Animation does. Runs on the UI runtime and on the JS thread.
 */
export declare function sampleSpec(spec: Spec, progress: number, out: Record<string, unknown>): void;
/**
 * The values to write when an animation that wrote `spec` is cancelled, so the view goes back to what the node's own style says: opacity, transform and the origin to the style's (or the
 * defaults), and every other key to the style's value. Every key the animation wrote is in it: an animation cancelled in the middle (a `slide` turned around) has left lengths and colours
 * at values of its own. A key the node has no value for is `null`, never `undefined`: Reanimated's JSI conversion drops `undefined` and the registry then keeps what the animation wrote
 * (a `height` pinned half way), while `null` resets the prop. A colour cannot be `null` (it throws in the colour processor): the node's own, or `transparent` for `backgroundColor`;
 * another colour the node has no value for has no neutral one and is left out (it is released with the registry, `forgetAnimatedValues`).
 */
export declare function restoreValues(spec: Spec, natural: Readonly<Record<string, unknown>>): Record<string, unknown>;
/** Whether the spec writes a transform. */
export declare const hasTransform: (spec: Spec) => boolean;
export {};
