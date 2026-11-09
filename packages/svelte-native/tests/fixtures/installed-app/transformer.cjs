/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro and Expo load the library */
// Loaded by plain `node` the way Metro's worker loads `transformer.babelTransformerPath`: required by the path `withSvelteNative` put in the config.
const { createRequire } = require("node:module");
const transformer = require(require.resolve("@rasheed/svelte-native/transformer"));
const { traverseFast } = require("@babel/types");

const root = process.cwd();
const options = { dev: false, projectRoot: root, platform: "android", hot: false, inlineRequires: false, minify: false, type: "module", unstable_transformProfile: "default", publicPath: "/assets", customTransformOptions: {} };
const imports = (ast) => {
  const found = [];
  traverseFast(ast, (node) => {
    if (node.type === "ImportDeclaration") found.push(node.source.value);
    if (node.type === "CallExpression" && node.callee.name === "require" && node.arguments[0]?.type === "StringLiteral") found.push(node.arguments[0].value);
  });
  return found;
};
const svelte = transformer.transform({
  filename: `${root}/src/Page.svelte`,
  src: '<script lang="ts">import { View, Text } from "@rasheed/svelte-native"; let n: number = $state(1);</script>\n<View><Text>{n}</Text></View>\n',
  options,
  plugins: [],
});
const remote = transformer.sourceOf({ filename: `${root}/src/lib/api.remote.ts`, src: 'import { query } from "$app/server"; export const hello = query(async () => 1);', options });
console.log(JSON.stringify({ exports: Object.keys(transformer).sort(), svelteImports: imports(svelte.ast), remote, cacheKey: transformer.getCacheKey({}), resolvedFrom: createRequire(`${root}/`).resolve("@rasheed/svelte-native/transformer") }));
