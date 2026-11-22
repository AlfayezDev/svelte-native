import { describe, expect, test } from "bun:test";
import { evaluateMediaQuery, parseMediaQuery, type MediaSource, type MediaState } from "../../src/media-query.ts";

// The evaluator is pure: a query and a state in, a boolean out. Every feature it knows, against states of a phone.
// The screen is the window and the status and navigation bars (a phone's `Dimensions.get("screen")` is taller than its window).
const phone: MediaState = { width: 411, height: 891, screenWidth: 411, screenHeight: 960, scale: 2.625, colorScheme: "light", reducedMotion: false, highContrast: false, invertedColors: false, reducedTransparency: false };
const state = (patch: Partial<MediaState> = {}): MediaState => ({ ...phone, ...patch });
const landscape = state({ width: 891, height: 411, screenWidth: 960, screenHeight: 411 });
const tablet = state({ width: 820, height: 1180, scale: 2 });

const matches = (query: string, on: MediaState = phone) => evaluateMediaQuery(query, on);

describe("media types", () => {
  test.each([
    ["all", true], ["screen", true], ["print", false], ["speech", false], ["tv", false], ["projection", false], ["braille", false], ["foo", false],
    ["only screen", true], ["only print", false], ["not print", true], ["not screen", false], ["not all", false], ["not foo", true],
    ["SCREEN", true], ["Not Print", true],
  ])("%s is %p", (query, expected) => expect(matches(query)).toBe(expected));

  test("a type with `and`: the type and the condition must both hold", () => {
    expect(matches("screen and (min-width: 400px)")).toBe(true);
    expect(matches("screen and (min-width: 600px)")).toBe(false);
    expect(matches("print and (min-width: 400px)")).toBe(false);
    expect(matches("all and (orientation: portrait)")).toBe(true);
    expect(matches("only screen and (orientation: portrait) and (max-width: 500px)")).toBe(true);
    expect(matches("not screen and (min-width: 600px)")).toBe(true); // not (screen and min-width 600px)
    expect(matches("not screen and (min-width: 400px)")).toBe(false);
    expect(matches("not print and (min-width: 400px)")).toBe(true);
    expect(matches("screen and not (min-width: 600px)")).toBe(true);
    expect(matches("screen and not (min-width: 400px)")).toBe(false);
  });

  test("an empty list is `all`", () => {
    expect(matches("")).toBe(true);
    expect(matches("   ")).toBe(true);
    expect(matches("/* nothing */")).toBe(true);
  });
});

describe("width and height", () => {
  test.each([
    ["(min-width: 400px)", true], ["(min-width: 411px)", true], ["(min-width: 412px)", false], ["(max-width: 411px)", true], ["(max-width: 410px)", false],
    ["(width: 411px)", true], ["(width: 410px)", false], ["(min-height: 891px)", true], ["(max-height: 800px)", false], ["(height: 891px)", true],
    ["(min-width: 0)", true], ["(min-width: 0px)", true], ["(max-width: 0)", false], ["(width: 0)", false],
    ["(min-width: 25.6875em)", true], ["(min-width: 25.69em)", false], ["(max-width: 25.6875rem)", true], ["(min-width: 25.7rem)", false],
    ["(min-width: 308.25pt)", true], ["(min-width: 4.28in)", true], ["(min-width: 4.3in)", false], ["(min-width: 10.8cm)", true], ["(min-width: 11cm)", false],
    ["(MIN-WIDTH: 400PX)", true], ["( min-width : 400px )", true], ["(min-width:400px)", true], ["(min-width:\n400px\t)", true],
    ["(min-width: 400px) and (max-width: 500px)", true], ["(min-width: 400px) and (max-width: 410px)", false],
  ])("%s is %p", (query, expected) => expect(matches(query)).toBe(expected));

  test("the window's size, in points, is what a device has: a turn changes the answer", () => {
    expect(matches("(min-width: 600px)")).toBe(false);
    expect(matches("(min-width: 600px)", landscape)).toBe(true);
    expect(matches("(min-width: 600px) and (max-width: 900px)", landscape)).toBe(true);
    expect(matches("(min-width: 768px)", tablet)).toBe(true);
    expect(matches("(min-height: 1000px)", tablet)).toBe(true);
  });

  test("a bare (width) is true for a window that has one", () => {
    expect(matches("(width)")).toBe(true);
    expect(matches("(height)")).toBe(true);
    expect(matches("(width)", state({ width: 0 }))).toBe(false);
  });

  test("fractional sizes compare like a browser's", () => {
    const odd = state({ width: 411.42857142857144 });
    expect(matches("(min-width: 411.4px)", odd)).toBe(true);
    expect(matches("(min-width: 411.43px)", odd)).toBe(false);
    expect(matches("(max-width: 411.42857142857144px)", odd)).toBe(true);
  });
});

describe("range syntax", () => {
  test.each([
    ["(width >= 411px)", true], ["(width > 411px)", false], ["(width <= 411px)", true], ["(width < 411px)", false], ["(width = 411px)", true], ["(width >= 600px)", false],
    ["(600px <= width)", false], ["(400px <= width)", true], ["(411px >= width)", true], ["(410px < width)", true], ["(411px < width)", false], ["(411px = width)", true],
    ["(400px <= width < 700px)", true], ["(400px < width <= 411px)", true], ["(411px < width < 700px)", false], ["(400px <= width <= 410px)", false],
    ["(700px > width >= 400px)", true], ["(700px >= width > 411px)", false], ["(1000px >= height > 800px)", true],
    ["(width>=400px)", true], ["(400px<=width<700px)", true], ["(  width   >=   400px  )", true],
    ["(height >= 40em)", true], ["(height < 50rem)", false], ["(width >= 0)", true],
    ["(aspect-ratio < 1)", true], ["(aspect-ratio > 1/2)", false], ["(1 / 3 < aspect-ratio < 1)", true], ["(resolution >= 2dppx)", true], ["(resolution > 3x)", false], ["(1x <= resolution <= 3x)", true],
    ["(color >= 8)", true], ["(color > 8)", false],
  ])("%s is %p", (query, expected) => expect(matches(query)).toBe(expected));

  test("malformed range forms are `not all`", () => {
    for (const query of [
      "(width >= )", "(>= 400px)", "(width >=)", "(400px <= 700px)", "(400px <= width > 200px)", "(400px = width < 700px)", "(400px <= width = 700px)", "(width <= height)",
      "(1px < 2px < 3px)", "(orientation = portrait)", "(hover >= none)", "(foo >= 400px)", "(400px <= foo)", "(400px <= width < 700px < 800px)", "(min-width >= 400px)", "(width >= red)", "(width < = 400px)",
    ]) expect([query, matches(query)]).toEqual([query, false]);
    // Each is `not all` in a list too: the other query still decides.
    expect(matches("(width <= height), screen")).toBe(true);
    expect(parseMediaQuery("(width <= height)").media).toBe("not all");
  });
});

describe("orientation and aspect ratio", () => {
  test("orientation follows the window's width and height; a square window is portrait", () => {
    expect(matches("(orientation: portrait)")).toBe(true);
    expect(matches("(orientation: landscape)")).toBe(false);
    expect(matches("(orientation: portrait)", landscape)).toBe(false);
    expect(matches("(orientation: landscape)", landscape)).toBe(true);
    expect(matches("(orientation: portrait)", state({ width: 500, height: 500 }))).toBe(true);
    expect(matches("(orientation: landscape)", state({ width: 500, height: 500 }))).toBe(false);
    expect(matches("(orientation)")).toBe(true);
    expect(matches("(orientation: sideways)")).toBe(false);
    expect(matches("not (orientation: sideways)")).toBe(false);
  });

  test("aspect-ratio compares width over height, with min- and max-", () => {
    const wide = state({ width: 1600, height: 900 });
    expect(matches("(min-aspect-ratio: 16/9)", wide)).toBe(true);
    expect(matches("(aspect-ratio: 16/9)", wide)).toBe(true);
    expect(matches("(aspect-ratio: 16 / 9)", wide)).toBe(true);
    expect(matches("(aspect-ratio: 4/3)", wide)).toBe(false);
    expect(matches("(max-aspect-ratio: 16/9)", wide)).toBe(true);
    expect(matches("(min-aspect-ratio: 17/9)", wide)).toBe(false);
    expect(matches("(min-aspect-ratio: 1/1)", wide)).toBe(true);
    expect(matches("(min-aspect-ratio: 2)", wide)).toBe(false);
    expect(matches("(max-aspect-ratio: 2)", wide)).toBe(true);
    expect(matches("(min-aspect-ratio: 1/1)")).toBe(false); // the phone is taller than wide
    expect(matches("(max-aspect-ratio: 1/1)")).toBe(true);
    expect(matches("(max-aspect-ratio: 9/16)")).toBe(true); // 411 / 891 = 0.461; 9 / 16 = 0.5625
    expect(matches("(max-aspect-ratio: 1/3)")).toBe(false);
    expect(matches("(min-aspect-ratio: 9/16)")).toBe(false);
    expect(matches("(min-aspect-ratio: 1/0)", wide)).toBe(false);
    expect(matches("(aspect-ratio)")).toBe(true);
  });
});

describe("resolution and the pixel ratio", () => {
  test("resolution takes dppx, x, dpi and dpcm, and the webkit pixel ratio a number", () => {
    // 2.625 dppx: 252 dpi.
    expect(matches("(min-resolution: 2dppx)")).toBe(true);
    expect(matches("(min-resolution: 2.625dppx)")).toBe(true);
    expect(matches("(min-resolution: 3dppx)")).toBe(false);
    expect(matches("(max-resolution: 2.5dppx)")).toBe(false);
    expect(matches("(max-resolution: 3x)")).toBe(true);
    expect(matches("(min-resolution: 192dpi)")).toBe(true);
    expect(matches("(min-resolution: 252dpi)")).toBe(true);
    expect(matches("(min-resolution: 253dpi)")).toBe(false);
    expect(matches("(min-resolution: 99dpcm)")).toBe(true);
    expect(matches("(min-resolution: 100dpcm)")).toBe(false);
    expect(matches("(resolution: 2.625dppx)")).toBe(true);
    expect(matches("(resolution: 2dppx)")).toBe(false);
    expect(matches("(resolution: 2dppx)", tablet)).toBe(true);
    expect(matches("(resolution: 192dpi)", tablet)).toBe(true);
    expect(matches("(min-resolution: infinite)")).toBe(false);
    expect(matches("(max-resolution: infinite)")).toBe(true);
    expect(matches("(resolution)")).toBe(true);
    expect(matches("(-webkit-min-device-pixel-ratio: 2)")).toBe(true);
    expect(matches("(-webkit-min-device-pixel-ratio: 3)")).toBe(false);
    expect(matches("(-webkit-max-device-pixel-ratio: 2)")).toBe(false);
    expect(matches("(-webkit-max-device-pixel-ratio: 3)")).toBe(true);
    expect(matches("(-webkit-device-pixel-ratio: 2.625)")).toBe(true);
    expect(matches("(-webkit-device-pixel-ratio: 2)", tablet)).toBe(true);
    expect(matches("(-webkit-min-device-pixel-ratio: 1.5), (min-resolution: 144dpi)", state({ scale: 1 }))).toBe(false);
    expect(matches("(-webkit-min-device-pixel-ratio: 1.5), (min-resolution: 144dpi)")).toBe(true);
  });

  test("the webkit ratio has no range syntax, and a resolution wants a unit", () => {
    expect(matches("(-webkit-device-pixel-ratio >= 2)")).toBe(false);
    expect(matches("(min-resolution: 2)")).toBe(false);
    expect(matches("(min-resolution: dppx)")).toBe(false);
    expect(matches("(-webkit-min-device-pixel-ratio: 2dppx)")).toBe(false);
    expect(matches("(-webkit-min-device-pixel-ratio: -1)")).toBe(false);
  });
});

describe("prefers-color-scheme, prefers-reduced-motion and prefers-contrast", () => {
  test("prefers-color-scheme is the appearance's", () => {
    expect(matches("(prefers-color-scheme: light)")).toBe(true);
    expect(matches("(prefers-color-scheme: dark)")).toBe(false);
    expect(matches("(prefers-color-scheme: dark)", state({ colorScheme: "dark" }))).toBe(true);
    expect(matches("(prefers-color-scheme: light)", state({ colorScheme: "dark" }))).toBe(false);
    expect(matches("not (prefers-color-scheme: dark)")).toBe(true);
    expect(matches("(prefers-color-scheme)")).toBe(true);
    expect(matches("(prefers-color-scheme: no-preference)")).toBe(false);
    expect(matches("(PREFERS-COLOR-SCHEME: DARK)", state({ colorScheme: "dark" }))).toBe(true);
  });

  test("prefers-reduced-motion is the system's reduce motion setting", () => {
    expect(matches("(prefers-reduced-motion: reduce)")).toBe(false);
    expect(matches("(prefers-reduced-motion: no-preference)")).toBe(true);
    expect(matches("(prefers-reduced-motion: reduce)", state({ reducedMotion: true }))).toBe(true);
    expect(matches("(prefers-reduced-motion: no-preference)", state({ reducedMotion: true }))).toBe(false);
    expect(matches("(prefers-reduced-motion)")).toBe(false);
    expect(matches("(prefers-reduced-motion)", state({ reducedMotion: true }))).toBe(true);
    expect(matches("not (prefers-reduced-motion: reduce)", state({ reducedMotion: true }))).toBe(false);
  });

  test("prefers-contrast is no-preference, or more when the system's contrast setting is on; less and custom are never", () => {
    expect(matches("(prefers-contrast: no-preference)")).toBe(true);
    expect(matches("(prefers-contrast: more)")).toBe(false);
    expect(matches("(prefers-contrast: more)", state({ highContrast: true }))).toBe(true);
    expect(matches("(prefers-contrast: no-preference)", state({ highContrast: true }))).toBe(false);
    expect(matches("(prefers-contrast: less)", state({ highContrast: true }))).toBe(false);
    expect(matches("(prefers-contrast: custom)", state({ highContrast: true }))).toBe(false);
    expect(matches("(prefers-contrast)")).toBe(false);
    expect(matches("(prefers-contrast)", state({ highContrast: true }))).toBe(true);
  });
});

describe("what a phone is: hover, pointer, display-mode and color", () => {
  test.each([
    ["(hover: none)", true], ["(hover: hover)", false], ["(hover)", false], ["(any-hover: none)", true], ["(any-hover: hover)", false], ["(any-hover)", false],
    ["(pointer: coarse)", true], ["(pointer: fine)", false], ["(pointer: none)", false], ["(pointer)", true], ["(any-pointer: coarse)", true], ["(any-pointer: fine)", false], ["(any-pointer: none)", false], ["(any-pointer)", true],
    ["(display-mode: standalone)", true], ["(display-mode: browser)", false], ["(display-mode: fullscreen)", false], ["(display-mode: minimal-ui)", false], ["(display-mode)", true],
    ["(color)", true], ["(color: 8)", true], ["(color: 4)", false], ["(min-color: 1)", true], ["(min-color: 8)", true], ["(min-color: 9)", false], ["(max-color: 8)", true], ["(max-color: 7)", false],
    ["(hover: hover) and (pointer: fine)", false], ["(hover: none) and (pointer: coarse)", true], ["not (hover: hover)", true],
  ])("%s is %p", (query, expected) => expect(matches(query)).toBe(expected));
});

describe("features of a phone that are fixed or the screen's", () => {
  test.each([
    ["(forced-colors: none)", true], ["(forced-colors: active)", false], ["(forced-colors)", false], ["(update: fast)", true], ["(update: slow)", false], ["(update: none)", false], ["(update)", true],
    ["(scripting: enabled)", true], ["(scripting: none)", false], ["(scripting: initial-only)", false], ["(scripting)", true],
    // The gamut is sRGB: React Native cannot say more, so wider gamuts are not claimed.
    ["(color-gamut: srgb)", true], ["(color-gamut: p3)", false], ["(color-gamut: rec2020)", false], ["(color-gamut)", true],
    ["(inverted-colors: none)", true], ["(inverted-colors: inverted)", false], ["(inverted-colors)", false],
    ["(prefers-reduced-transparency: no-preference)", true], ["(prefers-reduced-transparency: reduce)", false], ["(prefers-reduced-transparency)", false],
    ["(FORCED-COLORS: NONE)", true], ["(forced-colors: sideways)", false], ["(min-forced-colors: none)", false],
  ])("%s is %p", (query, expected) => expect(matches(query)).toBe(expected));

  test("inverted colors and reduced transparency follow the system's settings", () => {
    const on = state({ invertedColors: true, reducedTransparency: true });
    expect(matches("(inverted-colors: inverted)", on)).toBe(true);
    expect(matches("(inverted-colors: none)", on)).toBe(false);
    expect(matches("(inverted-colors)", on)).toBe(true);
    expect(matches("(prefers-reduced-transparency: reduce)", on)).toBe(true);
    expect(matches("(prefers-reduced-transparency: no-preference)", on)).toBe(false);
    expect(matches("(prefers-reduced-transparency)", on)).toBe(true);
  });

  test("an unknown feature next to the settings: the settings decide", () => {
    expect(matches("(forced-colors: active) or (prefers-contrast: more)")).toBe(false);
    expect(matches("(forced-colors: active) or (prefers-contrast: more)", state({ highContrast: true }))).toBe(true);
    expect(matches("(foo: bar) or (prefers-contrast: more)", state({ highContrast: true }))).toBe(true);
    expect(matches("(foo: bar) or (prefers-contrast: more)")).toBe(false);
  });

  test("device-width, device-height and device-aspect-ratio are the screen's", () => {
    expect(matches("(device-width: 411px)")).toBe(true);
    expect(matches("(min-device-width: 400px)")).toBe(true);
    expect(matches("(min-device-width: 412px)")).toBe(false);
    expect(matches("(max-device-width: 411px)")).toBe(true);
    expect(matches("(max-device-width: 410px)")).toBe(false);
    expect(matches("(device-height: 960px)")).toBe(true); // the window is 891 tall: the screen has the bars
    expect(matches("(min-device-height: 900px)")).toBe(true);
    expect(matches("(max-device-height: 900px)")).toBe(false);
    expect(matches("(min-height: 900px)")).toBe(false);
    expect(matches("(min-device-width: 600px)", landscape)).toBe(true); // a turn: 960 x 411
    expect(matches("(device-width >= 600px)", landscape)).toBe(true);
    expect(matches("(400px <= device-width < 500px)")).toBe(true);
    expect(matches("(device-width)")).toBe(true);
    expect(matches("(device-aspect-ratio: 411/960)")).toBe(true);
    expect(matches("(min-device-aspect-ratio: 1/2)")).toBe(false); // 0.428 < 0.5
    expect(matches("(max-device-aspect-ratio: 1/2)")).toBe(true);
    expect(matches("(min-device-aspect-ratio: 1/1)", landscape)).toBe(true);
    expect(matches("(device-aspect-ratio)")).toBe(true);
    expect(matches("(min-device-width: 25.6875em)")).toBe(true);
  });
});

describe("viewport units and negative lengths", () => {
  test.each([
    ["(width: 100vw)", true], ["(min-width: 100vw)", true], ["(max-width: 100vw)", true], ["(min-width: 101vw)", false], ["(max-width: 99vw)", false], ["(min-width: 50vw)", true],
    ["(height: 100vh)", true], ["(min-height: 100vh)", true], ["(min-height: 101vh)", false], ["(max-height: 50vh)", false],
    ["(width: 100vmin)", true], ["(height: 100vmax)", true], ["(height: 100vmin)", false], ["(min-height: 150vmax)", false], ["(max-height: 100vmax)", true],
    ["(min-width: 20vmin)", true], ["(min-width: 50vmax)", false],
    ["(width >= 100vw)", true], ["(width > 100vw)", false], ["(50vw <= width <= 100vw)", true], ["(min-device-width: 50vw)", true], ["(min-device-height: 100vh)", true],
    ["(MIN-WIDTH: 50VW)", true], ["(min-width: 10 vw)", false],
    // Negative lengths are valid, and compare.
    ["(min-width: -1px)", true], ["(max-width: -1px)", false], ["(width: -1px)", false], ["(min-width: -1em)", true], ["(-10px < width)", true], ["(width > -10px)", true], ["(width < -10px)", false],
    ["(min-height: -100vh)", true],
  ])("%s is %p", (query, expected) => expect(matches(query)).toBe(expected));

  test("a viewport unit follows the window: the answer changes with a turn", () => {
    expect(matches("(min-width: 50vw)", state({ width: 100 }))).toBe(true);
    expect(matches("(width: 100vw)", landscape)).toBe(true);
    expect(matches("(width: 100vmin)", landscape)).toBe(false);
    expect(matches("(height: 100vmin)", landscape)).toBe(true);
    expect(matches("(min-width: 100vh)", landscape)).toBe(true);
    expect(matches("(min-width: 100vh)")).toBe(false);
  });

  test("the media text keeps the unit, and a negative length its sign", () => {
    expect(parseMediaQuery("(MIN-WIDTH:50VW)").media).toBe("(min-width: 50vw)");
    expect(parseMediaQuery("(min-width:-1px)").media).toBe("(min-width: -1px)");
    expect(parseMediaQuery("(-10px<width)").media).toBe("(-10px < width)");
  });
});

describe("not, and, or, lists and parentheses", () => {
  test("not negates a feature or a group", () => {
    expect(matches("not (min-width: 600px)")).toBe(true);
    expect(matches("not (min-width: 400px)")).toBe(false);
    expect(matches("not ((min-width: 400px) and (max-width: 500px))")).toBe(false);
    expect(matches("not ((min-width: 400px) and (max-width: 410px))")).toBe(true);
    expect(matches("not (not (min-width: 400px))")).toBe(true); // two nots
  });

  test("and and or join conditions of the same kind", () => {
    expect(matches("(min-width: 400px) and (orientation: portrait) and (hover: none)")).toBe(true);
    expect(matches("(min-width: 400px) and (orientation: landscape)")).toBe(false);
    expect(matches("(min-width: 600px) or (orientation: portrait)")).toBe(true);
    expect(matches("(min-width: 600px) or (orientation: landscape) or (hover: hover)")).toBe(false);
    expect(matches("((min-width: 600px) or (orientation: portrait)) and (hover: none)")).toBe(true);
    expect(matches("((min-width: 600px) or (orientation: landscape)) and (hover: none)")).toBe(false);
    expect(matches("(min-width: 600px) or ((orientation: portrait) and (hover: none))")).toBe(true);
    // A condition with no type may use `or`; after a type it may not.
    expect(matches("screen and ((min-width: 600px) or (orientation: portrait))")).toBe(true);
    expect(matches("screen and (min-width: 600px) or (orientation: portrait)")).toBe(false);
    // `and` and `or` are not mixed without parentheses.
    expect(matches("(min-width: 400px) and (orientation: portrait) or (hover: none)")).toBe(false);
    expect(matches("(min-width: 400px) or (orientation: portrait) and (hover: none)")).toBe(false);
    // `not` takes one condition.
    expect(matches("not (min-width: 600px) and (orientation: portrait)")).toBe(false);
  });

  test("a comma is or: the list matches when one of its queries does", () => {
    expect(matches("(min-width: 600px), (orientation: portrait)")).toBe(true);
    expect(matches("(min-width: 600px), (orientation: landscape)")).toBe(false);
    expect(matches("print, screen")).toBe(true);
    expect(matches("print, (min-width: 600px), tv")).toBe(false);
    expect(matches("screen and (min-width: 600px), print and (min-width: 100px), (orientation: portrait)")).toBe(true);
    expect(matches("(min-width: 600px) and (max-width: 700px) , (max-width: 500px)")).toBe(true);
  });

  test("a query that is not understood is `not all` and does not take its list down", () => {
    expect(matches("foo bar, screen")).toBe(true);
    expect(matches("(min-width: red), (orientation: portrait)")).toBe(true);
    expect(matches("screen,")).toBe(true);
    expect(matches(",screen")).toBe(true);
    expect(matches("screen, , print")).toBe(true);
    expect(matches("print,")).toBe(false);
    expect(matches("screen, and")).toBe(true);
    expect(matches("(min-width: 400px), (")).toBe(true);
  });

  test("whitespace, comments and case", () => {
    expect(matches("  SCREEN   AND   ( MIN-WIDTH :  400PX )  ")).toBe(true);
    expect(matches("screen /* a type */ and (min-width: 400px)")).toBe(true);
    expect(matches("screen and/**/(min-width: 400px)")).toBe(true);
    expect(matches("/* x */ (min-width: 400px) /* y */")).toBe(true);
    expect(matches("(min-width: 400px)\n\tand\n(max-width: 500px)")).toBe(true);
  });
});

describe("what is not understood is false, and nothing throws", () => {
  const unknown = [
    // Features this device does not have, or a browser does not know.
    "(foo)", "(foo: bar)", "(min-foo: 1px)", "(monochrome)", "(grid)",
    "(overflow-block: scroll)", "(dynamic-range: standard)", "(-webkit-transform-3d)", "(min--moz-device-pixel-ratio: 2)",
    // A known feature with a value it does not take.
    "(min-width: red)", "(min-width: 10)", "(min-width: 10%)", "(min-width: 10 px)", "(min-width: 1px 2px)", "(min-width:)", "(min-width)", "(max-width)", "(min-aspect-ratio)", "(min-orientation: portrait)",
    "(max-hover: none)", "(hover: sideways)", "(hover: 1px)", "(hover: none hover)", "(pointer: fine coarse)", "(prefers-color-scheme: sepia)", "(orientation: 1)", "(min-resolution)", "(min-aspect-ratio: 16/0/9)", "(min-aspect-ratio: 0/0)", "(min-aspect-ratio: -1)",
    "(aspect-ratio: 16 9)", "(aspect-ratio: /9)", "(aspect-ratio: 16/)", "(color: 1.5)", "(color: -1)", "(color: eight)", "(width: )", "(: 400px)", "(:)", "(width: 1px,)",
    // Not a query.
    "(", ")", "()", "(()", "(()))", "((min-width: 400px)", "(min-width: 400px))", "(min-width: 400px", "screen and", "and", "or", "not", "only", "not not (hover: none)", "only (hover: none)", "screen screen", "screen and print", "screen or (hover: none)",
    "screen and screen", "and (min-width: 400px)", "screen and (min-width: 400px) and", "(min-width: 400px) and", "and (hover: none)", "(min-width: 400px) not (hover: hover)", "min-width: 400px", "width >= 400px",
    "screen(min-width: 400px)", "screen and(min-width: 400px)", "not(min-width: 400px)", "(min-width: 400px) and(max-width: 500px)", "layout", "{}", "[]", "\"screen\"", "url(x)", "@media screen", "screen;", "123", "1px", "#", "!", "screen & print", "screen && print",
    "(min-width: 400px) (max-width: 500px)", "((hover: none) or)", "((hover: none) (pointer: coarse))", "(min-width: calc(100px + 1px))", "(min-width: var(--x))", "(--custom)", "(--custom: 1)", "(min-width: 400px; max-width: 500px)",
  ];
  test.each(unknown)("%p is false and does not throw", (query) => {
    expect(() => parseMediaQuery(query)).not.toThrow();
    expect(matches(query)).toBe(false);
    expect(matches(query, landscape)).toBe(false);
    expect(matches(query, state({ colorScheme: "dark", reducedMotion: true, highContrast: true }))).toBe(false);
  });

  test("an unknown feature is `unknown` (false) inside a condition, and `not`, `and` and `or` decide as Media Queries 4 says: false beats unknown in `and`, true beats it in `or`, `not` leaves it unknown", () => {
    // `or`: a known true condition decides.
    expect(matches("(foo: bar) or (min-width: 1px)")).toBe(true);
    expect(matches("(min-width: 1px) or (foo: bar)")).toBe(true);
    expect(matches("(foo) or (orientation: portrait)")).toBe(true);
    expect(matches("(min-width: red) or (hover: none)")).toBe(true);
    expect(matches("(foo: bar) or (bar: foo) or (hover: none)")).toBe(true);
    expect(matches("(foo: bar) or (min-width: 9999px)")).toBe(false); // unknown or false is unknown
    expect(matches("(foo) or (bar)")).toBe(false);
    // `and`: unknown with true is unknown, and a false decides.
    expect(matches("(foo: bar) and (min-width: 1px)")).toBe(false);
    expect(matches("(min-width: 1px) and (foo: bar)")).toBe(false);
    expect(matches("screen and (foo)")).toBe(false);
    // `not`: of unknown is unknown, of the false that `and` makes of unknown and false is true.
    expect(matches("not (foo: bar)")).toBe(false);
    expect(matches("not (min-width: red)")).toBe(false);
    expect(matches("screen and not (foo)")).toBe(false);
    expect(matches("not ((foo: bar) or (min-width: 9999px))")).toBe(false);
    expect(matches("not ((foo: bar) and (min-width: 9999px))")).toBe(true);
    expect(matches("not ((foo: bar) or (min-width: 1px))")).toBe(false);
    expect(matches("not ((foo) and (min-width: 1px))")).toBe(false);
    // Nested.
    expect(matches("screen and ((foo) or (min-width: 1px))")).toBe(true);
    expect(matches("screen and ((foo) or (min-width: 9999px))")).toBe(false);
    expect(matches("((foo) or (hover: none)) and (pointer: coarse)")).toBe(true);
    // A function token is `<general-enclosed>` too: unknown, and `not(` is one.
    expect(matches("foo(bar) or (min-width: 1px)")).toBe(true);
    expect(matches("(min-width: 1px) and foo(bar)")).toBe(false);
    expect(matches("not(min-width: 1px) or (hover: none)")).toBe(true);
    // A list: the unknown query is false and the others decide.
    expect(matches("(foo), (min-width: 1px)")).toBe(true);
    // The unknown and a range with a feature that is not there: unknown too.
    expect(matches("(600px <= foo) or (hover: none)")).toBe(true);
    expect(matches("(foo >= 3) or (hover: none)")).toBe(true);
    expect(matches("(width >= ) or (hover: none)")).toBe(true);
  });

  test("a query that does not parse is false whatever surrounds it in the list, and is not an unknown feature", () => {
    expect(matches("(min-width: 1px) or ()")).toBe(false);
    expect(matches("() or (min-width: 1px)")).toBe(false);
    expect(matches("(foo) or (: 400px)")).toBe(false);
    expect(matches("(min-width: 1px) or (hover: none) and (pointer: coarse)")).toBe(false); // `or` and `and` are not mixed
    expect(matches("((min-width: 1px)")).toBe(false);
    expect(matches("(1px)")).toBe(false);
  });

  test("an empty query between commas, deep nesting and long text are handled", () => {
    expect(() => parseMediaQuery(`${"(".repeat(50_000)}hover${")".repeat(50_000)}`)).not.toThrow();
    expect(matches(`${"(".repeat(50_000)}hover: none${")".repeat(50_000)}`)).toBe(false);
    expect(matches(`${"(".repeat(20)}hover: none${")".repeat(20)}`)).toBe(true);
    expect(matches(`${"(".repeat(40)}hover: none${")".repeat(40)}`)).toBe(false);
    expect(matches(`${"print, ".repeat(10_000)}screen`)).toBe(true);
    expect(matches("x".repeat(100_000))).toBe(false);
    for (const odd of ["\u0000", "￿", "\ud800", "😀", "(min-width: 4\u0000px)", "screen and", "(\\)", "\\", "(min-width: 4\\70x)"]) expect(() => parseMediaQuery(odd)).not.toThrow();
  });

  test("a value that is not a string is the caller's, and a non-finite state never matches a range", () => {
    expect(matches("(min-width: 0px)", state({ width: Number.NaN }))).toBe(false);
    expect(matches("(max-width: 100000px)", state({ width: Number.NaN }))).toBe(false);
  });
});

describe("media, as a browser serialises it", () => {
  test.each([
    ["screen", "screen"], ["SCREEN", "screen"], ["all", "all"], ["", ""], ["   ", ""], ["only screen", "only screen"], ["NOT PRINT", "not print"], ["print", "print"],
    ["(min-width:600px)", "(min-width: 600px)"], ["(MIN-WIDTH:  600PX )", "(min-width: 600px)"], ["(min-width: 600.50px)", "(min-width: 600.5px)"], ["(min-width: .5em)", "(min-width: 0.5em)"], ["(min-width: 0)", "(min-width: 0px)"],
    ["(min-width: 600px) and (max-width: 800px)", "(min-width: 600px) and (max-width: 800px)"], ["(min-width:600px)and (max-width:800px)", "(min-width: 600px) and (max-width: 800px)"],
    ["screen and (min-width:600px)", "screen and (min-width: 600px)"], ["only screen and (orientation:portrait)", "only screen and (orientation: portrait)"], ["not screen and (color)", "not screen and (color)"],
    ["(width>=600px)", "(width >= 600px)"], ["(400px<=width<700px)", "(400px <= width < 700px)"], ["(600px <= WIDTH)", "(600px <= width)"], ["(width=411px)", "(width = 411px)"],
    ["(min-aspect-ratio:16/9)", "(min-aspect-ratio: 16 / 9)"], ["(min-resolution:2DPPX)", "(min-resolution: 2dppx)"], ["(-webkit-min-device-pixel-ratio:2)", "(-webkit-min-device-pixel-ratio: 2)"],
    ["not (hover)", "not (hover)"], ["((hover: none) or (pointer:coarse))", "((hover: none) or (pointer: coarse))"], ["(prefers-color-scheme:dark)", "(prefers-color-scheme: dark)"],
    ["screen, print", "screen, print"], ["screen,print", "screen, print"], ["(min-width:400px),(max-width:300px)", "(min-width: 400px), (max-width: 300px)"],
    ["(foo)", "not all"], ["(min-width: red)", "not all"], ["foo bar", "not all"], ["screen, (foo), print", "screen, not all, print"], ["screen and", "not all"], [",", "not all, not all"],
    ["(prefers-reduced-motion)", "(prefers-reduced-motion)"], ["(width)", "(width)"],
    // An unknown feature next to a known one stays in the text; one that can only be unknown is `not all`.
    ["(foo: bar) or (min-width:1px)", "(foo: bar) or (min-width: 1px)"], ["(MIN-WIDTH:1px) or (Foo:Bar)", "(min-width: 1px) or (foo: bar)"], ["screen and ((foo) or (min-width: 1px))", "screen and ((foo) or (min-width: 1px))"],
    ["not (foo)", "not all"], ["(foo) or (bar)", "not all"], ["screen and (foo)", "not all"], ["foo(bar)", "not all"], ["(foo), (min-width:1px)", "not all, (min-width: 1px)"],
  ])("%p is %p", (query, media) => expect(parseMediaQuery(query).media).toBe(media));

  test("a serialised query means what it did", () => {
    for (const query of ["(width>=400px)", "SCREEN and (MIN-width:400PX)", "(400px<=width<700px), print", "not (hover)", "(min-aspect-ratio:1/2) and (orientation:portrait)"]) {
      const media = parseMediaQuery(query).media;
      for (const on of [phone, landscape, tablet]) expect([query, matches(media, on)]).toEqual([query, matches(query, on)]);
    }
  });
});

describe("sources: what a query listens to", () => {
  const sourcesOf = (query: string): MediaSource[] => [...parseMediaQuery(query).sources].toSorted();
  test.each([
    ["screen", []], ["(hover: none)", []], ["(pointer: coarse)", []], ["(display-mode: standalone)", []], ["(color)", []], ["print and (hover: none)", []],
    ["(min-width: 400px)", ["window"]], ["(height > 400px)", ["window"]], ["(orientation: portrait)", ["window"]], ["(min-aspect-ratio: 1/1)", ["window"]], ["(min-resolution: 2dppx)", ["window"]],
    ["(-webkit-min-device-pixel-ratio: 2)", ["window"]], ["(400px <= width < 700px)", ["window"]],
    ["(device-width: 411px)", ["window"]], ["(min-device-aspect-ratio: 1/1)", ["window"]], ["(min-width: 50vw)", ["window"]], ["(min-device-width: 50vh)", ["window"]],
    ["(forced-colors: none)", []], ["(update: fast)", []], ["(scripting: enabled)", []], ["(color-gamut: srgb)", []],
    ["(inverted-colors: inverted)", ["inverted"]], ["(prefers-reduced-transparency: reduce)", ["transparency"]],
    ["(prefers-color-scheme: dark)", ["appearance"]], ["(prefers-reduced-motion: reduce)", ["motion"]], ["(prefers-contrast: more)", ["contrast"]],
    ["(min-width: 400px) and (prefers-color-scheme: dark)", ["appearance", "window"]],
    ["(prefers-reduced-motion) or (prefers-contrast) or (orientation: landscape), (prefers-color-scheme)", ["appearance", "contrast", "motion", "window"]],
    // A query that can only be `not all` listens to nothing; an unknown feature next to a known one leaves the known one's source.
    ["(foo)", []], ["(foo) or (prefers-color-scheme: dark)", ["appearance"]], ["(prefers-color-scheme: dark), (min-width: red)", ["appearance"]], ["(min-width: red)", []], ["not (foo)", []], ["", []],
  ] as [string, MediaSource[]][])("%p reads %p", (query, expected) => expect(sourcesOf(query)).toEqual(expected));
});

describe("a query reads only what it needs", () => {
  /** A state that records the fields it was asked for. */
  function recording(): { state: MediaState; read: string[] } {
    const read: string[] = [];
    const log = <K extends keyof MediaState>(field: K): MediaState[K] => { read.push(field); return phone[field]; };
    return {
      read,
      state: {
        get width() { return log("width"); },
        get height() { return log("height"); },
        get screenWidth() { return log("screenWidth"); },
        get screenHeight() { return log("screenHeight"); },
        get scale() { return log("scale"); },
        get colorScheme() { return log("colorScheme"); },
        get reducedMotion() { return log("reducedMotion"); },
        get highContrast() { return log("highContrast"); },
        get invertedColors() { return log("invertedColors"); },
        get reducedTransparency() { return log("reducedTransparency"); },
      },
    };
  }

  test.each([
    ["screen", []], ["print", []], ["(hover: none)", []], ["(min-width: 400px)", ["width"]], ["(orientation: portrait)", ["height", "width"]], ["(min-resolution: 2dppx)", ["scale"]],
    ["(prefers-color-scheme: dark)", ["colorScheme"]], ["(prefers-reduced-motion: reduce)", ["reducedMotion"]], ["(prefers-contrast: more)", ["highContrast"]],
    ["(device-width: 411px)", ["screenWidth"]], ["(device-aspect-ratio: 1/1)", ["screenHeight", "screenWidth"]], ["(forced-colors: none)", []], ["(inverted-colors: inverted)", ["invertedColors"]], ["(prefers-reduced-transparency: reduce)", ["reducedTransparency"]],
    ["(min-width: 50vw)", ["width"]], ["(min-height: 50vmax)", ["height", "width"]],
    ["(foo) or (min-width: 1px)", ["width"]], ["(foo) and (min-width: 1px)", ["width"]],
    ["(min-width: 600px) and (prefers-reduced-motion: reduce)", ["width"]], ["(min-width: 600px), (prefers-contrast: more)", ["highContrast", "width"]],
  ] as [string, string[]][])("%p reads %p", (query, fields) => {
    const { state: recorded, read } = recording();
    parseMediaQuery(query).matches(recorded);
    expect([...new Set(read)].toSorted()).toEqual(fields);
  });

  test("parsing reads no state at all", () => {
    const { state: recorded, read } = recording();
    for (const query of ["screen", "(min-width: 400px)", "(prefers-reduced-motion: reduce)", "(foo)"]) parseMediaQuery(query);
    void recorded;
    expect(read).toEqual([]);
  });
});
