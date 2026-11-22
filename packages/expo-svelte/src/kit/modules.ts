import { sourceFile } from "../package-root.ts";

/**
 * SvelteKit's built-in modules on the device: which import Metro resolves to which file of the library (`withExpoSvelte`, `metro.ts`), and which it refuses. Pure data, so that the
 * Node side (Metro's config, the tests) can read it without loading the React Native runtime the files themselves need.
 */

/** The imports the library answers on the device, to the file (relative to `src/`) that does. */
export const KIT_MODULES: Readonly<Record<string, string>> = {
  "$app/navigation": "kit/navigation.ts",
  "$app/state": "kit/state.ts",
  "$app/env": "kit/env.ts",
  "$app/environment": "kit/env.ts",
  "$app/paths": "kit/paths.ts",
};

/** SvelteKit modules that have nothing behind them on the device, and what an import of one fails the bundle with. */
export const KIT_UNAVAILABLE: Readonly<Record<string, string>> = {
  "$app/forms": "forms submit to a SvelteKit server's actions; use remote functions' `form` (docs: Loading data)",
  "$app/manifest": "the manifest lists the web build's files",
  "$app/service-worker": "a device has no service worker",
  "$app/stores": "SvelteKit 3 removed the stores; use `page` from `$app/state`",
  "$app/env/public": "the app has no SvelteKit environment; read what it needs from the app config (`extra`) with expo-constants",
};

/**
 * What Metro resolves an import of SvelteKit's `$app/*` modules to, as an absolute path, or `undefined` for any other import; throws for a module that is not available on the device.
 * (`svelte/motion` is Svelte's own: it builds `prefersReducedMotion` from `window.matchMedia`, which the polyfills install before any screen loads.)
 */
export function kitResolution(moduleName: string): string | undefined {
  if (Object.hasOwn(KIT_MODULES, moduleName)) return sourceFile(KIT_MODULES[moduleName]);
  if (Object.hasOwn(KIT_UNAVAILABLE, moduleName)) throw new Error(`${moduleName} is not available on the device (expo-svelte): ${KIT_UNAVAILABLE[moduleName]}. The guide's "SvelteKit modules" page lists what is.`);
  return undefined;
}
