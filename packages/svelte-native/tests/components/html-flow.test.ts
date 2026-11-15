import { expect, test } from "bun:test";
import { flexKeysOf, isFlexContainer, isHidden, isInlineLevel } from "../../src/fabric/html-flow.ts";

// What the host reads of a style to lay the children of an HTML view out (`fabric/html-flow.ts`); the trees it gives are in html-elements.test.ts.

test("a flex container has an explicit display: flex, or a key only a flex container has", () => {
  expect(isFlexContainer(undefined)).toBe(false);
  expect(isFlexContainer({ padding: 4, backgroundColor: "red" })).toBe(false);
  expect(isFlexContainer({ display: "flex" })).toBe(true);
  expect(isFlexContainer({ display: "flex", htmlDisplay: "inline-flex" })).toBe(true);
  for (const key of ["flexDirection", "flexWrap", "gap", "rowGap", "columnGap", "justifyContent", "alignItems", "alignContent"]) expect(isFlexContainer({ [key]: key === "gap" ? 4 : "row" }), key).toBe(true);
  // A key that is undefined or null is not set; `flex`, `flexGrow` and `alignSelf` are an item's, not a container's.
  expect(isFlexContainer({ gap: undefined, flexDirection: null })).toBe(false);
  expect(isFlexContainer({ flex: 1, flexGrow: 1, alignSelf: "center" })).toBe(false);
  expect(isFlexContainer([{ padding: 1 }, [null, { alignItems: "center" }]])).toBe(true);
});

test("the class compiler writes flex for a block too, with the keyword that was used: a block is not a flex container, and the last display of the array is the one that counts", () => {
  expect(isFlexContainer({ display: "flex", htmlDisplay: "block" })).toBe(false);
  expect(isFlexContainer({ display: "flex", htmlDisplay: "inline" })).toBe(false);
  expect(isFlexContainer([{ display: "flex", htmlDisplay: "flex" }, { display: "flex", htmlDisplay: "block" }])).toBe(false);
  expect(isFlexContainer([{ display: "flex", htmlDisplay: "block" }, { display: "flex", htmlDisplay: "flex" }])).toBe(true);
  // A display written by hand beside a class's takes the keyword with it: the class's `block` does not outlive `display: 'flex'`.
  expect(isFlexContainer([{ display: "flex", htmlDisplay: "block" }, { display: "flex" }])).toBe(true);
  // A block with a gap or a direction is a flex container, as a `block gap-2` is on a device (there is no other kind of layout).
  expect(isFlexContainer({ display: "flex", htmlDisplay: "block", gap: 4 })).toBe(true);
});

test("a key that a later item of the array leaves unset is not set: a flex key is not sticky", () => {
  expect(isFlexContainer([{ gap: 8 }, { gap: undefined }])).toBe(false);
  expect(isFlexContainer([{ gap: 8 }, { gap: null }])).toBe(false);
  expect(isFlexContainer([{ gap: undefined }, { gap: 8 }])).toBe(true);
  expect(isFlexContainer([{ gap: 8, alignItems: "center" }, { gap: undefined }])).toBe(true);
  expect(flexKeysOf([{ gap: 8, alignItems: "center" }, { gap: undefined }])).toEqual(["alignItems"]);
  expect(flexKeysOf({ display: "flex", htmlDisplay: "flex", flexDirection: "row" })).toEqual(["display: flex", "flexDirection"]);
  expect(flexKeysOf({ padding: 4 })).toEqual([]);
});

test("the keyword beside a display is believed only where it is one that display comes from", () => {
  // `block` is `flex` on a device; a stale or foreign keyword (a style object that was merged by hand) is not believed.
  expect(isFlexContainer({ display: "none", htmlDisplay: "flex" })).toBe(false);
  expect(isHidden({ display: "none", htmlDisplay: "block" })).toBe(true);
  expect(isInlineLevel({ display: "flex", htmlDisplay: "bogus" })).toBe(false);
  expect(isInlineLevel({ display: "contents", htmlDisplay: "inline" })).toBe(true);
});

test("an inline element is in the line unless it sets a display of its own", () => {
  expect(isInlineLevel(undefined)).toBe(true);
  expect(isInlineLevel({ color: "red", fontWeight: "700" })).toBe(true);
  expect(isInlineLevel({ display: "flex", htmlDisplay: "inline" })).toBe(true);
  expect(isInlineLevel({ display: "flex", htmlDisplay: "inline-block" })).toBe(true);
  expect(isInlineLevel({ display: "contents" })).toBe(true);
  expect(isInlineLevel({ display: "flex", htmlDisplay: "inline-flex" })).toBe(true);
  expect(isHidden({ display: "none", htmlDisplay: "none" })).toBe(true);
  expect(isHidden({ display: "none" })).toBe(true);
  expect(isHidden({ display: "flex", htmlDisplay: "block" })).toBe(false);
  expect(isHidden(undefined)).toBe(false);
  expect(isInlineLevel({ display: "flex", htmlDisplay: "block" })).toBe(false);
  expect(isInlineLevel({ display: "flex", htmlDisplay: "flex" })).toBe(false);
  expect(isInlineLevel({ display: "flex" })).toBe(false);
  expect(isInlineLevel({ display: "none", htmlDisplay: "none" })).toBe(false);
  expect(isInlineLevel([{ display: "flex", htmlDisplay: "block" }, { display: "flex", htmlDisplay: "inline" }])).toBe(true);
});
