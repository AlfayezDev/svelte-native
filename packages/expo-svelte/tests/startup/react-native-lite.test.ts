import { describe, expect, test } from "bun:test";
import type { PluginBuild } from "esbuild";
import { bundle, evaluate, src } from "../support/bundle.ts";

// Every React Native module the shim imports is replaced by a stub that records the moment it is evaluated, so the tests can
// tell which ones the first screen pays for and which wait for their first use.
type Lite = {
  codegenNativeComponent(name: string, options?: object): unknown;
  processColor(color: string): unknown;
  useColorScheme(): unknown;
  PixelRatio: { get(): number };
  StyleSheet: { hairlineWidth: number; create: unknown };
  StatusBar: { setBarStyle(style: string): string; current: string };
  Networking: { sendRequest(): string };
  Appearance: { getColorScheme(): string };
  PanResponder: { create(config: object): { panHandlers: Record<string, unknown> } };
  View(): unknown;
  findNodeHandle(): unknown;
  Animated: { Value: new (value: number) => { _value: number }; createAnimatedComponent(component: unknown): unknown };
};

const eager = [
  "react-native/Libraries/Utilities/Platform",
  "react-native/Libraries/BatchedBridge/NativeModules",
  "react-native/Libraries/EventEmitter/NativeEventEmitter",
  "react-native/Libraries/AppState/AppState",
  "react-native/Libraries/Utilities/Dimensions",
  "react-native/Libraries/ReactNative/I18nManager",
  "react-native/Libraries/TurboModule/TurboModuleRegistry",
];

const stubs: Record<string, string> = {
  "react-native/Libraries/StyleSheet/StyleSheet": "{ hairlineWidth: 1, create: (styles) => styles }",
  "react-native/Libraries/Utilities/codegenNativeComponent": "(name, options) => ({ name, options })",
  "react-native/Libraries/StyleSheet/processColor": "(color) => 'processed:' + color",
  "react-native/Libraries/Utilities/PixelRatio": "{ get: () => 2.5 }",
  "react-native/Libraries/Utilities/useColorScheme": "() => 'dark'",
  "react-native/Libraries/Components/StatusBar/StatusBar": "{ setBarStyle: (style) => 'bar:' + style, current: 'default' }",
  "react-native/Libraries/Network/RCTNetworking": "{ sendRequest: () => 'sent' }",
  "react-native/Libraries/Interaction/PanResponder": "{ create: () => ({ panHandlers: { onResponderGrant: () => 'grant' } }) }",
};
// `Appearance` is the module namespace, not a default export.
const appearance = "react-native/Libraries/Utilities/Appearance";

/** The shim bundled once for the run, against stubs that record the moment each is evaluated (in `recorded`, a module of the bundle, so a load leaves nothing on the global object). */
const stubbed = {
  name: "react-native-stubs",
  setup(builder: PluginBuild) {
    builder.onResolve({ filter: /^react-native\// }, (args) => ({ path: args.path, namespace: "stub" }));
    builder.onResolve({ filter: /^recorded$/ }, () => ({ path: "recorded", namespace: "recorded" }));
    builder.onLoad({ filter: /.*/, namespace: "recorded" }, () => ({ contents: "export const evaluated = [];", loader: "js" }));
    builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
      const value = args.path === appearance ? "{ getColorScheme: () => 'light' }" : (stubs[args.path] ?? "{}");
      const body = args.path === appearance ? `export const getColorScheme = ${value}.getColorScheme;` : `export default ${value};`;
      return { contents: `import { evaluated } from "recorded"; evaluated.push(${JSON.stringify(args.path)}); ${body}`, loader: "js" };
    });
  },
};
const built = () => bundle({ entry: `export * from ${JSON.stringify(src("fabric/react-native-lite.ts"))}; export { evaluated } from "recorded";`, plugins: [stubbed], cacheKey: "react-native-lite", converters: false });

/** The shim as a module of its own: nothing is evaluated until a test imports it. */
async function load(): Promise<{ lite: Lite; evaluated: string[] }> {
  const module = await evaluate<Lite & { evaluated: string[] }>((await built()).code);
  return { lite: module, evaluated: module.evaluated };
}

describe("react-native-lite", () => {
  test("loading the shim evaluates only the React Native modules the first screen needs", async () => {
    const { evaluated } = await load();
    expect([...evaluated].sort()).toEqual([...eager].sort());
  });

  test("a function export loads its module on the first call and forwards arguments and result", async () => {
    const { lite, evaluated } = await load();
    expect(lite.codegenNativeComponent("RCTFoo", { interfaceOnly: true })).toEqual({ name: "RCTFoo", options: { interfaceOnly: true } });
    expect(lite.processColor("red")).toBe("processed:red");
    expect(lite.useColorScheme()).toBe("dark");
    expect(evaluated.filter((path) => path.endsWith("/codegenNativeComponent"))).toHaveLength(1);
    lite.codegenNativeComponent("RCTBar");
    expect(evaluated.filter((path) => path.endsWith("/codegenNativeComponent"))).toHaveLength(1);
  });

  test("an object export loads its module when a property is read, written or tested, and only that module", async () => {
    const { lite, evaluated } = await load();
    const before = evaluated.length;
    expect(lite.PixelRatio.get()).toBe(2.5);
    expect(evaluated.slice(before)).toEqual(["react-native/Libraries/Utilities/PixelRatio"]);
    expect(lite.StyleSheet.hairlineWidth).toBe(1);
    expect("create" in lite.StyleSheet).toBe(true);
    expect(lite.StatusBar.setBarStyle("light")).toBe("bar:light");
    lite.StatusBar.current = "dark";
    expect(lite.StatusBar.current).toBe("dark");
    expect(lite.Networking.sendRequest()).toBe("sent");
    expect(lite.Appearance.getColorScheme()).toBe("light");
    expect(evaluated.slice(before)).toHaveLength(5);
  });

  test("PanResponder, which react-native-svg's extractResponder reads when it loads, is the real module once it is used and not before", async () => {
    const { lite, evaluated } = await load();
    expect(evaluated).not.toContain("react-native/Libraries/Interaction/PanResponder");
    expect(Object.keys(lite.PanResponder.create({}).panHandlers)).toEqual(["onResponderGrant"]);
    expect(evaluated.filter((path) => path.endsWith("/PanResponder"))).toHaveLength(1);
  });

  test("shim placeholders stay inert", async () => {
    const { lite } = await load();
    expect(lite.View()).toBeNull();
    expect(lite.findNodeHandle()).toBeNull();
    expect(new lite.Animated.Value(3)._value).toBe(3);
    expect(lite.Animated.createAnimatedComponent(lite.View)).toBe(lite.View);
  });
});
