import { realpathSync } from "node:fs";
import { sep } from "node:path";
import type { CompileOptions } from "svelte/compiler";
import { sourceDirectory } from "./package-root.ts";

/**
 * How this library compiles Svelte, in one place: the Metro transformer, the web target of the Vite plugin and the tests that compile fixtures all ask here.
 *
 * Runes mode is the default for the app's own components. Outside runes mode Svelte turns every top-level variable that the markup mutates into reactive state, even a `const`
 * (`const count = createSharedValue(0)` with `count.value = ...` in a handler), and a worklet that captures such a variable captures Svelte's runtime, which the UI runtime
 * does not have (the showcase's animateable-text screen crashed on a device that way). In runes mode state is only what `$state` and `$derived` say it is.
 *
 * What the default does and does not reach:
 * - A file may opt out with `<svelte:options runes={false} />`: Svelte merges a component's own `<svelte:options>` over the compile option, so the file's choice wins.
 * - Svelte modules (`.svelte.ts`, `.svelte.js`) are always compiled in runes mode by Svelte (`compileModule` has no `runes` option), so there is nothing to default there.
 * - A file below a `node_modules` directory keeps Svelte's own default (runes inferred from the file): a third-party Svelte library may still be written in the legacy syntax, and
 *   forcing runes on it would break it. A package of the app's own workspace is linked from outside `node_modules`, so it counts as the app's.
 * - This library's own components are written in runes and are always compiled as such, wherever the package is installed (its path below an app's `node_modules` included).
 * - An app that is migrating legacy components sets `runes: false` (`withSvelteNative(config, { runes: false })`, `svelteNative({ runes: false })`): the library then forces nothing
 *   and Svelte infers the mode of each file, as it does without this library.
 */

/**
 * The environment variable that carries the app's `runes` setting to the Metro transformer. Metro hands a babel transformer the file and Metro's own options, and nothing of the
 * app's config, but its workers are processes started by the one that loaded the config, and they inherit its environment. `withSvelteNative` sets it when it is given `runes`;
 * `0`, `false`, `off` and `no` turn the default off, anything else (and unset) leaves it on.
 */
export const RUNES_ENVIRONMENT_VARIABLE = "SVELTE_NATIVE_RUNES";

/** The environment that hands an app's `runes` option to the transformer of a Metro: nothing when the app gave none. */
export const runesEnvironment = (runes: boolean | undefined): Record<string, string> => (runes === undefined ? {} : { [RUNES_ENVIRONMENT_VARIABLE]: runes ? "1" : "0" });

/** Whether the app asked for the default: `true` unless the environment turns it off. */
export function runesDefaultEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(?:0|false|off|no)$/i.test(env[RUNES_ENVIRONMENT_VARIABLE]?.trim() ?? "");
}

/**
 * Svelte's async mode (`experimental.async`, which `router.prepare` needs and which also allows `await` in `$derived`, in the markup and at the top of a component) is off, and an app
 * turns it on with `withSvelteNative(config, { async: true })` (`svelteNative({ async: true })` for the Vite plugin). It reaches the transformer the way `runes` does, through the environment,
 * and is a compile option for every Svelte file the transformer compiles, the library's own and a library's below `node_modules` included: Svelte's flag is one switch for the whole
 * process, turned on by the first module that imports `svelte/internal/flags/async`, which is all a component compiled with the option adds when it has no `await` (`tests/fork.test.ts`).
 * Compiling some files with it and others without would change nothing at run time, so the option is all or none. A precompiled Svelte package that was built with `experimental.async`
 * imports the flag itself, and turns the mode on for an app that did not ask for it.
 */
export const ASYNC_ENVIRONMENT_VARIABLE = "SVELTE_NATIVE_ASYNC";

/** The environment that hands an app's `async` option to the transformer of a Metro: nothing when the app gave none. */
export const asyncEnvironment = (enabled: boolean | undefined): Record<string, string> => (enabled === undefined ? {} : { [ASYNC_ENVIRONMENT_VARIABLE]: enabled ? "1" : "0" });

/** Whether the app asked for async mode: `false` unless the environment turns it on (`1`, `true`, `on` or `yes`). */
export function asyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(?:1|true|on|yes)$/i.test(env[ASYNC_ENVIRONMENT_VARIABLE]?.trim() ?? "");
}

const IN_NODE_MODULES = /(?:^|[\\/])node_modules[\\/]/;
const ownSources = sourceDirectory + sep;

/** Whether `filename` is a source of this library: in its `src/` directory, or reached through a link into it (a path below `node_modules` that is a link into the package). */
export function isLibrarySource(filename: string): boolean {
  if (filename.startsWith(ownSources)) return true;
  if (!IN_NODE_MODULES.test(filename)) return false;
  try {
    return realpathSync(filename).startsWith(ownSources);
  } catch {
    return false;
  }
}

/**
 * The compiler's `runes` option for one component: `true` for the library's own sources, and for any file outside `node_modules` while the default is on; `undefined` (Svelte infers
 * the mode of the file) for the rest. The file's own `<svelte:options runes={...} />` overrides either.
 */
export function runesOption(filename: string, enabled: boolean = runesDefaultEnabled()): true | undefined {
  if (isLibrarySource(filename)) return true;
  if (!enabled || IN_NODE_MODULES.test(filename)) return undefined;
  return true;
}

/**
 * Whether the Metro transformer lowers the HTML elements of `filename` (`<div>`, `<button>`, `<input>`, ... to native components, `lower-html.ts`): the app's own files do, the
 * `.mobile.svelte` ones and the shared components of `src/lib` alike, and a package of the app's workspace (linked from outside `node_modules`) too. A library below `node_modules`
 * keeps its markup as written, and the library's own components are written with the host tags. The web build never lowers (it does not load `lower.ts`), so a file still means HTML there.
 */
export function lowersHtml(filename: string): boolean {
  return !IN_NODE_MODULES.test(filename) && !isLibrarySource(filename);
}

/** The renderer module the compiler's `experimental.customRenderer` names: what turns Svelte's DOM calls into host-node calls. */
export const CUSTOM_RENDERER = "@alfayez/svelte-native/renderer";

/**
 * The options the library compiles a native component with: external CSS (a style block is refused by the transformer), production output, the custom renderer, and the runes
 * default. Async mode (`experimental.async`) is on only when the app asked for it (`asyncEnabled`): the native path otherwise depends on `tick()` being a microtask flush
 * (`tests/compiler/svelte-async-mode.test.ts`).
 */
export function componentOptions(filename: string, enabled: boolean = runesDefaultEnabled(), async: boolean = asyncEnabled()) {
  return {
    filename,
    dev: false,
    css: "external",
    runes: runesOption(filename, enabled),
    experimental: { customRenderer: CUSTOM_RENDERER, ...(async ? { async: true } : {}) },
  } as const;
}

/** The options a Svelte module (`.svelte.ts`, `.svelte.js`) is compiled with: always runes (`compileModule` has no `runes` option), and async mode when the app asked for it. */
export function moduleOptions(filename: string, async: boolean = asyncEnabled()) {
  return { filename, dev: false, generate: "client", ...(async ? { experimental: { async: true } } : {}) } as const;
}

/**
 * What vite-plugin-svelte hands `dynamicCompileOptions`, as far as this package reads it. The plugin's own types are not a dependency of this package (SvelteKit brings the
 * plugin, and the web target is optional), and the data grows between its releases (7.3 adds Vite's `environment`), so the type names the fields used and a caller's own
 * (wider) data type goes through unchanged.
 */
export type DynamicCompileData = {
  filename: string;
  code: string;
  compileOptions: Partial<CompileOptions>;
};

/** vite-plugin-svelte's `dynamicCompileOptions`. */
export type DynamicCompileOptions<Data extends DynamicCompileData = DynamicCompileData> = (data: Data) =>
  // biome-ignore lint/suspicious/noConfusingVoidType: the signature is vite-plugin-svelte's; a callback that returns nothing is a `void` one, and not assignable to `undefined`
  Promise<Partial<CompileOptions> | void> | Partial<CompileOptions> | void;

/**
 * `dynamicCompileOptions` for the web target of the Vite plugin, which SvelteKit forwards to vite-plugin-svelte (the plugin calls it for every `.svelte` file and `.svelte.ts` module it
 * compiles, node_modules libraries included). It sets `runes: true` by the same rule as `runesOption`, except that an app that gives `compilerOptions.runes` itself keeps its
 * choice for its own files, and the options the app's own `dynamicCompileOptions` returns are applied over this one's.
 *
 * The web target gets the default too, because the same `.svelte` file (a component under `src/lib` that a native and a web page both import) is compiled by Vite for the browser and
 * by Metro for the device. Two modes would make it mean two things: a variable the markup mutates would be reactive state in the browser and a plain variable on the device.
 */
export function webDynamicCompileOptions<Data extends DynamicCompileData = DynamicCompileData>(app?: DynamicCompileOptions<Data>, enabled = true): DynamicCompileOptions<Data> {
  return async (data) => {
    const own = isLibrarySource(data.filename) || (data.compileOptions.runes === undefined && runesOption(data.filename, enabled) === true);
    const theirs = await app?.(data);
    return own ? { runes: true, ...theirs } : theirs;
  };
}

/**
 * The options an app gave SvelteKit's Vite plugin (`kit` of `svelteNative()`), with `webDynamicCompileOptions` as their `dynamicCompileOptions`. The app's own callback keeps whatever
 * data type its version of vite-plugin-svelte declares (`(data: never) => unknown` accepts any function), and so does the one that wraps it.
 */
export function withWebRunes<Kit extends { dynamicCompileOptions?: (data: never) => unknown }>(
  kit: Kit | undefined,
  enabled = true,
): Kit & { dynamicCompileOptions: NonNullable<Kit["dynamicCompileOptions"]> } {
  const app = kit?.dynamicCompileOptions as DynamicCompileOptions | undefined;
  return { ...(kit as Kit), dynamicCompileOptions: webDynamicCompileOptions(app, enabled) as NonNullable<Kit["dynamicCompileOptions"]> };
}

/**
 * The options an app gave SvelteKit's Vite plugin (`kit` of `svelteNative()`) with async mode added to the compiler options when the app asked for it (`svelteNative({ async: true })`).
 * What the app's own `kit.compilerOptions.experimental` says is kept, so `async: false` there still wins, and a web app that sets `experimental.async` itself needs no option.
 */
export function withWebAsync<Kit extends { compilerOptions?: { experimental?: object } }>(kit: Kit | undefined, enabled: boolean | undefined): Kit | undefined {
  if (!enabled) return kit;
  return { ...kit, compilerOptions: { ...kit?.compilerOptions, experimental: { async: true, ...kit?.compilerOptions?.experimental } } } as Kit;
}
