/**
 * Colour helpers of the native-view library checks (`foreign-libraries-checks.ts`, SPEC.md, "Device verification of the libraries"): the
 * pixels a capture of a view holds, as `SvelteQaPixels.sample` reads them, against the colour a prop says they must have. No React Native
 * import, so the harness's tests load it.
 */

export type Argb = { a: number; r: number; g: number; b: number };

/** The ARGB integer `SvelteQaPixels.sample` answers (a signed 32-bit number from the native side, any 32-bit number here) as its four channels. */
export function argb(value: number): Argb {
  const v = value >>> 0;
  return { a: (v >>> 24) & 255, r: (v >>> 16) & 255, g: (v >>> 8) & 255, b: v & 255 };
}

/** `#rrggbb` as opaque channels. */
export function hex(color: string): Argb {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match?.[1]) throw new Error(`not a #rrggbb colour: ${color}`);
  const n = parseInt(match[1], 16);
  return { a: 255, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** The largest difference of one colour channel (red, green, blue), 0 to 255. */
export function distance(first: Argb, second: Argb): number {
  return Math.max(Math.abs(first.r - second.r), Math.abs(first.g - second.g), Math.abs(first.b - second.b));
}

/** Whether a pixel is opaque and within [tolerance] of [expected] in every channel. */
export function near(pixel: number, expected: string, tolerance = 40): boolean {
  const found = argb(pixel);
  return found.a >= 250 && distance(found, hex(expected)) <= tolerance;
}

/** `#rrggbb` (and `/aa` when it is not opaque) for a message. */
export function show(pixel: number): string {
  const { a, r, g, b } = argb(pixel);
  const digits = [r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
  return a === 255 ? `#${digits}` : `#${digits}/${a}`;
}

/** Whether a pixel is transparent (a hole, a clipped corner, a shadow-free background of a capture). */
export const clear = (pixel: number): boolean => argb(pixel).a <= 4;

/** Whether a pixel is opaque (a view drew there). */
export const solid = (pixel: number): boolean => argb(pixel).a >= 250;

/**
 * The first number in a text (`count 23` -> 23), or null: the animated text's native string is read as a number to say whether it advanced.
 */
export function numberIn(text: string | null | undefined): number | null {
  const match = /-?\d+(?:\.\d+)?/.exec(text ?? "");
  return match ? Number(match[0]) : null;
}

/**
 * Takes [take] again, [every] ms apart, until [wanted] holds for what it gave or [ms] have passed since the first call, and answers the last result with how many calls it took and how long
 * it waited. A library that says it has loaded or is playing before its first frame has reached a capture (Rive's `onPlay` comes when the file is set up, not when a frame is drawn) is
 * waited for; a view that never draws still ends with its last result, for the check to name. A [take] that gives null (a capture that failed or gave no pixels) ends it at once: that is
 * not lateness. With no time ([ms] 0) it is one call.
 */
export async function untilTaken<T>(
  take: () => Promise<T | null>,
  wanted: (taken: T) => boolean,
  ms: number,
  pause: (milliseconds: number) => Promise<void>,
  every = 400,
  now: () => number = Date.now,
): Promise<{ taken: T | null; calls: number; waited: number }> {
  const start = now();
  for (let calls = 1; ; calls++) {
    const taken = await take();
    const waited = now() - start;
    if (taken === null || wanted(taken) || waited >= ms) return { taken, calls, waited };
    await pause(every);
  }
}

/**
 * What a capture of Rive's artboard must show at points away from each other: opaque at every point (the view drew there) and the artboard's own pink (`#d62a5c`, red high and
 * green low) at one of them, because the truck drives over the middle. The settle loop of the capture check and the check that reads the capture ask this one question, so the loop
 * waits for what the check will assert.
 */
export function riveBackdrop(colors: readonly number[]): boolean {
  return colors.length > 0 && colors.every(solid) && colors.some((pixel) => argb(pixel).r > 200 && argb(pixel).g < 110);
}

/** The points of Rive's box (fractions of the capture) that the capture check and the fit check read in the middle: the same three, so that a fit is judged on the pixels the first check already found painted. */
export const riveMiddle: readonly (readonly [number, number])[] = [[0.5, 0.5], [0.45, 0.4], [0.55, 0.6]];
/** The points on the two sides of the box, where `fit: contain` leaves a wide box bare and `fit: fill` paints the artboard. */
export const riveSides: readonly (readonly [number, number])[] = [[0.05, 0.5], [0.95, 0.5]];

/** The `fit` values the fit check puts on the animation. */
export type RiveFit = "contain" | "fill";

/** Whether a side of the box is bare, as `fit: contain` leaves it: transparent (what the views of every run showed), or, as the check always allowed, an opaque white or dark pixel. */
export const riveSideBare = (pixel: number): boolean => !solid(pixel) || near(pixel, "#ffffff", 20) || argb(pixel).r < 150;

/**
 * Whether a capture of Rive's box shows a painted frame of [fit]; [colors] are the pixels at `riveSides`, then at `riveMiddle`. A TextureView that has not been drawn into yet captures
 * transparent at every point, and for `contain` that is also what the sides look like, so a frame only counts as the view's when its middle is opaque:
 * - `contain`: the middle is opaque (the view drew) and the sides are bare (the artboard keeps its proportions).
 * - `fill`: the sides are opaque and the artboard's pink (red high): the artboard is stretched to the box.
 * The settle loop of the fit check and the check that judges what it ended with ask this one question, so a never-painted view fails and so does a wrong fit.
 */
export function riveFitPainted(fit: RiveFit, colors: readonly number[]): boolean {
  const sides = colors.slice(0, riveSides.length);
  const middle = colors.slice(riveSides.length);
  if (sides.length < riveSides.length) return false;
  if (fit === "contain") return middle.length > 0 && middle.every(solid) && sides.every(riveSideBare);
  return sides.every(solid) && argb(sides[0] ?? 0).r > 150;
}

/** What a settled capture took, as the lab's detail says it: the capture that ended the wait and how long the wait was. */
export const tookNote = (calls: number, waited: number): string => `on capture ${calls}, ${waited} ms in`;

/** The detail of one fit of the fit check: the pixels ([colors] as for `riveFitPainted`), and whether they are a painted frame of [fit] and how long it took to get there. */
export function riveFitDetail(fit: RiveFit, colors: readonly number[], calls: number, waited: number): string {
  const sides = colors.slice(0, riveSides.length).map(show).join(" ");
  const middle = colors.slice(riveSides.length).map(show).join(" ");
  return `${fit} sides ${sides}, middle ${middle} | ${riveFitPainted(fit, colors) ? `painted ${tookNote(calls, waited)}` : `not painted as ${fit} after ${calls} captures, ${waited} ms`}`;
}

/**
 * Whether [wanted] (event name and detail) arrived in this order among the entries of [history] from index [from] on, other events lying between them as they like: how a check
 * tells that two messages of one event name both reached JavaScript, and in the order they were sent.
 */
export function arrivedInOrder(history: readonly { event: string; detail?: unknown }[], from: number, wanted: readonly (readonly [event: string, detail: unknown])[]): boolean {
  let next = 0;
  for (const entry of history.slice(from)) {
    const step = wanted[next];
    if (step && entry.event === step[0] && entry.detail === step[1]) next++;
  }
  return next === wanted.length;
}
