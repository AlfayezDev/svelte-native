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
