
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Plugin } from "esbuild";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { appearanceStub, bundle, evaluate, src, tests } from "./bundle.ts";
import { type FakeNode, createHost, flatten } from "./host.ts";

/**
 * The harness of the tests of HTML elements (`components/html-elements.test.ts`, `components/html-differential.test.ts`): a page is lowered as the Metro transformer lowers a file of an app (`lowerPrimitives` with
 * `html`, for the files `lowersHtml` names), compiled with the options of the library, bundled with the host, and mounted on a fake Fabric binding, so what a test reads is the tree and the
 * props the platform would be given, and an event goes through the host's own path.
 */
export type { FakeNode };
const binding = createHost();
/** What the last mounts left: the committed children of each surface, and what the lowering warned about while the last fixture was built. */
export const host = {
  get roots(): Record<number, FakeNode[]> { return binding.roots; },
  set roots(roots: Record<number, FakeNode[]>) { binding.roots = roots; },
  warnings: [] as string[],
};
export const fake = binding.fake;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => { const out = {}; let changed = false; for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) { if (prev[k] !== next[k]) { out[k] = k in next ? next[k] : null; changed = true; } } return changed ? out : null; };",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const register = (name) => name; export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: { topChange: { phasedRegistrationNames: { bubbled: 'onChange', captured: 'onChangeCapture' } } }, directEventTypes: { topLayout: { registrationName: 'onLayout' }, topScroll: { registrationName: 'onScroll' } } });",
  "react-native/Libraries/Utilities/Platform": "export default { get OS() { return globalThis.__htmlOS ?? 'android'; }, Version: 34 };",
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
  "react-native/Libraries/Utilities/Appearance": appearanceStub,
  "react-native/Libraries/Utilities/PixelRatio": "export default { get: () => 2, roundToNearestPixel: (value) => Math.round(value * 2) / 2 };",
  "react-native/Libraries/Utilities/Dimensions": "export default { get: () => ({ width: 400, height: 800 }), addEventListener: () => ({ remove() {} }) };",
  // The `Text` and `View` a fixture imports are lowered to `<native-text>` and `<native-view>`, and the import is then unused.
  "expo-svelte": "export const Text = null; export const View = null;",
};

// The class table the class resolver reads (`expo-svelte/classes-table`): what the converter would write for these classes.
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

/**
 * The directory the tests' own `svelte` comes from: a page written in a test (`components/html-elements.test.ts`, `components/html-differential.test.ts`) lives in a temporary directory outside the
 * package, where what the compiler's output imports (`svelte/internal/client`) is found only through this.
 */
const nodeModules = dirname(dirname(createRequire(import.meta.url).resolve("svelte/package.json")));


/** The aliases the lowered code imports from, and the class table the class resolver reads. */
const aliases: Plugin = {
  name: "html-fixture",
  setup(builder) {
    builder.onResolve({ filter: /^expo-svelte\/classes-table$/ }, (args) => ({ path: args.path, namespace: "classes-table" }));
    builder.onLoad({ filter: /.*/, namespace: "classes-table" }, () => ({ contents: `export default ${JSON.stringify(classTable)};`, loader: "js" }));
    builder.onResolve({ filter: /^expo-svelte\/router$/ }, () => ({ path: src("router.svelte.ts") }));
    // What the lowering imports the components from; the entry holds more (lists, keyboards) than the page needs.
    builder.onResolve({ filter: /^expo-svelte\/core$/ }, () => ({ path: "core", namespace: "package" }));
    builder.onLoad({ filter: /.*/, namespace: "package" }, () => ({
      contents: components.map((name) => `export { default as ${name} } from ${JSON.stringify(src(`components/${name}.svelte`))};`).join("\n"),
      loader: "js", resolveDir: tests,
    }));
  },
};

/** `fixture` is the path of a page (absolute, or relative to `tests/`); without one, the page of `components/fixtures/html-root-fixture.svelte` under a router. */
export async function load(fixture = resolve(tests, "components/fixtures/html-root-fixture.svelte")) {
  const built = await bundle({
    entry: `import Fixture from ${JSON.stringify(isAbsolute(fixture) ? fixture : `./${fixture}`)};
        import '../src/css/load-table.ts';
        import { startSurface, stopSurface } from '../src/fabric/host.ts';
        import { tick } from 'svelte';
        import { __setColorScheme } from 'react-native/Libraries/Utilities/Appearance';
        export { startSurface, stopSurface, tick, Fixture, __setColorScheme };`,
    stubs, viewConfigs: "pass-through", converters: false, lower: { html: true }, plugins: [aliases], cacheKey: "html-harness",
    esbuild: { mainFields: [], nodePaths: [nodeModules] },
  });
  host.warnings = [...built.warnings];
  // The bundled host reads the binding when the bundle is evaluated; another file's fake may have been put in its place since the last load.
  binding.install();
  return evaluate<{ startSurface: (rootTag: number, app: unknown, props: Record<string, unknown>) => Record<string, unknown>; stopSurface: (rootTag: number) => void; tick: () => Promise<void>; Fixture: unknown; __setColorScheme: (scheme: "light" | "dark") => void }>(built.code);
}

export type Module = Awaited<ReturnType<typeof load>>;
export const settle = async (m: Module) => { for (let turn = 0; turn < 4; turn++) { await m.tick(); await Promise.resolve(); await Promise.resolve(); } };
export const all = flatten;
export const emit = (target: unknown, type: string, event: object) => (binding.handler as (t: unknown, type: string, e: object) => void)(target, type, event);
export const flat = (style: unknown): Record<string, unknown> => (Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : ((style as Record<string, unknown>) ?? {}));
/** What a node draws: the text it holds, with the text of nested spans in their places. */
export const textOf = (node: FakeNode): string => node.children.map((child) => (child.name === "RCTRawText" ? String(child.props.text) : textOf(child))).join("");
