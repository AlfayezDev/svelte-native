import { createSubscriber } from "svelte/reactivity";
import { Appearance } from "./platform.ts";

// One listener on the system's appearance for every reader: the first read inside an effect (a template, `$derived`, `$effect`) adds it,
// and the last of those effects to go removes it.
const subscribe = createSubscriber((update) => {
  const subscription = Appearance.addChangeListener(update);
  return () => subscription.remove();
});

/**
 * The system's light or dark mode, reactive like Svelte's `prefersReducedMotion`: a template, `$derived` or `$effect` that reads
 * `colorScheme.current` runs again when the user switches. A system that reports no scheme counts as light, as React Native's views do.
 * `Appearance.setColorScheme` (`@alfayez/svelte-native/platform`) overrides it for the app.
 */
export const colorScheme = {
  get current(): "light" | "dark" {
    subscribe();
    return Appearance.getColorScheme() === "dark" ? "dark" : "light";
  },
};
