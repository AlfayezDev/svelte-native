import { expect, test } from "bun:test";
import { DEFAULT_FONT_SIZE, TEXT_KEYS, fontSizeOf, hasTextKeys, inheritedStyle, resolveRelative, textStyleOf } from "../src/fabric/text-inherit.ts";

// The rules of text style that inherits (`fabric/text-inherit.ts`); the host tree they give is in html-elements.test.ts.

test("what inherits is the text keys of CSS", () => {
  expect([...TEXT_KEYS].sort()).toEqual(["color", "fontFamily", "fontSize", "fontStyle", "fontVariant", "fontWeight", "letterSpacing", "lineHeight", "textAlign", "textDecorationColor", "textDecorationLine", "textDecorationStyle", "textTransform"]);
  expect(hasTextKeys({ padding: 4 })).toBe(false);
  expect(hasTextKeys([null, false, [{ margin: 1 }, { color: "red" }]])).toBe(true);
  expect(hasTextKeys({ fontRelative: { lineHeight: 1.5 } })).toBe(true);
});

test("an element's text style is what it inherits with its own style over it, in the order of an array", () => {
  const outer = textStyleOf(undefined, [{ padding: 4 }, { color: "white", fontSize: 20 }]);
  expect(outer).toEqual({ color: "white", fontSize: 20 });
  const inner = textStyleOf(outer, [{ fontSize: 12 }, null, { fontWeight: "700", margin: 2 }]);
  expect(inner).toEqual({ color: "white", fontSize: 12, fontWeight: "700" });
  // A style with nothing that inherits is the inherited one itself; nothing at all is nothing.
  expect(textStyleOf(outer, { padding: 1 })).toBe(outer);
  expect(textStyleOf(undefined, { padding: 1 })).toBeUndefined();
  // A null or an undefined takes nothing away: a style that does not say is not a style that unsets.
  expect(textStyleOf(outer, { color: undefined, fontSize: null })).toEqual({ color: "white", fontSize: 20 });
});

test("an unchanged style is the same object, so what is below it is not rebuilt", () => {
  const first = textStyleOf(undefined, { color: "white", fontVariant: ["tabular-nums"], fontSize: 12 });
  expect(textStyleOf(undefined, { color: "white", fontVariant: ["tabular-nums"], fontSize: 12 }, first)).toBe(first);
  expect(textStyleOf(undefined, { color: "black", fontVariant: ["tabular-nums"], fontSize: 12 }, first)).not.toBe(first);
  const relative = textStyleOf(undefined, { fontRelative: { lineHeight: 1.5 } });
  expect(textStyleOf(undefined, { fontRelative: { lineHeight: 1.5 } }, relative)).toBe(relative);
  expect(textStyleOf(undefined, { fontRelative: { lineHeight: 2 } }, relative)).not.toBe(relative);
  const passed = textStyleOf(first, { padding: 2 }, first);
  expect(passed).toBe(first);
});

test("a line height is a size or a factor, whichever was set last", () => {
  const factor = textStyleOf(undefined, { fontRelative: { lineHeight: 1.5 } });
  expect(factor).toEqual({ fontRelative: { lineHeight: 1.5 } });
  // A size over a factor, and a factor over a size.
  expect(textStyleOf(factor, { lineHeight: 20 })).toEqual({ lineHeight: 20 });
  expect(textStyleOf({ lineHeight: 20 }, { fontRelative: { lineHeight: 1.25 } })).toEqual({ fontRelative: { lineHeight: 1.25 } });
  // The two relative keys are separate.
  expect(textStyleOf(factor, { fontRelative: { letterSpacing: 0.1 } })).toEqual({ fontRelative: { lineHeight: 1.5, letterSpacing: 0.1 } });
  expect(textStyleOf(factor, { letterSpacing: 2 })).toEqual({ fontRelative: { lineHeight: 1.5 }, letterSpacing: 2 });
});

test("a factor is made into dp for the font size the element ends up with: its own, else the inherited one, else 14", () => {
  expect(fontSizeOf(undefined, undefined)).toBe(DEFAULT_FONT_SIZE);
  expect(fontSizeOf({ fontSize: 18 }, undefined)).toBe(18);
  expect(fontSizeOf({ fontSize: 18 }, [null, { fontSize: 10 }])).toBe(10);
  expect(resolveRelative({ fontRelative: { lineHeight: 1.5, letterSpacing: 0.1 }, color: "red" }, 20)).toEqual({ color: "red", lineHeight: 30, letterSpacing: 2 });
  // In the place it was written: an item after it still overrides it.
  expect(resolveRelative([{ fontRelative: { lineHeight: 2 } }, { lineHeight: 9 }], 10)).toEqual([{ lineHeight: 20 }, { lineHeight: 9 }]);
  const plain = [{ color: "red" }];
  expect(resolveRelative(plain, 10)).toBe(plain);
});

test("a text and an input take the inherited style under their own; any other marked element only has its factors made into dp", () => {
  const inherited = textStyleOf(undefined, { color: "white", fontSize: 18, fontRelative: { lineHeight: 1.5 } });
  // A text: the inherited style (its factor made into dp for the size the text ends up with) and then the text's own.
  expect(inheritedStyle(inherited, { color: "red" }, true)).toEqual([{ color: "white", fontSize: 18, lineHeight: 27 }, { color: "red" }]);
  expect(inheritedStyle(inherited, { fontSize: 10 }, true)).toEqual([{ color: "white", fontSize: 18, lineHeight: 15 }, { fontSize: 10 }]);
  expect(inheritedStyle(inherited, undefined, true)).toEqual({ color: "white", fontSize: 18, lineHeight: 27 });
  // A view (or a text inside another): nothing inherited is added; its own relative values use the size it would have.
  expect(inheritedStyle(inherited, { padding: 4, fontRelative: { lineHeight: 2 } }, false)).toEqual({ padding: 4, lineHeight: 36 });
  expect(inheritedStyle(undefined, { padding: 4 }, false)).toEqual({ padding: 4 });
  expect(inheritedStyle(undefined, { fontRelative: { lineHeight: 2 } }, true)).toEqual({ lineHeight: 28 });
  // Nothing inherited and nothing relative: the style as it is, the same object.
  const own = { margin: 1 };
  expect(inheritedStyle(undefined, own, true)).toBe(own);
});

test("a default style that is a factor of the font size the element inherits (h1 is 2em, small 0.8em) is that size, which the element's own font size replaces, and which its descendants inherit", () => {
  const outer = textStyleOf(undefined, { fontSize: 20 });
  // Of what is inherited; 14 when nothing is.
  expect(textStyleOf(outer, { fontScale: 2, fontWeight: "700" })).toEqual({ fontSize: 40, fontWeight: "700" });
  expect(textStyleOf(undefined, { fontScale: 2 })).toEqual({ fontSize: 28 });
  // A later style in the order of the array wins: the heading's own size (a class after the default), and a default after a size is of that size.
  expect(textStyleOf(outer, [{ fontScale: 2 }, { fontSize: 18 }])).toEqual({ fontSize: 18 });
  expect(textStyleOf(outer, [{ fontSize: 10 }, { fontScale: 0.8 }])).toEqual({ fontSize: 8 });
  expect(hasTextKeys({ fontScale: 0.8 })).toBe(true);
  expect(fontSizeOf(outer, { fontScale: 0.75 })).toBe(15);
  // What a text is drawn with: the factor made into the size, in the place it was written, so a later item overrides it.
  expect(resolveRelative([{ fontScale: 1.5, fontWeight: "700" }, { color: "red" }], 30, 20)).toEqual([{ fontWeight: "700", fontSize: 30 }, { color: "red" }]);
  expect(inheritedStyle(outer, [{ fontScale: 2 }, { fontSize: 18 }], true)).toEqual([{ fontSize: 20 }, [{ fontSize: 40 }, { fontSize: 18 }]]);
  // A line height that is a factor is of that size.
  expect(inheritedStyle(textStyleOf(undefined, { fontRelative: { lineHeight: 1.5 } }), { fontScale: 2 }, true)).toEqual([{ lineHeight: 42 }, { fontSize: 28 }]);
});
