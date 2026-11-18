import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHarness, find, settle, type FakeNode, type Natives } from "../../support/harness.ts";
import { flattenFragments, panResponderKeys, type Oracle, type OracleNode } from "./oracle.ts";
import type { Platform } from "../../../support/rn-reference.ts";
import { vendorRoot } from "../../../support/paths.ts";

/**
 * The Svelte components against the library's own elements (`oracle.ts`): the same element tree is mounted by both and the nodes,
 * view names and props that reach the fake Fabric binding are compared. Metro resolves the library's `react-native` import to the
 * host's shim; here that import is `processColor` (React Native's own) and `PanResponder`'s handler names (React Native's own, read once).
 */
const modules = vendorRoot;
/** The library's own sources by deep path (the harness stubs every other import that starts with `react-native`). */
function libraryFile(path: string): string | undefined {
  const base = resolve(modules, path);
  return ["", ".ts", ".tsx", ".js", "/index.ts"].map((extension) => `${base}${extension}`).find((file) => /\.\w+$/.test(file) && existsSync(file));
}

export type Spec = { tag: string; props?: Record<string, unknown>; children?: (Spec | string)[] };
export type Described = { name: string; props: Record<string, unknown>; children: (Described | string)[] };

/**
 * `colors`: Reanimated's own `processColorsInProps` instead of the stub, applied by the stubbed `updateProps` as the real one does for animated props
 * (`updateProps.ts`: `if (isAnimatedProps) processColorsInProps(updates)`), and exported as `colors`.
 */
export async function svgHarness(platform: Platform, options: { natives?: Partial<Natives>; colors?: boolean } = {}) {
  const keys = await panResponderKeys();
  const harness = createHarness(platform, {
    natives: options.natives,
    stubs: {
      ...(options.colors ? {
        "react-native": `export const AppRegistry = { registerRunnable() {} }; export const Platform = { OS: ${JSON.stringify(platform)} };`,
        "react-native-reanimated/src/updateProps": `
          import { processColorsInProps } from "react-native-reanimated/src/common/style/processors/colors";
          const A = (globalThis.__anim ??= { descriptors: [], mappers: [], updates: [], css: [], removable: [] });
          export const updateProps = (descriptors, values, isAnimatedProps) => { const updates = { ...values }; if (isAnimatedProps) processColorsInProps(updates); A.updates.push({ descriptors, values: updates, animatedProps: isAnimatedProps === true }); };`,
      } : null),
      // React Native returns an object source as it is; a number is an asset.
      "react-native/Libraries/Image/resolveAssetSource": "export default (source) => (typeof source === 'number' ? (globalThis.__harness.natives.assets[source] ?? null) : source && typeof source === 'object' ? source : null);",
      "svg-react-native": `
        import processColor from "react-native/Libraries/StyleSheet/processColor";
        export { processColor };
        export const PanResponder = { create: () => ({ panHandlers: Object.fromEntries(${JSON.stringify(keys)}.map((key) => [key, () => undefined])) }) };`,
    },
    cacheKey: `svg-harness ${options.colors === true}`,
    plugins: [...(options.colors ? [{
      name: "reanimated-colors",
      setup(builder: import("esbuild").PluginBuild) {
        builder.onResolve({ filter: /^react-native-reanimated\/src\/common\/style\/processors\/colors$/ }, (args) => ({ path: resolve(modules, `${args.path}.ts`) }));
      },
    }] : []), {
      name: "svg-library-react-native",
      setup(builder) {
        builder.onResolve({ filter: /^react-native$/ }, (args) => (/[\\/]react-native-svg[\\/]/.test(args.importer) ? { path: "svg-react-native", namespace: "stub" } : undefined));
        builder.onResolve({ filter: /^react-native-svg\// }, (args) => ({ path: libraryFile(args.path) }));
      },
    }],
    exports: `export * as svg from '../src/fabric/foreign-svg.ts'; export * as extract from '../src/fabric/foreign-svg-extract.ts'; export * as xml from '../src/fabric/foreign-svg-xml.ts';${options.colors ? " export * as colors from 'react-native-reanimated/src/common/style/processors/colors';" : ""}`,
  });
  return harness;
}

/**
 * The harnesses a test file makes, which install a fake binding and the stand-ins' globals each: `world.harness(...)` makes one and `world.restore()` (in `afterAll`) puts the global
 * object back, newest harness first.
 */
export function svgWorld() {
  const made: { restore(): void }[] = [];
  return {
    async harness(...args: Parameters<typeof svgHarness>) {
      const harness = await svgHarness(...args);
      made.push(harness);
      return harness;
    },
    restore() { while (made.length > 0) made.pop()?.restore(); },
  };
}

export type SvgLoaded = Awaited<ReturnType<ReturnType<typeof createHarness>["load"]>> & {
  svg: typeof import("../../../../src/fabric/foreign-svg.ts");
  extract: typeof import("../../../../src/fabric/foreign-svg-extract.ts");
  xml: typeof import("../../../../src/fabric/foreign-svg-xml.ts");
  /** Only from `svgHarness(platform, { colors: true })`. */
  colors: { processColorsInProps(props: Record<string, unknown>): void };
};

/**
 * What the host adds to a node with press handlers (`splitProps` in `host.ts`): `onClick`, which makes the node clickable for accessibility services, and
 * on iOS `accessible`. They are the host's, whatever view it is.
 */
export const pressHostProps = ["onClick", "accessible"];
export const pressKeys = ["onPress", "onPressIn", "onPressOut", "onLongPress"];
export const hasPress = (spec: Spec | string): boolean => typeof spec !== "string" && (pressKeys.some((key) => spec.props && key in spec.props) || (spec.children ?? []).some(hasPress));

export function describeOurs(node: FakeNode, ignore: readonly string[] = []): Described {
  const props = { ...node.props };
  for (const key of ignore) delete props[key];
  return { name: node.name, props, children: node.children.map((child) => describeOurs(child, ignore)) };
}

/**
 * The six responder flags the library's Touchable mixin adds next to `responsible`: not sent here (the host's Pressability answers touches). A flag
 * the caller passes itself is sent, as the library does (`keep`).
 */
const touchableFlags = ["onStartShouldSetResponder", "onResponderTerminationRequest", "onResponderGrant", "onResponderMove", "onResponderRelease", "onResponderTerminate"];

/** What the library mounts, as the host's payload builder would send it. */
export function describeTheirs(nodes: (OracleNode | string)[], loaded: SvgLoaded, platform: Platform, keep: readonly string[] = []): Described[] {
  return nodes.flatMap(flattenFragments).filter((node): node is OracleNode => typeof node !== "string").map((node) => {
    const config = loaded.configs.viewConfigFor(node.name, platform);
    const props = { ...(loaded.configs.createPayload(node.props, config) ?? {}) };
    for (const flag of touchableFlags) if (!keep.includes(flag)) delete props[flag];
    return { name: node.name, props, children: describeTheirs(node.children, loaded, platform, keep) };
  });
}

/** As the library's XML renderer builds elements (`astToReact`): the children are always an array, even for one string. */
export const toReact = (oracle: Oracle, spec: Spec | string): unknown =>
  typeof spec === "string" ? spec : oracle.create(oracle.tags[spec.tag], { ...spec.props, children: (spec.children ?? []).map((child) => toReact(oracle, child)) });

export const toNode = (spec: Spec | string): unknown =>
  typeof spec === "string" ? spec : { tag: spec.tag, props: spec.props ?? {}, children: (spec.children ?? []).map(toNode) };

export { find, settle, resolve };
