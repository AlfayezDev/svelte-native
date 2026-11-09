import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { importWithReactNative, reactNativeConverters, type Platform } from "./rn-reference.ts";

/**
 * react-native-svg's own element classes, bundled with React and run without a renderer, as the oracle for the Svelte components: the
 * library's `render()` of an element is what it hands its native component, and resolving the classes below it down to the Fabric components
 * (the library's `*NativeComponent` modules are replaced by their view names) is the tree it would mount. The Svelte components must send
 * the same nodes, view names and props for the same inputs (`svg.test.ts`).
 */
const require = createRequire(import.meta.url);

/** A node of the tree the library mounts: a Fabric component and its props, children resolved. */
export type OracleNode = { name: string; props: Record<string, unknown>; children: (OracleNode | string)[] };
type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
type Class = { new (props: object): { render(): unknown }; defaultProps?: Record<string, unknown> };

export type Oracle = {
  React: typeof import("react");
  /** The library's element classes by xml tag (`xmlTags.ts`). */
  tags: Record<string, unknown>;
  /** The library's XML parser: the root element with its React children. */
  parse(xml: string): { tag: string; props: Record<string, unknown>; children: unknown[] } | null;
  /** The library's text, font and gradient extractors (`extractText.tsx`, `extractGradient.ts`) and filter extractors. */
  extractFont(props: object): object;
  extractText(props: object, container: boolean): { content: string | null; children: unknown; [key: string]: unknown };
  extractGradient(props: object, parent: unknown): { name: string; gradient: number[]; gradientUnits: number; gradientTransform: number[] | null } | null;
  filters: Record<string, (props: object, parent?: unknown) => object>;
  /** What the library mounts for [element]: classes resolved to their `render()` until Fabric components are left. */
  mount(element: unknown): OracleNode | string | null;
  /** `new Class(props).render()` for one element: what that element alone hands its native component, props of the Fabric element only. */
  renderOnce(element: unknown): Element | null;
  create(type: unknown, props?: object | null, ...children: unknown[]): unknown;
};

/** `react-native` as the library's elements use it: React Native's own `processColor` and `flattenStyle`, the platform, and stand-ins for what needs a device. */
function nativeStub(platform: Platform, panKeys: string[]): string {
  return `
    import processColor from "react-native/Libraries/StyleSheet/processColor";
    import flattenStyle from "react-native/Libraries/StyleSheet/flattenStyle";
    export { processColor };
    export const Platform = { OS: ${JSON.stringify(platform)}, select: (spec) => spec[${JSON.stringify(platform)}] ?? spec.default };
    export const StyleSheet = { create: (styles) => styles, flatten: flattenStyle, hairlineWidth: 1 };
    export const PanResponder = { create: () => ({ panHandlers: Object.fromEntries(${JSON.stringify(panKeys)}.map((key) => [key, () => undefined])) }) };
    export const findNodeHandle = (instance) => (instance && typeof instance === "object" && "tag" in instance ? instance.tag : null);
    export const Image = { resolveAssetSource: (source) => (source && typeof source === "object" ? source : null) };
    // The Touchable mixin's handlers answer in the elements' constructor; their results are not part of what is compared.
    export const Touchable = { Mixin: {
      touchableHandleStartShouldSetResponder() { return false; }, touchableHandleResponderTerminationRequest() { return true; },
      touchableHandleResponderGrant() {}, touchableHandleResponderMove() {}, touchableHandleResponderRelease() {}, touchableHandleResponderTerminate() {},
      touchableGetInitialState: () => ({}),
    } };
    export const TurboModuleRegistry = { getEnforcing: () => ({}) };
  `;
}

let panKeys: Promise<string[]> | undefined;
/** The handler names of React Native's own `PanResponder`, which `extractResponder` reads when it loads (the Svelte host's lite shim loads the same module). */
export function panResponderKeys(): Promise<string[]> {
  panKeys ??= importWithReactNative<{ PanResponder: { create(config: object): { panHandlers: object } } }>("android", `export { default as PanResponder } from "react-native/Libraries/Interaction/PanResponder";`)
    .then((module) => Object.keys(module.PanResponder.create({}).panHandlers));
  return panKeys;
}

const loaded = new Map<Platform, Promise<Oracle>>();

export function loadOracle(platform: Platform): Promise<Oracle> {
  let oracle = loaded.get(platform);
  if (!oracle) {
    oracle = (async () => {
      const keys = await panResponderKeys();
      const bundle = await build({
        stdin: {
          contents: `
            import * as React from "react";
            import { tags } from "react-native-svg/src/xmlTags";
            import { parse } from "react-native-svg/src/xml";
            import { extractFont } from "react-native-svg/src/lib/extract/extractText";
            import extractText from "react-native-svg/src/lib/extract/extractText";
            import extractGradient from "react-native-svg/src/lib/extract/extractGradient";
            import extractFeFlood, { extractFilter, extractIn, extractFeBlend, extractFeColorMatrix, extractFeComposite, extractFeGaussianBlur, extractFeMerge } from "react-native-svg/src/lib/extract/extractFilter";
            export { React, tags, parse, extractFont, extractText, extractGradient };
            export const filters = { extractFilter, extractIn, extractFeBlend, extractFeColorMatrix, extractFeComposite, extractFeFlood, extractFeGaussianBlur, extractFeMerge };
          `,
          resolveDir: import.meta.dirname,
        },
        bundle: true, format: "esm", platform: "neutral", write: false, mainFields: ["main"], logLevel: "error",
        define: { "process.env.NODE_ENV": '"production"' },
        plugins: [...reactNativeConverters(platform), {
          name: "svg-oracle",
          setup(builder) {
            builder.onResolve({ filter: /^react-native$/ }, () => ({ path: "react-native", namespace: "oracle" }));
            builder.onLoad({ filter: /.*/, namespace: "oracle" }, () => ({ contents: nativeStub(platform, keys), loader: "js", resolveDir: import.meta.dirname }));
            builder.onResolve({ filter: /^react-native\/Libraries\/StyleSheet\/flattenStyle$/ }, (args) => ({ path: require.resolve(args.path) }));
            // The Fabric components are their view names: an element `render()` returns `{ type: "RNSVGPath", props }`.
            builder.onLoad({ filter: /[\\/]react-native-svg[\\/]src[\\/]fabric[\\/]\w+NativeComponent\.ts$/ }, async ({ path }) => {
              const name = /codegenNativeComponent<[^>]*>\(\s*'(\w+)'/.exec(await readFile(path, "utf8"))?.[1];
              return name ? { contents: `export default ${JSON.stringify(name)};`, loader: "js" } : undefined;
            });
          },
        }],
      });
      const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-svg-oracle-"));
      try {
        const file = resolve(directory, "oracle.mjs");
        await writeFile(file, bundle.outputFiles[0].contents);
        const module = await import(pathToFileURL(file).href) as Pick<Oracle, "React" | "tags" | "parse" | "extractFont" | "extractText" | "extractGradient"> & { filters: Record<string, never> };
        return withMount(module as never);
      } finally {
        await rm(directory, { recursive: true });
      }
    })();
    loaded.set(platform, oracle);
  }
  return oracle;
}

function withMount(module: Oracle): Oracle {
  const { React } = module;
  const isElement = (value: unknown): value is Element => value !== null && typeof value === "object" && "type" in value && "props" in value;
  const flatten = (children: unknown): unknown[] => (Array.isArray(children) ? children.flatMap(flatten) : children === undefined || children === null || children === false ? [] : [children]);
  const withDefaults = (type: Class, props: Record<string, unknown>) => {
    const full = { ...props };
    for (const key in type.defaultProps) if (full[key] === undefined) full[key] = type.defaultProps[key];
    return full;
  };
  const renderOnce = (element: unknown): Element | null => {
    if (!isElement(element)) return null;
    const { type } = element;
    if (typeof type === "string") return element;
    if (typeof type === "function" && type.prototype && typeof type.prototype.render === "function") return new (type as Class)(withDefaults(type as Class, element.props)).render() as Element | null;
    if (typeof type === "function") return (type as (props: object) => Element | null)(element.props);
    return null;
  };
  const mount = (element: unknown): OracleNode | string | null => {
    if (typeof element === "string" || typeof element === "number") return String(element);
    if (!isElement(element)) return null;
    if (element.type === React.Fragment) return { name: "Fragment", props: {}, children: flatten(element.props.children).map(mount).filter((child): child is OracleNode | string => child !== null) };
    if (typeof element.type === "string") {
      const { children, ...rest } = element.props as Record<string, unknown>;
      const props = { ...rest };
      delete props.ref;
      delete props.key;
      return { name: element.type, props, children: flatten(children).flatMap((child) => { const node = mount(child); return node === null ? [] : [node]; }) };
    }
    const rendered = renderOnce(element);
    return rendered === null ? null : mount(rendered);
  };
  return { ...module, mount, renderOnce, create: React.createElement as Oracle["create"] };
}

/** Fragments are not nodes: their children belong to the parent. */
export function flattenFragments(node: OracleNode | string): (OracleNode | string)[] {
  if (typeof node === "string") return [node];
  if (node.name === "Fragment") return node.children.flatMap(flattenFragments);
  return [{ ...node, children: node.children.flatMap(flattenFragments) }];
}
