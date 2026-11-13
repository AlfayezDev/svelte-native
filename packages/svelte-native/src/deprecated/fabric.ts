/**
 * The deprecated `@alfayez/svelte-native/fabric` entry. The generated app entry imports `createFabricApp` and `remountSurfaces` from `@alfayez/svelte-native/app`
 * (which also loads the boot modules first); `svelte-native sync` rewrites it. It goes away in 0.4.0-rc.7.
 */
export {
  /** @deprecated Import `createFabricApp` from "@alfayez/svelte-native/app"; `@alfayez/svelte-native/fabric` is removed in 0.4.0-rc.7. */
  createFabricApp,
  /** @deprecated Import `fabricStats` from "@alfayez/svelte-native/app"; `@alfayez/svelte-native/fabric` is removed in 0.4.0-rc.7. */
  fabricStats,
  /** @deprecated Import `flush` from "@alfayez/svelte-native/app"; `@alfayez/svelte-native/fabric` is removed in 0.4.0-rc.7. */
  flush,
  /** @deprecated Import `remountSurfaces` from "@alfayez/svelte-native/app"; `@alfayez/svelte-native/fabric` is removed in 0.4.0-rc.7. */
  remountSurfaces,
  /** @deprecated Import `showError` from "@alfayez/svelte-native/app"; `@alfayez/svelte-native/fabric` is removed in 0.4.0-rc.7. */
  showError,
} from "../fabric/index.ts";
