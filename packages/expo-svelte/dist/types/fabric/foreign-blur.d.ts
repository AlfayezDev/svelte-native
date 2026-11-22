/**
 * The tints of the library's own `BlurView` (`SvelteBlur` on Android and iOS, `native/svelte-core`). They are the names `expo-blur` takes, so a screen can move from
 * one to the other. iOS maps each to a `UIBlurEffect` style; Android has no such materials and draws a translucent white or black over the blur: white for `light`,
 * `extraLight` and the `...Light` names, black for `dark` and the `...Dark` names, and for every other name white by day and black at night.
 */
export type BlurTint = "default" | "extraLight" | "light" | "dark" | "regular" | "prominent" | "systemUltraThinMaterial" | "systemThinMaterial" | "systemMaterial" | "systemThickMaterial" | "systemChromeMaterial" | "systemUltraThinMaterialLight" | "systemThinMaterialLight" | "systemMaterialLight" | "systemThickMaterialLight" | "systemChromeMaterialLight" | "systemUltraThinMaterialDark" | "systemThinMaterialDark" | "systemMaterialDark" | "systemThickMaterialDark" | "systemChromeMaterialDark";
/**
 * The part of the container's style that `expo-blur` 58 hands to the native blur view as well (`getNativeBlurViewRadiusStyle` of its `BlurView.tsx`): the corner radii, the curve
 * and `overflow: "hidden"`, so the blur is clipped to the container's corners. Undefined when the style has no radius.
 */
export declare function blurRadiusStyle(style: unknown): Record<string, unknown> | undefined;
/** The `borderRadii` prop of the native blur view on Android (`getAndroidBlurViewBorderRadii`): the horizontal and vertical radius of each corner, clockwise from the top left. */
export declare function androidBlurBorderRadii(radius: Record<string, unknown>): number[];
