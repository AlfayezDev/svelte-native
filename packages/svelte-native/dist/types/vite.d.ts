/// <reference path="./kit/modules.d.ts" />
import type { PluginOption } from "vite";
import type { sveltekit } from "@sveltejs/kit/vite";
export declare function svelteNative(options?: {
    target?: "web" | "native";
    platform?: "android" | "ios";
    /** The variant whose route table the native build writes. Default: `APP_VARIANT`, or `app` when that is empty. */
    variant?: string;
    /**
     * Whether the app's components are compiled in runes mode, whatever the file looks like (`<svelte:options runes={false} />` in a file opts that file out). Default `true`, for both targets,
     * so one `.svelte` file means the same in the browser and on the device. Svelte libraries below `node_modules` keep Svelte's own default (runes inferred per file), and the library's own
     * components are always runes. `false` is for an app that is migrating legacy components: nothing is forced and Svelte infers the mode of each file. Web target: handed to SvelteKit as
     * `dynamicCompileOptions` (the app's own `kit.compilerOptions.runes` and `kit.dynamicCompileOptions` still win). Native target: the Metro that runs the export gets it in the environment, and
     * `withSvelteNative(config, { runes })` in the app's `metro.config` wins over it.
     */
    runes?: boolean;
    /**
     * Experimental: Svelte's async mode (`experimental.async`), for `router.prepare` and for `await` in `$derived`, the markup and the top of a component. Default `false`. Native target: the Metro that
     * runs the export gets it in the environment (`withSvelteNative(config, { async })` in the app's `metro.config` wins over it); see `SvelteNativeMetroOptions.async`. Web target: added to the
     * compiler options handed to SvelteKit, under the app's own `kit.compilerOptions.experimental` (which wins), so one `.svelte` file compiles the same way on both targets.
     */
    async?: boolean;
    kit?: Parameters<typeof sveltekit>[0];
}): PluginOption;
