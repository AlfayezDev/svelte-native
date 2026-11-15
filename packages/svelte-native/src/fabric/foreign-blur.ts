/**
 * The tints of the library's own `BlurView` (`SvelteBlur` on Android and iOS, `native/svelte-core`). They are the names `expo-blur` takes, so a screen can move from
 * one to the other. iOS maps each to a `UIBlurEffect` style; Android has no such materials and draws a translucent white or black over the blur: white for `light`,
 * `extraLight` and the `...Light` names, black for `dark` and the `...Dark` names, and for every other name white by day and black at night.
 */
export type BlurTint =
  | "default"
  | "extraLight"
  | "light"
  | "dark"
  | "regular"
  | "prominent"
  | "systemUltraThinMaterial"
  | "systemThinMaterial"
  | "systemMaterial"
  | "systemThickMaterial"
  | "systemChromeMaterial"
  | "systemUltraThinMaterialLight"
  | "systemThinMaterialLight"
  | "systemMaterialLight"
  | "systemThickMaterialLight"
  | "systemChromeMaterialLight"
  | "systemUltraThinMaterialDark"
  | "systemThinMaterialDark"
  | "systemMaterialDark"
  | "systemThickMaterialDark"
  | "systemChromeMaterialDark";
