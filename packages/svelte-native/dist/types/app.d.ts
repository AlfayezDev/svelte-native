/**
 * What the app's generated entry (`.svelte-native/entry.ts`, written by `svelte-native sync`) imports: the boot modules and the Fabric app, in one import.
 *
 *     import { createFabricApp, remountSurfaces } from "@alfayez/svelte-native/app";
 *
 * An app does not import this entry itself. Importing it runs `init.ts` (what runs instead of React Native's `InitializeCore`), then `polyfills.ts` (the
 * standard `URL`, `Intl` and the rest the app expects), then loads the Fabric host (`fabric/index.ts`), in the order the generated entry has always imported them.
 * They stay three modules because each marks its own time for `bootSummary()`. Between the last two it imports `push/load.ts`, which only starts watching the app's hooks for `push`.
 */
import "./init.js";
import "./polyfills.js";
import "./push/load.js";
import { createFabricApp, fabricStats, flush, remountSurfaces, showError } from "./fabric/index.js";
export { createFabricApp, fabricStats, flush, remountSurfaces, showError };
export { registerHooks, type MobileHooks } from "./app-hooks.js";
