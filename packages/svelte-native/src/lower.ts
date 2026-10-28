import { parse } from "svelte/compiler";

const PACKAGE = "@rasheed/svelte-native";
const GESTURES = `${PACKAGE}/gestures`;

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
type Edit = { start: number; end: number; text: string };

const WARN_DIRECTIVES = new Set(["UseDirective", "TransitionDirective", "AnimateDirective"]);

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
      // `use:gesture` (from `@rasheed/svelte-native/gestures`) is an action the host tag does run: it sets the `gesture` attribute.
      if (imported === "gesture" && statement.source?.value === GESTURES) actions.add(specifier.local.name);
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

function walk(value: unknown, visit: (node: Node) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  const node = value as Node;
  if (typeof node.type === "string") visit(node);
  for (const key in node) if (key !== "metadata") walk(node[key], visit);
}

export type LowerOptions = { filename?: string; warn?: (message: string) => void };

/**
 * Rewrites `<View>`, `<Text>`, ... imported from "@rasheed/svelte-native" into their host tags.
 * Only the tag names change: everything else is carried over verbatim, so line numbers are
 * stable (columns shift on lines holding a lowered tag, and no source map is produced).
 */
export function lowerPrimitives(content: string, options: LowerOptions = {}): string {
  if (!content.includes(PACKAGE)) return content;
  let ast: Node;
  try {
    ast = parse(content, { modern: true, filename: options.filename }) as unknown as Node;
  } catch {
    // Leave syntax errors to the real compile, which reports them with context.
    return content;
  }
  const locals = new Map<string, string>();
  const actions = new Set<string>();
  collectImports(ast.instance?.content, locals, actions);
  collectImports(ast.module?.content, locals, actions);
  if (!locals.size) return content;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const edits: Edit[] = [];
  const seen = new Set<Node>();
  walk(ast.fragment, (node) => {
    if (node.type !== "Component" || seen.has(node)) return;
    seen.add(node);
    const primitive = locals.get(node.name);
    if (!primitive || mustStayComponent(node, primitive)) return;
    const tag = LOWERED_TAGS[primitive];
    for (const attribute of node.attributes as Node[]) {
      // Svelte compiles a `style` attribute on any element to `set_style`, which stringifies the object before the
      // renderer sees it; the hosts read the object from `nativeStyle` instead.
      if (attribute.type === "Attribute" && attribute.name === "style" && content.startsWith("style", attribute.start)) {
        edits.push({ start: attribute.start, end: attribute.start + "style".length, text: "nativeStyle" });
      }
      // A valueless attribute is `true` on a component but the empty string on an element; keep the component meaning.
      if (attribute.type === "Attribute" && attribute.value === true) {
        edits.push({ start: attribute.end, end: attribute.end, text: "={true}" });
      }
      if (WARN_DIRECTIVES.has(attribute.type) && !(attribute.type === "UseDirective" && actions.has(attribute.name))) {
        warn(`${options.filename ?? "component"}: ${attribute.type === "UseDirective" ? "use:" : attribute.type === "AnimateDirective" ? "animate:" : "transition:"}${attribute.name} on <${node.name}> is passed to <${tag}> unchanged; native elements do not run DOM directives`);
      }
    }
    edits.push({ start: node.start + 1, end: node.start + 1 + node.name.length, text: tag });
    const source = content.slice(node.start, node.end);
    if (source.endsWith("/>")) {
      edits.push({ start: node.end - 2, end: node.end, text: `></${tag}>` });
    } else {
      const close = content.lastIndexOf(`</${node.name}`, node.end - 1);
      if (close < node.start) return;
      edits.push({ start: close + 2, end: close + 2 + node.name.length, text: tag });
    }
  });
  if (!edits.length) return content;
  edits.sort((a, b) => b.start - a.start);
  let output = content;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}

/** Standard Svelte preprocessor wrapper, for svelte-check and other Svelte tooling. */
export const lower = {
  name: "svelte-native-lower",
  markup({ content, filename }: { content: string; filename?: string }) {
    const code = lowerPrimitives(content, { filename });
    return code === content ? undefined : { code };
  },
};

export default lower;
