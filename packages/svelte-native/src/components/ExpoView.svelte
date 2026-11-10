<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { expoViewName } from "../fabric/foreign.ts";
  import { expoViewHandle, expoViewPrototype, expoViewProps, type UntypedExpoViewHandle } from "../fabric/foreign-expo-view.ts";
  import type { HostHandle } from "../fabric/host.ts";
  import { forwardRef } from "./forward-ref.ts";
  import type { ViewProps } from "react-native";

  /**
   * The native view of any Expo module, by the module's name and the view's: `<ExpoView module="ExpoCamera" facing="back" />`
   * (`view` names one of a module's several views; a module's only view has no name). The props are the view's own, as the module
   * declares them (`getViewConfig`; a prop it does not declare is dropped), the `on…` props are its events, called with React Native's
   * event object (`{ nativeEvent }`, as for a component of the view), a shared object (an `expo-video` player) is given as its id,
   * and the children are mounted inside the view. A prop of the view named `module` or `view` cannot be given.
   *
   * `ref` gets the host handle (`tag`, `measure`, `dispatchCommand`, ...) with the functions the module defines for the view on
   * it (`handle.someFunction(...)`), the object Expo's React adapter gives a component's ref. It is the same object until the view
   * is unmounted, when `ref` hears null. `defineExpoView` makes a component of this one with the library's props typed.
   *
   * A library whose React component changes its props in JavaScript before they reach the view (`expo-linear-gradient`
   * converts its colours) needs that change made here; the dedicated components (`LinearGradient`, `ExpoImage`, `VideoView`,
   * `BlurView`) are those libraries' own.
   */
  let { module: moduleName, view: viewName, children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    module: string;
    view?: string;
    children?: Snippet;
    /** Receives the host handle with the view's native functions, or null on unmount. */
    ref?: (handle: UntypedExpoViewHandle | null) => void;
    [prop: string]: unknown;
  } = $props();
  const resolveProps = createNativeProps();
  // A node keeps the native view it was created for, so another module or view is another node (the key below); throws when there is none.
  const component = $derived(expoViewName(moduleName, viewName));
  const viewProps = $derived(expoViewProps(attributes));
  // A new wrapper only when the `ref` prop or the view changes, as the host hands a handle over only then (`forwardRef`).
  const hostRef = $derived.by(() => {
    const [name, view] = [moduleName, viewName];
    return ref ? forwardRef<HostHandle, UntypedExpoViewHandle>(ref, (host) => expoViewHandle(host, expoViewPrototype(name, view))) : undefined;
  });
</script>
{#key component}<native-foreign {component} nativeProps={resolveProps({ ...viewProps, ref: hostRef })}>{@render children?.()}</native-foreign>{/key}
