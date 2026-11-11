/**
 * What the HTML checks of the native checks lab expect (`/__dev`, "Run all checks": `html-lab.ts` runs them on the elements of `HtmlScreen.svelte`). No React Native import, so the harness's tests load it
 * (`qa/test/html-checks.test.ts` holds the expectations against readings that are right and wrong, `qa/test/html-probe.test.ts` runs the whole flow against the real host).
 *
 * HTML elements are lowered to host tags in the app's own files, and the host decides at run time what they draw: which text is one line, which view lays out items, what text style a text inherits. The
 * checks read the tree the host drew from and what it made of it: a node's props through `mergeHostProps` (what the host builds the native props from), its snapshot (`getSnapshot().children`), and
 * `hostState` (the view the host made for it and the props it gave that view: the style with what it inherited and its default style in it, `viewName`, and `flex` for a marked view). `hostState` is the
 * host's own record, and its fields are the ones the host's own tests read (`tests/html-elements.test.ts` reads the same through a fake Fabric); a change of them fails these checks, which is what they are for.
 */
import { flattenStyle, isColor, type Outcome, type Style } from "./class-checks.ts";

/** The part of the renderer's `NativeNode` the checks read. */
export type HtmlNode = {
  kind: string;
  name: string;
  textValue: string;
  hostState: unknown;
  getSnapshot(): { children: readonly HtmlNode[] };
  peekProps(): Readonly<Record<string, unknown>>;
  getProp(key: string): unknown;
  listeners: Map<string, Set<unknown>>;
  dispatcher(type: string): (...args: unknown[]) => void;
};

/** What the host made for a node: the view's name, `flex` (a marked view: whether its children were laid out as items), the style it gave the view (flattened) and its props. */
export type Built = { viewName: string; flex: boolean | undefined; style: Style; props: Readonly<Record<string, unknown>> };

/** The names of the HTML checks, in the order the lab runs them: `qa/test/class-checks.test.ts` pins their number and their length (logcat cuts the lab's result line near 4 KB). */
export const htmlCheckNames = [
  "html: inherited colour and size reach the text",
  "html: a flex row has 2 items",
  "html: a block div draws text, spans and link as one line",
  "html: h1 is bold at 2x the inherited size",
  "html: a submit press calls onsubmit, prevented",
  "html: input type=password is secure",
] as const;

/** `text-lg` and `text-sky-900` of the card, as the build converts them (`qa/test/html-checks.test.ts` holds both against the class table). */
export const cardSize = 18;
export const sky900 = "#024a70";

export function builtOf(node: HtmlNode | undefined): Built | null {
  const state = node?.hostState as { viewName?: unknown; flex?: unknown; props?: unknown } | null | undefined;
  if (!state || typeof state.viewName !== "string" || state.props === null || typeof state.props !== "object") return null;
  const props = state.props as Record<string, unknown>;
  return { viewName: state.viewName, flex: typeof state.flex === "boolean" ? state.flex : undefined, style: flattenStyle(props.style), props };
}

/** The children of a node that are drawn from: its elements and its text, with the places a block leaves (comments) taken out and fragments opened. */
export function members(node: HtmlNode): HtmlNode[] {
  const found: HtmlNode[] = [];
  for (const child of node.getSnapshot().children) {
    if (child.kind === "comment") continue;
    if (child.kind === "fragment") found.push(...members(child));
    else found.push(child);
  }
  return found;
}
export const isBlank = (node: HtmlNode): boolean => node.kind === "text" && /^[ \t\n\r\f]*$/.test(node.textValue);
/** The text a node draws: its strings and those of the elements in it, in order. */
export const textOf = (node: HtmlNode): string => (node.kind === "text" ? node.textValue : members(node).map(textOf).join(""));
/** The nodes under [node] (it included) for which [wanted] holds, in document order. */
export function find(node: HtmlNode, wanted: (candidate: HtmlNode) => boolean): HtmlNode[] {
  return [...(wanted(node) ? [node] : []), ...members(node).flatMap((child) => find(child, wanted))];
}

/** What the screen counted and what the form's handler saw of the last submission (`HtmlScreen.counted`). */
export type Counted = { links: number; submits: number; last: { type: string; prevented: boolean; target: boolean; submitter: boolean } | null };
/** What a text input is, read from the node and from what the host built for it. */
export type InputRead = { own: unknown; built: unknown };
/** A member of the block div: what it is, the view the host made of it, and for the link its role and `href`. */
export type MemberRead = { kind: string; view: string | undefined; text: string; role: unknown; href: unknown };

const verdict = (passed: boolean, detail: string): Outcome => ({ passed, detail: passed ? "" : detail });
const said = (style: Style | undefined, ...keys: string[]): string => (style ? keys.map((key) => `${key} ${JSON.stringify(style[key])}`).join(", ") : "not built");

/** What each check asks of what it read. A function answers whether the reading is right, with a message for when it is not (empty when it is). */
export const expectations = {
  /** [card] is the card's own style (`mergeHostProps`), [paragraph] and [span] what the host built for a `p` of the card and for a span of its flex row, which is a view between them and the card. */
  inherit: (card: Style, paragraph: Built | null, span: Built | null): Outcome => {
    const given = isColor(card.color, sky900, 1) && card.fontSize === cardSize;
    const reached = (built: Built | null) => !!built && isColor(built.style.color, sky900, 1) && built.style.fontSize === cardSize;
    return verdict(given && reached(paragraph) && reached(span), `card ${said(card, "color", "fontSize")}; p ${said(paragraph?.style, "color", "fontSize")}; span ${said(span?.style, "color", "fontSize")}`);
  },
  /** [row] is what the host built for the flex row, [items] its elements with the view the host made of each: two texts of their own, not spans of one line. */
  row: (row: Built | null, items: { view: string | undefined; text: string }[]): Outcome =>
    verdict(!!row && row.flex === true && items.length === 2 && items.every((item) => item.view === "RCTText") && items[0]?.text === "Total" && items[1]?.text === "42",
      `flex ${row?.flex}; ${items.length} items: ${items.map((item) => `${item.view} "${item.text}"`).join(", ")}`),
  /** [block] is what the host built for the block div, [parts] its members: text and spans that are one line (no text of its own among them), the link a span with its role and `href`. */
  block: (block: Built | null, parts: MemberRead[]): Outcome => {
    const elements = parts.filter((part) => part.kind === "element");
    const link = elements.find((part) => part.role === "link");
    const sentence = parts.map((part) => part.text).join("");
    return verdict(
      !!block && block.flex === false && elements.length === 3 && elements.every((part) => part.view === "RCTVirtualText") && !!link && link.href === "#terms" && link.text === "terms of use" && sentence === "Read the terms of use and the privacy notice, or both.",
      `flex ${block?.flex}; ${elements.map((part) => `${part.view} "${part.text}"`).join(", ")}; link ${JSON.stringify(link?.role)} ${JSON.stringify(link?.href)}; "${sentence}"`,
    );
  },
  /** [card] is the card's own style, [h1] what the host built for the heading: bold, twice the size it inherits, a header. */
  heading: (card: Style, h1: Built | null): Outcome =>
    verdict(typeof card.fontSize === "number" && !!h1 && h1.style.fontWeight === "700" && h1.style.fontSize === 2 * card.fontSize && h1.props.accessibilityRole === "header",
      `card ${said(card, "fontSize")}; h1 ${said(h1?.style, "fontSize", "fontWeight")} ${JSON.stringify(h1?.props.accessibilityRole)}`),
  /** The press on the submit button: the form heard it once (count and what its handler saw), the press on the button that is not a submit button changed nothing. */
  submit: (before: Counted, afterSubmit: Counted, afterPlain: Counted): Outcome => {
    const last = afterSubmit.last;
    return verdict(
      afterSubmit.submits === before.submits + 1 && !!last && last.type === "submit" && last.prevented && last.target && last.submitter && afterPlain.submits === afterSubmit.submits,
      `submits ${before.submits} -> ${afterSubmit.submits} -> ${afterPlain.submits}; last ${JSON.stringify(last)}`,
    );
  },
  /** The password input and the plain one: the first is secure as the node says and as the host built it, the second is not. */
  password: (secure: InputRead | null, plain: InputRead | null): Outcome =>
    verdict(!!secure && !!plain && secure.own === true && secure.built === true && plain.own !== true && plain.built !== true,
      `password ${JSON.stringify(secure)}; plain ${JSON.stringify(plain)}`),
};
