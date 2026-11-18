/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro and Expo load the library */
// Loaded by plain `node` in an app that has neither `@sveltejs/kit` nor `vite` (tests/package/node-modules.test.ts): the Metro integration and the transformer load, resolve and
// compile without them, and what does need SvelteKit says so by name.
const { traverseFast } = require("@babel/types");
const { withSvelteNative } = require("@alfayez/svelte-native/metro");
const transformer = require(require.resolve("@alfayez/svelte-native/transformer"));

const root = process.cwd();
const found = (filePath) => ({ type: "sourceFile", filePath });
const context = (originModulePath) => ({ originModulePath, resolveRequest: (ctx, moduleName) => found(`${ctx.originModulePath}::${moduleName}`) });
// No variant: the app's own.
const config = withSvelteNative({ projectRoot: root, cacheVersion: "1", resolver: { sourceExts: ["js", "ts"] }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} });
const resolveRequest = config.resolver.resolveRequest;
const message = (action) => {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

const options = { dev: false, projectRoot: root, platform: "android", hot: false, inlineRequires: false, minify: false, type: "module", unstable_transformProfile: "default", publicPath: "/assets", customTransformOptions: {} };
const imports = (ast) => {
  const found = [];
  traverseFast(ast, (node) => {
    if (node.type === "ImportDeclaration") found.push(node.source.value);
    if (node.type === "CallExpression" && node.callee.name === "require" && node.arguments[0]?.type === "StringLiteral") found.push(node.arguments[0].value);
  });
  return found;
};
const compiled = transformer.transform({
  filename: `${root}/src/Page.svelte`,
  src: '<script lang="ts">import { View, Text } from "@alfayez/svelte-native"; let n: number = $state(1);</script>\n<View><Text>{n}</Text></View>\n',
  options,
  plugins: [],
});

console.log(
  JSON.stringify({
    routes: resolveRequest(context(`${root}/src/a.ts`), "@alfayez/svelte-native/routes", "android").filePath,
    ordinary: resolveRequest(context(`${root}/src/a.ts`), "react-native-screens", "android").filePath,
    vendored: resolveRequest(context(`${root}/src/a.ts`), "react-native-reanimated/src/updateProps", "android").filePath,
    kitFromRuntime: message(() => resolveRequest(context(`${root}/node_modules/@alfayez/svelte-native/src/remote/runtime.ts`), "@sveltejs/kit/src/runtime/client/remote-functions/command.svelte.js", "android")),
    kitInternal: message(() => resolveRequest(context(`${root}/node_modules/@alfayez/svelte-native/src/remote/shims/client.ts`), "@sveltejs/kit/internal", "android")),
    svelteImports: imports(compiled.ast),
    remoteModule: message(() => transformer.sourceOf({ filename: `${root}/src/lib/api.remote.ts`, src: 'import { query } from "$app/server"; export const hello = query(async () => 1);', options })),
    cacheKey: transformer.getCacheKey({}),
  }),
);
