import { parse } from "svelte/compiler";
import { HTML_CLASS_HELPER, HTML_HELPER_EXPORTS, bindThisText, isFunctionLiteral, lowerHtml, mayHaveHtml, oneLine, repeatableSource } from "./lower-html.ts";

const PACKAGE = "expo-svelte";
const RENDERER = `${PACKAGE}/renderer`;
// Svelte's `set_attributes`, which an element with a `{...spread}` sends all of its attributes through, drops a function that is not an
// `on*` handler (a `ref`, say). The renderer's `hostSpread` and `hostValue` box those functions and `setAttribute` unboxes them.
const SPREAD_HELPER = "__expoSvelteSpread";
const VALUE_HELPER = "__expoSvelteValue";
// `class` and `class:name` on a lowered tag become `nativeClass={__expoSvelteClass(...)}`: the renderer's `hostClass` works out their style.
const CLASS_HELPER = "__expoSvelteClass";
const HELPER_EXPORTS: Record<string, string> = { [SPREAD_HELPER]: "hostSpread", [VALUE_HELPER]: "hostValue", [CLASS_HELPER]: "hostClass", ...HTML_HELPER_EXPORTS };

// Lowered call sites never run the component (`<ScrollView>` becomes `<native-scroll>` here): behaviour every scroll view
// needs, such as React Native's base scroll style, belongs to the host (`fabric/host.ts`, `splitProps`), not to the
// component in `components/`.
/** Primitive components that are plain wrappers around one host tag. */
export const LOWERED_TAGS: Record<string, string> = {
  View: "native-view",
  Text: "native-text",
  ScrollView: "native-scroll",
  Image: "native-image",
  ActivityIndicator: "native-spinner",
  Pressable: "native-pressable",
};

// The Svelte AST is walked structurally, so nodes are deliberately loosely typed.
// biome-ignore lint/suspicious/noExplicitAny: structural AST walk
type Node = { type: string; start: number; end: number; [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
/** `copies`: where the text of an edit holds a span of the file as it is written (`at` in the text, `source` in the file), so a position inside the span is that character of the file, not the start of the edit. */
type Edit = { start: number; end: number; text: string; copies?: { at: number; source: number; length: number }[] };

/**
 * The press handlers of a lowered tag. Svelte compiles `onPress={enabled ? go : undefined}` to an event listener that stays on the node for good and calls whatever
 * the expression is now, which is nothing when it is `undefined`: the host sees a listener and takes the node for a pressable that does nothing, which keeps the
 * gesture from the nearest ancestor that has a handler (as in React Native, where a `Text` or `View` with no handler is no responder). So a handler that is not
 * written as a function (it may be `undefined`) is passed as an attribute, `nativeOnPress`, which the host reads as the prop `onPress` and which is there only
 * while it is a function. A function written in place is always one and stays an event.
 */
const PRESS_HANDLERS = new Set(["onPress", "onPressIn", "onPressOut", "onLongPress", "onPressChange"]);

function fromPackage(source: unknown): boolean {
  return typeof source === "string" && (source === PACKAGE || source.startsWith(`${PACKAGE}/`));
}

function collectImports(program: Node | null | undefined, locals: Map<string, string>, actions: Set<string>) {
  for (const statement of program?.body ?? []) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type" || !fromPackage(statement.source?.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const imported = specifier.imported.name ?? specifier.imported.value;
      if (Object.hasOwn(LOWERED_TAGS, imported)) locals.set(specifier.local.name, imported);
      // `use:gesture` (from `expo-svelte`) is an action the host tag does run: it sets the `gesture` attribute.
      if (imported === "gesture" && statement.source?.value === PACKAGE) actions.add(specifier.local.name);
    }
  }
}

/** True when the component relies on behaviour only a component instance provides. */
function mustStayComponent(node: Node, primitive: string): boolean {
  for (const attribute of node.attributes as Node[]) {
    if (attribute.type === "LetDirective") return true;
    if (attribute.type === "BindDirective" && attribute.name !== "this") return true;
    if (attribute.type === "Attribute" && attribute.name === "children") return true;
    if (primitive === "Pressable" && attribute.type === "Attribute" && attribute.name === "style") {
      // Only an object literal or plain text is known not to be a function.
      const value = attribute.value;
      const isStatic = value === true || (Array.isArray(value) ? value.every((part: Node) => part.type === "Text")
        : value.type === "ExpressionTag" && value.expression.type === "ObjectExpression");
      if (!isStatic) return true;
    }
  }
  // Snippets declared inside a component tag become props; on a host tag they would be dropped.
  return (node.fragment?.nodes ?? []).some((child: Node) => child.type === "SnippetBlock");
}

/** The source of a `class` attribute's value as one expression: `{expr}` as it is, a quoted value (with `{expr}` parts) as a template literal (its text cannot hold a `{`). */
function classExpression(content: string, attribute: Node): string {
  const value = attribute.value;
  if (value === true) return "true";
  if (!Array.isArray(value)) return content.slice(value.expression.start, value.expression.end);
  let template = "`";
  for (const part of value as Node[]) {
    // As Svelte joins an attribute: a nullish part is the empty string.
    template += part.type === "Text" ? part.data.replace(/[`\\]/g, (match: string) => `\\${match}`) : `\${(${content.slice(part.expression.start, part.expression.end)}) ?? ""}`;
  }
  return `${template}\``;
}

/** The expressions of a `class` attribute's value, in the order [classExpression] writes them. */
function classSpans(attribute: Node): Node[] {
  const value = attribute.value;
  if (value === true) return [];
  if (!Array.isArray(value)) return [value.expression];
  return (value as Node[]).filter((part) => part.type !== "Text").map((part) => part.expression);
}

/** Where [text] holds the source of each of [spans] (in order, each after the one before, the first from [firstAt]) exactly as the file has it. A span that was changed on its way (put on one line) is not found and keeps no copy. */
function copiedSpans(content: string, text: string, firstAt: number, spans: readonly Node[]): NonNullable<Edit["copies"]> {
  const copies: NonNullable<Edit["copies"]> = [];
  let from = firstAt;
  for (const span of spans) {
    const source = content.slice(span.start, span.end);
    if (!source) continue;
    const at = text.indexOf(source, from);
    if (at < 0) continue;
    copies.push({ at, source: span.start, length: source.length });
    from = at + source.length;
  }
  return copies;
}

/** True when an attribute expression could evaluate to a function (a literal, an object, an array or an operator's result cannot). */
function couldBeFunction(expression: Node): boolean {
  switch (expression.type) {
    case "Literal": case "TemplateLiteral": case "ObjectExpression": case "ArrayExpression":
    case "BinaryExpression": case "UnaryExpression": case "UpdateExpression":
      return false;
    default:
      return true;
  }
}

function walk(value: unknown, visit: (node: Node) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  const node = value as Node;
  if (typeof node.type === "string") visit(node);
  for (const key in node) if (key !== "metadata") walk(node[key], visit);
}

export type LowerOptions = {
  filename?: string;
  warn?: (message: string) => void;
  /**
   * Also lower the HTML elements of the file (`<div>`, `<p>`, `<button>`, `<a href>`, `<img>`, `<input>`, ...) to native ones (`lower-html.ts`), and fail on an HTML element with no native
   * equivalent. Off by default: the Metro transformer asks for it for the app's own files, and the preprocessor (`lower`, which svelte-check and a `svelte.config.js` may load, and so a
   * web build) never does, since a file must still mean HTML there.
   */
  html?: boolean;
};

/**
 * Rewrites `<View>`, `<Text>`, ... imported from "expo-svelte" into their host tags.
 * Only the tag names change: everything else is carried over verbatim, so line numbers are
 * stable (columns shift on lines holding a lowered tag, and no source map is produced: [lowerWithMap] has the way back for one position).
 */
export function lowerPrimitives(content: string, options: LowerOptions = {}): string {
  return lowerWithMap(content, options).code;
}

/** The lowered text of a file, and where a position of it is in the file the developer wrote ([lowerWithMap]). `line` is 1-based and `column` 0-based, as Svelte's errors have them. */
export type Lowering = { code: string; original(line: number, column: number): { line: number; column: number } };

/**
 * [lowerPrimitives] with the way back: `original` takes a position in the lowered text (where Svelte reports an error, on the lowered tag's name and the `nativeClass={...}` that took the
 * place of a `class`) to the position of the same place in `content`. A position inside what an edit wrote is the start of what the edit replaced.
 */
export function lowerWithMap(content: string, options: LowerOptions = {}): Lowering {
  const unchanged = (): Lowering => ({ code: content, original: (line, column) => ({ line, column }) });
  if (!content.includes(PACKAGE) && !(options.html && mayHaveHtml(content))) return unchanged();
  let ast: Node;
  try {
    ast = parse(content, { modern: true, filename: options.filename }) as unknown as Node;
  } catch {
    // Leave syntax errors to the real compile, which reports them with context.
    return unchanged();
  }
  const locals = new Map<string, string>();
  const actions = new Set<string>();
  collectImports(ast.instance?.content, locals, actions);
  collectImports(ast.module?.content, locals, actions);
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const html = options.html ? lowerHtml(ast, content, options.filename, warn) : undefined;
  if (!locals.size && !html?.elements.size && !html?.edits.length) return unchanged();
  const edits: Edit[] = html ? [...html.edits] : [];
  const helpers = new Set<string>(html?.helpers);
  /** Wraps an expression in a call of one of the renderer's helpers. */
  const wrap = (expression: Node, helper: string) => {
    helpers.add(helper);
    edits.push({ start: expression.start, end: expression.start, text: `${helper}(` }, { start: expression.end, end: expression.end, text: ")" });
  };
  const seen = new Set<Node>();
  walk(ast.fragment, (node) => {
    if ((node.type !== "Component" && node.type !== "RegularElement") || seen.has(node)) return;
    seen.add(node);
    // An HTML element that `lower-html.ts` turns into a host tag takes the paths below as a lowered `<View>` does.
    const lowered = node.type === "RegularElement" ? html?.elements.get(node) : undefined;
    const primitive = lowered ? undefined : locals.get(node.name);
    if (node.type === "RegularElement" ? !lowered : !primitive || mustStayComponent(node, primitive)) return;
    const tag = lowered?.tag ?? LOWERED_TAGS[primitive as string];
    const spreadHelper = lowered ? lowered.spreadHelper : SPREAD_HELPER;
    // An HTML element inherits its font size, so the font-relative values of its class wait for the host (`hostHtmlClass`).
    const classHelper = lowered ? HTML_CLASS_HELPER : CLASS_HELPER;
    const spreads = (node.attributes as Node[]).some((attribute) => attribute.type === "SpreadAttribute");
    // `class` and every `class:name` become one `nativeClass`, written where the `class` was (where the first directive was without one);
    // the directives are removed. Next to a spread, as on the DOM: the last of `class` and the spreads that have a `class` gives the class,
    // and the toggles of the directives apply to it. So each spread gets the toggles too (`hostSpread` uses them when the spread has a
    // `class`), and toggles without a `class` attribute are written before every spread, which can then override them.
    const classes = (node.attributes as Node[]).filter((attribute) => (attribute.type === "Attribute" && attribute.name === "class") || attribute.type === "ClassDirective");
    const directives = classes.filter((attribute) => attribute.type === "ClassDirective");
    const toggles = directives.length === 0 ? undefined
      : `{ ${directives.map((directive) => `${JSON.stringify(directive.name)}: ${oneLine(content.slice(directive.expression.start, directive.expression.end))}`).join(", ")} }`;
    if (classes.length > 0) {
      const own = classes.find((attribute) => attribute.type === "Attribute");
      const parts = [...(own ? [classExpression(content, own)] : []), ...(toggles ? [toggles] : [])];
      // The element's own style comes along: the font size it sets is what a `leading-none` of a `<View>` or a `<Text>` is made from. It is written a second time, so it must be a plain read (not a call
      // that would run twice), and it is on one line (the copy adds no line to the file). A quoted `style="..."` is a string, which sets none, and an HTML element has none: its class keeps the
      // font-relative values for the host, which knows the font size the element ends up with.
      const style = lowered ? undefined : (node.attributes as Node[]).find((attribute) => attribute.type === "Attribute" && attribute.name === "style" && attribute.value !== true && !Array.isArray(attribute.value));
      const copy = style === undefined ? undefined : repeatableSource(content, style.value.expression);
      const styleArgument = copy === undefined ? "" : `, ${copy}`;
      // What the attributes were written with (the braces around an expression, the breaks between them) is not in the call: its newlines are written after it, so no line moves.
      const written = `nativeClass={${classHelper}(${parts.length === 1 ? parts[0] : `[${parts.join(", ")}]`}${styleArgument})}`;
      const dropped = classes.reduce((count, attribute) => count + content.slice(attribute.start, attribute.end).split("\n").length - 1, 0) - (written.split("\n").length - 1);
      const value = dropped > 0 ? written + "\n".repeat(dropped) : written;
      // The expressions are copied into the call as they are written (a multi-line one keeps its lines): an error inside one is at its place in the file.
      const copies = copiedSpans(content, written, `nativeClass={${classHelper}(`.length, [
        ...(own ? classSpans(own) : []),
        ...directives.map((directive) => directive.expression),
        ...(style !== undefined && copy !== undefined ? [style.value.expression] : []),
      ]);
      helpers.add(classHelper);
      const at = own ?? (spreads ? undefined : classes[0]);
      if (at === undefined) edits.push({ start: node.attributes[0].start, end: node.attributes[0].start, text: `${value} ` });
      for (const attribute of classes) edits.push({ start: attribute.start, end: attribute.end, text: attribute === at ? value : "", ...(attribute === at && copies.length ? { copies } : {}) });
    }
    for (const attribute of node.attributes as Node[]) {
      if (classes.includes(attribute) || lowered?.handled.has(attribute)) continue;
      // `bind:this` of a host tag does not compile (Svelte's custom renderer has no `bind:`), and on the component it is the instance: what the host gives an element is the handle `ref` takes (`measure`, ...).
      if (attribute.type === "BindDirective" && attribute.name === "this") {
        const text = bindThisText(content, attribute, spreads);
        if (text !== undefined) {
          if (spreads) helpers.add(VALUE_HELPER);
          helpers.add("__expoSvelteBind");
          const lost = content.slice(attribute.start, attribute.end).split("\n").length - text.split("\n").length;
          edits.push({ start: attribute.start, end: attribute.end, text: lost > 0 ? text + "\n".repeat(lost) : text });
          continue;
        }
      }
      if (spreads && attribute.type === "SpreadAttribute") {
        if (toggles === undefined) wrap(attribute.expression, spreadHelper);
        else {
          helpers.add(spreadHelper);
          edits.push({ start: attribute.expression.start, end: attribute.expression.start, text: `${spreadHelper}(` }, { start: attribute.expression.end, end: attribute.expression.end, text: `, ${toggles})` });
        }
      }
      // With a spread on the element every attribute goes through `set_attributes` too: a function-valued one (`ref={handle}`) must be boxed as well.
      if (spreads && attribute.type === "Attribute" && !attribute.name.startsWith("on") && attribute.name !== "style" && attribute.value !== true
        && !Array.isArray(attribute.value) && attribute.value.type === "ExpressionTag" && couldBeFunction(attribute.value.expression)) {
        // A shorthand `{ref}` is `ref={ref}` once its value is a call.
        if (content[attribute.start] === "{") edits.push({ start: attribute.start, end: attribute.start, text: `${attribute.name}=` });
        wrap(attribute.value.expression, VALUE_HELPER);
      }
      // A press handler that may be `undefined` (no spread on the tag: through `set_attributes` a nullish handler removes its listener as it should).
      if (!spreads && attribute.type === "Attribute" && PRESS_HANDLERS.has(attribute.name) && attribute.value !== true && !Array.isArray(attribute.value)
        && attribute.value.type === "ExpressionTag" && !isFunctionLiteral(attribute.value.expression)) {
        const renamed = `native${attribute.name[0].toUpperCase()}${attribute.name.slice(1)}`;
        // A shorthand `{onPress}` keeps its braces and gains the name.
        if (content[attribute.start] === "{") edits.push({ start: attribute.start, end: attribute.start, text: `${renamed}=` });
        else edits.push({ start: attribute.start, end: attribute.start + attribute.name.length, text: renamed });
      }
      // Svelte compiles a `style` attribute on any element to `set_style`, which stringifies the object before the
      // renderer sees it; the hosts read the object from `nativeStyle` instead.
      if (attribute.type === "Attribute" && attribute.name === "style" && content.startsWith("style", attribute.start)) {
        edits.push({ start: attribute.start, end: attribute.start + "style".length, text: "nativeStyle" });
      }
      // A valueless attribute is `true` on a component but the empty string on an element; keep the component meaning.
      if (attribute.type === "Attribute" && attribute.value === true) {
        edits.push({ start: attribute.end, end: attribute.end, text: "={true}" });
      }
      // `transition:`, `in:`, `out:` and `animate:` stay as they are: the host tag plays them (`fabric/transitions.ts`). An action other than `use:gesture` is passed on unchanged, but nothing runs it against a DOM.
      if (attribute.type === "UseDirective" && !actions.has(attribute.name)) {
        warn(`${options.filename ?? "component"}: use:${attribute.name} on <${node.name}> is passed to <${tag}> unchanged; native elements do not run DOM actions`);
      }
    }
    edits.push({ start: node.start + 1, end: node.start + 1 + node.name.length, text: tag + (lowered?.attributes ?? "") });
    const source = content.slice(node.start, node.end);
    if (source.endsWith("/>")) {
      edits.push({ start: node.end - 2, end: node.end, text: `></${tag}>` });
    } else if (lowered?.isVoid) {
      edits.push({ start: node.end, end: node.end, text: `</${tag}>` });
    } else {
      const close = content.lastIndexOf(`</${node.name}`, node.end - 1);
      if (close < node.start) return;
      edits.push({ start: close + 2, end: close + 2 + node.name.length, text: tag });
    }
  });
  if (!edits.length) return unchanged();
  const script = ast.instance ?? ast.module;
  const names = [...helpers].sort().map((helper) => `${HELPER_EXPORTS[helper]} as ${helper}`);
  const setup = html?.setup ?? [];
  const injected = [...(names.length ? [`import { ${names.join(", ")} } from "${RENDERER}";`] : []), ...(html?.imports ?? []), ...setup].join(" ");
  // On the line of the opening tag, so no line number below it moves.
  if (injected && script && (ast.instance || !setup.length)) edits.push({ start: script.content.start, end: script.content.start, text: ` ${injected}` });
  // What runs when the component initializes needs an instance script, and a file of HTML alone (or with a module script only) has none: one is written at the start of the first line.
  else if (injected) edits.push({ start: 0, end: 0, text: `<script>${injected}</script>` });
  // From the end of the text to its start, so no edit moves another; two that start at the same place apply the longer one first, so what is inserted there ends up in front of what replaces it.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let output = content;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return { code: output, original: (line, column) => positionIn(content, output, edits, line, column) };
}

/** The 0-based offset of a 1-based line and 0-based column of [text]. */
function offsetAt(text: string, line: number, column: number): number {
  let offset = 0;
  for (let at = 1; at < line; at++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  return offset + column;
}

/** The 1-based line and 0-based column of a 0-based offset of [text]. */
function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) };
}

/** [lowered]'s line and column, in [content]: the edits (in the order they were applied, last in the text first) are walked from the start of the text, with what each moved the rest by. */
function positionIn(content: string, lowered: string, edits: readonly Edit[], line: number, column: number): { line: number; column: number } {
  const target = offsetAt(lowered, line, column);
  let delta = 0;
  for (let at = edits.length - 1; at >= 0; at--) {
    const edit = edits[at] as Edit;
    const from = edit.start + delta;
    if (target < from) break;
    if (target < from + edit.text.length) {
      const copy = edit.copies?.find((one) => target >= from + one.at && target < from + one.at + one.length);
      return lineAndColumn(content, copy ? copy.source + (target - from - copy.at) : edit.start);
    }
    delta += edit.text.length - (edit.end - edit.start);
  }
  return lineAndColumn(content, Math.max(0, Math.min(content.length, target - delta)));
}

/** Standard Svelte preprocessor wrapper, for svelte-check and other Svelte tooling. */
export const lower = {
  name: "expo-svelte-lower",
  markup({ content, filename }: { content: string; filename?: string }) {
    const code = lowerPrimitives(content, { filename });
    return code === content ? undefined : { code };
  },
};

export default lower;
