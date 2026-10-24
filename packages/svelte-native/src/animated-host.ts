import { createElement, type ComponentPropsWithRef } from "react";
import type { View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

export type NativeAnimatedViewProps = ComponentPropsWithRef<typeof View> & { animatedStyle: () => ViewStyle };

export function NativeAnimatedView({ animatedStyle, style, ...props }: NativeAnimatedViewProps) {
  const animated = useAnimatedStyle(animatedStyle);
  return createElement(Animated.View, { ...props, style: [style, animated] });
}
