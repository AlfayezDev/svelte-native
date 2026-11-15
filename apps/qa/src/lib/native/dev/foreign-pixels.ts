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
 * How the built-in blur's checks read a stripe edge (`foreign-libraries-checks.ts`, `svelteblur`). [colors] are the pixels of a capture at four points on a row across the edge between
 * two stripes: [outer left, inner left, inner right, outer right], the inner pair a little way from the edge on each side (1.2 % of the box's width, 4 to 5 dp) and the outer pair further out
 * (7 %, 25 to 28 dp). `near` is how far apart the inner pair looks and `far` the outer pair (the largest difference of one colour channel, 0 to 255). A tint takes the same share off the contrast of
 * both pairs, so `near / far` ([edgeRatio]) is what the blur alone did: it does not move with a tint, a wash or a change of brightness.
 *  - A hard edge (nothing over it) has both pairs straddling the line: the ratio is 1, and with the red and yellow of the lab both are 145.
 *  - A Gaussian blur of standard deviation s smears the line over about 2 s: the inner pair sees erf(d / (s sqrt 2)) of the step and the outer pair the same for its larger distance. The ratio for a box
 *    of 360 dp is 0.20 at s = 25 dp (intensity 100 on Android), 0.28 at 12.5 dp (intensity 50), 0.39 at 8.3 dp and 1 as s goes to 0.
 *  - A tint alone (Android below 12, which draws it where it cannot blur) keeps the line and lowers the contrast: the ratio is still 1, and `near` falls as the tint grows.
 */
export type EdgeRead = { near: number; far: number };
export function readEdge(colors: readonly number[]): EdgeRead {
  const [outerLeft = 0, innerLeft = 0, innerRight = 0, outerRight = 0] = colors;
  return { near: distance(argb(innerLeft), argb(innerRight)), far: distance(argb(outerLeft), argb(outerRight)) };
}
/** `near / far`, the part of the step the inner pair sees; null when the outer pair shows no step to speak of (under 10: a hole, or nothing behind). */
export const edgeRatio = (read: EdgeRead): number | null => (read.far >= 10 ? read.near / read.far : null);
/** A hard edge in the stripes' own colours: both pairs are a full step apart (the red and yellow differ by 145). */
export const edgeHard = (read: EdgeRead): boolean => read.near >= 100 && read.near >= read.far * 0.85;
/** A hard edge, tinted or not: the line is there (the outer pair shows 60 or more of the 145) and the inner pair sees nearly all of what the outer one does. The edge of a view that is not blurring. */
export const edgeSharp = (read: EdgeRead): boolean => read.far >= 60 && read.near >= read.far * 0.85;
/**
 * The bounds of the ratio at intensity 100, by platform. Android's is 0.35, from `BlurRules.kt` (`native/svelte-core`): `MAX_RADIUS_DP = 25` and `radius(intensity, density, scale) = intensity / 100 * MAX_RADIUS_DP
 * * density * scale` with `scale = 1 / DIVISOR` (`DIVISOR = 4`: the picture of what is behind the view is a quarter of its size and drawn four times larger), so the render effect blurs by 25 dp at intensity 100
 * (12.5 at 50; at 1 it is 0.16 px of the picture, under `MIN_EFFECT_RADIUS = 0.5`, and there is no effect). `RenderEffect.createBlurEffect` takes the radius as the Gaussian's standard deviation, which
 * gives a ratio of 0.20 in a box of 360 dp (0.19 to 0.22 from 300 to 400); 0.35 is what a blur of 8 dp would give, a third of the blur the rules ask for, which the check must not accept. (If the platform
 * read the radius as a blur radius and made a sigma of 0.577 r + 0.5, the ratio would be 0.25: inside the bound.)
 *
 * iOS's is 0.30, from the first iPhone run (iPhone SE 3, iOS 26.6, `UIVisualEffectView` with a `UIBlurEffect`, the three places of the section in a box of 309, 309 and 293 dp): the ratio at intensity 100 was
 * 0.22, 0.20 and 0.20 (the inner pair 13, 12 and 11 apart, the outer pair 60, 61 and 54), at 50 it was 0.26, 0.26 and 0.24, and at 1 it was 1.00 in all three. The system's blur is not ours (its radius is not a
 * number the library gives it), so its readings saturate: 0.30 is a third over the largest of them, and a blur that left a third of the step in the inner pair, or a view that draws only a tint (a ratio of 1), is
 * over it.
 */
export const gradualBound = { android: 0.35, ios: 0.30 } as const;
/** A gradual edge: some step is there at all (the outer pair differs by 10 or more) and the inner pair sees at most [bound] of it (`gradualBound`). */
export const edgeGradual = (read: EdgeRead, bound: number): boolean => read.far >= 10 && read.near <= read.far * bound;
/** A hard edge under a light tint (Android below 12 draws no blur): the line is there (20 or more, the tint takes up to three quarters of 145) and the red stripe's green (72) has been lifted towards white. */
export const edgeUnderTint = (colors: readonly number[], read: EdgeRead): boolean => read.near >= 20 && read.near >= read.far * 0.85 && argb(colors[0] ?? 0).g > 140;
/** The sum of a pixel's red, green and blue: a light tint over a stripe is far above a dark one. */
export const brightness = (pixel: number): number => { const { r, g, b } = argb(pixel); return r + g + b; };
/**
 * How much each intensity may differ from the next in `ratio`, by platform: the ratio at 50 is above the one at 100 by [lower] and below the one at 1 by [upper]. Android's lower is 0.03: the two differ by
 * 0.07 to 0.09 in a box of 330 to 400 dp (0.20 against 0.28) and 8-bit pixels move a ratio by about 0.02. iOS's come from the first iPhone run (see `gradualBound`): the ratio at 50 was above the one at 100 by
 * 0.04, 0.06 and 0.04, and below the one at 1 (always 1.00) by 0.74, 0.74 and 0.76. A lower of 0.02 is half of the smallest gap (and about the noise of 8-bit pixels: a view whose intensity does not reach the
 * blur gives a gap of 0 to 0.02), an upper of 0.5 is two thirds of the smallest one (a blur that is as absent at 50 as at 1 gives 0).
 */
export const betweenMargin = { android: { lower: 0.03, upper: 0.25 }, ios: { lower: 0.02, upper: 0.5 } } as const;
/** The ratio at 50 sits between the ratios at 100 and at 1 (`betweenMargin`): a blur whose radius follows the intensity. */
export function ratioBetween(full: number | null, half: number | null, weak: number | null, margin: { lower: number; upper: number }): boolean {
  return full !== null && half !== null && weak !== null && half >= full + margin.lower && half <= weak - margin.upper;
}
/**
 * What the capture of a light tint must show over a stripe, by platform (`foreign-libraries-checks.ts`, `svelteblur`): each is a sum of the red, green and blue channels (`brightness`).
 *  - `yellow`: the floor of the light tint over the yellow stripe's middle (the stripe's own sum is 472) at intensity 100, which a dark tint is far below. `stripe`: the floor of the light tint over the red and
 *    the blue stripe (378 and 400 bare) at intensity 70. `gap`: how much darker the dark tint over the yellow is than the light one.
 *  - Android draws a white of 0.45 over a blurred stripe, which lifts the yellow to about 600 (601 and 604 on the Samsung A16: 520 is under it by 80, over the bare 472) and the red and the blue to 515 and
 *    529 (450 is under them); the dark one gave 255 to 259 (a gap of 345).
 *  - iOS's light material does not lift a stripe the way a white does: it blurs the stripe into its neighbours and greys it. On the iPhone SE 3 the light tint gave the yellow 447, 450 and 446 (under the bare
 *    472, which the Android floor demands to be over), the red 446 to 448 and the blue 465, and the dark one gave the yellow 164, 165 and 161 (a gap of 283 to 285). The floors are 400 (a tenth under the lowest
 *    light reading, and far over any dark one) and the gap 200 (over two thirds of the smallest); what the checks still tell is a tint that is ignored (a gap of 0), swapped (the light one under the floor)
 *    or drawn by a view that is not there (472 for both).
 */
export const lightTint = {
  android: { yellow: 520, stripe: 450, gap: 150 },
  ios: { yellow: 400, stripe: 400, gap: 200 },
} as const;
/**
 * The horizontal band behind the built-in blur (`LibrarySet.svelte`): a near-black band across the box from 30 % to 42 % of its height, over the stripes. Six points (`bandPoints`: columns at 3 % of the
 * width, outside the blur's box, and 12 %, inside it; rows at 24 %, 36 % and 48 %: 6 % of the height, about 6 dp, above the band, in it and below it) say whether the band is where it is: the same
 * pattern, bright dark bright, in both columns. Read at intensity 1 (almost nothing blurs but the picture of what is behind is still the one drawn), a picture that sits higher or lower than the box by 6 dp or more
 * moves the edge past a row and breaks the pattern.
 */
export const bandPoints: readonly (readonly [number, number])[] = [[0.03, 0.24], [0.03, 0.36], [0.03, 0.48], [0.12, 0.24], [0.12, 0.36], [0.12, 0.48]];
/**
 * Whether the six pixels of `bandPoints` are bright, dark, bright in each column: the band is darker than the stripe above it and the one below it by 120 (the sum of the channels), with or without a
 * tint over it (red 378 and the band 54 differ by 324, and a white tint of 0.30, the lightest the fallback draws, leaves 227 of it).
 */
export function bandInPlace(colors: readonly number[]): boolean {
  if (colors.length !== bandPoints.length) return false;
  const bright = colors.map((pixel) => brightness(pixel));
  const column = (offset: number) => {
    const [above, within, below] = [bright[offset] ?? 0, bright[offset + 1] ?? 999, bright[offset + 2] ?? 0];
    return within + 120 <= Math.min(above, below);
  };
  return column(0) && column(3);
}

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
 * waited for; a view that never draws still ends with its last result, for the check to name. A [take] that gives null (a capture that failed or gave no pixels) is taken again like any other
 * result that is not wanted, until the time is up: the GPU frame of a capture times out after 3 s and the engine draws the next one in software (`Capture.kt`), so a failed capture is often the first of two.
 * With no time ([ms] 0) it is one call.
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
    if ((taken !== null && wanted(taken)) || waited >= ms) return { taken, calls, waited };
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
