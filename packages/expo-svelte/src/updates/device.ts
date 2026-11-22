import { requireOptionalNativeModule } from "expo-modules-core";
import type { SvelteUpdatesNative } from "./native.ts";

/** The `SvelteUpdates` module, or null where it is not installed. The only file of the updates code that needs React Native's module system. */
export const loadNative = (): SvelteUpdatesNative | null => requireOptionalNativeModule<SvelteUpdatesNative>("SvelteUpdates");
