import { reanimatedStubs } from "./reanimated-stubs.ts";
import { svgLibraryStubs } from "./svg-library-stubs.ts";
import { load as bundle, src, tests } from "./bundle.ts";
import { fakeHost } from "./fake-host.ts";
import { type FakeNode, flatten, settle } from "./host.ts";

/**
 * For the tests of an app started the way the platform starts one: `createFabricApp` registers the app with the app registry (`RN$AppRegistry`), the host runs the registered runnable with
 * a root tag and the initial props, and a hot update, a recreation or a restore runs it again. `appSurface()` is called once at the top of a test file: it installs a fake host around
 * each test (with `__DEV__` and the registry set), bundles a fixture with the stand-ins the app needs (the router, the screens, the navigation modules `globalThis.__nativeModules`
 * and the launch link `globalThis.__initialURL`), and records what was committed to each surface.
 */
export type AppModule = Pick<typeof import("../../src/fabric/index.ts"), "createFabricApp" | "remountSurfaces" | "showError"> &
  Pick<typeof import("../../src/app-hooks.ts"), "registerHooks" | "retryInit"> &
  Pick<typeof import("./tree-app.ts"), "appTree" | "collidingFiles"> & { tick: () => Promise<void>; Fixture: never };

export type Runnable = (parameters: { rootTag: number; initialProps?: Record<string, unknown> }) => void;

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  ...svgLibraryStubs,
  "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload": "export const create = (props) => ({ ...props }); export const diff = (prev, next) => ({ ...next });",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry": "export const get = (name) => ({ uiViewClassName: name, validAttributes: {}, bubblingEventTypes: {}, directEventTypes: {} });",
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/Utilities/BackHandler": "export default { addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(globalThis.__initialURL ?? null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "expo-modules-core": "export const EventEmitter = class {}; export const requireOptionalNativeModule = (name) => (globalThis.__nativeModules ?? {})[name] ?? null;",
};

export function appSurface() {
  const runnables: Record<string, Runnable> = {};
  const registry = { registerRunnable(key: string, run: Runnable) { runnables[key] = run; return key; } };
  const host = fakeHost({ globals: { __DEV__: true, RN$AppRegistry: registry } });
  /** Every commit to a surface, in order, with the tags of its top-level nodes. */
  const commits: { root: number; tags: number[] }[] = [];
  const completeRoot = host.fake.completeRoot;
  host.fake.completeRoot = (root, set) => { commits.push({ root, tags: set.children.map((node) => node.tag) }); completeRoot(root, set); };

  /** The fixture (an absolute path) bundled with the app's entry points, as a module of its own: its hot-update state (`__svelteNativeHmrState`) is new. */
  const load = (fixture: string): Promise<AppModule> => {
    delete (globalThis as { __svelteNativeHmrState?: unknown }).__svelteNativeHmrState;
    return bundle<AppModule>({
      entry: `import Fixture from ${JSON.stringify(fixture)};
        import { createFabricApp, remountSurfaces, showError } from ${JSON.stringify(src("fabric/index.ts"))};
        import { appTree, collidingFiles } from ${JSON.stringify(`${tests}/tree-app.ts`)};
        import { tick } from 'svelte';
        import { registerHooks, retryInit } from ${JSON.stringify(src("app-hooks.ts"))};
        export { createFabricApp, remountSurfaces, showError, tick, Fixture, appTree, collidingFiles, registerHooks, retryInit };`,
      stubs,
      converters: false,
    });
  };

  const find = (nodes: FakeNode[], name: string): FakeNode[] => flatten(nodes).filter((node) => node.name === name);
  /** The strings drawn on a surface. */
  const texts = (root: number) => find(host.roots[root] ?? [], "RCTRawText").map((node) => String(node.props.text));
  /** Forgets what the surfaces and the commits were: a test that loads a second app starts counting again. */
  const forget = () => { host.roots = {}; commits.length = 0; };
  /** The host stops the surface of a root tag (a recreated Activity does, and a closed screen). */
  const stopSurface = (rootTag: number) => (globalThis as { __svelteFabricStop?: (rootTag: number) => void }).__svelteFabricStop?.(rootTag);
  return { host, runnables, commits, load, find, texts, forget, settle, stopSurface };
}
