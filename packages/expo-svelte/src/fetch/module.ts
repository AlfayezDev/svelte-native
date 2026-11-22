import type { SvelteFetchModule } from "./native.ts";

let loaded: SvelteFetchModule | null | undefined;

/**
 * The native module, or null in a binary built without it (an app that has not rebuilt since the library added it), or in a host that has no Expo module registry at all (the host
 * checks of this repository bundle the library against stand-ins for it). Looked up once, on first use.
 */
export function optionalNative(): SvelteFetchModule | null {
  if (loaded === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use: the module registry is not touched while the app boots
    const registry = require("expo-modules-core") as Partial<typeof import("expo-modules-core")>;
    loaded = registry.requireOptionalNativeModule?.<SvelteFetchModule>("SvelteFetch") ?? null;
  }
  return loaded;
}

export function native(): SvelteFetchModule {
  const module = optionalNative();
  if (module === null) throw new TypeError("The SvelteFetch native module is not part of this app: rebuild the native app");
  return module;
}

/** Replaces the module (host checks pass a JavaScript implementation of the contract in `native.ts`); `undefined` forgets the lookup. */
export function setNativeModule(module: SvelteFetchModule | null | undefined): void {
  loaded = module;
}
