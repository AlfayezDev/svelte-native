import { build, transform } from "esbuild";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { compile, compileModule } from "svelte/compiler";
import { componentOptions, lowersHtml } from "../src/compile-options.ts";
import { lowerPrimitives } from "../src/lower.ts";
import { reanimatedStubs } from "./reanimated-stubs.ts";

/**
 * The harness of the tests of HTML elements (`html-elements.test.ts`, `html-differential.test.ts`): a page is lowered as the Metro transformer lowers a file of an app (`lowerPrimitives` with
 * `html`, for the files `lowersHtml` names), compiled with the options of the library, bundled with the host, and mounted on a fake Fabric binding, so what a test reads is the tree and the
 * props the platform would be given, and an event goes through the host's own path.
 */
export type FakeNode = { tag: number; name: string; props: Record<string, unknown>; children: FakeNode[]; sealed: boolean; target?: unknown };
/** What the last mounts left: the committed children of each surface, and what the lowering warned about while the last fixture was built. */
export const host: { roots: Record<number, FakeNode[]>; warnings: string[] } = { roots: {}, warnings: [] };
export const fake = {
  createNode(tag: number, name: string, _root: number, props: Record<string, unknown>, target: unknown) { return { tag, name, props: { ...props }, children: [], sealed: false, target }; },
  cloneNodeWithNewChildren(node: FakeNode) { return { ...node, children: [], sealed: false }; },
  cloneNodeWithNewProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [...node.children], sealed: false }; },
  cloneNodeWithNewChildrenAndProps(node: FakeNode, props: Record<string, unknown>) { return { ...node, props: { ...node.props, ...props }, children: [], sealed: false }; },
  appendChild(parent: FakeNode, child: FakeNode) {
    if (parent.sealed) throw new Error(`appendChild on sealed ${parent.name}`);
    parent.children.push(child);
  },
  createChildSet(root: number) { return { root, children: [] as FakeNode[] }; },
  appendChildToSet(set: { children: FakeNode[] }, child: FakeNode) { set.children.push(child); },
  completeRoot(root: number, set: { children: FakeNode[] }) {
    const seal = (n: FakeNode) => { n.sealed = true; n.children.forEach(seal); };
    set.children.forEach(seal);
    host.roots[root] = set.children;
  },
  measure(_node: FakeNode, callback: (...args: number[]) => void) { callback(1, 2, 3, 4, 5, 6); },
  measureInWindow(_node: FakeNode, callback: (...args: number[]) => void) { callback(5, 6, 3, 4); },
  dispatchCommand() {},
  registerEventHandler(handler: unknown) { (fake as { handler?: unknown }).handler = handler; },
};
(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager = fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null), openURL: (url) => { (globalThis.__opened ??= []).push(url); return Promise.resolve(); } };",
  "react-native/Libraries/Image/resolveAssetSource": "export default (source) => source && typeof source === 'object' && 'uri' in source ? { scale: 1, ...source } : null;",
  "react-native/Libraries/Components/Keyboard/Keyboard": "export default { isVisible: () => false, dismiss() {} };",
  "react-native/Libraries/NativeComponent/ViewConfig": "export const createViewConfig = (partial) => partial;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = () => null;",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
  "react-native/Libraries/Utilities/Appearance": "export const getColorScheme = () => 'light'; export const addChangeListener = () => ({ remove() {} });",
  "react-native/Libraries/Utilities/PixelRatio": "export default { get: () => 2, roundToNearestPixel: (value) => Math.round(value * 2) / 2 };",
  "react-native/Libraries/Utilities/Dimensions": "export default { get: () => ({ width: 400, height: 800 }), addEventListener: () => ({ remove() {} }) };",
  // The `Text` and `View` a fixture imports are lowered to `<native-text>` and `<native-view>`, and the import is then unused.
  "@example/svelte-native": "export const Text = null; export const View = null;",
};

// The class table the class resolver reads (`@example/svelte-native/classes-table`): what the converter would write for these classes.
const classTable = {
  version: 1,
  classes: {
    "text-lg": [{ order: 1, style: { fontSize: 18 }, fontRelative: { lineHeight: 1.5 } }],
    "text-sm": [{ order: 2, style: { fontSize: 14 }, fontRelative: { lineHeight: 1.25 } }],
    "leading-snug": [{ order: 3, fontRelative: { lineHeight: 1.25 } }],
    "text-white": [{ order: 4, style: { color: "#ffffff" } }],
    "bg-blue": [{ order: 5, style: { backgroundColor: "#0000ff" } }],
    card: [{ order: 6, style: { padding: 16 } }],
    // What the converter writes for these: `display` is what the native view gets and `htmlDisplay` the keyword the author used (`css/properties.ts`).
    flex: [{ order: 7, style: { display: "flex", htmlDisplay: "flex" } }],
    block: [{ order: 8, style: { display: "flex", htmlDisplay: "block" } }],
    inline: [{ order: 9, style: { display: "flex", htmlDisplay: "inline" } }],
    "inline-flex": [{ order: 14, style: { display: "flex", htmlDisplay: "inline-flex" } }],
    "inline-block": [{ order: 15, style: { display: "flex", htmlDisplay: "inline-block" } }],
    hidden: [{ order: 16, style: { display: "none", htmlDisplay: "none" } }],
    "flex-row": [{ order: 10, style: { flexDirection: "row" } }],
    "justify-between": [{ order: 11, style: { justifyContent: "space-between" } }],
    "items-center": [{ order: 12, style: { alignItems: "center" } }],
    "gap-2": [{ order: 13, style: { gap: 8 } }],
  },
};

const components = ["TextInput", "Switch", "Modal"];


export async function load(fixture = "html-root-fixture.svelte") {
  host.warnings = [];
  const bundle = await build({
    stdin: {
      contents: `import Fixture from ${JSON.stringify(isAbsolute(fixture) ? fixture : `./${fixture}`)};
        import '../src/css/load-table.ts';
        import { startSurface, stopSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        export { startSurface, stopSurface, tick, Fixture };`,
      resolveDir: import.meta.dirname,
    },
    bundle: true, format: "esm", platform: "neutral", conditions: ["browser"], write: false,
    plugins: [{
      name: "html-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^(react-native|expo-modules-core|@example\/svelte-native$)/ }, (args) => (args.path.startsWith("react-native-gesture-handler") ? undefined : { path: args.path, namespace: "stub" }));
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
        builder.onResolve({ filter: /\/view-configs\.ts$/ }, () => ({ path: resolve(import.meta.dirname, "view-configs-stub.ts") }));
        builder.onResolve({ filter: /^@example\/svelte-native\/classes-table$/ }, (args) => ({ path: args.path, namespace: "classes-table" }));
        builder.onLoad({ filter: /.*/, namespace: "classes-table" }, () => ({ contents: `export default ${JSON.stringify(classTable)};`, loader: "js" }));
        builder.onResolve({ filter: /^@example\/svelte-native\/renderer$/ }, () => ({ path: resolve(import.meta.dirname, "../src/renderer.ts") }));
        builder.onResolve({ filter: /^@example\/svelte-native\/router$/ }, () => ({ path: resolve(import.meta.dirname, "../src/router.svelte.ts") }));
        // What the lowering imports the components from; the entry holds more (lists, keyboards) than the page needs.
        builder.onResolve({ filter: /^@example\/svelte-native\/core$/ }, () => ({ path: "core", namespace: "package" }));
        builder.onLoad({ filter: /.*/, namespace: "package" }, () => ({
          contents: components.map((name) => `export { default as ${name} } from ${JSON.stringify(resolve(import.meta.dirname, `../src/components/${name}.svelte`))};`).join("\n"),
          loader: "js", resolveDir: import.meta.dirname,
        }));
        builder.onResolve({ filter: /^esm-env$/ }, () => ({ path: resolve(import.meta.dirname, "../src/environment.ts") }));
        builder.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
          const { code } = await transform(await readFile(path, "utf8"), { loader: "ts" });
          return { contents: compileModule(code, { filename: path }).js.code, loader: "js" };
        });
        // The way Metro's transformer does it, for the files it lowers HTML in.
        builder.onLoad({ filter: /\.svelte$/ }, async ({ path }) => ({
          contents: compile(lowerPrimitives(await readFile(path, "utf8"), { filename: path, html: lowersHtml(path), warn: (message) => host.warnings.push(message) }), componentOptions(path)).js.code,
          loader: "js",
        }));
      },
    }],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-html-"));
  const file = resolve(directory, "bundle.mjs");
  await writeFile(file, bundle.outputFiles[0].contents);
  const m = await import(pathToFileURL(file).href);
  await rm(directory, { recursive: true });
  return m;
}


export type Module = Awaited<ReturnType<typeof load>>;
export const settle = async (m: Module) => { for (let turn = 0; turn < 4; turn++) { await m.tick(); await Promise.resolve(); await Promise.resolve(); } };
export const all = (nodes: FakeNode[]): FakeNode[] => nodes.flatMap((node) => [node, ...all(node.children)]);
export const emit = (target: unknown, type: string, event: object) => (fake as unknown as { handler: (t: unknown, type: string, e: object) => void }).handler(target, type, event);
export const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {}));
/** What a node draws: the text it holds, with the text of nested spans in their places. */
export const textOf = (node: FakeNode): string => node.children.map((child) => (child.name === "RCTRawText" ? String(child.props.text) : textOf(child))).join("");
