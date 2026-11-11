import { createSubscriber } from "svelte/reactivity";
import { Dimensions } from "./platform.ts";

// One listener on React Native's `Dimensions` for every reader: the first read inside an effect (a template, `$derived`, `$effect`) adds it,
// and the last of those effects to go removes it. A read outside an effect gets the current value and subscribes to nothing.
const subscribe = createSubscriber((update) => {
  const subscription = Dimensions.addEventListener("change", update);
  return () => subscription.remove();
});

type Metrics = { width: number; height: number; scale: number; fontScale: number };

function read(which: "window" | "screen"): Metrics {
  subscribe();
  return Dimensions.get(which) as Metrics;
}

/**
 * The window's size, reactive, like `colorScheme.current`: a template, `$derived` or `$effect` that reads it runs again when the window changes
 * (the device turns, a foldable opens, split screen, the font scale changes).
 *
 *   const wide = $derived(windowSize.width >= 768);
 *
 * `width` and `height` are the window's, in points (dp); `scale` is the pixel ratio, `fontScale` the system's text size, and `screen` the
 * whole screen's size. Svelte's own `innerWidth`, `innerHeight` and `devicePixelRatio` (`svelte/reactivity/window`) read the same values.
 */
export const windowSize = {
  get width(): number {
    return read("window").width;
  },
  get height(): number {
    return read("window").height;
  },
  get scale(): number {
    return read("window").scale;
  },
  get fontScale(): number {
    return read("window").fontScale;
  },
  get screen(): { width: number; height: number } {
    const { width, height } = read("screen");
    return { width, height };
  },
};
