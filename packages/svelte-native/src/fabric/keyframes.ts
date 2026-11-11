/**
 * CSS keyframes as tracks, and the worklet that samples them.
 *
 * Svelte plays a transition or `animate:flip` through `element.animate(keyframes, options)`: an array of camelCased CSS property objects it has sampled from the transition's
 * `css(t, u)` (the easing is in the samples, so playback between two keyframes is linear). `parseKeyframes` turns that array into a `Spec`, one track per React Native style key, with
 * plain numbers and strings in it so it can be handed to the UI runtime; `sampleSpec` is the worklet that reads a spec at a progress and writes the values of that moment. The same
 * function runs on the JS thread (the first values of a node, the layout `getBoundingClientRect` reports while an animation moves a node) and in the mapper on the UI thread.
 *
 * What a track can be: a number (`opacity`, a length in px or a percentage, `height`, `paddingTop`, ...), a colour in hex or `rgb()` (`backgroundColor`, ...), a transform list whose functions are the same in
 * every keyframe (`translate`, `scale`, `rotate`, `skew`, `perspective`), a transform list that is not (the keyframes are shown one after the other), or a string (shown one after the other).
 * What cannot be played is dropped with a warning and the rest plays: `filter` (React Native has no filter on a view for `blur`), the SVG stroke properties (`draw`), `matrix()` and the 3D
 * transform functions. `overflow` is not a track: Svelte also writes it to `element.style`, which a node applies for the length of the transition (`NativeNode.style`).
 */
import { nativeTransform, parseLength, parseTransform, transformOps, type NativeTransform, type Unit } from "./dom-style.ts";

export type Keyframe = Readonly<Record<string, string | number | null | undefined>>;
/** What Svelte passes to `element.animate`: `{ duration, fill: "forwards" }`. `delay` and the other fill modes are honoured too. */
export type AnimationOptions = { duration?: number; delay?: number; fill?: "none" | "forwards" | "backwards" | "both" | "auto" };

type Scalar = { key: string; unit: "" | "%"; values: number[] };
type Colour = { key: string; values: number[][] };
type Discrete = { key: string; values: unknown[] };
export type Spec = {
  /** The number of keyframes, at least 1; they are evenly spaced over the active time (Svelte's offsets are). */
  frames: number;
  /** The style keys the tracks write. */
  keys: string[];
  scalars: Scalar[];
  colours: Colour[];
  discrete: Discrete[];
  /** The transform functions every keyframe has, and their values per keyframe (`transform[frame][op]`); null when there is no transform or the lists differ (`transforms`). */
  ops: { name: string; unit: Unit }[] | null;
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

/** Reports a property or function that cannot be played, once per `key`. */
const PAINT_ONLY = /^(?:opacity|transform)$|(?:^|[a-z])Color$|^color$/;
/** Whether playing the spec changes layout (a length, a discrete value such as `position`), not only paint (opacity, transforms, colours). */
export function affectsLayout(spec: Spec): boolean {
  return spec.keys.some((key) => !PAINT_ONLY.test(key));
}

export type Warn = (key: string, message: string) => void;

const META = new Set(["offset", "easing", "composite", "computedOffset"]);
const UNSUPPORTED = /^(?:filter|backdropFilter|clipPath|mask.*|stroke.*|fill.*|cssFloat|cssOffset)$/;
const COLOUR_KEY = /(?:^|[a-z])Color$|^color$/;

/** `#rgb`, `#rrggbb`, `#rrggbbaa` and `rgb()` / `rgba()` (commas or spaces, `/` before the alpha) as [r, g, b, a], or null: the colours a keyframe can have that are played (a name is shown as it is). */
const parseChannels = (css: string): number[] | null => {
  const text = css.trim().toLowerCase();
  const hex = /^#([\da-f]{3,8})$/.exec(text)?.[1];
  if (hex !== undefined && (hex.length === 3 || hex.length === 4 || hex.length === 6 || hex.length === 8)) {
    const wide = hex.length <= 4 ? [...hex].map((digit) => digit + digit) : (hex.match(/../g) as string[]);
    const [r, g, b, a] = wide.map((pair) => parseInt(pair, 16));
    return [r as number, g as number, b as number, a === undefined ? 1 : a / 255];
  }
  const functional = /^rgba?\(\s*([^)]*)\)$/.exec(text)?.[1];
  if (functional === undefined) return null;
  const parts = functional.split(/[\s,/]+/).filter((part) => part !== "");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const values = parts.map((part, at) => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(part)) return Number.NaN;
    const value = Number.parseFloat(part);
    return part.endsWith("%") ? (at === 3 ? value / 100 : (value * 255) / 100) : value;
  });
  return values.some((value) => Number.isNaN(value)) ? null : [values[0] as number, values[1] as number, values[2] as number, values[3] ?? 1];
};

/** The same list with every missing (`undefined`) entry replaced by the nearest one before it, or after it for the first ones. */
function fillGaps<T>(values: (T | undefined)[]): T[] | null {
  const firstDefined = values.find((value) => value !== undefined);
  if (firstDefined === undefined) return null;
  let previous = firstDefined;
  return values.map((value) => (previous = value === undefined ? previous : value));
}

const same = (values: readonly unknown[]): boolean => values.every((value) => value === values[0]);

/** Reads `keyframes` and `options` as a `Spec`. Properties that cannot be played are reported through `warn` and left out. */
export function parseKeyframes(keyframes: readonly Keyframe[], options: AnimationOptions, report: Warn): Spec {
  const told = new Set<string>();
  const warn: Warn = (key, message) => { if (!told.has(key)) { told.add(key); report(key, message); } };
  const delay = Math.max(0, Number(options.delay ?? 0) || 0);
  const duration = Math.max(0, Number(options.duration ?? 0) || 0);
  const fill = options.fill;
  const spec: Spec = {
    frames: Math.max(1, keyframes.length), keys: [], scalars: [], colours: [], discrete: [], ops: null, transform: null, transforms: null,
    delay, duration, total: delay + duration, forwards: fill === "forwards" || fill === "both", backwards: fill === "backwards" || fill === "both", empty: true, constant: true,
  };
  const names = new Set<string>();
  for (const frame of keyframes) for (const key in frame) if (!META.has(key)) names.add(key);
  for (const key of names) {
    const raw = keyframes.map((frame) => frame[key] ?? undefined);
    if (key === "overflow") continue;
    if (UNSUPPORTED.test(key)) {
      warn(key, key === "filter" ? "`filter` (the blur of `transition:blur`) is not played on a native view; the rest of the transition is" : `\`${key}\` cannot be animated on a native view and is left out`);
      continue;
    }
    if (key === "transform") addTransform(spec, raw, warn);
    else addProperty(spec, key, raw, warn);
  }
  spec.empty = spec.keys.length === 0;
  spec.constant = spec.scalars.every((track) => same(track.values))
    && spec.colours.every((track) => track.values.every((channels) => channels.every((value, at) => value === (track.values[0] as number[])[at])))
    && spec.discrete.every((track) => same(track.values))
    && (spec.transform === null || spec.transform.every((row) => row.every((value, at) => value === (spec.transform as number[][])[0]?.[at])))
    && (spec.transforms === null || spec.transforms.every((list) => JSON.stringify(list) === JSON.stringify((spec.transforms as NativeTransform[][])[0])));
  return spec;
}

function addTransform(spec: Spec, raw: (string | number | undefined)[], warn: Warn): void {
  const lists = raw.map((value) => {
    if (typeof value !== "string") return undefined;
    const parsed = parseTransform(value);
    for (const name of parsed.unsupported) warn(`transform:${name}`, `the transform function \`${name}\` is not played on a native view and is left out`);
    return parsed.ops;
  });
  const filled = fillGaps(lists);
  if (filled === null) return;
  const signature = (ops: readonly { name: string; unit: Unit }[]) => ops.map((op) => `${op.name}:${op.unit}`).join(" ");
  const first = filled[0] as typeof filled[number];
  if (filled.every((ops) => signature(ops) === signature(first))) {
    if (first.length === 0) return;
    spec.ops = first.map(({ name, unit }) => ({ name, unit }));
    spec.transform = filled.map((ops) => ops.map((op) => op.value));
  } else spec.transforms = filled.map((ops) => nativeTransform(ops));
  spec.keys.push("transform");
}

function addProperty(spec: Spec, key: string, raw: (string | number | undefined)[], warn: Warn): void {
  if (raw.every((value) => value === undefined)) return;
  const lengths = raw.map((value) => (value === undefined ? undefined : parseLength(value)));
  const defined = lengths.filter((entry) => entry !== undefined);
  if (defined.every((entry) => entry !== null)) {
    const units = new Set(defined.map((entry) => (entry as { unit: string }).unit));
    if (units.size > 1) { warn(key, `\`${key}\` mixes a percentage and a length between keyframes and is left out`); return; }
    const values = fillGaps(lengths.map((entry) => entry?.value));
    if (values === null) return;
    spec.scalars.push({ key, unit: [...units][0] as "" | "%", values });
    spec.keys.push(key);
    return;
  }
  const texts = raw.map((value) => (value === undefined ? undefined : String(value).trim()));
  if (COLOUR_KEY.test(key)) {
    const channels = texts.map((text) => (text === undefined ? undefined : parseChannels(text) ?? undefined));
    const filled = channels.every((entry, at) => entry !== undefined || texts[at] === undefined) ? fillGaps(channels) : null;
    if (filled) { spec.colours.push({ key, values: filled }); spec.keys.push(key); return; }
  }
  const values = fillGaps(texts);
  if (values === null) return;
  spec.discrete.push({ key, values });
  spec.keys.push(key);
}

/**
 * Writes the values the spec has at `progress` (0 to 1 of `delay + duration`) into `out`, key by key: the style of that moment. Before the delay it writes nothing unless the fill is
 * backwards, and after the end nothing unless it is forwards, as a Web Animation does. Runs on the UI runtime and on the JS thread.
 */
export function sampleSpec(spec: Spec, progress: number, out: Record<string, unknown>): void {
  "worklet";
  const time = progress * spec.total;
  let local: number;
  if (time < spec.delay) {
    if (!spec.backwards) return;
    local = 0;
  } else if (time >= spec.delay + spec.duration) {
    if (!spec.forwards) return;
    local = 1;
  } else local = (time - spec.delay) / spec.duration;
  const last = spec.frames - 1;
  let index = 0;
  let fraction = 0;
  if (last > 0) {
    const at = local * last;
    index = Math.floor(at);
    if (index >= last) { index = last - 1; fraction = 1; } else fraction = at - index;
  }
  const next = last > 0 ? index + 1 : index;
  for (let i = 0; i < spec.scalars.length; i++) {
    const track = spec.scalars[i] as Scalar;
    const from = track.values[index] as number;
    const value = from + ((track.values[next] as number) - from) * fraction;
    out[track.key] = track.unit === "%" ? `${value}%` : value;
  }
  for (let i = 0; i < spec.colours.length; i++) {
    const track = spec.colours[i] as Colour;
    const from = track.values[index] as number[];
    const to = track.values[next] as number[];
    const channel = (at: number) => (from[at] as number) + ((to[at] as number) - (from[at] as number)) * fraction;
    out[track.key] = `rgba(${Math.round(channel(0))}, ${Math.round(channel(1))}, ${Math.round(channel(2))}, ${channel(3)})`;
  }
  for (let i = 0; i < spec.discrete.length; i++) {
    const track = spec.discrete[i] as Discrete;
    out[track.key] = track.values[fraction < 0.5 ? index : next];
  }
  const ops = spec.ops;
  if (ops !== null && spec.transform !== null) {
    const from = spec.transform[index] as number[];
    const to = spec.transform[next] as number[];
    const entries: Record<string, number | string>[] = [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i] as { name: string; unit: Unit };
      const value = (from[i] as number) + ((to[i] as number) - (from[i] as number)) * fraction;
      const entry: Record<string, number | string> = {};
      entry[op.name] = op.unit === "" ? value : op.unit === "%" ? `${value}%` : `${value}deg`;
      entries.push(entry);
    }
    out.transform = entries;
  } else if (spec.transforms !== null) out.transform = spec.transforms[fraction < 0.5 ? index : next];
}

const SIZES = new Set(["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "top", "left", "right", "bottom"]);

/**
 * The values to write when an animation that wrote `spec` is cancelled, so the view goes back to what the node's own style says: opacity and transform to the style's (or the defaults),
 * the origin, a size (`height`, `width`, ...) and a colour to the style's, which may be nothing (`undefined`: a `height` the animation pinned is released). The paddings, margins and border
 * widths a `slide` animates end where the style has them, so they are left as the last keyframe wrote them.
 */
export function restoreValues(spec: Spec, natural: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of spec.keys) {
    if (key === "opacity") out.opacity = typeof natural.opacity === "number" ? natural.opacity : 1;
    else if (key === "transform") out.transform = nativeTransform(transformOps(natural.transform));
    else if (key === "transformOrigin") out.transformOrigin = natural.transformOrigin ?? "50% 50%";
    else if (SIZES.has(key) || COLOUR_KEY.test(key)) out[key] = natural[key];
  }
  return out;
}

/** Whether the spec writes a transform. */
export const hasTransform = (spec: Spec): boolean => spec.ops !== null || spec.transforms !== null;
