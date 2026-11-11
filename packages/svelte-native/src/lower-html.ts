/**
 * HTML elements to native ones, at compile time: `<div>`, `<p>`, `<button>`, `<a href>`, `<img>`, `<input>` and the rest of the table in `ELEMENTS`, so one `.svelte` file can be
 * written with HTML for SvelteKit and still run on a device. `lower.ts` calls this for the files the Metro transformer lowers (never for the web build, which does not load
 * `lower.ts`: `vite.ts` compiles `.svelte` files through SvelteKit alone), when the file is the app's own (`lowersHtml` in `compile-options.ts`).
 *
 * Two kinds of result. An element that is a plain host tag (`div`, `p`, `button`, `a`, `img`) is handed back in `elements`, and `lower.ts` carries over its `class`, `class:`,
 * `style` and spreads through the paths a lowered `<View>` takes (`bind:this` becomes a `ref`); the attributes this file rewrites (`onclick` to `onPress`, `src` to `source`) are in `handled`. An element
 * that needs a component for its meaning (`input` and `textarea` are a `TextInput`, a checkbox a `Switch`, `dialog` a `Modal`: they bind) is rewritten here, with the component imported
 * under a name of its own. The text that sits directly in a view-like element is wrapped in a `native-text` (the host draws no bare text, `fabric/host.ts`).
 *
 * Every element it makes a host tag of is marked (`nativeHtml`): the host passes the text style of a marked element (`class="text-lg"`, `style="color: white"`) down to the text and
 * the inputs of the marked elements below it, as CSS does (`fabric/text-inherit.ts`). A `<form>` is marked too (`nativeForm`), and a `<button>` or Enter in an input submits the form above it
 * (`hostSubmit`). A `style="..."` string is converted here (`css/inline.ts`), and `style:property` directives are worked out when they change (`hostStyleProps`).
 *
 * Only text is inserted and renamed, and no newline is added, so a line number in the source is still the line of the same markup. What has no native meaning is an error that names
 * the element, the file and the line (all of them, in one message); a web handler that can never run on a device is a warning.
 */
import { convertInlineStyle } from "./css/inline.ts";
import { inputTypeProps } from "./html-input.ts";

const PACKAGE = "@example/svelte-native";
const CORE = `${PACKAGE}/core`;
const ROUTER = `${PACKAGE}/router`;

// The renderer's helpers the generated code calls (`renderer.ts`), by the names `lower.ts` imports them under.
export const SOURCE_HELPER = "__svelteNativeSource";
export const INPUT_TYPE_HELPER = "__svelteNativeInputType";
export const INPUT_EVENT_HELPER = "__svelteNativeInputEvent";
/** `hostSpread` for the spread of an HTML element: a web handler name in the spread (`onclick`) is the native one. */
export const WEB_SPREAD_HELPER = "__svelteNativeWebSpread";
/** `hostClass` for a lowered HTML element: the font-relative values of a class wait for the font size the element inherits. */
export const HTML_CLASS_HELPER = "__svelteNativeHtmlClass";
export const CLICK_HELPER = "__svelteNativeClick";
export const SUBMIT_HELPER = "__svelteNativeSubmit";
export const KEY_HELPER = "__svelteNativeKeyEvent";
export const STYLE_HELPER = "__svelteNativeStyleProps";
/** `hostValue` of `lower.ts`: a function next to a spread (a `ref`) is boxed, or Svelte's `set_attributes` drops it. */
const VALUE_HELPER = "__svelteNativeValue";
export const HTML_HELPER_EXPORTS: Record<string, string> = {
  [SOURCE_HELPER]: "hostSource",
  [INPUT_TYPE_HELPER]: "hostInputType",
  [INPUT_EVENT_HELPER]: "hostInputEvent",
  [WEB_SPREAD_HELPER]: "hostWebSpread",
  [HTML_CLASS_HELPER]: "hostHtmlClass",
  [CLICK_HELPER]: "hostClick",
  [SUBMIT_HELPER]: "hostSubmit",
  [KEY_HELPER]: "hostKeyEvent",
  [STYLE_HELPER]: "hostStyleProps",
};

/** The function a pressed `<a href>` calls: `useLink()` (`router.svelte.ts`) is called while the component initializes, which a handler cannot do. */
const LINK = "__svelteNativeLink";
/** The components that carry what a host tag cannot (a binding), under names that cannot collide with the file's own imports (a tag name must start with a capital). */
const COMPONENTS: Record<string, string> = { TextInput: "SvelteNativeTextInput", Switch: "SvelteNativeSwitch", Modal: "SvelteNativeModal" };

// The Svelte AST is walked structurally, so nodes are deliberately loosely typed.
// biome-ignore lint/suspicious/noExplicitAny: structural AST walk
type Node = { type: string; start: number; end: number; [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Edit = { start: number; end: number; text: string };

/** A host tag `lower.ts` renames the element to, and what it must leave to this file. */
export type LoweredElement = {
  tag: string;
  /** Attributes this file rewrote: `lower.ts` does nothing more with them. */
  handled: Set<Node>;
  /** Attributes the element gets, written (with a space before each) after the tag name, so the ones the file wrote itself come later and win. */
  attributes: string;
  /** A void element (`<img>`) has no closing tag to rename: the host tag needs one. */
  isVoid: boolean;
};

export type HtmlLowering = {
  elements: Map<Node, LoweredElement>;
  /** What this file rewrites itself: wrapped text, and the elements that become components. */
  edits: Edit[];
  /** The renderer's helpers (keys of `HTML_HELPER_EXPORTS`) the generated code calls. */
  helpers: Set<string>;
  /** Import statements for the script. */
  imports: string[];
  /** Statements for the instance script (they run when the component initializes). */
  setup: string[];
};

/**
 * The elements and what each becomes. `view`, `text`, `button`, `link`, `image`: a host tag; `input` and `textarea`: `TextInput` (an `input` of `type="checkbox"` is a `Switch`);
 * `dialog`: `Modal`.
 */
type Kind = "view" | "text" | "button" | "link" | "image" | "input" | "textarea" | "dialog" | "pre" | "br" | "rule";
const ELEMENTS: Record<string, Kind> = {};
for (const name of "div section header footer main nav article aside ul ol li form label figure fieldset dl dd".split(" ")) ELEMENTS[name] = "view";
for (const name of "p span h1 h2 h3 h4 h5 h6 strong b em i small code blockquote figcaption dt mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" ")) ELEMENTS[name] = "text";
Object.assign(ELEMENTS, { button: "button", a: "link", img: "image", input: "input", textarea: "textarea", dialog: "dialog", pre: "pre", br: "br", hr: "rule" });

/** What flows with text in a line: bare text and `{expression}`s next to these make one `native-text` of their own. */
const INLINE = new Set("span strong b em i small code a br mark kbd time abbr s u del ins q cite sub sup var samp dfn data".split(" "));

const table = "tables have no native equivalent: lay the rows out with flex `div`s (`flex flex-row`)";
const select = "there is no native select: show the choices as a list of `button`s, in a `Modal` if they should cover the screen";
const web = "use `WebView` from `@example/svelte-native/foreign`";
const textLike = "use a `span` (or `p`)";
const blockLike = "use a `div`";
/** What to use instead of an HTML element that has no native one. */
const HINTS: Record<string, string> = {
  table, thead: table, tbody: table, tfoot: table, tr: table, td: table, th: table, caption: table, colgroup: table, col: table,
  canvas: "there is no canvas: draw with the SVG components of `@example/svelte-native/svg` (react-native-svg)",
  svg: "SVG is react-native-svg here: import `Svg`, `Path`, ... from `@example/svelte-native/svg`",
  video: "use `Video` (react-native-video) or `VideoView` (expo-video) from `@example/svelte-native/foreign`",
  audio: "there is no audio element: play sound with a native module such as expo-audio",
  iframe: web, embed: web, object: web,
  select, option: select, optgroup: select, datalist: select,
  progress: "use `ActivityIndicator`, or a `div` whose width follows the value",
  meter: "use a `div` whose width follows the value",
  picture: "use an `img`",
  source: "use `img`, or `Video` from `@example/svelte-native/foreign`",
  details: blockLike, summary: blockLike, menu: "use a `ul`", legend: textLike, address: blockLike, hgroup: blockLike, search: blockLike,
  bdi: textLike, bdo: textLike, rp: textLike, rt: textLike, ruby: textLike, wbr: textLike, output: textLike,
  map: "image maps have no native equivalent", area: "image maps have no native equivalent",
  track: "use `Video` from `@example/svelte-native/foreign`",
  template: "there is no template element: use a snippet (`{#snippet}`)", noscript: "there is no noscript on a device",
  link: "there is nothing to link on a device", meta: "there is nothing to describe on a device", base: "there is no base URL on a device", param: "use `WebView` from `@example/svelte-native/foreign`",
};
const DEFAULT_HINT = "use a `div` (View) or a `span` (Text), or a component of `@example/svelte-native`";
const HTML_NAMES = new Set([...Object.keys(ELEMENTS), ...Object.keys(HINTS), "slot", "style", "script", "title", "head", "body", "html"]);
const OPENING = new RegExp(`<(?:${[...HTML_NAMES].join("|")})(?=[\\s/>])`);

/** True when the file may have an HTML element the lowering handles (a cheap test, so a file with none is not parsed). */
export function mayHaveHtml(content: string): boolean {
  return OPENING.test(content);
}

const UNSUPPORTED_TYPES: Record<string, string> = {
  radio: "there is no native radio: use a `button` per choice and keep the chosen one in state",
  submit: "use a `button`", reset: "use a `button`", button: "use a `button`", image: "use a `button` around an `img`",
  file: "there is no file input: pick files with a native module such as expo-document-picker",
  range: "there is no slider here: build one with gestures (`@example/svelte-native/gestures`)",
  color: "there is no color picker", hidden: "keep the value in a variable",
  date: "use `DateTimePicker` from `@example/svelte-native/foreign`", time: "use `DateTimePicker` from `@example/svelte-native/foreign`",
  "datetime-local": "use `DateTimePicker` from `@example/svelte-native/foreign`", month: "use `DateTimePicker` from `@example/svelte-native/foreign`", week: "use `DateTimePicker` from `@example/svelte-native/foreign`",
};

// What an HTML attribute is called for a `TextInput` (the ones not named here keep their name).
const INPUT_RENAMES: Record<string, string> = {
  readonly: "readOnly", autofocus: "autoFocus", autocomplete: "autoComplete", autocapitalize: "autoCapitalize", inputmode: "inputMode", enterkeyhint: "enterKeyHint",
  onfocus: "onFocus", onblur: "onBlur",
};

const lines = (text: string): number => text.split("\n").length - 1;
const WHITESPACE = /^[ \t\n\r\f]*$/;
const NUMBER = /^\d+(?:\.\d+)?(?:px)?$/;

type Context = "view" | "text" | "unknown";


/** Where the text of a `<pre>` is: the whitespace in it is the text, and Svelte would trim and collapse it in any element but a `pre`. */
type Pre = "start" | "inside" | undefined;

export function lowerHtml(ast: Node, content: string, filename: string | undefined, warn: (message: string) => void = () => {}): HtmlLowering {
  const out: HtmlLowering = { elements: new Map(), edits: [], helpers: new Set(), imports: [], setup: [] };
  const problems: string[] = [];
  const components = new Set<string>();
  let link = false;

  const slice = (node: Node): string => content.slice(node.start, node.end);
  const where = (node: Node): string => {
    const before = content.slice(0, node.start);
    return `${filename ?? "component"}:${lines(before) + 1}:${node.start - before.lastIndexOf("\n")}`;
  };
  const fail = (node: Node, message: string): void => {
    problems.push(`${where(node)} ${message}`);
  };
  /** Replaces `[start, end)`; the newlines the old text had and the new one lacks are written after it, so no line number below moves. */
  const replace = (start: number, end: number, text: string): void => {
    const lost = lines(content.slice(start, end)) - lines(text);
    out.edits.push({ start, end, text: lost > 0 ? text + "\n".repeat(lost) : text });
  };
  const replaceNode = (node: Node, text: string): void => replace(node.start, node.end, text);
  /** Gives an `Attribute` another name (the shorthand `{onclick}` becomes `onPress={onclick}`). */
  const rename = (attribute: Node, to: string): void => {
    if (content[attribute.start] === "{") out.edits.push({ start: attribute.start, end: attribute.start, text: `${to}=` });
    else out.edits.push({ start: attribute.start, end: attribute.start + attribute.name.length, text: to });
  };
  const helper = (name: string): string => {
    out.helpers.add(name);
    return name;
  };

  const attributeNamed = (node: Node, name: string): Node | undefined => (node.attributes as Node[]).find((attribute) => attribute.type === "Attribute" && attribute.name === name);
  const directive = (node: Node, type: string, name: string): Node | undefined => (node.attributes as Node[]).find((attribute) => attribute.type === type && attribute.name === name);
  const expressionSource = (expression: Node): string => content.slice(expression.start, expression.end);

  /** The text of an attribute written as plain text (`type="email"`), or undefined when it is an expression, has expressions in it or has no value. */
  const staticText = (attribute: Node): string | undefined => {
    const value = attribute.value;
    if (value === true) return undefined;
    if (Array.isArray(value)) return (value as Node[]).every((part) => part.type === "Text") ? (value as Node[]).map((part) => part.data).join("") : undefined;
    return value.type === "ExpressionTag" && value.expression.type === "Literal" && typeof value.expression.value === "string" ? value.expression.value : undefined;
  };
  /** An attribute's value as one expression: `{expr}` as written, text as a string literal, a quoted value with `{expr}` parts as a template literal, nothing as `true`. */
  const valueSource = (attribute: Node): string => {
    const value = attribute.value;
    if (value === true) return "true";
    if (!Array.isArray(value)) return expressionSource(value.expression);
    const parts = value as Node[];
    if (parts.length === 1 && parts[0].type === "ExpressionTag") return expressionSource(parts[0].expression);
    if (parts.every((part) => part.type === "Text")) return JSON.stringify(parts.map((part) => part.data).join(""));
    let template = "`";
    for (const part of parts) template += part.type === "Text" ? part.data.replace(/[`\\$]/g, (match: string) => `\\${match}`) : `\${(${expressionSource(part.expression)}) ?? ""}`;
    return `${template}\``;
  };
  /** The function an `onclick`-style attribute or `on:click` directive hands the element, as source; undefined when there is none (or it only forwards the event). */
  const handlerSource = (attribute: Node, web: string): string | undefined => {
    if (attribute.type === "Attribute" && attribute.name === `on${web}` && attribute.value !== true && !Array.isArray(attribute.value)) return expressionSource(attribute.value.expression);
    if (attribute.type === "OnDirective" && attribute.name === web && attribute.expression && (attribute.modifiers as string[]).length === 0) return expressionSource(attribute.expression);
    return undefined;
  };
  const handlerOf = (node: Node, web: string): { attribute: Node; source: string } | undefined => {
    for (const attribute of node.attributes as Node[]) {
      const source = handlerSource(attribute, web);
      if (source !== undefined) return { attribute, source };
    }
    return undefined;
  };
  /** An event attribute under the native name: an attribute is renamed, the directive is written as the attribute. */
  const nativeHandler = (found: { attribute: Node; source: string }, to: string): void => {
    if (found.attribute.type === "Attribute") rename(found.attribute, to);
    else replaceNode(found.attribute, `${to}={${found.source}}`);
  };
  /** An event attribute that is wrapped: the web handler gets an event-like argument built from what the native one gives (`call` is the expression that calls it). */
  const wrappedHandler = (found: { attribute: Node; source: string }, to: string, parameter: string, call: string): void => {
    replaceNode(found.attribute, `${to}={(${parameter}) => (${found.source})?.(${call})}`);
  };

  /** Number attributes the web writes as text (`width="40"`) are numbers on a native view. */
  const numberAttribute = (attribute: Node, name = attribute.name): boolean => {
    const text = staticText(attribute);
    if (text === undefined || !NUMBER.test(text.trim())) return false;
    replaceNode(attribute, `${name}={${Number.parseFloat(text)}}`);
    return true;
  };

  const unsupportedBinding = (node: Node, attribute: Node, hint: string): void => {
    fail(attribute, `bind:${attribute.name} on <${node.name}> is not supported on native: ${hint}`);
  };

  /** The directives that cannot be carried over, and the bindings other than `bind:this` for the ones the caller has not dealt with. */
  const rejectDirectives = (node: Node, allowed: (attribute: Node) => boolean = () => false): void => {
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type === "ClassDirective" && !allowed(attribute)) fail(attribute, `class:${attribute.name} on <${node.name}> is not supported on native here: give \`class\` an array or an object (\`class={[...]}\`)`);
      else if (attribute.type === "BindDirective" && attribute.name !== "this" && !allowed(attribute)) {
        const sizes = /^(?:client|offset)(?:Width|Height)$|^contentRect$|^contentBoxSize$|^borderBoxSize$|^devicePixelContentBoxSize$/;
        unsupportedBinding(node, attribute, sizes.test(attribute.name) ? "measure with `onLayout`" : "there is nothing to bind to on a native view");
      }
    }
  };

  /**
   * A web handler that can never run on a device (`onmouseover`, `onkeydown` on a div) is a warning, not an error: the file is shared with the web, where it runs. `handled` are the
   * events this element does get (`click`, ...): the others, written as `on...` in lower case or as an `on:` directive, are the web's. A native handler (`onLayout`) is camel case.
   */
  const warnUnhandled = (node: Node, handled: readonly string[]): void => {
    for (const attribute of node.attributes as Node[]) {
      const event = attribute.type === "Attribute" && attribute.value !== true && /^on[a-z]+$/.test(attribute.name) ? attribute.name.slice(2) : attribute.type === "OnDirective" ? attribute.name : undefined;
      if (event === undefined || handled.includes(event)) continue;
      warn(`${where(attribute)} ${attribute.type === "Attribute" ? attribute.name : `on:${event}`} on <${node.name}> never runs on a device: a native element has no "${event}" event (the web still calls it)`);
    }
  };

  /**
   * `style="padding: 4px; color: red"` is converted here (`css/inline.ts`) and written as the style object; `style:property={value}` directives become one call that works them out
   * when they change (`hostStyleProps`). The directives and the string go with the element's own `style={...}` into one array, in that order (a directive wins, as on the web). A `style`
   * that is an expression stays as it is, unless there are directives to join it. `property` is the attribute that carries the style on the target (`nativeStyle` for a host tag).
   */
  const lowerStyle = (node: Node, property: "nativeStyle" | "style", handled: Set<Node> | undefined, generated: string[]): void => {
    const attribute = attributeNamed(node, "style");
    const directives = (node.attributes as Node[]).filter((other) => other.type === "StyleDirective");
    let own: string | undefined;
    let rewrite = directives.length > 0;
    if (attribute && attribute.value !== true) {
      if (!Array.isArray(attribute.value)) own = expressionSource(attribute.value.expression);
      else {
        const text = staticText(attribute);
        if (text === undefined) {
          fail(attribute, `style="..." with {...} in it is not supported on native: write the style as an object (\`style={{ ... }}\`), give the element a class, or use \`style:property={value}\``);
          return;
        }
        const converted = convertInlineStyle(text);
        if ("error" in converted) {
          fail(attribute, `style="${text.trim()}" on <${node.name}> cannot be converted: ${converted.error}`);
          return;
        }
        if (Object.keys(converted.style).length > 0) own = JSON.stringify(converted.style);
        rewrite = true;
      }
    }
    if (!rewrite) return;
    const parts = own === undefined ? [] : [own];
    if (directives.length > 0) {
      const entries: string[] = [];
      for (const style of directives) {
        if (style.value === true && !/^[A-Za-z_$][\w$]*$/.test(style.name)) fail(style, `style:${style.name} needs a value: write style:${style.name}={...}`);
        entries.push(`${JSON.stringify(style.name)}: ${style.value === true ? style.name : valueSource(style)}`);
        replaceNode(style, "");
        handled?.add(style);
      }
      parts.push(`${helper(STYLE_HELPER)}({ ${entries.join(", ")} })`);
    }
    const text = parts.length === 0 ? undefined : parts.length === 1 ? (parts[0] as string) : `[${parts.join(", ")}]`;
    if (attribute) {
      handled?.add(attribute);
      replaceNode(attribute, text === undefined ? "" : `${property}={${text}}`);
    } else if (text !== undefined) generated.push(`${property}={${text}}`);
  };

  // The element as a host tag -----------------------------------------------------------------------------------------------------------------------------------------

  const hasRole = (node: Node): boolean => (node.attributes as Node[]).some((attribute) => attribute.type === "Attribute" && (attribute.name === "role" || attribute.name === "accessibilityRole"));

  /**
   * `onclick` (or `on:click`) is `onPress`. With an `href` a press also follows the link, so the `<a>` has no `href` left, and a submit button submits its form: both after the
   * handler, unless it called `preventDefault` on the event (`hostClick`). The attributes it writes are added to `generated`, and the ones it dealt with are `handled`.
   * `submit` is the source of the button's `type`. Returns whether there is a handler of the element's own.
   */
  const press = (node: Node, handled: Set<Node>, generated: string[], href?: Node, submit?: string): boolean => {
    const click = handlerOf(node, "click");
    const target = href === undefined || href.value === true ? undefined : valueSource(href);
    if (href) {
      handled.add(href);
      replaceNode(href, "");
    }
    if (target !== undefined) link = true;
    if (click) handled.add(click.attribute);
    const after = target !== undefined ? `() => ${LINK}(${target})` : submit !== undefined ? `(__event) => ${helper(SUBMIT_HELPER)}(__event, ${submit})` : undefined;
    if (after === undefined) {
      if (click) nativeHandler(click, "onPress");
    } else {
      const call = `onPress={(__event) => ${helper(CLICK_HELPER)}(__event, ${click ? click.source : "undefined"}, ${after})}`;
      if (click) replaceNode(click.attribute, call);
      else generated.push(call);
    }
    return click !== undefined;
  };

  /** A `disabled` button is dimmed for the screen reader too (`aria-disabled`): the host keeps the press state in `disabled` alone. */
  const ariaDisabled = (node: Node, generated: string[]): void => {
    const disabled = attributeNamed(node, "disabled");
    if (disabled && !attributeNamed(node, "aria-disabled")) generated.push(`aria-disabled={${valueSource(disabled)}}`);
  };

  const host = (node: Node, kind: Kind, context: Context): Context => {
    const handled = new Set<Node>();
    const generated: string[] = kind === "image" ? [] : ["nativeHtml={true}"];
    const events = ["click"];
    const role = (name: string): void => {
      if (!hasRole(node)) generated.push(`accessibilityRole="${name}"`);
    };
    let tag = "native-view";
    let inside: Context = "view";
    let isVoid = false;
    if (kind === "text" || kind === "pre") {
      tag = "native-text";
      inside = "text";
      if (/^h[1-6]$/.test(node.name)) role("header");
      press(node, handled, generated);
    } else if (kind === "link") {
      const inText = context === "text";
      tag = inText ? "native-text" : "native-pressable";
      inside = inText ? "text" : "view";
      role("link");
      press(node, handled, generated, attributeNamed(node, "href"));
    } else if (kind === "button") {
      tag = "native-pressable";
      role("button");
      ariaDisabled(node, generated);
      // A button is a submit button unless it says it is not (`type="button"`): whether a form is above it is known when it is pressed.
      const type = attributeNamed(node, "type");
      const typeText = type && type.value !== true ? staticText(type)?.trim().toLowerCase() : undefined;
      const submit = type === undefined || type.value === true || typeText === "submit" ? "undefined" : typeText === undefined ? valueSource(type) : undefined;
      press(node, handled, generated, undefined, submit);
      // `type` (submit, button, reset) is the form's: nothing else is done with it on a device.
      if (type) {
        handled.add(type);
        replaceNode(type, "");
      }
    } else if (kind === "image") {
      tag = "native-image";
      isVoid = true;
      imageAttributes(node, handled);
      press(node, handled, generated);
      events.push("load", "error");
    } else if (kind === "rule") {
      isVoid = true;
      generated.push(`nativeBase="hairline"`);
    } else {
      if (node.name === "form") {
        generated.push("nativeForm={true}");
        events.push("submit");
      }
      if (press(node, handled, generated)) tag = "native-pressable";
    }
    lowerStyle(node, "nativeStyle", handled, generated);
    // `class:` is carried over by `lower.ts` (as it is for a lowered `<View>`); the other directives have no meaning here.
    rejectDirectives(node, (attribute) => attribute.type === "ClassDirective");
    warnUnhandled(node, events);
    out.elements.set(node, { tag, handled, attributes: generated.map((attribute) => ` ${attribute}`).join(""), isVoid });
    return kind === "image" || kind === "rule" ? "unknown" : inside;
  };

  /** `src` is the `source` of a native image (a string is its `uri`; an asset module or a source object, what Metro makes of an import, passes), `width` and `height` are numbers, `onload` and `onerror` the native names. */
  const imageAttributes = (node: Node, handled: Set<Node>): void => {
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type !== "Attribute") continue;
      if (attribute.name === "src" && attribute.value !== true) {
        handled.add(attribute);
        const text = staticText(attribute);
        replaceNode(attribute, `source={${text === undefined ? `${helper(SOURCE_HELPER)}(${valueSource(attribute)})` : `{ uri: ${JSON.stringify(text)} }`}}`);
      } else if ((attribute.name === "width" || attribute.name === "height") && numberAttribute(attribute)) handled.add(attribute);
      else if (attribute.name === "onload" || attribute.name === "onerror") {
        handled.add(attribute);
        rename(attribute, attribute.name === "onload" ? "onLoad" : "onError");
      }
    }
  };

  // The element as a component --------------------------------------------------------------------------------------------------------------------------------------

  /** Renames the element to the component (and closes a void one): the attributes it keeps are the component's props. */
  const asComponent = (node: Node, component: string, generated: string[]): void => {
    components.add(component);
    out.edits.push({ start: node.start + 1, end: node.start + 1 + node.name.length, text: COMPONENTS[component] + generated.map((attribute) => ` ${attribute}`).join("") });
    if (slice(node).endsWith("/>")) return;
    if (node.name === "input") out.edits.push({ start: node.end - 1, end: node.end - 1, text: " /" });
    else {
      const close = content.lastIndexOf(`</${node.name}`, node.end - 1);
      if (close > node.start) out.edits.push({ start: close + 2, end: close + 2 + node.name.length, text: COMPONENTS[component] });
    }
  };

  /**
   * `bind:this` is the element on the web, and on a device it is the host handle (`measure`, `focus`, ...), which is what a `ref` gets: Svelte's custom renderer refuses `bind:` on a host tag,
   * and on a component `bind:this` is the component's instance, not the control. Like `bind:this`, the `ref` gets `null` when the element goes away.
   */
  const thisAsRef = (node: Node, attribute: Node): void => {
    if (attribute.expression.type === "SequenceExpression") return;
    const set = `(__ref) => (${expressionSource(attribute.expression)} = __ref)`;
    // With a spread on the element, every attribute goes through `set_attributes`, which drops a function that is not a handler.
    const spread = (node.attributes as Node[]).some((other) => other.type === "SpreadAttribute");
    replaceNode(attribute, `ref={${spread ? `${helper(VALUE_HELPER)}(${set})` : set}}`);
  };

  const lowerTextInput = (node: Node, multiline: boolean): void => {
    const generated: string[] = ["nativeHtml={true}"];
    const names = new Set<string>();
    const typeAttribute = multiline ? undefined : attributeNamed(node, "type");
    let typed: Readonly<Record<string, string | boolean>> = {};
    if (typeAttribute && typeAttribute.value !== true) {
      const text = staticText(typeAttribute);
      if (text === undefined) generated.push(`{...${helper(INPUT_TYPE_HELPER)}(${valueSource(typeAttribute)})}`);
      else {
        const type = text.trim().toLowerCase();
        if (type === "checkbox") {
          lowerCheckbox(node, typeAttribute);
          return;
        }
        // A type the browser does not know is a text input there, and here.
        if (Object.hasOwn(UNSUPPORTED_TYPES, type)) {
          fail(node, `<input type="${text}"> is not supported on native: ${UNSUPPORTED_TYPES[type]}`);
          return;
        }
        typed = inputTypeProps(type);
      }
    }
    if (typeAttribute) replaceNode(typeAttribute, "");
    for (const attribute of node.attributes as Node[]) {
      if (attribute === typeAttribute) continue;
      if (attribute.type === "Attribute") {
        const name: string = attribute.name;
        if (name === "disabled") {
          replaceNode(attribute, `editable={${attribute.value === true ? "false" : `!(${valueSource(attribute)})`}}`);
          names.add("editable");
        } else if (name === "maxlength") {
          if (!numberAttribute(attribute, "maxLength")) rename(attribute, "maxLength");
          names.add("maxLength");
        } else if (name === "rows" && multiline) {
          if (!numberAttribute(attribute, "numberOfLines")) rename(attribute, "numberOfLines");
          names.add("numberOfLines");
        } else if (name === "oninput" || name === "onchange") {
          // `oninput` fires on every edit (`onChangeText`); the web's `change` fires when the edit is finished (`onEndEditing`), whose event has the text in `nativeEvent`.
          const found = handlerOf(node, name.slice(2));
          if (found?.attribute === attribute && attribute.value !== true && !Array.isArray(attribute.value)) {
            if (name === "oninput") wrappedHandler(found, "onChangeText", "__text", `${helper(INPUT_EVENT_HELPER)}("input", __text)`);
            else wrappedHandler(found, "onEndEditing", "__event", `${helper(INPUT_EVENT_HELPER)}("change", __event?.nativeEvent?.text)`);
            names.add(name === "oninput" ? "onChangeText" : "onEndEditing");
          }
        } else if (Object.hasOwn(INPUT_RENAMES, name)) {
          rename(attribute, INPUT_RENAMES[name] as string);
          names.add(INPUT_RENAMES[name] as string);
        } else names.add(name);
      } else if (attribute.type === "OnDirective") {
        const found = handlerOf(node, attribute.name);
        if (found && attribute.name === "input") wrappedHandler(found, "onChangeText", "__text", `${helper(INPUT_EVENT_HELPER)}("input", __text)`);
        else if (found && attribute.name === "change") wrappedHandler(found, "onEndEditing", "__event", `${helper(INPUT_EVENT_HELPER)}("change", __event?.nativeEvent?.text)`);
        else if (found && (attribute.name === "focus" || attribute.name === "blur")) nativeHandler(found, attribute.name === "focus" ? "onFocus" : "onBlur");
      } else if (attribute.type === "BindDirective") {
        if (attribute.name === "this") thisAsRef(node, attribute);
        else if (attribute.name !== "value") unsupportedBinding(node, attribute, "bind:value is the one a text input has");
        else names.add("value");
      }
    }
    // The key events: React Native has the one `onKeyPress`, with the key in its event, so `onkeydown` and `onkeyup` are both it.
    const down = handlerOf(node, "keydown");
    const up = handlerOf(node, "keyup");
    if (down || up) {
      const call = (type: "keydown" | "keyup", found: typeof down): string => (found ? `(${found.source})?.(${helper(KEY_HELPER)}("${type}", __event)); ` : "");
      replaceNode((down ?? up)?.attribute as Node, `onKeyPress={(__event) => { ${call("keydown", down)}${call("keyup", up)}}}`);
      if (down && up) replaceNode(up.attribute, "");
    }
    // Enter in a single-line input submits the form above it, as in a browser.
    if (!multiline && !names.has("onSubmitEditing")) generated.push(`onSubmitEditing={(__event) => ${helper(SUBMIT_HELPER)}(__event)}`);
    lowerStyle(node, "style", undefined, generated);
    rejectDirectives(node, (attribute) => attribute.type === "BindDirective");
    warnUnhandled(node, ["input", "change", "focus", "blur", "keydown", "keyup"]);
    for (const [name, value] of Object.entries(typed)) if (!names.has(name)) generated.push(value === true ? `${name}={true}` : `${name}="${value}"`);
    if (multiline && !names.has("multiline")) generated.push("multiline={true}");
    asComponent(node, "TextInput", generated);
  };

  /** `<input type="checkbox">` is a `Switch`: `checked` is its `value`, and a change gives the web's event shape (`currentTarget.checked`). */
  const lowerCheckbox = (node: Node, typeAttribute: Node): void => {
    replaceNode(typeAttribute, "");
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type === "Attribute") {
        if (attribute.name === "checked") {
          if (attribute.value === true || staticText(attribute) !== undefined) replaceNode(attribute, "value={true}");
          else rename(attribute, "value");
        } else if (attribute.name === "value") replaceNode(attribute, ""); // the value a checkbox submits with a form, not its state
        else if (attribute.name === "onchange") {
          const found = handlerOf(node, "change");
          if (found?.attribute === attribute) wrappedHandler(found, "onValueChange", "__value", `${helper(INPUT_EVENT_HELPER)}("change", __value)`);
        }
      } else if (attribute.type === "OnDirective" && attribute.name === "change") {
        const found = handlerOf(node, "change");
        if (found) wrappedHandler(found, "onValueChange", "__value", `${helper(INPUT_EVENT_HELPER)}("change", __value)`);
      } else if (attribute.type === "BindDirective") {
        if (attribute.name === "checked") replaceNode(attribute, `bind:value={${expressionSource(attribute.expression)}}`);
        else if (attribute.name === "this") thisAsRef(node, attribute);
        else unsupportedBinding(node, attribute, attribute.name === "group" ? "keep the choice in state" : "`bind:checked` is the one a checkbox has");
      }
    }
    const generated: string[] = [];
    lowerStyle(node, "style", undefined, generated);
    rejectDirectives(node, (attribute) => attribute.type === "BindDirective");
    warnUnhandled(node, ["change"]);
    asComponent(node, "Switch", generated);
  };

  /** `<dialog open>` is a `Modal` that is `visible`; `bind:open` also closes it when the platform does (the back key, a swipe), and `onclose` hears that. */
  const lowerDialog = (node: Node): void => {
    const generated: string[] = [];
    const open = attributeNamed(node, "open");
    const bound = directive(node, "BindDirective", "open");
    const close = handlerOf(node, "close");
    if (open) replaceNode(open, `visible={${valueSource(open)}}`);
    else if (!bound) generated.push("visible={false}");
    if (bound?.expression.type === "SequenceExpression") fail(bound, "bind:open with a getter and a setter is not supported on native: give the dialog `open={...}` and an `onclose`");
    else if (bound) {
      const target = expressionSource(bound.expression);
      replaceNode(bound, `visible={${target}}`);
      if (close) replaceNode(close.attribute, "");
      generated.push(`onRequestClose={(__event) => { ${target} = false; ${close ? `(${close.source})?.(__event); ` : ""}}}`);
    } else if (close) nativeHandler(close, "onRequestClose");
    for (const attribute of node.attributes as Node[]) if (attribute.type === "BindDirective" && attribute.name === "this") thisAsRef(node, attribute);
    lowerStyle(node, "style", undefined, generated);
    rejectDirectives(node, (attribute) => attribute === bound);
    warnUnhandled(node, ["close"]);
    asComponent(node, "Modal", generated);
  };

  // The walk ------------------------------------------------------------------------------------------------------------------------------------------------------

  const blank = (node: Node): boolean => node.type === "Comment" || (node.type === "Text" && WHITESPACE.test(node.data));
  const inline = (node: Node): boolean => node.type === "Text" || node.type === "ExpressionTag" || node.type === "Comment" || (node.type === "RegularElement" && INLINE.has(node.name));

  /**
   * In a view-like element, a run of text, `{expression}`s and inline elements (`<b>`, `<a>`, ...) that holds some text is one `native-text`: as in a browser, it is a line the
   * inline elements are part of. The text of a run in a `native-text` keeps the whitespace it has, and the edges are trimmed by Svelte, as for a written `<Text>`. Returns the members.
   */
  const wrapRuns = (nodes: Node[]): Set<Node> => {
    const members = new Set<Node>();
    let run: Node[] = [];
    const finish = (): void => {
      let from = 0;
      let to = run.length;
      while (from < to && blank(run[from] as Node)) from++;
      while (to > from && blank(run[to - 1] as Node)) to--;
      const body = run.slice(from, to);
      run = [];
      if (!body.some((node) => node.type === "ExpressionTag" || (node.type === "Text" && !WHITESPACE.test(node.data)))) return;
      out.edits.push({ start: (body[0] as Node).start, end: (body[0] as Node).start, text: "<native-text nativeHtml={true}>" }, { start: (body[body.length - 1] as Node).end, end: (body[body.length - 1] as Node).end, text: "</native-text>" });
      for (const node of body) members.add(node);
    };
    for (const node of nodes) {
      if (inline(node)) run.push(node);
      else finish();
    }
    finish();
    return members;
  };

  /**
   * The text of a `<pre>` is a template literal in an expression: Svelte trims the edges of an element and collapses the whitespace between nodes, but not an expression's, so the
   * spaces and newlines reach the native text as written. The newline right after `<pre>` is not part of the text (as in HTML): it is kept in the source, outside the literal, so no
   * line number moves.
   */
  const preformatted = (text: Node, first: boolean): void => {
    let data: string = text.data;
    let prefix = "";
    if (first && data.startsWith("\n")) {
      data = data.slice(1);
      prefix = "\n";
    }
    if (data === "") return;
    replace(text.start, text.end, `${prefix}{\`${data.replace(/[`\\]|\$\{/g, (match) => `\\${match}`)}\`}`);
  };

  const visitFragment = (fragment: Node, context: Context, pre?: Pre): void => {
    const nodes = fragment.nodes as Node[];
    const wrapped = context === "view" ? wrapRuns(nodes) : new Set<Node>();
    for (const [index, node] of nodes.entries()) {
      if (pre && node.type === "Text") preformatted(node, pre === "start" && index === 0);
      else visitNode(node, wrapped.has(node) ? "text" : context, pre === undefined ? undefined : "inside");
    }
  };

  const visitNode = (node: Node, context: Context, pre?: Pre): void => {
    if (node.type === "RegularElement") {
      visitElement(node, context, pre);
      return;
    }
    // `<svelte:head>` is the document's: nothing of it is drawn on a device.
    if (node.type === "SvelteHead") return;
    // A block draws where it stands; what a component, a snippet or a dynamic element draws is up to them.
    const inherit = node.type === "IfBlock" || node.type === "EachBlock" || node.type === "KeyBlock" || node.type === "AwaitBlock";
    for (const key in node) {
      const value = node[key];
      if (key !== "metadata" && value && typeof value === "object" && value.type === "Fragment") visitFragment(value, inherit ? context : "unknown", inherit ? pre : undefined);
    }
  };

  const visitElement = (node: Node, context: Context, pre?: Pre): void => {
    const name: string = node.name;
    // A host tag written by hand (`native-view`), a custom element or a part of an SVG already reported: not an HTML element.
    if (!HTML_NAMES.has(name)) {
      visitFragment(node.fragment, "unknown");
      return;
    }
    const kind = ELEMENTS[name];
    if (kind === undefined) fail(node, `<${name}> is not supported on native: ${Object.hasOwn(HINTS, name) ? HINTS[name] : DEFAULT_HINT}`);
    else if (kind === "input" || kind === "textarea") lowerTextInput(node, kind === "textarea");
    else if (kind === "dialog") {
      lowerDialog(node);
      visitFragment(node.fragment, "view");
    } else if (kind === "br") {
      // A line break is a newline of the text it is in.
      if (context === "text") replaceNode(node, `{"\\n"}`);
      else fail(node, "<br> is not supported on native outside text: put a newline in the text instead (`{\"\\n\"}`), or use a margin");
    } else {
      const inside = host(node, kind, context);
      if (kind !== "image" && kind !== "rule") visitFragment(node.fragment, inside, kind === "pre" ? "start" : pre ? "inside" : undefined);
    }
  };

  visitFragment(ast.fragment, "unknown");

  if (problems.length) throw new Error(problems.length === 1 ? (problems[0] as string) : `${problems.length} HTML elements or attributes have no native equivalent:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  if (components.size) out.imports.push(`import { ${[...components].sort().map((component) => `${component} as ${COMPONENTS[component]}`).join(", ")} } from "${CORE}";`);
  if (link) {
    out.imports.push(`import { useLink as __svelteNativeUseLink } from "${ROUTER}";`);
    out.setup.push(`const ${LINK} = __svelteNativeUseLink();`);
  }
  return out;
}
