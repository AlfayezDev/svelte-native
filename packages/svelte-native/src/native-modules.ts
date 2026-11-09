/**
 * Native modules reached the way React Native's JavaScript reaches them, without React. The foreign-view wrappers use them
 * (`fabric/foreign.ts`), and so does the native module smoke test (`apps/qa/src/lib/native/dev/smoke.ts`) for libraries
 * whose own JavaScript needs React.
 */

/** A TurboModule by name. Throws when no module of that name is registered. */
export function turboModule<T>(name: string): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use: the registry is not needed until a module is
  return (require("react-native/Libraries/TurboModule/TurboModuleRegistry") as { getEnforcing<M>(name: string): M }).getEnforcing<T>(name);
}

/** A legacy NativeModule by name (`NativeModules`, which the bridgeless runtime also lets reach legacy modules); undefined when none is registered. */
export function nativeModule<T>(name: string): T | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- required on first use
  return (require("react-native/Libraries/BatchedBridge/NativeModules") as { default: Record<string, unknown> }).default[name] as T | undefined;
}
