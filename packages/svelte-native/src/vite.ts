// biome-ignore-all lint/suspicious/noTsIgnore: `@sveltejs/kit` may be absent (an optional peer), and `@ts-expect-error` would fail where it is installed
import { resolve } from "node:path";
import type { PluginOption } from "vite";
import { exportNative, syncNative } from "./build.ts";
import { withWebAsync, withWebRunes } from "./compile-options.ts";
import { kitMissingMessage } from "./remote/kit.ts";
import { assertCustomRenderer } from "./svelte-build.ts";

// `@sveltejs/kit` is an optional peer: the web target needs it, a native-only app does not have it, and without it the `kit` option is not typed.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- the module may be absent
// @ts-ignore
import type { sveltekit } from "@sveltejs/kit/vite";

/** SvelteKit's Vite plugin, loaded when the web target asks for it: an app that only builds for native never loads (or installs) SvelteKit. */
async function loadSvelteKit(): Promise<typeof sveltekit> {
  try {
    return (await import("@sveltejs/kit/vite")).sveltekit;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") throw new Error(kitMissingMessage("The web target of svelteNative() (@example/svelte-native/vite)"), { cause });
    throw cause;
  }
}

export function svelteNative(options: {
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
} = {}): PluginOption {
  if (options.target !== "native") return loadSvelteKit().then((kit) => [
    { name: "svelte-native:web", config: () => ({ optimizeDeps: { entries: ["!src/routes/**/+mobile.svelte", "!src/routes/**/*.mobile.svelte", "!src/lib/native/**"] } }) },
    kit(withWebAsync(withWebRunes(options.kit, options.runes), options.async)),
  ]);
  assertCustomRenderer("The native target of svelteNative() (@example/svelte-native/vite)");
  let root = "";
  return {
    name: "svelte-native",
    config: () => ({ build: { write: false, rolldownOptions: { input: "virtual:svelte-native-build" } } }),
    configResolved(config) { root = config.root; },
    async buildStart() { await syncNative(root, { variant: options.variant }); },
    resolveId(id) { if (id === "virtual:svelte-native-build") return "\0svelte-native-build"; },
    load(id) { if (id === "\0svelte-native-build") return "export {};"; },
    async generateBundle() { await exportNative(resolve(root), options.platform ?? "android", { variant: options.variant, runes: options.runes, async: options.async }); },
  };
}
