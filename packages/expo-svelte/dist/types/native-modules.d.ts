/**
 * Native modules reached the way React Native's JavaScript reaches them, without React. The foreign-view wrappers use them
 * (`fabric/foreign.ts`), and so does the native module smoke test (`apps/qa/src/lib/native/dev/smoke.ts`) for libraries
 * whose own JavaScript needs React. `platform.ts` exports them (`expo-svelte/platform`).
 */
/** A TurboModule by name. Throws when no module of that name is registered. */
export declare function turboModule<T>(name: string): T;
/** A legacy NativeModule by name (`NativeModules`, which the bridgeless runtime also lets reach legacy modules); undefined when none is registered. */
export declare function nativeModule<T>(name: string): T | undefined;
