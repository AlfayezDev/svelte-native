/**
 * How the children of a marked HTML view are laid out (`host.ts`, `childrenHost`): text and inline elements in a block container are one line, and in a flex container each element is an
 * item and each run of text an anonymous one, as CSS makes them. Which of the two a view is, is read from its resolved style, and whether an inline element is in the line from its own.
 */

/** The style keys that only a flex container has a use for: any of them makes a view one, as `display: flex` does. */
const FLEX_KEYS = new Set(["flexDirection", "flexWrap", "gap", "rowGap", "columnGap", "justifyContent", "alignItems", "alignContent"]);

type Layout = { keyword: string | undefined; flexKeys: boolean };

/**
 * What a style says about layout, read as React Native flattens it (a later item's key wins). `display` is what the native view gets, and the class compiler writes `flex` for `block`,
 * `inline` and `inline-block` too (React Native has no others: `md:block` undoes `hidden` with it), so the keyword the author used comes with it as `htmlDisplay`; a `display` that
 * is written by hand (a style object) is its own keyword.
 */
function layoutOf(style: unknown, into: Layout = { keyword: undefined, flexKeys: false }): Layout {
  if (Array.isArray(style)) {
    for (const item of style) layoutOf(item, into);
    return into;
  }
  if (style === null || typeof style !== "object") return into;
  const object = style as Record<string, unknown>;
  if (typeof object.display === "string") into.keyword = typeof object.htmlDisplay === "string" ? object.htmlDisplay : object.display;
  for (const key in object) if (FLEX_KEYS.has(key) && object[key] !== undefined && object[key] !== null) into.flexKeys = true;
  return into;
}

/** A view that lays its children out as a flex container: an explicit `display: flex` (`flex`, `inline-flex`), or a key only a flex container has (a direction, a gap, an alignment). */
export function isFlexContainer(style: unknown): boolean {
  const layout = layoutOf(style);
  return layout.keyword === "flex" || layout.keyword === "inline-flex" || layout.flexKeys;
}

/** An element that is in the line of text around it: one that does not set its `display`, or sets it to what is in a line (`inline`, `inline-block`, `contents`). A `block`, a `flex` or a hidden one is an item of its own. */
export function isInlineLevel(style: unknown): boolean {
  const { keyword } = layoutOf(style);
  return keyword === undefined || keyword === "inline" || keyword === "inline-block" || keyword === "contents";
}
