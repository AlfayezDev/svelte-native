/** Native JS-thread actions and attachments. Use the /interactions subpath for portable imports. */
import { createInteractions } from "./interactions-core.ts";
export type { DragPoint, DragOptions, SwipeDirection, SwipeOptions } from "./interactions-core.ts";

export const { drag, draggable, swipe } = createInteractions(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native builders load only for a native target
  const { Gesture } = require("./gestures/index.ts") as typeof import("./gestures/index.ts");
  return Gesture.Pan();
});
