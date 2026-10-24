import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";

const require = createRequire(import.meta.url);
const nativeSvelte = dirname(require.resolve("svelte/package.json"));

export function withSvelteNative(config: ConfigT): ConfigT {
  const resolveRequest = config.resolver.resolveRequest;
  const resolver: ConfigT["resolver"] = {
    ...config.resolver,
    sourceExts: [...new Set([...config.resolver.sourceExts, "svelte"])],
    resolveRequest: (context, moduleName, platform) => {
    if (moduleName.startsWith("$env/") && moduleName.includes("private") || moduleName === "$app/server" || moduleName === "@rasheed/ingest") {
      throw new Error(`Server-only import in native bundle: ${moduleName}`);
    }
    if (moduleName === "svelte" || moduleName.startsWith("svelte/")) {
      const nativeContext = { ...context, originModulePath: resolve(nativeSvelte, "native-entry.js"), unstable_conditionNames: ["browser", "require"] };
      return context.resolveRequest(nativeContext, moduleName, platform);
    }
    if (moduleName === "esm-env") {
      return { type: "sourceFile", filePath: require.resolve("./environment.ts") };
    }
    const result = resolveRequest ? resolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
    if (result.type === "sourceFile" && (/\.server\.[cm]?[jt]s$/.test(result.filePath) || result.filePath.includes("/src/lib/server/"))) {
      throw new Error(`Server-only file in native bundle: ${result.filePath}`);
    }
    return result;
    },
  };
  return { ...config, resolver, transformer: { ...config.transformer, babelTransformerPath: require.resolve("@rasheed/svelte-native/transformer") } };
}
