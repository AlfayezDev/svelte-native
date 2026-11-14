import type { MetroConfig as ConfigT } from "expo/metro-config";
export declare const LITE_ORIGINS: RegExp;
/**
 * The names under which Node's `crypto` is imported. A library written for Node (`jose`, an AWS or a Stripe client, ...) imports one of them; on the device they resolve to
 * react-native-quick-crypto, which implements Node's API (`createHash`, `createHmac`, `randomBytes`, ciphers, key pairs, `subtle`, ...) over OpenSSL. `crypto` the global is the web's
 * (`polyfills.ts`), and is made of the same library.
 */
export declare const NODE_CRYPTO: ReadonlySet<string>;
export declare const QUICK_CRYPTO = "react-native-quick-crypto";
export declare const INITIALIZE_CORE: RegExp;
/**
 * React Native modules that reach the React renderer (118 KB, plus React and the public-instance/DOM classes), keyed by
 * file suffix. Their only Fabric-entry users are view-config registration and command helpers, which need none of it.
 */
export declare const RENDERER_STUBS: Record<string, string>;
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
export declare function closeWatchers(): void;
/** The code every stub shares: a module that throws `<name> is not in this app (APP_VARIANT=…)` on anything but `__esModule`, a call or a construction. */
export declare const stubCoreSource = "// Generated by @alfayez/svelte-native/metro: what stands in for a package this app does not link.\n\"use strict\";\nmodule.exports = (name, variant) => {\n  const fail = () => { throw new Error(name + \" is not in this app (APP_VARIANT=\" + variant + \")\"); };\n  // A bound function: callable and constructible, and without the non-configurable prototype property that ownKeys below would have to report.\n  return new Proxy(function () {}.bind(null), {\n    get: (_target, key) => (key === \"__esModule\" ? false : typeof key === \"symbol\" ? undefined : fail()),\n    apply: fail,\n    construct: fail,\n    has: () => false,\n    ownKeys: () => [],\n    getOwnPropertyDescriptor: () => undefined,\n  });\n};\n";
/** The stub of one package: a line that asks the shared core for it, so thirty-odd stubs cost the bundle a few bytes each. */
export declare function stubSource(name: string, variant: string): string;
/** Whether [moduleName] is [name] or a path inside it. */
export declare const isInPackage: (moduleName: string, name: string) => boolean;
export declare function libraryChanged(projectRoot: string, library?: string): boolean;
export declare function withSvelteNative(config: ConfigT, options?: SvelteNativeMetroOptions): ConfigT;
