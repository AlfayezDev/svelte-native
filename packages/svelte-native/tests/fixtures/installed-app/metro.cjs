/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the point: this is how Metro and Expo load the library */
// Loaded by plain `node` from an app whose `node_modules` holds the packed library (tests/node-modules.test.ts): the way `metro.config.cjs` loads it.
const { readFileSync } = require("node:fs");
const { withSvelteNative } = require("@example/svelte-native/metro");

const root = process.cwd();
const found = (filePath) => ({ type: "sourceFile", filePath });
// The context Metro gives `resolveRequest`: the default resolver answers with the file it was asked about, so the answer shows what the library changed.
const context = (originModulePath) => ({ originModulePath, resolveRequest: (ctx, moduleName) => found(`${ctx.originModulePath}::${moduleName}`) });
// No variant: an app that names none gets the library's own (`app`), as the CLI and the Expo plugin do with no `APP_VARIANT`.
const config = withSvelteNative({ projectRoot: root, cacheVersion: "1", resolver: { sourceExts: ["js", "ts"] }, serializer: { getModulesRunBeforeMainModule: () => [] }, transformer: {} });
const resolveRequest = config.resolver.resolveRequest;
const throughStub = (suffix, originModulePath) => {
  const base = { ...context(originModulePath), resolveRequest: () => found(`/app/node_modules/${suffix}`) };
  return resolveRequest(base, "x", "android").filePath;
};

console.log(
  JSON.stringify({
    transformerPath: config.transformer.babelTransformerPath,
    lite: resolveRequest(context(`${root}/node_modules/expo/index.js`), "react-native", "android").filePath,
    environment: resolveRequest(context(`${root}/src/a.ts`), "esm-env", "android").filePath,
    rendererStub: throughStub("react-native/Libraries/ReactNative/RendererProxy.js", `${root}/src/a.ts`),
    initializeCore: throughStub("react-native/Libraries/Core/InitializeCore.js", `${root}/src/a.ts`),
    svelte: resolveRequest(context(`${root}/src/a.ts`), "svelte/internal/client", "android").filePath,
    routes: resolveRequest(context(`${root}/src/a.ts`), "@example/svelte-native/routes", "android").filePath,
    table: readFileSync(`${root}/.svelte-native/routes.app.ts`, "utf8"),
    entry: readFileSync(`${root}/.svelte-native/entry.ts`, "utf8"),
  }),
);
