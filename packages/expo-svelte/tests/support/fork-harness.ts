import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { reanimatedStubs } from "./reanimated-stubs.ts";
import { appStubs, bundle, evaluate } from "./bundle.ts";
import { type FakeNode, createHost } from "./host.ts";

/**
 * The harness of `renderer/fork.test.ts`: a bundle of the renderer, the Fabric host and a fixture, with Svelte's async mode on, which `fork()` needs and which the library leaves off unless the app
 * asks (`withExpoSvelte(config, { async: true })`, `compile-options.ts`). By default the components are compiled with the library's own options and the bundle imports the flag module first,
 * the one thing the option adds to a component without an `await`; `compiled: true` compiles every component with `experimental.async`, which is what the option does (the same output but for
 * that import, `compiler/async-mode-fork.test.ts`), and a function chooses the files, for a bundle in which only some are. The bundle carries its own copy of Svelte's runtime, so the flag stays in that bundle
 * and no other test's runtime sees it. */
export type { FakeNode };
const binding = createHost();
/** What the last `loadFork()` made the host do: the calls it made and the surfaces it committed. */
export const fabric = {
  get calls(): string[] { return binding.calls; },
  get roots(): Record<number, FakeNode[]> { return binding.roots; },
};

/**
 * The host reads `nativeFabricUIManager` when its module is evaluated, and other test files put a fake of their own in its place, so every `loadFork()` installs this one again (and
 * empties what it recorded) before it evaluates a bundle: a test then sees the calls of its own bundle and no other. React Native has `requestAnimationFrame`, which `tick()` waits for in
 * async mode; Bun has none, so one is put in place for every load and not once: a test file that runs between two users of this harness may delete it (`components/list.test.ts` does, after each test).
 */
function installFabric(): void {
  binding.reset();
  binding.install(typeof globalThis.requestAnimationFrame === "function" ? {} : { requestAnimationFrame: (callback: () => void) => setTimeout(callback, 16) });
}

const stubs: Record<string, string> = {
  ...reanimatedStubs,
  ...appStubs,
  "react-native/Libraries/Utilities/Platform": "export default { OS: 'android', Version: 34 };",
  "react-native/Libraries/AppState/AppState": "export default { currentState: 'active', addEventListener: () => ({ remove() {} }) };",
  "react-native/Libraries/Linking/Linking": "export default { addEventListener: () => ({ remove() {} }), getInitialURL: () => Promise.resolve(null) };",
  "react-native/Libraries/Image/resolveAssetSource": "export default () => null;",
  "react-native/Libraries/Components/View/ViewNativeComponent": "export {};",
  "react-native/Libraries/Text/TextNativeComponent": "export {};",
  "react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent": "export {};",
  "react-native": "export const AppRegistry = { registerRunnable() {} };",
};

/** The modules a fork test reaches into, as the bundle exports them. */
export type ForkModule = {
  Fixture: import("svelte").Component<Record<string, unknown>, Record<string, unknown>>;
  renderer: import("svelte/renderer").Renderer<{ fragment: never; element: never; text: never; comment: never }>;
  NativeNode: typeof import("../../src/renderer.ts").NativeNode;
  mergeHostProps: typeof import("../../src/native-props.ts").mergeHostProps;
  mount: typeof import("svelte").mount;
  unmount: typeof import("svelte").unmount;
  tick: typeof import("svelte").tick;
  flushSync: typeof import("svelte").flushSync;
  fork: (fn: () => void) => { commit(): Promise<void>; discard(): void };
  startSurface: typeof import("../../src/fabric/host.ts").startSurface;
  flush: typeof import("../../src/fabric/host.ts").flush;
  fabricStats: typeof import("../../src/fabric/host.ts").fabricStats;
  asyncFlag: () => boolean;
};

const flags = resolve(dirname(createRequire(import.meta.url).resolve("svelte/package.json")), "src/internal/flags/index.js");

/** Bundles the fixture with async mode on (`async: false` is the control: the same bundle without the flag). */
export async function loadFork(fixture: string, { async = true, compiled = false, realConfigs = false }: { async?: boolean; compiled?: boolean | ((path: string) => boolean); realConfigs?: boolean } = {}): Promise<ForkModule> {
  // The stand-in passes every prop through as it is; `realConfigs` runs the host's own payload builder (React Native's style converters included), which is what a device pays.
  const built = await bundle({
    entry: `${async ? "import 'svelte/internal/flags/async';" : ""}
        import Fixture from './${fixture}';
        import renderer, { NativeNode } from '../src/renderer.ts';
        import { mergeHostProps } from '../src/native-props.ts';
        import { startSurface, flush, fabricStats } from '../src/fabric/host.ts';
        import { mount, unmount, tick, flushSync, fork } from 'svelte';
        import { async_mode_flag } from '${flags}';
        export const asyncFlag = () => async_mode_flag;
        export { Fixture, renderer, NativeNode, mergeHostProps, mount, unmount, tick, flushSync, fork, startSurface, flush, fabricStats };`,
    stubs, viewConfigs: realConfigs ? "real" : "pass-through", converters: realConfigs, compiled,
  });
  installFabric();
  return evaluate<ForkModule>(built.code);
}

export const find = (nodes: FakeNode[], name: string): FakeNode[] => nodes.flatMap((n) => [...(n.name === name ? [n] : []), ...find(n.children, name)]);
