import { describe, expect, test } from "bun:test";
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

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
};
// `Appearance` is the module namespace, not a default export.
const appearance = "react-native/Libraries/Utilities/Appearance";

async function load(): Promise<{ lite: Lite; evaluated: string[] }> {
  const bundle = await build({
    entryPoints: [resolve(import.meta.dirname, "../src/fabric/react-native-lite.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    plugins: [
      {
        name: "react-native-stubs",
        setup(builder) {
          builder.onResolve({ filter: /^react-native\// }, (args) => ({ path: args.path, namespace: "stub" }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => {
            const value = args.path === appearance ? "{ getColorScheme: () => 'light' }" : (stubs[args.path] ?? "{}");
            const body = args.path === appearance ? `export const getColorScheme = ${value}.getColorScheme;` : `export default ${value};`;
            return { contents: `globalThis.__evaluated.push(${JSON.stringify(args.path)}); ${body}`, loader: "js" };
          });
        },
      },
    ],
  });
  const directory = await mkdtemp(resolve(tmpdir(), "svelte-native-lite-"));
  const file = resolve(directory, "lite.mjs");
  await writeFile(file, bundle.outputFiles[0]?.contents ?? "");
  const evaluated: string[] = [];
  (globalThis as { __evaluated?: string[] }).__evaluated = evaluated;
  const lite = (await import(pathToFileURL(file).href)) as Lite;
  await rm(directory, { recursive: true });
  return { lite, evaluated };
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

  test("shim placeholders stay inert", async () => {
    const { lite } = await load();
    expect(lite.View()).toBeNull();
    expect(lite.findNodeHandle()).toBeNull();
    expect(new lite.Animated.Value(3)._value).toBe(3);
    expect(lite.Animated.createAnimatedComponent(lite.View)).toBe(lite.View);
  });
});
