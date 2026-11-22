import type { Snippet } from "svelte";
import type { ComponentPropsWithRef } from "react";
import type { ViewStyle } from "react-native";
import type Animated from "#vendor/react-native-reanimated";
import type { BaseAnimationBuilder, EntryExitAnimationFunction, LayoutAnimationFunction } from "#vendor/react-native-reanimated";
import type { GestureProps } from "../gestures/types.js";
import type { ClassProps } from "../classes.js";
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
type $$ComponentProps = Omit<NativeAnimatedViewProps, "children"> & {
    children?: Snippet;
} & ClassProps;
declare const AnimatedView: import("svelte").Component<$$ComponentProps, {}, "">;
type AnimatedView = ReturnType<typeof AnimatedView>;
export default AnimatedView;
