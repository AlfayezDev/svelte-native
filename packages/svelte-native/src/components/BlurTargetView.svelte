<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { Platform } from "../fabric/deps-rn.ts";
  import { expoViewName } from "../fabric/foreign.ts";
  import View from "./View.svelte";
  import type { ViewProps } from "react-native";

  /**
   * The content `BlurView` blurs on Android (`ExpoBlurTargetView` of `expo-blur`); a plain `View` on iOS, which needs no target.
   * Pass its `ref` value to `BlurView`'s `blurTarget`. The target is a foreign view: what it holds is mounted by React Native, so
   * those views take no JavaScript touch or responder events (see `BlurView`).
   */
  let { children, ref, ...attributes }: Omit<ViewProps, "children"> & {
    children?: Snippet;
    /** Receives the host handle (`tag`, `measure`, ...), or null on unmount. */
    ref?: (handle: unknown) => void;
  } = $props();
  const resolveProps = createNativeProps();
  const android = Platform.OS === "android";
  const component = android ? expoViewName("ExpoBlur", "ExpoBlurTargetView") : "";
</script>
{#if android}
  <native-foreign {component} nativeProps={resolveProps({ ...attributes, ref })}>{@render children?.()}</native-foreign>
{:else}
  <View {...attributes} {ref}>{@render children?.()}</View>
{/if}
