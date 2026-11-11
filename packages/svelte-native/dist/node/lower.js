// src/lower.ts
import { parse } from "svelte/compiler";
var PACKAGE = "@example/svelte-native";
var GESTURES = `${PACKAGE}/gestures`;
var RENDERER = `${PACKAGE}/renderer`;
var SPREAD_HELPER = "__svelteNativeSpread";
var VALUE_HELPER = "__svelteNativeValue";
var CLASS_HELPER = "__svelteNativeClass";
var HELPER_EXPORTS = { [SPREAD_HELPER]: "hostSpread", [VALUE_HELPER]: "hostValue", [CLASS_HELPER]: "hostClass" };
var LOWERED_TAGS = {
  View: "native-view",
  Text: "native-text",
  ScrollView: "native-scroll",
  Image: "native-image",
  ActivityIndicator: "native-spinner",
  Pressable: "native-pressable"
};
var NOT_PRIMITIVES = `${PACKAGE}/svg`;
function fromPackage(source) {
  return typeof source === "string" && (source === PACKAGE || source.startsWith(`${PACKAGE}/`) && source !== NOT_PRIMITIVES);
}
function collectImports(program, locals, actions) {
  for (const statement of program?.body ?? []) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type" || !fromPackage(statement.source?.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
      const imported = specifier.imported.name ?? specifier.imported.value;
      if (Object.hasOwn(LOWERED_TAGS, imported)) locals.set(specifier.local.name, imported);
      if (imported === "gesture" && statement.source?.value === GESTURES) actions.add(specifier.local.name);
    }
  }
}
function mustStayComponent(node, primitive) {
  for (const attribute of node.attributes) {
    if (attribute.type === "LetDirective") return true;
    if (attribute.type === "BindDirective" && attribute.name !== "this") return true;
    if (attribute.type === "Attribute" && attribute.name === "children") return true;
    if (primitive === "Pressable" && attribute.type === "Attribute" && attribute.name === "style") {
      const value = attribute.value;
      const isStatic = value === true || (Array.isArray(value) ? value.every((part) => part.type === "Text") : value.type === "ExpressionTag" && value.expression.type === "ObjectExpression");
      if (!isStatic) return true;
    }
  }
  return (node.fragment?.nodes ?? []).some((child) => child.type === "SnippetBlock");
}
function classExpression(content, attribute) {
  const value = attribute.value;
  if (value === true) return "true";
  if (!Array.isArray(value)) return content.slice(value.expression.start, value.expression.end);
  let template = "`";
  for (const part of value) {
    template += part.type === "Text" ? part.data.replace(/[`\\]/g, (match) => `\\${match}`) : `\${(${content.slice(part.expression.start, part.expression.end)}) ?? ""}`;
  }
  return `${template}\``;
}
function couldBeFunction(expression) {
  switch (expression.type) {
    case "Literal":
    case "TemplateLiteral":
    case "ObjectExpression":
    case "ArrayExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "UpdateExpression":
      return false;
    default:
      return true;
  }
}
function walk(value, visit) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const node = value;
  if (typeof node.type === "string") visit(node);
  for (const key in node) if (key !== "metadata") walk(node[key], visit);
}
function lowerPrimitives(content, options = {}) {
  if (!content.includes(PACKAGE)) return content;
  let ast;
  try {
    ast = parse(content, { modern: true, filename: options.filename });
  } catch {
    return content;
  }
  const locals = /* @__PURE__ */ new Map();
  const actions = /* @__PURE__ */ new Set();
  collectImports(ast.instance?.content, locals, actions);
  collectImports(ast.module?.content, locals, actions);
  if (!locals.size) return content;
  const warn = options.warn ?? ((message) => console.warn(message));
  const edits = [];
  const helpers = /* @__PURE__ */ new Set();
  const wrap = (expression, helper) => {
    helpers.add(helper);
    edits.push({ start: expression.start, end: expression.start, text: `${helper}(` }, { start: expression.end, end: expression.end, text: ")" });
  };
  const seen = /* @__PURE__ */ new Set();
  walk(ast.fragment, (node) => {
    if (node.type !== "Component" || seen.has(node)) return;
    seen.add(node);
    const primitive = locals.get(node.name);
    if (!primitive || mustStayComponent(node, primitive)) return;
    const tag = LOWERED_TAGS[primitive];
    const spreads = node.attributes.some((attribute) => attribute.type === "SpreadAttribute");
    const classes = node.attributes.filter((attribute) => attribute.type === "Attribute" && attribute.name === "class" || attribute.type === "ClassDirective");
    const directives = classes.filter((attribute) => attribute.type === "ClassDirective");
    const toggles = directives.length === 0 ? void 0 : `{ ${directives.map((directive) => `${JSON.stringify(directive.name)}: ${content.slice(directive.expression.start, directive.expression.end)}`).join(", ")} }`;
    if (classes.length > 0) {
      const own = classes.find((attribute) => attribute.type === "Attribute");
      const parts = [...own ? [classExpression(content, own)] : [], ...toggles ? [toggles] : []];
      const style = node.attributes.find((attribute) => attribute.type === "Attribute" && attribute.name === "style" && attribute.value !== true && !Array.isArray(attribute.value));
      const styleArgument = style === void 0 ? "" : `, ${content.slice(style.value.expression.start, style.value.expression.end)}`;
      const value = `nativeClass={${CLASS_HELPER}(${parts.length === 1 ? parts[0] : `[${parts.join(", ")}]`}${styleArgument})}`;
      helpers.add(CLASS_HELPER);
      const at = own ?? (spreads ? void 0 : classes[0]);
      if (at === void 0) edits.push({ start: node.attributes[0].start, end: node.attributes[0].start, text: `${value} ` });
      for (const attribute of classes) edits.push({ start: attribute.start, end: attribute.end, text: attribute === at ? value : "" });
    }
    for (const attribute of node.attributes) {
      if (classes.includes(attribute)) continue;
      if (spreads && attribute.type === "SpreadAttribute") {
        if (toggles === void 0) wrap(attribute.expression, SPREAD_HELPER);
        else {
          helpers.add(SPREAD_HELPER);
          edits.push({ start: attribute.expression.start, end: attribute.expression.start, text: `${SPREAD_HELPER}(` }, { start: attribute.expression.end, end: attribute.expression.end, text: `, ${toggles})` });
        }
      }
      if (spreads && attribute.type === "Attribute" && !attribute.name.startsWith("on") && attribute.name !== "style" && attribute.value !== true && !Array.isArray(attribute.value) && attribute.value.type === "ExpressionTag" && couldBeFunction(attribute.value.expression)) {
        if (content[attribute.start] === "{") edits.push({ start: attribute.start, end: attribute.start, text: `${attribute.name}=` });
        wrap(attribute.value.expression, VALUE_HELPER);
      }
      if (attribute.type === "Attribute" && attribute.name === "style" && content.startsWith("style", attribute.start)) {
        edits.push({ start: attribute.start, end: attribute.start + "style".length, text: "nativeStyle" });
      }
      if (attribute.type === "Attribute" && attribute.value === true) {
        edits.push({ start: attribute.end, end: attribute.end, text: "={true}" });
      }
      if (attribute.type === "UseDirective" && !actions.has(attribute.name)) {
        warn(`${options.filename ?? "component"}: use:${attribute.name} on <${node.name}> is passed to <${tag}> unchanged; native elements do not run DOM actions`);
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
  const script = ast.instance ?? ast.module;
  if (helpers.size && script) {
    const names = [...helpers].sort().map((helper) => `${HELPER_EXPORTS[helper]} as ${helper}`);
    edits.push({ start: script.content.start, end: script.content.start, text: ` import { ${names.join(", ")} } from "${RENDERER}";` });
  }
  edits.sort((a, b) => b.start - a.start);
  let output = content;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
var lower = {
  name: "svelte-native-lower",
  markup({ content, filename }) {
    const code = lowerPrimitives(content, { filename });
    return code === content ? void 0 : { code };
  }
};
var lower_default = lower;
export {
  LOWERED_TAGS,
  lower_default as default,
  lower,
  lowerPrimitives
};
