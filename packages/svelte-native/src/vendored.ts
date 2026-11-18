/**
 * The third-party native packages this library carries itself (VENDORING.md): their published source is copied into `vendor/<name>/` (`scripts/vendor.ts`), so an app's
 * package.json lists `@alfayez/svelte-native` and nothing beside it. This file is what the Node side knows of them: the list, where each is on disk, how React Native's
 * autolinking is told about it (`vendoredDependency`, `linkVendored`: the entries its config command would print for the installed package, with the paths of the copy),
 * the names Metro resolves to the copy, and the refusal of an app that still installs an original (`declaredVendored`, `collisionMessage`).
 *
 * The JavaScript the library itself runs imports a copy through the package's `imports` map (`#vendor/<name>`), which Metro, Vite, Bun and TypeScript all read; nothing here is
 * needed for that.
 */
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { optionalLibraries } from "./optional-libraries.ts";
import { packageRoot } from "./package-root.ts";

export type LinkPlatform = "android" | "ios";

/**
 * What makes a vendored package optional: it is linked, bundled and configured only for an app that turns it on (`libraries` of the plugin options, `libraries.ts`). A package without
 * the field is the pilot's kind, in every app.
 */
export type OptionalLibrary = {
  /**
   * How the library links. `react-native`: React Native's autolinking, through the entry this file adds to the config command's output (`android` and `ios` below). `expo`: an Expo
   * module, found by Expo's autolinker from its `expo-module.config.json`, which is given the copy's directory as a search path (`libraries.ts`, `expoModuleSearchPaths`).
   */
  kind: "react-native" | "expo";
  /** The package's own Expo config plugin, relative to the package: it runs with the options the app gives the library, as if the app had listed it in `plugins`. */
  plugin?: string;
  /** Libraries this one cannot work without (react-native-pdf reads its files through react-native-blob-util): turning it on turns them on too. */
  requires?: readonly string[];
};

export type VendoredPackage = {
  /** The package's name on npm, and the name of its directory under `vendor/`. */
  name: string;
  /** The exact version that was copied (`vendor/<name>/package.json` says the same, and a test keeps them in step). */
  version: string;
  /**
   * What React Native's Android autolinking finds in the package: the import and the construction of its `ReactPackage`, as `react-native-config` prints them. Read from the
   * Java or Kotlin class by autolinking, so they are written down here and a test reads the sources of the copy to keep them true. The rest is for the packages that have it
   * (the pilot's two have none): the component descriptors a view library's codegen lists, the codegen CMake file when it is not under `android/build/`, and a pure C++ TurboModule's
   * CMake module (paths relative to the package).
   */
  android?: {
    packageImportPath: string;
    packageInstance: string;
    /** The codegen library's name when the package's own `react-native.config.js` says it and it is not what `codegenConfig.name` or the `react { }` block of `android/build.gradle` have (react-native-animateable-text: `JBAnimatedText`, not the gradle's `JBAnimatedTextCodegen`). It wins over both. */
    libraryName?: string;
    componentDescriptors?: readonly string[];
    cmakeListsPath?: string;
    cxxModule?: { cmakeListsModuleName: string; cmakeListsPath: string; headerName: string };
  };
  /** The podspec at the package's root (its file name), which autolinking gives to CocoaPods. */
  ios?: { podspec: string };
  /** Present for a package an app turns on; absent for one every app links. */
  optional?: OptionalLibrary;
};

/**
 * The vendored packages. Adding one: run `scripts/vendor.ts`, add its entry here, take it from the library's `peerDependencies` and from the places that install it (VENDORING.md,
 * "Adding a package").
 */
export const vendoredPackages: readonly VendoredPackage[] = [
  // The optional view libraries (`optional-libraries.ts`).
  ...optionalLibraries,
  {
    name: "react-native-nitro-modules",
    version: "0.35.10",
    android: { packageImportPath: "import com.margelo.nitro.NitroModulesPackage;", packageInstance: "new NitroModulesPackage()" },
    ios: { podspec: "NitroModules.podspec" },
  },
  {
    name: "react-native-mmkv",
    version: "4.3.1",
    android: { packageImportPath: "import com.margelo.nitro.mmkv.NitroMmkvPackage;", packageInstance: "new NitroMmkvPackage()" },
    ios: { podspec: "NitroMmkv.podspec" },
  },
  {
    // The base64 module quick-crypto and its Buffer ask for (`libraryName` QuickBase64 is the `react { }` block of its build.gradle).
    name: "react-native-quick-base64",
    version: "2.2.2",
    android: { packageImportPath: "import com.reactnativequickbase64.QuickBase64Package;", packageInstance: "new QuickBase64Package()" },
    ios: { podspec: "react-native-quick-base64.podspec" },
  },
  {
    // `crypto` and `crypto.subtle`: a Nitro module over OpenSSL (and libsodium, when the plugin's `sodiumEnabled` is on). It links the vendored Nitro runtime by its project name and pod.
    name: "react-native-quick-crypto",
    version: "1.1.3",
    android: { packageImportPath: "import com.margelo.nitro.quickcrypto.QuickCryptoPackage;", packageInstance: "new QuickCryptoPackage()" },
    ios: { podspec: "QuickCrypto.podspec" },
  },
  {
    // The `Intl` constructors Hermes lacks: a pure C++ TurboModule (no view, no module class: the `ReactPackage` is empty), so Android adds its CMake module to the app's build.
    name: "hermes-intl",
    version: "0.1.2",
    android: { packageImportPath: "import dev.hermesintl.HermesIntlPackage;", packageInstance: "new HermesIntlPackage()", cxxModule: { cmakeListsModuleName: "hermesintl", cmakeListsPath: "android/CMakeLists.txt", headerName: "NativeHermesIntl" } },
    ios: { podspec: "HermesIntl.podspec" },
  },
  {
    name: "react-native-gesture-handler",
    version: "2.32.0",
    // The two components of its codegen (`RNGestureHandlerButton`, `RNGestureHandlerRootView`); `libraryName` is `codegenConfig.name`.
    android: { packageImportPath: "import com.swmansion.gesturehandler.RNGestureHandlerPackage;", packageInstance: "new RNGestureHandlerPackage()", componentDescriptors: ["RNGestureHandlerButtonComponentDescriptor", "RNGestureHandlerRootViewComponentDescriptor"] },
    ios: { podspec: "RNGestureHandler.podspec" },
  },
  {
    name: "react-native-worklets",
    version: "0.10.1",
    android: { packageImportPath: "import com.swmansion.worklets.WorkletsPackage;", packageInstance: "new WorkletsPackage()" },
    ios: { podspec: "RNWorklets.podspec" },
  },
  {
    name: "react-native-reanimated",
    version: "4.5.1",
    android: { packageImportPath: "import com.swmansion.reanimated.ReanimatedPackage;", packageInstance: "new ReanimatedPackage()" },
    ios: { podspec: "RNReanimated.podspec" },
  },
  {
    name: "react-native-svg",
    version: "15.15.4",
    // The 29 components of its `react-native.config.js`, and its codegen CMake file, which is in the sources and not below `android/build/` (a test reads both from the copy).
    android: {
      packageImportPath: "import com.horcrux.svg.SvgPackage;",
      packageInstance: "new SvgPackage()",
      componentDescriptors: [
        "RNSVGCircleComponentDescriptor", "RNSVGClipPathComponentDescriptor", "RNSVGDefsComponentDescriptor", "RNSVGFeBlendComponentDescriptor", "RNSVGFeColorMatrixComponentDescriptor",
        "RNSVGFeCompositeComponentDescriptor", "RNSVGFeFloodComponentDescriptor", "RNSVGFeGaussianBlurComponentDescriptor", "RNSVGFeMergeComponentDescriptor", "RNSVGFeOffsetComponentDescriptor",
        "RNSVGFilterComponentDescriptor", "RNSVGEllipseComponentDescriptor", "RNSVGForeignObjectComponentDescriptor", "RNSVGGroupComponentDescriptor", "RNSVGImageComponentDescriptor",
        "RNSVGLinearGradientComponentDescriptor", "RNSVGLineComponentDescriptor", "RNSVGMarkerComponentDescriptor", "RNSVGMaskComponentDescriptor", "RNSVGPathComponentDescriptor",
        "RNSVGPatternComponentDescriptor", "RNSVGRadialGradientComponentDescriptor", "RNSVGRectComponentDescriptor", "RNSVGSvgViewAndroidComponentDescriptor", "RNSVGSymbolComponentDescriptor",
        "RNSVGTextComponentDescriptor", "RNSVGTextPathComponentDescriptor", "RNSVGTSpanComponentDescriptor", "RNSVGUseComponentDescriptor",
      ],
      cmakeListsPath: "android/src/main/jni/CMakeLists.txt",
    },
    ios: { podspec: "RNSVG.podspec" },
  },
];

/** The names of the vendored packages. */
export const vendoredNames: readonly string[] = vendoredPackages.map((vendored) => vendored.name);

/** The packages an app turns on (`libraries` of the plugin options), and the ones every app links. */
export const optionalPackages: readonly VendoredPackage[] = vendoredPackages.filter((vendored) => vendored.optional !== undefined);
export const alwaysLinkedPackages: readonly VendoredPackage[] = vendoredPackages.filter((vendored) => vendored.optional === undefined);

/** The registry entry of a vendored package, by its name. */
export const vendoredPackage = (name: string): VendoredPackage | undefined => vendoredPackages.find((vendored) => vendored.name === name);

/** `vendor/` of the package. `root` is the package's directory (this one, unless a test gives another). */
export const vendorDirectory = (root: string = packageRoot): string => join(root, "vendor");

/** The directory of a vendored package. */
export const vendoredRoot = (name: string, root: string = packageRoot): string => join(vendorDirectory(root), name);

/** The vendored package an import names, and the rest of the path (`react-native-mmkv/lib/index` is `react-native-mmkv` and `lib/index`; the bare name has an empty one). */
export function vendoredImport(request: string): { vendored: VendoredPackage; subpath: string } | undefined {
  for (const vendored of vendoredPackages) {
    if (request === vendored.name) return { vendored, subpath: "" };
    if (request.startsWith(`${vendored.name}/`)) return { vendored, subpath: request.slice(vendored.name.length + 1) };
  }
  return undefined;
}

/** A path with its links resolved, or the path itself when it does not exist. */
const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** The two ways `vendor/` is named: as given and with its links resolved (Metro asks for `react-native` imports by the thousand, so the resolution is made once per package root). */
const spellings = new Map<string, readonly string[]>();
function vendorSpellings(root: string): readonly string[] {
  let found = spellings.get(root);
  if (found === undefined) {
    found = [...new Set([vendorDirectory(root), real(vendorDirectory(root))])];
    spellings.set(root, found);
  }
  return found;
}

/**
 * Where a file is, relative to `node_modules`, as if it were an installed package: a file of `vendor/react-native-mmkv/` is `react-native-mmkv/…`. `undefined` for a file
 * that is not in a vendored package. Metro gives the real path of a file, and a project may name it through the link into the package, so both are tried.
 */
export function vendoredFileAs(path: string, root: string = packageRoot): string | undefined {
  for (const directory of vendorSpellings(root)) {
    const inside = relative(directory, path);
    if (inside !== "" && !inside.startsWith("..") && !isAbsolute(inside)) {
      const name = vendoredPackages.find((vendored) => inside === vendored.name || inside.startsWith(`${vendored.name}${sep}`))?.name;
      if (name !== undefined) return inside.split(sep).join("/");
    }
  }
  return undefined;
}

type Json = Record<string, unknown>;
const readJson = (file: string): Json | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : undefined;
  } catch {
    return undefined;
  }
};

/** The `libraryName` of the `react { }` block of a package's `android/build.gradle`, which autolinking reports for a package whose package.json has no `codegenConfig`. */
function gradleLibraryName(buildGradle: string): string | undefined {
  try {
    return /^\s*libraryName\s*=\s*"([^"]+)"/m.exec(readFileSync(buildGradle, "utf8"))?.[1];
  } catch {
    return undefined;
  }
}

/** An entry of React Native's autolinking config for one platform: the fields the command prints for a package, in the order it prints them. */
export type AutolinkingDependency = { root: string; name: string; platforms: Record<string, unknown> };

/**
 * What `react-native-config` (Expo's, SDK 57) prints for the package if it were installed, with the paths of the vendored copy: `root` and `sourceDir` (Android) or `podspecPath` (iOS)
 * are in `vendor/<name>/`, the rest is what the package's files say (its version; `libraryName` is `codegenConfig.name`, else the `libraryName` of the `react { }` block in
 * `android/build.gradle`; the generated codegen CMake file is below `android/build/` unless the registry says where it is) or what the registry records. `undefined` when the
 * package has nothing for the platform.
 */
export function vendoredDependency(vendored: VendoredPackage, platform: LinkPlatform, root: string = packageRoot): AutolinkingDependency | undefined {
  const directory = vendoredRoot(vendored.name, root);
  const manifest = readJson(join(directory, "package.json")) ?? {};
  if (platform === "android") {
    const android = vendored.android;
    if (!android) return undefined;
    const sourceDir = join(directory, "android");
    const codegen = manifest.codegenConfig;
    const codegenName = typeof codegen === "object" && codegen !== null && typeof (codegen as Json).name === "string" ? ((codegen as Json).name as string) : undefined;
    const libraryName = android.libraryName ?? codegenName ?? gradleLibraryName(join(sourceDir, "build.gradle"));
    const cxx = android.cxxModule;
    return {
      root: directory,
      name: vendored.name,
      platforms: {
        android: {
          sourceDir,
          packageImportPath: android.packageImportPath,
          packageInstance: android.packageInstance,
          buildTypes: [],
          ...(libraryName === undefined ? {} : { libraryName }),
          componentDescriptors: [...(android.componentDescriptors ?? [])],
          cmakeListsPath: join(directory, android.cmakeListsPath ?? "android/build/generated/source/codegen/jni/CMakeLists.txt"),
          cxxModuleCMakeListsModuleName: cxx?.cmakeListsModuleName ?? null,
          cxxModuleCMakeListsPath: cxx ? join(directory, cxx.cmakeListsPath) : null,
          cxxModuleHeaderName: cxx?.headerName ?? null,
          isPureCxxDependency: false,
        },
      },
    };
  }
  if (!vendored.ios) return undefined;
  return {
    root: directory,
    name: vendored.name,
    platforms: { ios: { podspecPath: join(directory, vendored.ios.podspec), version: typeof manifest.version === "string" ? manifest.version : vendored.version, configurations: [], scriptPhases: [] } },
  };
}

/** The part of the config the command prints that linking reads: the app's directory, and the dependencies by name. */
type LinkableConfig = { root?: string; dependencies?: Record<string, { root?: string; [key: string]: unknown }>; [key: string]: unknown };

/** The vendored packages an app's package.json lists as its own dependencies, which would link them a second time. */
export function declaredVendored(appRoot: string): string[] {
  const manifest = readJson(join(appRoot, "package.json"));
  if (!manifest) return [];
  const declared = new Set<string>();
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const entries = manifest[group];
    if (typeof entries === "object" && entries !== null) for (const name of Object.keys(entries)) declared.add(name);
  }
  return vendoredNames.filter((name) => declared.has(name));
}

/** The refusal for an app that has an original of a vendored package: said by the config plugin, `svelte-native doctor` and the autolinking command alike. */
export function collisionMessage(names: readonly string[], library = "@alfayez/svelte-native"): string {
  const list = names.map((name) => `${name} ${vendoredPackage(name)?.version ?? ""}`.trim());
  const them = names.length === 1 ? "it" : "them";
  const optional = names.filter((name) => vendoredPackage(name)?.optional !== undefined);
  // An optional library is the app's to turn on: its options go to the plugin, and the rest of the message is the pilot's.
  const turnOn = optional.length === 0 ? "" : ` ${optional.length === 1 ? "It is" : "They are"} optional: turn ${optional.length === 1 ? "it" : "them"} on with \`libraries: { ${optional.map((name) => `"${name}": true`).join(", ")} }\` in the ${library} plugin's options (its own plugin options go there instead of in \`plugins\`).`;
  return `${library} includes ${list.join(" and ")}; remove ${them} from the app's dependencies (package.json), reinstall, and prebuild again. The library links its own copy; a second one would be linked beside it. A library of the app that asks for ${them} as a peer dependency is served by the copy (Metro resolves the name to it; the Gradle project and the pod keep the name), so nothing needs to take ${them === "it" ? "its" : "their"} place.${turnOn}`;
}

/** Raised by `linkVendored` for an app that declares a vendored package itself. */
export class VendoredCollision extends Error {
  readonly names: readonly string[];
  constructor(names: readonly string[]) {
    super(collisionMessage(names));
    this.name = "VendoredCollision";
    this.names = names;
  }
}

/** `names` and the libraries they need (`OptionalLibrary.requires`), each once. */
export function withRequired(names: Iterable<string>): string[] {
  const all = new Set<string>();
  const add = (name: string): void => {
    if (all.has(name)) return;
    all.add(name);
    for (const required of vendoredPackage(name)?.optional?.requires ?? []) add(required);
  };
  for (const name of names) add(name);
  return [...all];
}

/**
 * The autolinking config of `platform` with the vendored packages linked from the library: an entry for each, with the fields autolinking prints for the installed
 * package. The packages every app links are always there; an optional one (`linked`: the names the app turned on, with what they need) only when it is named, and an optional one
 * that is not is *taken out* of the config if autolinking found an original of it (a copy installed for another package's sake), so the app carries none of it. A package the config
 * already has (found in `node_modules` all the same, for example the Nitro runtime that react-native-quick-crypto asks for as a peer, which a package manager installs on its own) is
 * replaced by the library's, which keeps the name and so the Gradle project and the pod. A package that the app's own package.json names is a mistake, not a leftover, and throws
 * `VendoredCollision`: the app would be building a second copy it believes is the one it chose, turned on or not.
 * The input is not changed.
 */
export function linkVendored<Config extends LinkableConfig>(config: Config, platform: LinkPlatform, root: string = packageRoot, linked: Iterable<string> = []): Config {
  const on = new Set(withRequired(linked));
  const entries = vendoredPackages.flatMap((vendored) => {
    if (vendored.optional !== undefined && !on.has(vendored.name)) return [];
    const dependency = vendoredDependency(vendored, platform, root);
    return dependency ? [[vendored.name, dependency] as const] : [];
  });
  const dependencies = { ...(config.dependencies ?? {}) };
  const others = vendoredPackages.filter((vendored) => dependencies[vendored.name] !== undefined && real(dependencies[vendored.name]?.root ?? "") !== real(vendoredRoot(vendored.name, root))).map((vendored) => vendored.name);
  if (others.length > 0 && typeof config.root === "string") {
    const declared = declaredVendored(config.root).filter((name) => others.includes(name));
    if (declared.length > 0) throw new VendoredCollision(declared);
  }
  for (const vendored of optionalPackages) if (!on.has(vendored.name)) delete dependencies[vendored.name];
  // The config command lists its dependencies by name; so does this.
  const sorted = Object.entries({ ...dependencies, ...Object.fromEntries(entries) }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { ...config, dependencies: Object.fromEntries(sorted) } as Config;
}
