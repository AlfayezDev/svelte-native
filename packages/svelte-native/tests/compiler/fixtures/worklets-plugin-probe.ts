// Run by worklets-plugin.test.ts under Node (the Babel transformer Metro's workers load cannot run under Bun): loads the package's transformer as Metro's worker does, in the app directory
// named on the command line, and prints what the Worklets Babel plugin did to a file with worklets, and which file `react-native-worklets/plugin` is for whoever asks.
import { createRequire } from "node:module";
import { join } from "node:path";
import generate from "@babel/generator";
import { transform } from "../../../src/transformer.ts";

const [root, filename] = process.argv.slice(2) as [string, string];
const source = `
export function useStyle(width) {
  const grow = (value) => { "worklet"; return value * 2 + width; };
  const another = function (value) { "worklet"; return grow(value) + 1; };
  return { grow, another };
}
`;
const output = transform({
  filename: join(root, filename),
  src: source,
  options: { dev: false, projectRoot: root, platform: "android", hot: false, inlineRequires: false, minify: false, type: "module", unstable_transformProfile: "default", publicPath: "/assets", customTransformOptions: {} },
  plugins: [],
} as never) as { ast: object };
const code = (generate as unknown as { default?: typeof generate }).default?.(output.ast as never).code ?? (generate as unknown as (ast: object) => { code: string })(output.ast).code;
// What a plugin or the preset finds when it asks Node for the package's plugin, from the app and from babel-preset-expo's own directory (the two places the preset looks).
const fromApp = createRequire(join(root, "package.json")).resolve("react-native-worklets/plugin");
const preset = createRequire(import.meta.url).resolve("babel-preset-expo/package.json");
const fromPreset = createRequire(join(preset, "..", "build", "utils", "resolveModule.js")).resolve("react-native-worklets/plugin", { paths: [root, join(preset, "..", "build", "utils")] });
console.log(JSON.stringify({ code, fromApp, fromPreset, loaded: Object.keys(createRequire(import.meta.url).cache).filter((path) => path.includes("react-native-worklets")) }));
