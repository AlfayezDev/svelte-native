<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ComponentPropsWithRef } from "react";
  import type { ViewStyle } from "react-native";
  import type Animated from "react-native-reanimated";
  import type { BaseAnimationBuilder, EntryExitAnimationFunction, LayoutAnimationFunction } from "react-native-reanimated";
  import type {} from "../elements.d.ts";
  import type { GestureProps } from "../gestures/types.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  /**
   * Reanimated's animated view props (including CSS animation and transition style keys) plus an optional UI-runtime style worklet.
   * `entering`, `exiting` and `layout` are Reanimated's layout animations (`FadeIn`, `FadeOut`, `LinearTransition`, ...), run by
   * Reanimated's C++ proxy (`entering` is read once, at mount).
   */
  type NativeAnimatedViewProps = Omit<ComponentPropsWithRef<typeof Animated.View>, "animatedProps"> & GestureProps & {
    /** A worklet returning the style to animate (`useAnimatedStyle` without the hook), or several that are merged. */
    animatedStyle?: (() => ViewStyle) | ReadonlyArray<() => ViewStyle>;
    /** A worklet returning the props that are not style to animate (`useAnimatedProps` without the hook), or several. Reanimated's own `animatedProps` object is not what this host takes. */
    animatedProps?: (() => Record<string, unknown>) | ReadonlyArray<() => Record<string, unknown>>;
    entering?: BaseAnimationBuilder | typeof BaseAnimationBuilder | EntryExitAnimationFunction;
    exiting?: BaseAnimationBuilder | typeof BaseAnimationBuilder | EntryExitAnimationFunction;
    layout?: BaseAnimationBuilder | typeof BaseAnimationBuilder | LayoutAnimationFunction;
  };
  let { children, ...attributes }: Omit<NativeAnimatedViewProps, "children"> & { children?: Snippet } & ClassProps = $props();
  const resolveProps = createNativeProps();
</script>
<native-animated-view nativeProps={resolveProps(attributes)}>{@render children?.()}</native-animated-view>
