/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro and Expo load the library */
// Loaded by plain `node` the way Metro's worker loads `transformer.babelTransformerPath`: required by the path `withSvelteNative` put in the config.
const { createRequire } = require("node:module");
const transformer = require(require.resolve("@example/svelte-native/transformer"));
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
  // `in:` needs the library's patch to Svelte's compiler, which `require("svelte/compiler")` (Svelte's prebuilt bundle) does not have: the transformer loads the sources.
  src: '<script lang="ts">import { View, Text } from "@example/svelte-native"; import { fade } from "svelte/transition"; let n: number = $state(1);</script>\n{#if n}<View in:fade><Text>{n}</Text></View>{/if}\n',
  options,
  plugins: [],
});
// A `.svelte.ts` module of the library at the path an install puts it at, under `node_modules`.
const svelteModule = transformer.transform({
  filename: `${root}/node_modules/@example/svelte-native/src/counter.svelte.ts`,
  src: "let count: number = $state(0);\nexport function bump(by: number = 1): number {\n  count += by;\n  return count;\n}\n",
  options,
  plugins: [],
});
// D17: the app's components are in runes mode by default (no `svelte/internal/flags/legacy` import), a Svelte library below node_modules keeps Svelte's own default, and the library's own
// components are runes wherever the package is installed, `TabPaneList.svelte` (which has no rune in it) among them.
const plain = "<script>\n  let count = 0;\n</script>\n<native-pressable onpress={() => count++}><native-text>{count}</native-text></native-pressable>\n";
const legacyLibrary = '<script>\n  export let title = "";\n</script>\n<native-text>{title}</native-text>\n';
const modeOf = (filename, src) => {
  try {
    return imports(transformer.transform({ filename, src, options, plugins: [] }).ast).includes("svelte/internal/flags/legacy") ? "legacy" : "runes";
  } catch (error) {
    return `error: ${error.code ?? error.message}`;
  }
};
const modes = {
  app: modeOf(`${root}/src/Plain.svelte`, plain),
  library: modeOf(`${root}/node_modules/some-svelte-lib/Plain.svelte`, plain),
  legacyLibrary: modeOf(`${root}/node_modules/some-svelte-lib/Legacy.svelte`, legacyLibrary),
  legacyApp: modeOf(`${root}/src/Legacy.svelte`, legacyLibrary),
  own: modeOf(`${root}/node_modules/@example/svelte-native/src/TabPaneList.svelte`, require("node:fs").readFileSync(`${root}/node_modules/@example/svelte-native/src/TabPaneList.svelte`, "utf8")),
};
// The app's `async` option, through the path an app takes: `withSvelteNative(config, { async })` (`@example/svelte-native/metro`, built) sets the environment the Metro workers inherit, and the built
// transformer compiles with it. A component with no `await` imports Svelte's async flag with the option and does not without it, the library's own and a library's below node_modules included, and the
// transformer's cache key follows it. A Svelte module that awaits in a `$derived` compiles only with it.
const { withSvelteNative } = require("@example/svelte-native/metro");
const FLAG = "svelte/internal/flags/async";
const awaited = "let a = $state(1);\nconst later = $derived(await Promise.resolve(a));\nexport const read = () => later;\n";
const asyncMode = {};
for (const [name, value] of [["default", undefined], ["on", true], ["off", false]]) {
  delete process.env.SVELTE_NATIVE_ASYNC;
  withSvelteNative({ projectRoot: root, cacheVersion: "1", resolver: { sourceExts: ["js", "ts"] }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} }, { syncRoutes: false, async: value });
  const flagged = (filename, src) => imports(transformer.transform({ filename, src, options, plugins: [] }).ast).includes(FLAG);
  let awaitedModule;
  try {
    transformer.transform({ filename: `${root}/src/later.svelte.ts`, src: awaited, options, plugins: [] });
    awaitedModule = "compiles";
  } catch (error) {
    awaitedModule = `error: ${error.code ?? error.message}`;
  }
  asyncMode[name] = {
    env: process.env.SVELTE_NATIVE_ASYNC ?? null,
    app: flagged(`${root}/src/Plain.svelte`, plain),
    library: flagged(`${root}/node_modules/some-svelte-lib/Plain.svelte`, plain),
    own: flagged(`${root}/node_modules/@example/svelte-native/src/TabPaneList.svelte`, require("node:fs").readFileSync(`${root}/node_modules/@example/svelte-native/src/TabPaneList.svelte`, "utf8")),
    awaitedModule,
    cacheKey: transformer.getCacheKey({}),
  };
}
delete process.env.SVELTE_NATIVE_ASYNC;
const remote = transformer.sourceOf({ filename: `${root}/src/lib/api.remote.ts`, src: 'import { query } from "$app/server"; export const hello = query(async () => 1);', options });
console.log(JSON.stringify({ exports: Object.keys(transformer).sort(), svelteImports: imports(svelte.ast), svelteModule: imports(svelteModule.ast), remote, modes, asyncMode, cacheKey: transformer.getCacheKey({}), resolvedFrom: createRequire(`${root}/`).resolve("@example/svelte-native/transformer") }));
