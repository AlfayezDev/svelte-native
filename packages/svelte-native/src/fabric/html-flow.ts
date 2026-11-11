/**
 * How the children of a marked HTML view are laid out (`host.ts`, `childrenHost`): text and inline elements in a block container are one line, and in a flex container each element is an
 * item and each run of text an anonymous one, as CSS makes them. Which of the two a view is, is read from its resolved style, and whether an inline element is in the line from its own.
 */

/** The style keys that only a flex container has a use for: any of them makes a view one, as `display: flex` does. */
export const FLEX_KEYS: ReadonlySet<string> = new Set(["flexDirection", "flexWrap", "gap", "rowGap", "columnGap", "justifyContent", "alignItems", "alignContent"]);

/** What the native `display` is for each keyword the class compiler maps (`css/properties.ts`, which has its own copy for Node): `htmlDisplay` is believed only where it agrees with the `display` it comes with, and a keyword that is not here has no native equivalent. */
export const NATIVE_DISPLAY: Record<string, string> = { flex: "flex", "inline-flex": "flex", block: "flex", "inline-block": "flex", inline: "flex", "flow-root": "flex", none: "none", contents: "contents" };

type Layout = { keyword: string | undefined; flexKeys: Set<string> | undefined };

/**
 * What a style says about layout, read as React Native flattens it (a later item's key wins, so a key that a later item sets to `undefined` is not set). `display` is what the native
 * view gets, and the class compiler writes `flex` for `block`, `inline` and `inline-block` too (React Native has no others: `md:block` undoes `hidden` with it), so the keyword the author
 * used comes with it as `htmlDisplay`, which counts when it is one `display` could have come from; a `display` that is written by hand (a style object) is its own keyword.
 */
function layoutOf(style: unknown, into: Layout = { keyword: undefined, flexKeys: undefined }): Layout {
  if (Array.isArray(style)) {
    for (const item of style) layoutOf(item, into);
    return into;
  }
  if (style === null || typeof style !== "object") return into;
  const object = style as Record<string, unknown>;
  const display = object.display;
  if (typeof display === "string") {
    const written = object.htmlDisplay;
    into.keyword = typeof written === "string" && Object.hasOwn(NATIVE_DISPLAY, written) && NATIVE_DISPLAY[written] === display ? written : display;
  }
  for (const key in object) {
    if (!FLEX_KEYS.has(key)) continue;
    if (object[key] === undefined || object[key] === null) into.flexKeys?.delete(key);
    else {
      into.flexKeys ??= new Set();
      into.flexKeys.add(key);
    }
  }
  return into;
}

/** A view that lays its children out as a flex container: an explicit `display: flex` (`flex`, `inline-flex`), or a key only a flex container has (a direction, a gap, an alignment). */
export function isFlexContainer(style: unknown): boolean {
  const layout = layoutOf(style);
  return layout.keyword === "flex" || layout.keyword === "inline-flex" || (layout.flexKeys?.size ?? 0) > 0;
}

/** An element that is in the line of text around it: one that does not set its `display`, or sets it to what is in a line (`inline`, `inline-block`, `inline-flex`, `contents`). A `block`, a `flex` or a hidden one is not (`isHidden`: it is an item of its own). */
export function isInlineLevel(style: unknown): boolean {
  const { keyword } = layoutOf(style);
  return keyword === undefined || keyword === "inline" || keyword === "inline-block" || keyword === "inline-flex" || keyword === "contents";
}

/** An element with `display: none`: it has no box, so it does not break the line around it. */
export function isHidden(style: unknown): boolean {
  return layoutOf(style).keyword === "none";
}

/** The keys of a style that make a view a flex container, for the warning that they do nothing on a text. */
export function flexKeysOf(style: unknown): string[] {
  const layout = layoutOf(style);
  return [...(layout.keyword === "flex" || layout.keyword === "inline-flex" ? ["display: flex"] : []), ...(layout.flexKeys ?? [])];
}
