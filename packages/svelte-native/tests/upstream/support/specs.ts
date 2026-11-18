import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { vendoredImport } from "../../../src/vendored.ts";
import { nodeModules as modules, vendorRoot } from "../../support/paths.ts";

/**
 * Readers of what the native-view libraries declare in their own sources (a codegen spec in TypeScript or Flow, an Expo module's Kotlin, a manager's `@ReactProp`s), which the
 * host tests build their fake Expo modules from and the drift tests in this directory compare the host's static view configs with. Paths are relative to `node_modules`.
 */
export type ExpoViewConfig = { validAttributes: Record<string, unknown>; directEventTypes?: Record<string, { registrationName: string }> | null };

/** The props and handlers a library's codegen spec (a TypeScript `interface X extends ViewProps`) declares, read from its source: the tables in `view-configs.ts` are compared with them. */
export function specOf(file: string, interfaceName: string): { props: string[]; handlers: string[]; viewProps: boolean } {
  const path = resolve(modules, file);
  const source = ts.createSourceFile(path, ts.sys.readFile(path) ?? "", ts.ScriptTarget.Latest, true);
  const props: string[] = [];
  const handlers: string[] = [];
  let viewProps = false;
  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      viewProps = node.heritageClauses?.some((clause) => clause.types.some((type) => type.getText(source) === "ViewProps")) ?? false;
      for (const member of node.members) {
        if (!ts.isPropertySignature(member)) continue;
        const name = member.name.getText(source).replace(/['"]/g, "");
        const type = member.type?.getText(source) ?? "";
        (/EventHandler|Event$/.test(type) || /^on[A-Z]/.test(name) ? handlers : props).push(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { props, handlers, viewProps };
}


/** The props and events a view of an Expo module declares, read from the module's Kotlin source (`View(X::class) { Name("..."); Events(...); Prop("...") }`). */
export function expoViewConfigs(moduleFile: string): Record<string, ExpoViewConfig> {
  const source = readFileSync(resolve(modules, moduleFile), "utf8");
  const configs: Record<string, ExpoViewConfig> = {};
  for (const match of source.matchAll(/\bView\(\w+::class\)\s*\{/g)) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < source.length) {
      const char = source[index++];
      if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    const block = source.slice(start, index);
    const name = /\bName\("(\w+)"\)/.exec(block)?.[1] ?? "";
    const props = [...block.matchAll(/\bProp\("(\w+)"\)/g)].map((prop) => prop[1]);
    const events = [...(/\bEvents\(([^)]*)\)/.exec(block)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((event) => event[1]);
    configs[name] = {
      validAttributes: Object.fromEntries(props.map((prop) => [prop, true])),
      directEventTypes: events.length ? Object.fromEntries(events.map((event) => [`top${event.slice(2)}`, { registrationName: event }])) : null,
    };
  }
  return configs;
}

/** The text of a file of an installed library, relative to `node_modules`; of a library the package carries (react-native-svg, react-native-gesture-handler, ...), the file of its copy in `vendor/`. */
export const libraryFile = (file: string): string => readFileSync(resolve(vendoredImport(file) ? vendorRoot : modules, file), "utf8");

// The datetimepicker spec is Flow, which the TypeScript reader cannot parse: its props are read from the source text.
export function flowSpec(file: string): { props: string[]; colors: string[]; handlers: string[] } {
  const text = libraryFile(file);
  const body = /type NativeProps = \$ReadOnly<\{\|([\s\S]*?)\|\}>;/.exec(text)?.[1] ?? "";
  const props: string[] = [];
  const colors: string[] = [];
  const handlers: string[] = [];
  const members = [...body.matchAll(/^ {2}(\w+)\?: ([\s\S]*?),\n(?= {2}\w+\?:|$)/gm)];
  for (const [, name = "", type = ""] of members) {
    if (/EventHandler/.test(type)) handlers.push(name);
    else {
      props.push(name);
      if (/ColorValue/.test(type)) colors.push(name);
    }
  }
  return { props, colors, handlers };
}

// react-native-pdf's spec is Flow too, with its members written `name: ?type,`.
export function pdfSpec(file: string): { props: string[]; handlers: string[] } {
  const text = libraryFile(file);
  const body = /export type NativeProps = \$ReadOnly<\{\|([\s\S]*?)\|\}>;/.exec(text)?.[1] ?? "";
  const props: string[] = [];
  const handlers: string[] = [];
  for (const [, name = "", type = ""] of body.matchAll(/^\s+(\w+): (.*?),$/gm)) (/EventHandler/.test(type) ? handlers : props).push(name);
  return { props, handlers };
}
