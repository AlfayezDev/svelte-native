import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { ConfigT } from "@expo/metro/metro-config";

const require = createRequire(import.meta.url);
const nativeSvelte = dirname(require.resolve("svelte/package.json"));

const LITE_ORIGINS = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:hermes-intl|expo|expo-modules-core|expo-file-system|react-native-reanimated|react-native-worklets|react-native-is-edge-to-edge|expo-secure-store|expo-image-picker|expo-localization|expo-crypto|expo-constants|expo-font|expo-asset|expo-splash-screen|expo-status-bar|expo-system-ui|expo-keep-awake|expo-application|react-native-svg)[\\/]/;

const INITIALIZE_CORE = /react-native[\\/]Libraries[\\/]Core[\\/]InitializeCore\.js$/;

/**
 * React Native modules that reach the React renderer (118 KB, plus React and the public-instance/DOM classes), keyed by
 * file suffix. Their only Fabric-entry users are view-config registration and command helpers, which need none of it.
 */
const RENDERER_STUBS: Record<string, string> = {
  "react-native/Libraries/ReactNative/RendererProxy.js": "./fabric/renderer-stub.ts",
  "react-native/Libraries/Renderer/shims/ReactFabric.js": "./fabric/react-fabric-stub.ts",
  "react-native/Libraries/Renderer/shims/createReactNativeComponentClass.js": "./fabric/component-class-stub.ts",
};

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
    if (moduleName === "react-native" && LITE_ORIGINS.test(context.originModulePath)) {
      return { type: "sourceFile", filePath: require.resolve("./fabric/react-native-lite.ts") };
    }
    if (moduleName === "esm-env") {
      return { type: "sourceFile", filePath: require.resolve("./environment.ts") };
    }
    const result = resolveRequest ? resolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
    if (result.type === "sourceFile") {
      const stub = Object.entries(RENDERER_STUBS).find(([suffix]) => result.filePath.endsWith(suffix));
      if (stub) return { type: "sourceFile", filePath: require.resolve(stub[1]) };
      // `init.ts` is the Fabric entry's InitializeCore. `expo/src/winter` (run before main) imports InitializeCore for the
      // XHR globals it patches, so it gets `init.ts`, which then runs first; React Native's own would also put its
      // AppRegistry on `RN$AppRegistry` over the Fabric host's.
      if (INITIALIZE_CORE.test(result.filePath)) return { type: "sourceFile", filePath: require.resolve("./init.ts") };
    }
    if (result.type === "sourceFile" && (/\.server\.[cm]?[jt]s$/.test(result.filePath) || result.filePath.includes("/src/lib/server/"))) {
      throw new Error(`Server-only file in native bundle: ${result.filePath}`);
    }
    return result;
    },
  };
  // The Fabric entry boots through our own init (its first import, so it is in the module graph and runs before
  // the app) instead of InitializeCore, which is dropped from the pre-main list; every other pre-main module is kept.
  // Expo's serializer holds on to this very `serializer` object, so the option is replaced in place rather than copied.
  const serializer = config.serializer as { -readonly [K in keyof ConfigT["serializer"]]: ConfigT["serializer"][K] };
  const runBeforeMain = serializer.getModulesRunBeforeMainModule;
  serializer.getModulesRunBeforeMainModule = (entryFile: string) => {
    const modules = runBeforeMain(entryFile);
    return modules.filter((module) => !/react-native[\\/]Libraries[\\/]Core[\\/]InitializeCore(\.js)?$/.test(module));
  };
  // Keep Metro's transform cache apart per mode: the same file resolves differently.
  return { ...config, cacheVersion: `${config.cacheVersion ?? ""}+svelte-native-2`, resolver, serializer, transformer: { ...config.transformer, babelTransformerPath: require.resolve("@rasheed/svelte-native/transformer") } };
}
