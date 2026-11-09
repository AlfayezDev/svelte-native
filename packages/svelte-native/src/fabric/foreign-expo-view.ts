/**
 * Any Expo module's native view as a Svelte component (`ExpoView`, `defineExpoView`), without a wrapper written per library. It
 * does what Expo's own React adapter (`NativeViewManagerAdapter.native.tsx` in `expo-modules-core`) does, minus React: the
 * view's name and config (`expoViewName` in `foreign.ts`), a shared object prop as its registry id, and the view's native
 * functions on the handle that `ref` gives. A library whose React component transforms its props in JavaScript before they reach
 * the view (`expo-linear-gradient` converts its colours) still needs that transform: it is why the dedicated wrappers exist.
 */
import { sharedObjectId } from "./foreign.ts";
import type { HostHandle } from "./host.ts";

/** The view's native functions are typed by the app (`defineExpoView`): the generic component can only say that they take anything and answer anything. */
type AnyFunctions = { [name: string]: (...args: unknown[]) => unknown };

/**
 * What `ref` of an Expo view gives: the host handle (`tag`, `measure`, `dispatchCommand`, ...) plus the functions the native
 * module defines for the view (`takePicture`, `startAnimating`), typed as `Methods`. A function of the view wins over a
 * host method of the same name. `nativeTag` is what Expo's native side reads to find the view, from a view function's `this` and
 * from a view passed as an argument to a module function.
 */
export type ExpoViewHandle<Methods extends object = Record<never, never>> = Omit<HostHandle, keyof Methods> & Methods & { readonly nativeTag: number };

/** The handle of `ExpoView`, whose native functions the app calls untyped (`defineExpoView` types them). */
export type UntypedExpoViewHandle = HostHandle & { readonly nativeTag: number } & AnyFunctions;

type Modules = Record<string, { ViewPrototypes?: Record<string, object> } | undefined>;

/**
 * The functions the native module defines on the view's component prototype, which the React adapter assigns to its component's
 * prototype (`ViewPrototypes` of the module object, keyed by the module's name, or `<module>_<view>` for a named view). A module with
 * no function on that view has no entry (Android registers a prototype only for a view that has async functions).
 */
export function expoViewPrototype(moduleName: string, viewName?: string): object | null {
  const modules = (globalThis as { expo?: { modules?: Modules } }).expo?.modules;
  return modules?.[moduleName]?.ViewPrototypes?.[viewName ? `${moduleName}_${viewName}` : moduleName] ?? null;
}

/**
 * The object `ref` hands over for a view: its prototype is the view's native prototype, so `handle.someFunction(...)` runs with
 * `this` the handle, whose `nativeTag` is the host handle's tag (the tag Fabric made the view under, which Expo's `findView`
 * resolves). The host handle's methods are bound to the host, so they work wherever the handle is passed.
 */
export function expoViewHandle(host: HostHandle, prototype: object | null): UntypedExpoViewHandle {
  const handle = Object.create(prototype ?? Object.prototype) as Record<string, unknown>;
  for (const [name, member] of Object.entries(host)) {
    if (name in handle) continue;
    handle[name] = typeof member === "function" ? (member as (...args: unknown[]) => unknown).bind(host) : member;
  }
  Object.defineProperty(handle, "nativeTag", { value: host.tag, enumerable: true });
  return handle as UntypedExpoViewHandle;
}

/** A shared object (an object with a numeric `__expo_shared_object_id__`) as the id native resolves; everything else, numbers included, as it is. */
export function unwrapSharedObject(value: unknown): unknown {
  return value !== null && typeof value === "object" ? sharedObjectId(value) ?? value : value;
}

/**
 * The props the native view gets from the attributes the app gave `ExpoView`: a shared object prop is its id, the rest is as given
 * (a handler `on…` is the host's to register under the event names of the view's config; it is called with React Native's event
 * object, `{ nativeEvent }`, as it is for a React component of the view). The view's config decides which props reach it: a name it
 * does not declare is dropped, as it is for every foreign view.
 */
export function expoViewProps(attributes: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const name of Object.keys(attributes)) props[name] = unwrapSharedObject(attributes[name]);
  return props;
}
