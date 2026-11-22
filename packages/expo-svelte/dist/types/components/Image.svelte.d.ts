import type { ClassProps } from "../classes.js";
import type { ImageProps } from "react-native";
import type { GestureProps } from "../gestures/types.js";
type $$ComponentProps = ImageProps & GestureProps & ClassProps;
declare const Image: import("svelte").Component<$$ComponentProps, {}, "">;
type Image = ReturnType<typeof Image>;
export default Image;
