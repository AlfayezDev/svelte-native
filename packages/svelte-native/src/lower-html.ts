/**
 * HTML elements to native ones, at compile time: `<div>`, `<p>`, `<button>`, `<a href>`, `<img>`, `<input>` and the rest of the table in `html-tags.ts`, so one `.svelte` file can be
 * written with HTML for SvelteKit and still run on a device. `lower.ts` calls this for the files the Metro transformer lowers (never for the web build, which does not load
 * `lower.ts`: `vite.ts` compiles `.svelte` files through SvelteKit alone), when the file is the app's own (`lowersHtml` in `compile-options.ts`).
 *
 * Two kinds of result. An element that is a plain host tag (`div`, `p`, `button`, `a`, `img`) is handed back in `elements`, and `lower.ts` carries over its `class`, `class:`,
 * `style` and spreads through the paths a lowered `<View>` takes (`bind:this` becomes a `ref`); the attributes this file rewrites (`onclick` to `onPress`, `src` to `source`) are in `handled`. An element
 * that needs a component for its meaning (`input` and `textarea` are a `TextInput`, a checkbox a `Switch`, `dialog` a `Modal`: they bind) is rewritten here, with the component imported
 * under a name of its own; `TextInput` works the HTML attributes out when the app runs (`html-input.ts`), so a `{...rest}` that carries them means the same.
 *
 * Every element it makes a host tag of is marked (`nativeHtml`): the host passes the text style of a marked element (`class="text-lg"`, `style="color: white"`) down to the text and
 * the inputs of the marked elements below it, as CSS does (`fabric/text-inherit.ts`), and draws the text that is bare in a marked view, however it got there (`children`, a snippet),
 * in a text of its own (`buildRun`). The text elements that flow in a line are marked `"inline"`. A `<form>` is marked too (`nativeForm`), and a `<button>` or Enter in an input submits
 * the form above it (`hostSubmit`). A `style="..."` string is converted here (`css/inline.ts`), and `style:property` directives are worked out when they change (`hostStyleProps`).
 *
 * Only text is inserted, renamed and moved, and the newlines of what moves go with it, so a line number in the source is still the line of the same markup. What has no native meaning is
 * an error that names the element, the file and the line (all of them, in one message); a web handler that can never run on a device is a warning.
 */
import { convertInlineStyle } from "./css/inline.ts";
import { ELEMENTS, INLINE, USER_AGENT_STYLES, hostTagOf, type Kind } from "./html-tags.ts";

const PACKAGE = "@example/svelte-native";
const CORE = `${PACKAGE}/core`;
const ROUTER = `${PACKAGE}/router`;

// The renderer's helpers the generated code calls (`renderer.ts`), by the names `lower.ts` imports them under.
export const SOURCE_HELPER = "__svelteNativeSource";
export const INPUT_EVENT_HELPER = "__svelteNativeInputEvent";
/** `hostSpread` for the spread of an HTML element: a web handler name in the spread (`onclick`) is the native one. */
export const WEB_SPREAD_HELPER = "__svelteNativeWebSpread";
/** The same for an element whose press does something by itself (a button, a link): the spread's `onclick` runs with it, it does not replace it. */
export const WEB_CLICK_SPREAD_HELPER = "__svelteNativeWebClickSpread";
/** `hostClass` for a lowered HTML element: the font-relative values of a class wait for the font size the element inherits. */
export const HTML_CLASS_HELPER = "__svelteNativeHtmlClass";
export const CLICK_HELPER = "__svelteNativeClick";
export const SUBMIT_HELPER = "__svelteNativeSubmit";
export const HREF_HELPER = "__svelteNativeHref";
export const STYLE_HELPER = "__svelteNativeStyleProps";
export const BIND_HELPER = "__svelteNativeBind";
export const TAG_HELPER = "__svelteNativeTag";
export const INLINE_HELPER = "__svelteNativeInline";
/** `hostValue` of `lower.ts`: a function next to a spread (a `ref`) is boxed, or Svelte's `set_attributes` drops it. */
export const VALUE_HELPER = "__svelteNativeValue";
export const HTML_HELPER_EXPORTS: Record<string, string> = {
  [SOURCE_HELPER]: "hostSource",
  [INPUT_EVENT_HELPER]: "hostInputEvent",
  [WEB_SPREAD_HELPER]: "hostWebSpread",
  [WEB_CLICK_SPREAD_HELPER]: "hostWebClickSpread",
  [HTML_CLASS_HELPER]: "hostHtmlClass",
  [CLICK_HELPER]: "hostClick",
  [SUBMIT_HELPER]: "hostSubmit",
  [HREF_HELPER]: "hostHref",
  [STYLE_HELPER]: "hostStyleProps",
  [BIND_HELPER]: "hostBind",
  [TAG_HELPER]: "hostTag",
  [INLINE_HELPER]: "hostInline",
};

/** The function a pressed `<a>` calls with its `href`: `useLink()` (`router.svelte.ts`) is called while the component initializes, which a handler cannot do. */
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
  /** The helper its spread goes through (`hostWebSpread`, or the one that leaves a press its own). */
  spreadHelper: string;
};

export type HtmlLowering = {
  elements: Map<Node, LoweredElement>;
  /** What this file rewrites itself: the elements that become components, what is moved, what is taken out. */
  edits: Edit[];
  /** The renderer's helpers (keys of `HTML_HELPER_EXPORTS`) the generated code calls. */
  helpers: Set<string>;
  /** Import statements for the script. */
  imports: string[];
  /** Statements for the instance script (they run when the component initializes). */
  setup: string[];
};

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
const HTML_NAMES = new Set([...Object.keys(ELEMENTS), ...Object.keys(HINTS)]);
// What the gate looks for: a tag in lower case that is not a host tag (`native-view`), a `script` or a `style` (every file has those), which is any element of the markup that is not
// a component (`<center>` and a custom element are errors, so they are looked for too), and the special elements Svelte's custom renderer refuses.
const OPENING = /<(?!native-|script[\s>]|style[\s>])[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?=[\s/>])|<svelte:(?:head|window|document|body|element)(?=[\s/>])/;

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

/** The events Svelte's transitions send the element they play on (`element.dispatchEvent`: `NativeNode.dispatchEvent` calls the listeners), so `onintroend={...}` runs on a device. */
const TRANSITION_EVENTS = ["introstart", "introend", "outrostart", "outroend"];
/** The events of the web a text input gets on a device (`html-input.ts`). */
const INPUT_EVENTS = ["input", "change", "focus", "blur", "keydown", "keyup"];

const lines = (text: string): number => text.split("\n").length - 1;
const WHITESPACE = /^[ \t\n\r\f]*$/;
const NUMBER = /^\d+(?:\.\d+)?(?:px)?$/;

type Context = "view" | "text" | "unknown";

/** Where the text of a `<pre>` is: the whitespace in it is the text, and Svelte would trim and collapse it in any element but a `pre`. */
type Pre = "start" | "inside" | undefined;

/**
 * Whether the source has a comment or a template literal with a line break in it, outside of strings: what keeps it from being put on one line (`oneLine`). Strings are skipped, so a `//`
 * in one (`"http://x"`) is not a comment; a regular expression with a quote in it is not understood, which no style or binding target has.
 */
function unflattenable(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === '"' || char === "'") {
      for (at++; at < text.length && text[at] !== char; at++) if (text[at] === "\\") at++;
    } else if (char === "`") {
      // The literal, to its closing quote (what is inside a `${}` is not told from the text): one with a line break in it is not flattened.
      const from = at;
      for (at++; at < text.length && text[at] !== "`"; at++) if (text[at] === "\\") at++;
      if (text.slice(from, at).includes("\n")) return true;
    } else if (char === "/" && text[at + 1] === "/") return true;
    else if (char === "/" && text[at + 1] === "*") {
      const end = text.indexOf("*/", at + 2);
      at = end < 0 ? text.length : end + 1;
    }
  }
  return false;
}

/** A function written where it is used: an arrow or a `function`, which is a handler whenever it is read. */
export function isFunctionLiteral(expression: Node): boolean {
  return expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression";
}

/**
 * A piece of source that is written more than once, on one line: its line breaks are spaces, so the copy adds none to the file. Source with a `//` comment (which would swallow what follows
 * it) or a template literal that has a line break in it (the text of the literal would change) is not changed. A `//` in a string is not a comment.
 */
export function oneLine(text: string): string {
  return unflattenable(text) ? text : text.replace(/[ \t]*\r?\n[ \t]*/g, " ");
}

/** The kinds of expression with no effect of their own: reading them twice is the same as reading them once, and a getter that reads a variable is as reactive twice as once. */
const READ_ONLY = new Set(["Identifier", "Literal", "ObjectExpression", "ArrayExpression", "Property", "SpreadElement", "MemberExpression", "ChainExpression", "ConditionalExpression", "LogicalExpression", "BinaryExpression", "TemplateLiteral", "TemplateElement"]);

/**
 * The source of an expression that is written a second time as a copy, on one line (`oneLine`), or undefined when it must not be: it is not a plain read (a call, an assignment, `await`,
 * `new`, ... would run twice) or it cannot be put on one line.
 */
export function repeatableSource(content: string, expression: Node): string | undefined {
  const reads = (node: Node): boolean => {
    if (!READ_ONLY.has(node.type) || (node.type === "TemplateElement" && node.value.raw.includes("\n"))) return false;
    for (const key in node) {
      if (key === "metadata" || key === "type" || key === "start" || key === "end" || key === "loc") continue;
      const value = node[key];
      if (value && typeof value === "object" && !(Array.isArray(value) ? value.every((item) => item === null || typeof item !== "object" || reads(item as Node)) : typeof value.type !== "string" || reads(value as Node))) return false;
    }
    return true;
  };
  const source = content.slice(expression.start, expression.end);
  if (!reads(expression)) return undefined;
  const flat = oneLine(source);
  return flat.includes("\n") ? undefined : flat;
}

/**
 * The `ref` a `bind:this={target}` becomes, or undefined for a binding with a getter and a setter. The variable gets the host handle and `null` when the element goes away, and only
 * if it still holds this handle (`hostBind`): the target may have moved (`bind:this={els[i]}` of a keyed `{#each}`), so the computed keys of the target are read where the attribute
 * is (`[i]`), the `ref` is made again when one changes, and the target is written with the keys it had. `spreads`: the element has a spread, which passes a function only boxed.
 */
export function bindThisText(content: string, attribute: Node, spreads: boolean): string | undefined {
  const expression: Node = attribute.expression;
  if (expression.type === "SequenceExpression") return undefined;
  const keys: Node[] = [];
  const collect = (node: Node): void => {
    if (node.type !== "MemberExpression") return;
    collect(node.object);
    if (node.computed && node.property.type !== "Literal") keys.push(node.property);
  };
  collect(expression);
  let target = content.slice(expression.start, expression.end);
  for (let index = keys.length - 1; index >= 0; index--) {
    const key = keys[index] as Node;
    target = `${target.slice(0, key.start - expression.start)}__k[${index}]${target.slice(key.end - expression.start)}`;
  }
  // The target is written twice (the setter and the getter): the copies are on one line, so they add none to the file.
  target = oneLine(target);
  const call = `${BIND_HELPER}((__k, __v) => (${target} = __v), (__k) => ${target}, [${keys.map((key) => content.slice(key.start, key.end)).join(", ")}])`;
  return `ref={${spreads ? `${VALUE_HELPER}(${call})` : call}}`;
}

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
  /** The attributes and directives this file has written another way (the rest are looked at by `warnUnhandled`). */
  const edited = new Set<Node>();
  const replaceNode = (node: Node, text: string): void => {
    edited.add(node);
    replace(node.start, node.end, text);
  };
  /**
   * Takes a node out of its place because its text is written somewhere else (a move), and returns the text it is written as with the newlines of the part that is not in it (the
   * braces of an attribute, the line breaks around a value) added to it, so the lines that were there are where the text is now and nothing is added where it was.
   */
  const moveOut = (node: Node, written: string): string => {
    edited.add(node);
    out.edits.push({ start: node.start, end: node.end, text: "" });
    const lost = lines(slice(node)) - lines(written);
    return lost > 0 ? written + "\n".repeat(lost) : written;
  };
  /** Gives an `Attribute` another name (the shorthand `{onclick}` becomes `onPress={onclick}`). */
  const rename = (attribute: Node, to: string): void => {
    edited.add(attribute);
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
  /** The function an `onclick`-style attribute or `on:click` directive hands the element, as source (and as the node of its expression); undefined when there is none (or it only forwards the event). */
  const handlerSource = (attribute: Node, web: string): { source: string; expression: Node } | undefined => {
    if (attribute.type === "Attribute" && attribute.name === `on${web}` && attribute.value !== true && !Array.isArray(attribute.value)) return { source: expressionSource(attribute.value.expression), expression: attribute.value.expression };
    if (attribute.type === "OnDirective" && attribute.name === web && attribute.expression && (attribute.modifiers as string[]).length === 0) return { source: expressionSource(attribute.expression), expression: attribute.expression };
    return undefined;
  };
  type Handler = { attribute: Node; source: string; expression: Node; spread: boolean };
  const handlerOf = (node: Node, web: string): Handler | undefined => {
    const spread = (node.attributes as Node[]).some((attribute) => attribute.type === "SpreadAttribute");
    for (const attribute of node.attributes as Node[]) {
      const found = handlerSource(attribute, web);
      if (found !== undefined) return { attribute, ...found, spread };
    }
    return undefined;
  };
  /**
   * An event attribute under another name: an attribute is renamed, the directive is written as the attribute. A press that may be `undefined` (`onclick={enabled ? go : undefined}`)
   * is `nativeOnPress`, not `onPress`: Svelte compiles `onPress={...}` to a listener that stays on the element for good, and the host would take an element whose handler is `undefined`
   * for a pressable that does nothing and give it the press that belongs to an ancestor (`PRESS_HANDLERS` in `lower.ts`). With a spread on the element Svelte's `set_attributes` removes
   * a nullish listener itself, and a function in `nativeOnPress` would not get through it, so it stays `onPress` there.
   */
  const nativeHandler = (found: Handler, to: string): void => {
    const name = to === "onPress" && !found.spread && !isFunctionLiteral(found.expression) ? "nativeOnPress" : to;
    if (found.attribute.type === "Attribute") rename(found.attribute, name);
    else replaceNode(found.attribute, `${name}={${found.source}}`);
  };
  /** An event attribute that is wrapped: the web handler gets an event-like argument built from what the native one gives (`call` is the expression that calls it). */
  const wrappedHandler = (found: Handler, to: string, parameter: string, call: string): void => {
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
   * The events of the web on an element, once the ones it gets are dealt with (`handled`: `click`, ...). A handler that can never run on a device (`onmouseover`, `onkeydown` on a div) is a
   * warning, not an error: the file is shared with the web, where it runs. The others, written as `on...` in lower case or as an `on:` directive, are the web's; a native handler
   * (`onLayout`) is camel case. Svelte's custom renderer refuses `on:`, so a directive that is left is written as the attribute of the event (`on:click={f}` is `onclick={f}`), and one
   * with a modifier (`|preventDefault`), or none that gives a function, cannot be and is an error that says what to write.
   */
  const warnUnhandled = (node: Node, handled: readonly string[]): void => {
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type === "OnDirective" && !edited.has(attribute)) {
        const modifiers = (attribute.modifiers as string[]).map((modifier) => `|${modifier}`).join("");
        const source = handlerSource(attribute, attribute.name);
        if (source === undefined) {
          fail(attribute, `on:${attribute.name}${modifiers} on <${node.name}> is not supported on native: write the \`on${attribute.name}\` attribute with a function, and call \`event.preventDefault()\` in it for a modifier`);
          continue;
        }
        replaceNode(attribute, `on${attribute.name}={${source.source}}`);
      }
      const event = attribute.type === "Attribute" && attribute.value !== true && /^on[a-z]+$/.test(attribute.name) ? attribute.name.slice(2) : attribute.type === "OnDirective" ? attribute.name : undefined;
      if (event === undefined || handled.includes(event)) continue;
      warn(`${where(attribute)} ${attribute.type === "Attribute" ? attribute.name : `on:${event}`} on <${node.name}> never runs on a device: a native element has no "${event}" event (the web still calls it)`);
    }
  };

  /**
   * `style="padding: 4px; color: red"` is converted here (`css/inline.ts`) and written as the style object; `style:property={value}` directives become one call that works them out
   * when they change (`hostStyleProps`). The directives and the string go with the element's own `style={...}` into one array, in that order (a directive wins, as on the web). A `style`
   * that is an expression stays as it is, unless there are directives to join it; one that is text when the app runs is parsed then. `property` is the attribute that carries the style on
   * the target (`nativeStyle` for a host tag).
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
        entries.push(moveOut(style, `${JSON.stringify(style.name)}: ${style.value === true ? style.name : valueSource(style)}`));
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
   * `onclick` (or `on:click`) is `onPress`. What the press does by itself (`after`: a link's navigation, a button's form submission, both read from the element when it is pressed, so a
   * spread's `href` and `type` count) happens after the handler, unless it called `preventDefault` on the event (`hostClick`). The attributes it writes are added to `generated`, and the
   * ones it dealt with are `handled`. Returns whether there is a handler of the element's own.
   */
  const press = (node: Node, handled: Set<Node>, generated: string[], after?: string): boolean => {
    const click = handlerOf(node, "click");
    if (click) handled.add(click.attribute);
    if (after === undefined) {
      if (click) nativeHandler(click, "onPress");
      return click !== undefined;
    }
    const call = `onPress={(__event) => ${helper(CLICK_HELPER)}(__event, ${click ? click.source : "undefined"}, ${after})}`;
    if (click) replaceNode(click.attribute, call);
    else generated.push(call);
    return click !== undefined;
  };

  const host = (node: Node, kind: Kind, context: Context): Context => {
    const handled = new Set<Node>();
    const inline = (kind === "text" && INLINE.has(node.name)) || (kind === "link" && context === "text");
    const generated: string[] = kind === "image" ? [] : [inline ? 'nativeHtml="inline"' : "nativeHtml={true}"];
    // The style a browser gives the element until its class or style says otherwise.
    if (USER_AGENT_STYLES.has(node.name)) generated.push(`nativeBase="${node.name}"`);
    const events = ["click", ...TRANSITION_EVENTS];
    const role = (name: string): void => {
      if (!hasRole(node)) generated.push(`accessibilityRole="${name}"`);
    };
    let tag = "native-view";
    let inside: Context = "view";
    let isVoid = false;
    let spreadHelper = WEB_SPREAD_HELPER;
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
      // Every link follows its `href` when pressed (`hostHref`: the attribute stays, so a spread's counts, and none, or one that is not a string, is no navigation).
      link = true;
      spreadHelper = WEB_CLICK_SPREAD_HELPER;
      press(node, handled, generated, `(__event) => ${LINK}(${helper(HREF_HELPER)}(__event))`);
    } else if (kind === "button") {
      tag = "native-pressable";
      role("button");
      // A button is a submit button unless its `type` says it is not, which is read when it is pressed (`hostSubmit`, so a spread's `type` counts): whether a form is above it is known then too.
      spreadHelper = WEB_CLICK_SPREAD_HELPER;
      press(node, handled, generated, `(__event) => ${helper(SUBMIT_HELPER)}(__event)`);
    } else if (kind === "image") {
      tag = "native-image";
      isVoid = true;
      imageAttributes(node, handled);
      press(node, handled, generated);
      events.push("load", "error");
    } else if (kind === "rule") {
      isVoid = true;
      generated.push('nativeBase="hairline"');
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
    out.elements.set(node, { tag, handled, attributes: generated.map((attribute) => ` ${attribute}`).join(""), isVoid, spreadHelper });
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
    // Svelte refuses a DOM directive on a component, and a native control runs none: it is taken out, and the file says so.
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type !== "UseDirective" && attribute.type !== "TransitionDirective" && attribute.type !== "AnimateDirective") continue;
      const kind = attribute.type === "UseDirective" ? "use:" : attribute.type === "AnimateDirective" ? "animate:" : attribute.intro && !attribute.outro ? "in:" : attribute.outro && !attribute.intro ? "out:" : "transition:";
      warn(`${where(attribute)} ${kind}${attribute.name} on <${node.name}> is left out on native: the control is a component, which takes no DOM directive, and a native element runs none`);
      replaceNode(attribute, "");
    }
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
   * and on a component `bind:this` is the component's instance, not the control (`bindThisText`).
   */
  const thisAsRef = (attribute: Node, spreads = false): void => {
    const text = bindThisText(content, attribute, spreads);
    if (text === undefined) return;
    helper(BIND_HELPER);
    if (spreads) helper(VALUE_HELPER);
    replaceNode(attribute, text);
  };

  /** The initial value of a `<textarea>` is what is written between its tags: text and `{expression}`s, which become its `value` (unless it has one), and a newline right after the tag is not part of it. */
  const textareaValue = (node: Node, generated: string[]): void => {
    const nodes = node.fragment.nodes as Node[];
    if (nodes.length === 0 || attributeNamed(node, "value") || directive(node, "BindDirective", "value")) return;
    if (!nodes.every((child) => child.type === "Text" || child.type === "ExpressionTag")) return;
    let template = "`";
    let lost = 0;
    for (const [index, child] of nodes.entries()) {
      if (child.type === "Text") {
        let data: string = child.data;
        if (index === 0 && data.startsWith("\n")) {
          data = data.slice(1);
          lost++;
        }
        template += data.replace(/[`\\]|\$\{/g, (match) => `\\${match}`);
      } else template += `\${(${expressionSource(child.expression)}) ?? ""}`;
    }
    const written = `value={${template}\`}${"\n".repeat(lost)}`;
    const range = { start: (nodes[0] as Node).start, end: (nodes[nodes.length - 1] as Node).end } as Node;
    generated.push(moveOut(range, written));
  };

  const lowerTextInput = (node: Node, multiline: boolean): void => {
    const generated: string[] = ["nativeHtml={true}"];
    const typeAttribute = multiline ? undefined : attributeNamed(node, "type");
    if (typeAttribute && typeAttribute.value !== true) {
      const text = staticText(typeAttribute);
      if (text !== undefined) {
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
      }
    }
    if (multiline) {
      if (!attributeNamed(node, "multiline")) generated.push("multiline={true}");
      textareaValue(node, generated);
    }
    // The attributes stay as they are: `TextInput` works the HTML ones out when the app runs (`html-input.ts`), so a `type={expression}` and a `{...rest}` mean the same. What is
    // written as a directive becomes the attribute, which is the name the component reads.
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type === "OnDirective" && INPUT_EVENTS.includes(attribute.name)) {
        const found = handlerOf(node, attribute.name);
        if (found?.attribute === attribute) replaceNode(attribute, `on${attribute.name}={${found.source}}`);
      } else if (attribute.type === "BindDirective") {
        if (attribute.name === "this") thisAsRef(attribute);
        else if (attribute.name !== "value") unsupportedBinding(node, attribute, "bind:value is the one a text input has");
      }
    }
    lowerStyle(node, "style", undefined, generated);
    rejectDirectives(node, (attribute) => attribute.type === "BindDirective");
    warnUnhandled(node, INPUT_EVENTS);
    asComponent(node, "TextInput", generated);
  };

  /** `<input type="checkbox">` is a `Switch`: `checked` is its `value`, and a change gives the web's event shape (`currentTarget.checked`). */
  const lowerCheckbox = (node: Node, typeAttribute: Node): void => {
    replaceNode(typeAttribute, "");
    const element = [`type: "checkbox"`];
    for (const name of ["name", "id"]) {
      const text = attributeNamed(node, name);
      const value = text && staticText(text);
      if (value !== undefined && value !== "") element.push(`${name}: ${JSON.stringify(value)}`);
    }
    const change = (): string => `${helper(INPUT_EVENT_HELPER)}("change", __value, { ${element.join(", ")} })`;
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type === "Attribute") {
        if (attribute.name === "checked") {
          if (attribute.value === true || staticText(attribute) !== undefined) replaceNode(attribute, "value={true}");
          else rename(attribute, "value");
        } else if (attribute.name === "value") replaceNode(attribute, ""); // the value a checkbox submits with a form, not its state
        else if (attribute.name === "onchange") {
          const found = handlerOf(node, "change");
          if (found?.attribute === attribute) wrappedHandler(found, "onValueChange", "__value", change());
        }
      } else if (attribute.type === "OnDirective" && attribute.name === "change") {
        const found = handlerOf(node, "change");
        if (found) wrappedHandler(found, "onValueChange", "__value", change());
      } else if (attribute.type === "BindDirective") {
        if (attribute.name === "checked") replaceNode(attribute, `bind:value={${expressionSource(attribute.expression)}}`);
        else if (attribute.name === "this") thisAsRef(attribute);
        else unsupportedBinding(node, attribute, attribute.name === "group" ? "keep the choice in state" : "`bind:checked` is the one a checkbox has");
      }
    }
    const generated: string[] = [];
    lowerStyle(node, "style", undefined, generated);
    rejectDirectives(node, (attribute) => attribute.type === "BindDirective");
    warnUnhandled(node, ["change"]);
    asComponent(node, "Switch", generated);
  };

  /**
   * `<dialog open>` is a `Modal` that is shown while it is open: `Modal` takes `open` (and `bind:open`, which it sets to `false` when the platform closes it: the Back key, a swipe)
   * as it takes `visible`, so they stay as written. A dialog with no `open` is closed. `onclose` hears the platform's closing, as `onRequestClose`.
   */
  const lowerDialog = (node: Node): void => {
    const generated: string[] = ["nativeHtml={true}"];
    const open = attributeNamed(node, "open");
    const bound = directive(node, "BindDirective", "open");
    if (!open && !bound) generated.push("open={false}");
    const close = handlerOf(node, "close");
    if (close) nativeHandler(close, "onRequestClose");
    for (const attribute of node.attributes as Node[]) if (attribute.type === "BindDirective" && attribute.name === "this") thisAsRef(attribute);
    lowerStyle(node, "style", undefined, generated);
    rejectDirectives(node, (attribute) => attribute === bound);
    warnUnhandled(node, ["close"]);
    asComponent(node, "Modal", generated);
  };

  // The walk ------------------------------------------------------------------------------------------------------------------------------------------------------

  const blank = (node: Node): boolean => node.type === "Comment" || (node.type === "Text" && WHITESPACE.test(node.data));
  const inlineNode = (node: Node): boolean => node.type === "Text" || node.type === "ExpressionTag" || node.type === "Comment" || (node.type === "RegularElement" && INLINE.has(node.name));

  /**
   * In a view-like element, a run of text, `{expression}`s and inline elements (`<b>`, `<a>`, ...) that holds some text is a line the inline elements are part of: an `<a>` in it is a
   * press on the text, as one in a `<p>`. The host draws the run in a text of its own, from what it finds when the app runs (`buildRun`), so text that comes from `children` or a snippet
   * is drawn too. Returns the members.
   */
  const lineMembers = (nodes: Node[]): Set<Node> => {
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
      for (const node of body) members.add(node);
    };
    for (const node of nodes) {
      if (inlineNode(node)) run.push(node);
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
    const members = context === "view" ? lineMembers(nodes) : new Set<Node>();
    for (const [index, node] of nodes.entries()) {
      if (pre && node.type === "Text") preformatted(node, pre === "start" && index === 0);
      else visitNode(node, members.has(node) ? "text" : context, pre === undefined ? undefined : "inside");
    }
  };

  /**
   * `<svelte:element this={tag}>` draws the host tag of `tag` (`hostTag`, by the table the elements are lowered by), and a text element that flows in a line is marked so (a tag written out
   * is known, and one that is worked out when the app runs is marked by the same table, `hostInline`, when it can be read twice). `bind:this` is the host handle, as on any element. The
   * rest of its attributes are not adapted: a `class`, a `style` and the web's events are for the elements written out, and an `on:` directive, which Svelte's custom renderer refuses,
   * is the `on` attribute of the same event.
   */
  const visitDynamic = (node: Node): void => {
    const tag: Node = node.tag;
    let marker = " nativeHtml={true}";
    if (tag.type === "Literal" && typeof tag.value === "string") {
      const host = tag.value.startsWith("native-") ? tag.value : hostTagOf(tag.value);
      if (host === undefined) fail(tag, `<svelte:element this="${tag.value}"> has no native equivalent: ${Object.hasOwn(HINTS, tag.value) ? HINTS[tag.value] : DEFAULT_HINT}`);
      else if (host !== tag.value) out.edits.push({ start: tag.start, end: tag.end, text: host });
      if (INLINE.has(tag.value) && host === "native-text") marker = ' nativeHtml="inline"';
    } else {
      out.edits.push({ start: tag.start, end: tag.start, text: `${helper(TAG_HELPER)}(` }, { start: tag.end, end: tag.end, text: ")" });
      const again = repeatableSource(content, tag);
      if (again !== undefined) marker = ` nativeHtml={${helper(INLINE_HELPER)}(${again})}`;
    }
    out.edits.push({ start: node.start + 1 + "svelte:element".length, end: node.start + 1 + "svelte:element".length, text: marker });
    for (const attribute of node.attributes as Node[]) {
      if (attribute.type === "BindDirective") {
        // Svelte sends every attribute of a dynamic element through `set_attributes`, which drops a function (the tag is not known to be one that takes a `ref`): the box carries it.
        if (attribute.name === "this") thisAsRef(attribute, true);
        else unsupportedBinding(node, attribute, "there is nothing to bind to on a native view");
      } else if (attribute.type === "Attribute" && attribute.name === "onclick" && attribute.value !== true) {
        // A tap is a touch, which the host turns into `onPress`: a `click` listener is for the accessibility services only, so the press is what `onclick` means, as on a lowered `div`.
        rename(attribute, "onPress");
      } else if (attribute.type === "OnDirective") {
        if (attribute.expression && (attribute.modifiers as string[]).length === 0) replaceNode(attribute, `on${attribute.name === "click" ? "Press" : attribute.name}={${expressionSource(attribute.expression)}}`);
        else fail(attribute, `on:${attribute.name}${(attribute.modifiers as string[]).map((modifier) => `|${modifier}`).join("")} on <svelte:element> is not supported on native: write the \`on${attribute.name}\` attribute, and call \`event.preventDefault()\` in it for a modifier`);
      } else if ((attribute.type === "Attribute" && (attribute.name === "class" || attribute.name === "style" || /^on[a-z]+$/.test(attribute.name))) || attribute.type === "ClassDirective" || attribute.type === "StyleDirective") {
        warn(`${where(attribute)} ${attribute.type === "Attribute" ? attribute.name : `${attribute.type === "ClassDirective" ? "class" : "style"}:${attribute.name}`} on <svelte:element> is not adapted on native (a class, a style and the web's events are for the elements written out): write the element, or use \`native-*\` attributes`);
      }
    }
    visitFragment(node.fragment, "unknown");
  };

  const visitNode = (node: Node, context: Context, pre?: Pre): void => {
    if (node.type === "RegularElement") {
      visitElement(node, context, pre);
      return;
    }
    // `<svelte:head>` is the document's: it means nothing on a device, and Svelte's custom renderer refuses it, so a file shared with the web compiles without it.
    if (node.type === "SvelteHead") {
      replaceNode(node, "");
      return;
    }
    if (node.type === "SvelteWindow" || node.type === "SvelteDocument" || node.type === "SvelteBody") {
      const name = node.type === "SvelteWindow" ? "svelte:window" : node.type === "SvelteDocument" ? "svelte:document" : "svelte:body";
      fail(node, `<${name}> is not supported on native: there is no ${name.slice(7)} to listen to (read the window's size with \`windowSize\` or \`svelte/reactivity/window\`, and use the events of the elements)`);
      return;
    }
    if (node.type === "SvelteElement") {
      visitDynamic(node);
      return;
    }
    // A block draws where it stands; what a component, a snippet or a dynamic element draws is up to them.
    const inherit = node.type === "IfBlock" || node.type === "EachBlock" || node.type === "KeyBlock" || node.type === "AwaitBlock";
    for (const key in node) {
      const value = node[key];
      if (key !== "metadata" && value && typeof value === "object" && value.type === "Fragment") visitFragment(value, inherit ? context : "unknown", inherit ? pre : undefined);
    }
  };

  const visitElement = (node: Node, context: Context, pre?: Pre): void => {
    const name: string = node.name;
    // A host tag written by hand (`native-view`): the author's.
    if (name.startsWith("native-")) {
      visitFragment(node.fragment, "unknown");
      return;
    }
    if (!HTML_NAMES.has(name)) {
      fail(node, name.includes("-")
        ? `<${name}> is a custom element, which is not supported on native: write a component, or a host tag (\`native-view\`)`
        : `<${name}> is not supported on native: ${DEFAULT_HINT}`);
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
