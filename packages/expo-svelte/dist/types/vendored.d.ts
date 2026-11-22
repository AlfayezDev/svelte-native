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
        cxxModule?: {
            cmakeListsModuleName: string;
            cmakeListsPath: string;
            headerName: string;
        };
    };
    /** The podspec at the package's root (its file name), which autolinking gives to CocoaPods. */
    ios?: {
        podspec: string;
    };
    /** Present for a package an app turns on; absent for one every app links. */
    optional?: OptionalLibrary;
};
/**
 * The vendored packages. Adding one: run `scripts/vendor.ts`, add its entry here, take it from the library's `peerDependencies` and from the places that install it (VENDORING.md,
 * "Adding a package").
 */
export declare const vendoredPackages: readonly VendoredPackage[];
/** The names of the vendored packages. */
export declare const vendoredNames: readonly string[];
/** The packages an app turns on (`libraries` of the plugin options), and the ones every app links. */
export declare const optionalPackages: readonly VendoredPackage[];
export declare const alwaysLinkedPackages: readonly VendoredPackage[];
/** The registry entry of a vendored package, by its name. */
export declare const vendoredPackage: (name: string) => VendoredPackage | undefined;
/** `vendor/` of the package. `root` is the package's directory (this one, unless a test gives another). */
export declare const vendorDirectory: (root?: string) => string;
/** The directory of a vendored package. */
export declare const vendoredRoot: (name: string, root?: string) => string;
/** The vendored package an import names, and the rest of the path (`react-native-mmkv/lib/index` is `react-native-mmkv` and `lib/index`; the bare name has an empty one). */
export declare function vendoredImport(request: string): {
    vendored: VendoredPackage;
    subpath: string;
} | undefined;
/**
 * Where a file is, relative to `node_modules`, as if it were an installed package: a file of `vendor/react-native-mmkv/` is `react-native-mmkv/…`. `undefined` for a file
 * that is not in a vendored package. Metro gives the real path of a file, and a project may name it through the link into the package, so both are tried.
 */
export declare function vendoredFileAs(path: string, root?: string): string | undefined;
/** An entry of React Native's autolinking config for one platform: the fields the command prints for a package, in the order it prints them. */
export type AutolinkingDependency = {
    root: string;
    name: string;
    platforms: Record<string, unknown>;
};
/**
 * What `react-native-config` (Expo's, SDK 57) prints for the package if it were installed, with the paths of the vendored copy: `root` and `sourceDir` (Android) or `podspecPath` (iOS)
 * are in `vendor/<name>/`, the rest is what the package's files say (its version; `libraryName` is `codegenConfig.name`, else the `libraryName` of the `react { }` block in
 * `android/build.gradle`; the generated codegen CMake file is below `android/build/` unless the registry says where it is) or what the registry records. `undefined` when the
 * package has nothing for the platform.
 */
export declare function vendoredDependency(vendored: VendoredPackage, platform: LinkPlatform, root?: string): AutolinkingDependency | undefined;
/** The part of the config the command prints that linking reads: the app's directory, and the dependencies by name. */
type LinkableConfig = {
    root?: string;
    dependencies?: Record<string, {
        root?: string;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
};
/** The vendored packages an app's package.json lists as its own dependencies, which would link them a second time. */
export declare function declaredVendored(appRoot: string): string[];
/** The refusal for an app that has an original of a vendored package: said by the config plugin, `expo-svelte doctor` and the autolinking command alike. */
export declare function collisionMessage(names: readonly string[], library?: string): string;
/** Raised by `linkVendored` for an app that declares a vendored package itself. */
export declare class VendoredCollision extends Error {
    readonly names: readonly string[];
    constructor(names: readonly string[]);
}
/** `names` and the libraries they need (`OptionalLibrary.requires`), each once. */
export declare function withRequired(names: Iterable<string>): string[];
/**
 * The autolinking config of `platform` with the vendored packages linked from the library: an entry for each, with the fields autolinking prints for the installed
 * package. The packages every app links are always there; an optional one (`linked`: the names the app turned on, with what they need) only when it is named, and an optional one
 * that is not is *taken out* of the config if autolinking found an original of it (a copy installed for another package's sake), so the app carries none of it. A package the config
 * already has (found in `node_modules` all the same, for example the Nitro runtime that react-native-quick-crypto asks for as a peer, which a package manager installs on its own) is
 * replaced by the library's, which keeps the name and so the Gradle project and the pod. A package that the app's own package.json names is a mistake, not a leftover, and throws
 * `VendoredCollision`: the app would be building a second copy it believes is the one it chose, turned on or not.
 * The input is not changed.
 */
export declare function linkVendored<Config extends LinkableConfig>(config: Config, platform: LinkPlatform, root?: string, linked?: Iterable<string>): Config;
export {};
