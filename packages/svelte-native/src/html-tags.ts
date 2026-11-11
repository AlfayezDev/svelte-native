/**
 * The HTML elements the lowering maps (`lower-html.ts`), and what each is on a device: one table for the build, which rewrites the markup it can read, and the run time
 * (`hostTag` of the renderer), which maps the tag of a `<svelte:element this={tag}>` when it is known. Pure data, so both can import it.
 */

/**
 * What an element becomes. `view`, `text`, `button`, `link`, `image`, `rule` and `pre`: a host tag; `input` and `textarea`: `TextInput` (an `input` of `type="checkbox"` is a `Switch`);
 * `dialog`: `Modal`; `br`: a newline of the text it is in.
 */
export type Kind = "view" | "text" | "button" | "link" | "image" | "input" | "textarea" | "dialog" | "pre" | "br" | "rule";

export const ELEMENTS: Record<string, Kind> = {};
for (const name of "div section header footer main nav article aside ul ol li form label figure fieldset dl dd".split(" ")) ELEMENTS[name] = "view";
for (const name of "p span h1 h2 h3 h4 h5 h6 strong b em i small code blockquote figcaption dt mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" ")) ELEMENTS[name] = "text";
Object.assign(ELEMENTS, { button: "button", a: "link", img: "image", input: "input", textarea: "textarea", dialog: "dialog", pre: "pre", br: "br", hr: "rule" });

/**
 * What flows with text in a line: bare text and `{expression}`s next to these (and next to each other) are drawn as one text, which the inline elements are spans of. The elements made
 * from these are marked `nativeHtml="inline"`; the host makes the text (`fabric/host.ts`, `buildRun`).
 */
export const INLINE = new Set("span strong b em i small code a br mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" "));

const HOST_TAGS: Partial<Record<Kind, string>> = {
  view: "native-view", rule: "native-view", text: "native-text", pre: "native-text", button: "native-pressable", link: "native-pressable", image: "native-image",
};

/** The host tag of an HTML element name, or undefined when it is not a host tag here (it is a component, or has no equivalent). */
export function hostTagOf(name: string): string | undefined {
  const kind = Object.hasOwn(ELEMENTS, name) ? ELEMENTS[name] : undefined;
  return kind === undefined ? undefined : HOST_TAGS[kind];
}

/**
 * The elements that have a default style, as a browser's has: `nativeBase` of the element is its name, and the host works the style out (`fabric/host.ts`, `baseStyle`), under
 * the element's class and style. `a` has none: its color is the app's to give.
 */
export const USER_AGENT_STYLES = new Set("b strong em i cite dfn var u ins s del code kbd samp pre small sub sup mark h1 h2 h3 h4 h5 h6".split(" "));
