<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { Platform } from "../fabric/deps-rn.ts";
  import { expoViewName } from "../fabric/foreign.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The content `ExpoBlurView` blurs on Android (`ExpoBlurTargetView` of `expo-blur`); a plain `View` on iOS, which needs no target.
   * Pass its `ref` value to `ExpoBlurView`'s `blurTarget`. The target is a foreign view: what it holds is mounted by React Native, so
   * those views take no JavaScript touch or responder events (see `ExpoBlurView`).
   */
  let { children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
  } & ClassProps = $props();
  const resolveProps = createNativeProps();
  const android = Platform.OS === "android";
  const component = android ? expoViewName("ExpoBlur", "ExpoBlurTargetView") : "";
</script>
{#if android}
  <native-foreign {component} nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-foreign>
{:else}
  <View {...attributes} {ref}>{@render children?.()}</View>
{/if}
