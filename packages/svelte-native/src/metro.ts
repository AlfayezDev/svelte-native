import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
// `expo` re-exports Metro's config type: `@expo/metro` (where it comes from) is a dependency of `@expo/metro-config`, which is `expo`'s, and no one else's.
import type { MetroConfig as ConfigT } from "expo/metro-config";
import { syncRoutes, watchRoutes } from "./build.ts";
import { buildClassesSync, reportSkipped, reportUnsupported, watchClasses } from "./css/build.ts";
import { asyncEnvironment, runesEnvironment } from "./compile-options.ts";
import { kitResolution } from "./kit/modules.ts";
import { packageRoot, sourceFile } from "./package-root.ts";
import { checkPushConfig, pushIsOn } from "./push/config.ts";
import { remoteResolution } from "./remote/transform.ts";
import { assertCustomRenderer } from "./svelte-build.ts";
import { classesTableFile, labIncludedFor, routesTableFile, variantName } from "./variant.ts";

const require = createRequire(import.meta.url);
const nativeSvelte = dirname(require.resolve("svelte/package.json"));

export const LITE_ORIGINS = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:hermes-intl|expo|expo-modules-core|expo-file-system|react-native-reanimated|react-native-worklets|react-native-is-edge-to-edge|expo-secure-store|expo-image-picker|expo-localization|expo-crypto|expo-constants|expo-font|expo-asset|expo-splash-screen|expo-status-bar|expo-system-ui|expo-keep-awake|expo-application|react-native-nitro-modules|react-native-mmkv|react-native-quick-crypto|react-native-quick-base64|react-native-svg)[\\/]/;

/**
 * The names under which Node's `crypto` is imported. A library written for Node (`jose`, an AWS or a Stripe client, ...) imports one of them; on the device they resolve to
 * react-native-quick-crypto, which implements Node's API (`createHash`, `createHmac`, `randomBytes`, ciphers, key pairs, `subtle`, ...) over OpenSSL. `crypto` the global is the web's
 * (`polyfills.ts`), and is made of the same library.
 */
export const NODE_CRYPTO: ReadonlySet<string> = new Set(["crypto", "node:crypto"]);
export const QUICK_CRYPTO = "react-native-quick-crypto";

export const INITIALIZE_CORE = /react-native[\\/]Libraries[\\/]Core[\\/]InitializeCore\.js$/;

/**
 * React Native modules that reach the React renderer (118 KB, plus React and the public-instance/DOM classes), keyed by
 * file suffix. Their only Fabric-entry users are view-config registration and command helpers, which need none of it.
 * `AppRegistry` (with `AppRegistryImpl`, which imports `renderApplication`) is the library's own: a library that imports it from
 * `react-native` (expo-task-manager registers a headless task with it) gets the registry native code calls (`fabric/app-registry.ts`).
 */
export const RENDERER_STUBS: Record<string, string> = {
  "react-native/Libraries/ReactNative/RendererProxy.js": "./fabric/renderer-stub.ts",
  "react-native/Libraries/Renderer/shims/ReactFabric.js": "./fabric/react-fabric-stub.ts",
  "react-native/Libraries/Renderer/shims/createReactNativeComponentClass.js": "./fabric/component-class-stub.ts",
  "react-native/Libraries/ReactNative/AppRegistry.js": "./fabric/app-registry.ts",
  "react-native/Libraries/ReactNative/AppRegistryImpl.js": "./fabric/app-registry.ts",
};

export type SvelteNativeMetroOptions = {
  /**
   * Packages this app does not link (the same list the Expo plugin's `autolinkingExclude` gets). Metro resolves each of them, and
   * every subpath of it, to a stub module that throws `<package> is not in this app (APP_VARIANT=…)` when it is used, so a
   * `require` of one in the JavaScript (the native module smoke test's) puts a few lines in the bundle and not the package.
   */
  stubbedPackages?: readonly string[];
  /**
   * Source files (absolute paths, with or without the extension) this app does not carry, resolved to a stub the same way: the
   * smoke test's checks, which only the smoke app needs. A relative import of one is stubbed before it is resolved, any other import
   * (`#lib/…`, a package export) once it has resolved to the file.
   */
  stubbedFiles?: readonly string[];
  /**
   * Directories (absolute paths) this app does not carry: every import that resolves to a file inside one gets the directory's stub
   * (one per directory, whatever the file), so the module graph of an app without its development lab holds a line of stub where code
   * outside the lab still names a lab module, and not the module and everything it imports. The route table leaves the lab's routes
   * out at the source (`routeFiles`); this is the backstop for what is still imported.
   */
  stubbedDirectories?: readonly string[];
  /** The variant this Metro bundles (`APP_VARIANT`, `app` for none): named in the stubs' message, and the one whose route table `./routes` is. Default `variantName()`. */
  variant?: string;
  /**
   * Whether Metro writes the app's route table for `variant` (`.svelte-native/routes.<variant>.ts`) when the config loads, before its file map
   * is built, and in development (`NODE_ENV=development`, `expo start`) again whenever a file under `src/routes` changes. On when the project
   * has a `src/routes` directory. There is one table per variant and no table they share: `./routes`, imported by the generated entry, and
   * `@alfayez/svelte-native/routes` (the table's `variant`, `lab` and `tree`, which the app reads) resolve to the table of this Metro's variant,
   * so a sync for another variant never changes what this one serves, a running server's warm graph included. The entry is written
   * only when missing or when the environment names a `SVELTE_NATIVE_ROOT`; `svelte-native sync` is what rewrites it.
   */
  syncRoutes?: boolean;
  /**
   * Whether the transformer compiles the app's components in runes mode (`<svelte:options runes={false} />` in a file still opts that file out). Default `true`: legacy mode turns a top-level
   * variable that the markup mutates into reactive state even when it is a `const`, and a worklet that captures one crashes the screen on the device. `false` is for an app that is migrating
   * legacy components: the library then forces nothing and Svelte infers the mode of each file. A Svelte library below `node_modules` always keeps Svelte's own default (runes inferred per
   * file), so a legacy third-party component keeps working; the library's own components are always runes. The setting reaches Metro's workers through the environment
   * (`SVELTE_NATIVE_RUNES`, set when this config loads).
   */
  runes?: boolean;
  /**
   * Experimental. Whether Svelte's async mode is on: every Svelte file the transformer compiles (the app's, the library's own and a library's below `node_modules`) gets `experimental.async`,
   * which allows `await` in `$derived`, in the markup and at the top of a component, and is what `router.prepare` needs. Default `false`. Svelte's async mode is one switch for the whole app
   * (the first module that imports its flag turns it on for all), so the option is all or none, and a precompiled Svelte package built with `experimental.async` turns it on by itself.
   * With it on, `tick()` waits for the next frame or a timer instead of a microtask, and the components of different blocks (`{#if}`, `{#each}`, `{#key}`) that change in one update run
   * their `$effect.pre` and their teardown in another order. Like `runes` it reaches Metro's workers through the environment (`SVELTE_NATIVE_ASYNC`), and it is part of the transformer's cache key.
   */
  async?: boolean;
  /**
   * `class` on components: the app's CSS file (Tailwind 4: `@import "tailwindcss";` and the app's own classes), relative to the project, for example
   * `"src/global.css"`. Tailwind (`tailwindcss`, which the app installs) compiles it for the classes the files under `src/` use, and the result is
   * written as the class table (`.svelte-native/classes.<variant>.ts`, which `@alfayez/svelte-native/classes-table` resolves to) when the config loads
   * and, in development (`NODE_ENV=development`, `expo start`), again whenever a source or the CSS changes. Without it the table is empty and `class`
   * has no effect. The app does not import the CSS file (docs: styling#classes).
   */
  css?: string;
};

/** Watchers the Metro integration started (the route table's and the class table's, one each per config in development); the tests close them. */
const watchers = new Set<{ close(): void }>();
export function closeWatchers(): void {
  for (const watcher of watchers) watcher.close();
  watchers.clear();
}

/** The code every stub shares: a module that throws `<name> is not in this app (APP_VARIANT=…)` on anything but `__esModule`, a call or a construction. */
export const stubCoreSource = `// Generated by @alfayez/svelte-native/metro: what stands in for a package this app does not link.
"use strict";
module.exports = (name, variant) => {
  const fail = () => { throw new Error(name + " is not in this app (APP_VARIANT=" + variant + ")"); };
  // A bound function: callable and constructible, and without the non-configurable prototype property that ownKeys below would have to report.
  return new Proxy(function () {}.bind(null), {
    get: (_target, key) => (key === "__esModule" ? false : typeof key === "symbol" ? undefined : fail()),
    apply: fail,
    construct: fail,
    has: () => false,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => undefined,
  });
};
`;

/** The stub of one package: a line that asks the shared core for it, so thirty-odd stubs cost the bundle a few bytes each. */
export function stubSource(name: string, variant: string): string {
  return `// Generated by @alfayez/svelte-native/metro: ${name} is not linked in this app.
module.exports = require("./_core.js")(${JSON.stringify(name)}, ${JSON.stringify(variant)});
`;
}

/** Whether [moduleName] is [name] or a path inside it. */
export const isInPackage = (moduleName: string, name: string): boolean => moduleName === name || moduleName.startsWith(`${name}/`);

/**
 * Whether Metro has to start from empty caches because the installed library is not the one the project's last Metro used. Updating the library
 * (a new tag of the git dependency) moves it to another directory of `node_modules/.pnpm`, and Metro's file map cache kept resolving
 * `@alfayez/svelte-native` to the old one after a restart (10 Nov 2026: a project updated to 0.4.0-rc.2 ran 0.4.0-rc.1's entry, which has no
 * `colorScheme`, until its caches were reset). `.svelte-native/metro-library` holds the library's real directory; a project without it resets once.
 * Decided once per process: Expo loads the config more than once, and only the first load sees the old record.
 */
let resetForLibrary: boolean | undefined;
export function libraryChanged(projectRoot: string, library: string = realpathSync(packageRoot)): boolean {
  const record = join(projectRoot, ".svelte-native", "metro-library");
  let previous: string | undefined;
  try {
    previous = readFileSync(record, "utf8").trim();
  } catch {
    previous = undefined;
  }
  if (previous === library) return false;
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, `${library}\n`);
  return true;
}

/** A path with its links resolved, or the path itself when it does not exist. */
const realOr = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** The names an app's config gives the library's config plugin. */
const PLUGIN_NAMES = new Set(["@alfayez/svelte-native", "@alfayez/svelte-native/app.plugin", "@alfayez/svelte-native/expo"]);

/**
 * The platforms `capabilities.push` names in the app's config, read as Expo reads it (`getConfig` from `expo/config`, which runs `app.config.*` and does not apply plugins). `undefined`
 * when the config cannot be read or its push settings are malformed (the prebuild refuses those): then the client is bundled, and the native module's `enabled` decides on the device.
 */
export function pushPlatforms(projectRoot: string): { android: boolean; ios: boolean } | undefined {
  let plugins: unknown;
  try {
    const { getConfig } = require("expo/config") as typeof import("expo/config");
    plugins = getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp.plugins;
  } catch {
    return undefined;
  }
  const entry = (Array.isArray(plugins) ? plugins : []).find((plugin: unknown) => PLUGIN_NAMES.has(String(Array.isArray(plugin) ? plugin[0] : plugin)));
  const options: unknown = Array.isArray(entry) ? entry[1] : undefined;
  const push: unknown = typeof options === "object" && options !== null ? (options as { capabilities?: { push?: unknown } }).capabilities?.push : undefined;
  if (!pushIsOn(push)) return { android: false, ios: false };
  const checked = checkPushConfig(push);
  return "config" in checked ? { android: checked.config.android !== undefined, ios: checked.config.ios !== undefined } : undefined;
}

export function withSvelteNative(config: ConfigT, options: SvelteNativeMetroOptions = {}): ConfigT {
  assertCustomRenderer("withSvelteNative (@alfayez/svelte-native/metro)");
  Object.assign(process.env, runesEnvironment(options.runes), asyncEnvironment(options.async));
  const resolveRequest = config.resolver.resolveRequest;
  const stubbed = options.stubbedPackages ?? [];
  const variant = options.variant ?? variantName();
  // A directory per variant (the stubs name it in their message): the QA app's Metro and a product bundle share no file, so a bundle never rewrites what a running Metro serves.
  const stubDirectory = join(config.projectRoot, ".svelte-native", "stubs", variant.replace(/[^A-Za-z0-9_-]/g, "_"));
  // One stub file per package, written now: Metro's file map is built from what is on disk when it starts, and a file it did not see cannot be read.
  // A file that is already what it should be is left alone (its modification time is what a running Metro watches).
  const write = (file: string, content: string) => {
    let current: string | undefined;
    try { current = readFileSync(file, "utf8"); } catch { current = undefined; }
    if (current !== content) writeFileSync(file, content);
  };
  const stubs = new Map<string, string>();
  if (stubbed.length > 0) {
    mkdirSync(stubDirectory, { recursive: true });
    write(join(stubDirectory, "_core.js"), stubCoreSource);
  }
  for (const name of stubbed) {
    const file = join(stubDirectory, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    mkdirSync(stubDirectory, { recursive: true });
    write(file, stubSource(name, variant));
    stubs.set(name, file);
  }
  const withoutExtension = (path: string) => path.replace(/\.[cm]?[jt]sx?$/, "");
  const nameOf = (path: string) => withoutExtension(path).slice(config.projectRoot.length + 1);
  const writeStub = (name: string) => {
    const file = join(stubDirectory, `${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.js`);
    mkdirSync(stubDirectory, { recursive: true });
    write(join(stubDirectory, "_core.js"), stubCoreSource);
    write(file, stubSource(name, variant));
    return file;
  };
  const files = new Map<string, string>();
  for (const path of options.stubbedFiles ?? []) files.set(withoutExtension(path), writeStub(nameOf(path)));
  const directories = new Map<string, string>();
  for (const path of options.stubbedDirectories ?? []) {
    const directory = path.replace(/[\\/]+$/, "");
    directories.set(directory + sep, writeStub(`${nameOf(directory)}/`));
  }
  // The route table is the variant's own file: this config writes it now and resolves `./routes` to it, so no file is shared with another variant.
  const lab = labIncludedFor(variant);
  const entryFile = join(config.projectRoot, ".svelte-native", "entry.ts");
  const routesTable = join(config.projectRoot, ".svelte-native", routesTableFile(variant));
  if (options.syncRoutes ?? existsSync(join(config.projectRoot, "src/routes"))) {
    const syncing = { variant, lab, entry: "keep" } as const;
    syncRoutes(config.projectRoot, syncing);
    if (process.env.NODE_ENV === "development") watchers.add(watchRoutes(config.projectRoot, syncing));
  }
  // The class table is the variant's own file too. With the `css` option it is built now, before Metro's file map is, and in development built again
  // when a source or the CSS changes; without it `@alfayez/svelte-native/classes-table` is the library's empty table.
  const classesTable = options.css === undefined ? sourceFile("css/empty-table.ts") : join(config.projectRoot, ".svelte-native", classesTableFile(variant));
  if (options.css !== undefined) {
    const building = { root: config.projectRoot, css: options.css, variant };
    const built = buildClassesSync(building);
    reportSkipped(built.skipped);
    reportUnsupported(built.unsupported);
    if (process.env.NODE_ENV === "development") watchers.add(watchClasses(building, built.stylesheets));
  }
  // A platform whose push is off in the app's config gets the push client's stand-in (`push/absent.ts`): `push` answers as in a build without push (PUSH.md), and the client,
  // which every app would otherwise bundle (`app.ts` imports `push/load.ts`, which requires it), is not in the bundle. A config that cannot be read keeps the client.
  const pushClient = realpathSync(sourceFile("push/push.svelte.ts"));
  const pushOn = pushPlatforms(config.projectRoot);
  const pushAbsent = sourceFile("push/absent.ts");
  const pushOff = (platform: string | null): boolean => pushOn !== undefined && (platform === "ios" ? !pushOn.ios : platform === "android" ? !pushOn.android : !pushOn.android && !pushOn.ios);
  const stubFor = (moduleName: string, origin: string): string | null => {
    const name = stubbed.find((candidate) => isInPackage(moduleName, candidate));
    if (name !== undefined) return stubs.get(name) ?? null;
    if (files.size > 0 && (moduleName.startsWith("./") || moduleName.startsWith("../"))) return files.get(withoutExtension(resolve(dirname(origin), moduleName))) ?? null;
    return null;
  };
  /** The stub of a resolved file: its own, or its directory's. */
  const stubForFile = (filePath: string): string | null => {
    if (files.size > 0) {
      const own = files.get(withoutExtension(filePath));
      if (own !== undefined) return own;
    }
    if (directories.size === 0) return null;
    for (const [directory, stub] of directories) if (filePath.startsWith(directory)) return stub;
    return null;
  };
  const resolver: ConfigT["resolver"] = {
    ...config.resolver,
    sourceExts: [...new Set([...config.resolver.sourceExts, "svelte"])],
    resolveRequest: (given, requested, platform) => {
    // `crypto` and `node:crypto` are react-native-quick-crypto, resolved as the app's own import of it would be (from the app's directory: a library written for Node does not depend on it, the app does)
    // and by the rest of this resolver, so an app that stubs the package gets its stub for them too.
    const aliased = NODE_CRYPTO.has(requested);
    const moduleName = aliased ? QUICK_CRYPTO : requested;
    const context = aliased ? { ...given, originModulePath: join(config.projectRoot, "package.json") } : given;
    if (moduleName === "@alfayez/svelte-native/routes" || (moduleName === "./routes" && context.originModulePath === entryFile)) return { type: "sourceFile", filePath: routesTable };
    if (moduleName === "@alfayez/svelte-native/classes-table") return { type: "sourceFile", filePath: classesTable };
    const stub = stubFor(moduleName, context.originModulePath);
    if (stub !== null) return { type: "sourceFile", filePath: stub };
    // SvelteKit's remote function client files (`@sveltejs/kit/src/runtime/client/remote-functions`), which the `.remote` stubs run on, and what they import from a browser app.
    const remote = remoteResolution(moduleName, context.originModulePath);
    if (remote !== undefined) return { type: "sourceFile", filePath: remote };
    // A `*.remote.ts` module is replaced by client stubs before its imports are read (the transformer), so `$app/server` is only reached by code that is not one.
    if (moduleName.startsWith("$env/") && moduleName.includes("private") || moduleName === "$app/server" || moduleName === "$app/env/private") {
      throw new Error(`Server-only import in native bundle: ${moduleName}`);
    }
    // SvelteKit's `$app/*` modules on the device (`kit/modules.ts`).
    const kit = kitResolution(moduleName);
    if (kit !== undefined) return { type: "sourceFile", filePath: kit };
    // Svelte's reactive window values read the DOM's `window`; on the device they are `Dimensions`' (`reactivity-window.ts`).
    if (moduleName === "svelte/reactivity/window") return { type: "sourceFile", filePath: sourceFile("reactivity-window.ts") };
    if (moduleName === "svelte" || moduleName.startsWith("svelte/")) {
      const nativeContext = { ...context, originModulePath: resolve(nativeSvelte, "native-entry.js"), unstable_conditionNames: ["browser", "require"] };
      return context.resolveRequest(nativeContext, moduleName, platform);
    }
    if (moduleName === "react-native" && LITE_ORIGINS.test(context.originModulePath)) {
      return { type: "sourceFile", filePath: sourceFile("fabric/react-native-lite.ts") };
    }
    if (moduleName === "esm-env") {
      return { type: "sourceFile", filePath: sourceFile("environment.ts") };
    }
    const result = resolveRequest ? resolveRequest(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
    if (result.type === "sourceFile") {
      const stubbedFile = stubForFile(result.filePath);
      if (stubbedFile !== null) return { type: "sourceFile", filePath: stubbedFile };
      if (result.filePath.endsWith("push.svelte.ts") && pushOff(platform) && realOr(result.filePath) === pushClient) return { type: "sourceFile", filePath: pushAbsent };
      const stub = Object.entries(RENDERER_STUBS).find(([suffix]) => result.filePath.endsWith(suffix));
      if (stub) return { type: "sourceFile", filePath: sourceFile(stub[1]) };
      // `init.ts` is the Fabric entry's InitializeCore. `expo/src/winter` (run before main) imports InitializeCore for the
      // XHR globals it patches, so it gets `init.ts`, which then runs first; React Native's own would also put its
      // AppRegistry on `RN$AppRegistry` over the Fabric host's.
      if (INITIALIZE_CORE.test(result.filePath)) return { type: "sourceFile", filePath: sourceFile("init.ts") };
    }
    if (result.type === "sourceFile" && (/\.server\.[cm]?[jt]s$/.test(result.filePath) || result.filePath.includes("/src/lib/server/"))) {
      throw new Error(`Server-only file in native bundle: ${result.filePath}`);
    }
    return result;
    },
  };
  // The Fabric entry boots through our own init (the first import of `@alfayez/svelte-native/app`, which the entry imports, so it is in the module graph and
  // runs before the app) instead of InitializeCore, which is dropped from the pre-main list; every other pre-main module is kept.
  // Expo's serializer holds on to this very `serializer` object, so the option is replaced in place rather than copied.
  const serializer = config.serializer as { -readonly [K in keyof ConfigT["serializer"]]: ConfigT["serializer"][K] };
  const runBeforeMain = serializer.getModulesRunBeforeMainModule;
  serializer.getModulesRunBeforeMainModule = (entryFile: string) => {
    const modules = runBeforeMain(entryFile);
    return modules.filter((module) => !/react-native[\\/]Libraries[\\/]Core[\\/]InitializeCore(\.js)?$/.test(module));
  };
  // Keep Metro's transform cache apart per mode: the same file resolves differently.
  resetForLibrary ??= libraryChanged(config.projectRoot);
  if (resetForLibrary && !config.resetCache) console.log("svelte-native: the installed library changed since Metro last ran here; starting Metro with empty caches");
  const configured: ConfigT = { ...config, resetCache: config.resetCache || resetForLibrary, cacheVersion: `${config.cacheVersion ?? ""}+svelte-native-2${stubbed.length + files.size + directories.size > 0 ? `+stubs-${variant}` : ""}`, resolver, serializer, transformer: { ...config.transformer, babelTransformerPath: require.resolve("@alfayez/svelte-native/transformer") } };
  return configured;
}
