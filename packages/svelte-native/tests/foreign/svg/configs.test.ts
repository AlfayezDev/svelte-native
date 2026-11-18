import { expect, test } from "bun:test";
import { transform } from "esbuild";
import { transformSync } from "@babel/core";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { importWithReactNative, withReactNativeGlobals, type Platform, type Reference } from "../../support/rn-reference.ts";
import { loadOracle } from "./support/oracle.ts";
import { flattenFragments, type OracleNode } from "./support/oracle.ts";
import { toReact } from "./support/harness.ts";
import { cases, svgRoot } from "./support/cases.ts";
import { svgKinds } from "../../../src/fabric/foreign-svg-kinds.ts";
import { vendored } from "../../support/paths.ts";

/**
 * The view configs of react-native-svg's 30 Fabric components (29 on Android: iOS has its own root view) (`foreign-svg-kinds.ts`) against the ones React Native generates from the library's own
 * codegen specs (`src/fabric/*NativeComponent.ts`, run through the Babel plugin Metro uses): the same attributes and converters, the same events, and
 * the payload the host builds from the props the library's elements send equals the payload React Native's own code builds for them.
 */
const require = createRequire(import.meta.url);
const codegen = require.resolve("@react-native/babel-plugin-codegen");
const fabric = resolve(vendored("react-native-svg"), "src/fabric");
const platforms: Platform[] = ["android", "ios"];
const timeout = 60_000;
type Table = Record<string, unknown>;
type RegisteredConfig = { uiViewClassName: string; validAttributes: Table; bubblingEventTypes: Record<string, { phasedRegistrationNames: { bubbled: string } }>; directEventTypes: Record<string, { registrationName: string }> };

const specs = readdirSync(fabric).filter((file) => /^\w+NativeComponent\.ts$/.test(file));

type SvgReference = Pick<Reference, "create" | "diff" | "configs"> & { get(name: string): RegisteredConfig };
const references = new Map<Platform, Promise<SvgReference>>();
function loadSvgReference(platform: Platform): Promise<SvgReference> {
  let loaded = references.get(platform);
  if (!loaded) {
    const entry = `${specs.map((file) => `import ${JSON.stringify(resolve(fabric, file))};`).join("\n")}
      export { get } from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
      export { create, diff } from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload";
      export * as configs from ${JSON.stringify(resolve(import.meta.dirname, "../../../src/fabric/view-configs.ts"))};
      import ${JSON.stringify(resolve(import.meta.dirname, "../../../src/fabric/foreign-svg-kinds.ts"))};`;
    loaded = importWithReactNative<SvgReference>(platform, entry, [{
      name: "svg-specs",
      setup(builder) {
        // The spec files are TypeScript for the codegen plugin, which replaces `codegenNativeComponent<NativeProps>(...)` with the view config it reads from the types.
        builder.onLoad({ filter: /react-native-svg[\\/]src[\\/]fabric[\\/]\w+NativeComponent\.ts$/ }, async ({ path }) => {
          const generated = transformSync(readFileSync(path, "utf8"), { filename: path, babelrc: false, configFile: false, plugins: [codegen], parserOpts: { plugins: ["typescript"] }, sourceType: "unambiguous" });
          const stripped = await transform(generated?.code ?? "", { loader: "ts" });
          return { contents: stripped.code, loader: "js", resolveDir: dirname(path) };
        });
      },
    }]).then((module) => ({ get: (name) => withReactNativeGlobals(() => module.get(name)) as RegisteredConfig, create: module.create, diff: module.diff, configs: module.configs }));
    references.set(platform, loaded);
  }
  return loaded;
}

const colors: unknown[] = ["#fff", "#ff0000", "#ffffff80", "rgba(0,0,255,0.5)", "red", "transparent", "hsl(120, 100%, 50%)", "not a color", 0, 0xff0000ff, -1, null, true, {}];
const sources: unknown[] = [{ uri: "https://example.com/a.png" }, { uri: "file:///a.png", width: 4, height: 2 }, null];
const outcome = (run: () => unknown): unknown => { try { return JSON.parse(JSON.stringify(run() ?? null, (_key, value) => (value === undefined ? "__undefined__" : value)) ?? "null"); } catch (error) { return { thrown: String(error) }; } };

function sameAttributes(path: string, reference: Table, mine: Table, converters: Set<string>) {
  expect(Object.keys(mine).sort(), path).toEqual(Object.keys(reference).sort());
  for (const key of Object.keys(reference)) {
    const expected = reference[key] as true | { process?: (value: unknown) => unknown } | Table;
    const actual = mine[key];
    if (expected === true) expect(actual, `${path}.${key}`).toBe(true);
    else if (typeof (expected as { process?: unknown }).process === "function") {
      const process = (expected as { process: (value: unknown) => unknown }).process;
      expect(typeof actual, `${path}.${key}`).toBe("function");
      // The converters of a view's own style are compared on their samples in `renderer/view-configs.test.ts`; these are the ones the library's props add.
      if (process.name !== "processColor" && process.name !== "resolveAssetSource") continue;
      converters.add(process.name);
      for (const sample of process.name === "resolveAssetSource" ? sources : colors) expect(outcome(() => (actual as (value: unknown) => unknown)(sample)), `${path}.${key}(${JSON.stringify(sample)})`).toEqual(outcome(() => process(sample)));
    } else if (typeof (expected as { diff?: unknown }).diff === "function") expect(actual, `${path}.${key}`).toBe(true);
    else {
      expect(typeof actual, `${path}.${key}`).toBe("object");
      sameAttributes(`${path}.${key}`, expected as Table, actual as Table, converters);
    }
  }
}

const eventsOf = (config: RegisteredConfig): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(config.bubblingEventTypes ?? {}).map(([type, event]) => [type, event.phasedRegistrationNames.bubbled])),
  ...Object.fromEntries(Object.entries(config.directEventTypes ?? {}).map(([type, event]) => [type, event.registrationName])),
});

test("every spec of the library is a component the view configs register, and the other way round", () => {
  const names = specs.map((file) => /codegenNativeComponent<[^>]*>\(\s*'(\w+)'/.exec(readFileSync(resolve(fabric, file), "utf8"))?.[1]);
  expect(specs.length).toBe(30);
  expect(names.sort()).toEqual(Object.keys(svgKinds).sort());
});

for (const platform of platforms) {
  test(`${platform}: each config has the attributes, converters and events React Native generates from the spec`, async () => {
    const reference = await loadSvgReference(platform);
    const converters = new Set<string>();
    const base = reference.configs.viewConfigFor("RCTView", platform).attributes as Table;
    // Each platform has its own root view; the other one's spec is `excludedPlatforms`.
    for (const name of Object.keys(svgKinds).filter((component) => component !== (platform === "android" ? "RNSVGSvgView" : "RNSVGSvgViewAndroid"))) {
      const registered = reference.get(name);
      const mine = reference.configs.viewConfigFor(name, platform);
      expect(mine.foreign, name).toBe(false);
      const events = eventsOf(registered);
      // On iOS the generated config lists each event handler prop as an attribute (`ConditionallyIgnoredEventHandlers`); Android's does not, and
      // no native view reads the flag (the events are sent whatever the props say), so the table has none.
      const attributes = { ...registered.validAttributes };
      if (platform === "ios") for (const registration of Object.values(events)) if (!(registration in base)) delete attributes[registration];
      sameAttributes(name, attributes, mine.attributes as Table, converters);
      expect(Object.fromEntries(mine.events), `${name} events`).toEqual(events);
    }
    expect([...converters].sort()).toEqual(["processColor", "resolveAssetSource"]);
  }, timeout);

  test(`${platform}: the payload of the props every element of the library sends is the one React Native builds`, async () => {
    const reference = await loadSvgReference(platform);
    const oracle = await loadOracle(platform);
    const warn = console.warn;
    console.warn = () => {};
    const base = reference.configs.viewConfigFor("RCTView", platform).attributes as Table;
    try {
      let nodes = 0;
      const check = (node: OracleNode | string) => {
        if (typeof node === "string") return;
        if (node.name === "Fragment") { node.children.forEach(check); return; }
        if (node.name === "RNSVGSvgView" || node.name === "RNSVGSvgViewAndroid") expect(node.name).toBe(platform === "android" ? "RNSVGSvgViewAndroid" : "RNSVGSvgView");
        const registered = reference.get(node.name);
        const mine = reference.configs.viewConfigFor(node.name, platform);
        const expected = outcome(() => reference.create(node.props, registered.validAttributes)) as Table | null;
        // The handler flags of iOS's generated config (`onSvgLayout: true`), which the table leaves out (see above).
        if (expected && platform === "ios") for (const registration of Object.values(eventsOf(registered))) if (!(registration in base)) delete expected[registration];
        expect(outcome(() => reference.configs.createPayload(node.props, mine)), node.name).toEqual(expected);
        nodes++;
        node.children.forEach(check);
      };
      for (const [, spec] of Object.entries({ ...cases, ...svgRoot })) {
        const mounted = oracle.mount(toReact(oracle, spec));
        if (mounted) flattenFragments(mounted).forEach(check);
      }
      expect(nodes).toBeGreaterThan(100);
    } finally {
      console.warn = warn;
    }
  }, timeout);
}
