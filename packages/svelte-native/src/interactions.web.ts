/** Browser-only entry: no React Native, RNGH, Reanimated or component imports. */
import { createInteractions } from "./interactions-core.ts";
export type { DragPoint, DragOptions, SwipeDirection, SwipeOptions } from "./interactions-core.ts";
export const { drag, draggable, swipe } = createInteractions();
