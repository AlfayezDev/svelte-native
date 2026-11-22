import { flushSync } from "svelte";
import { prefersReducedMotion } from "svelte/motion";

/** What a component that reads `prefersReducedMotion.current` in an effect sees: the value, each time it changes. */
export function watch(): { seen: boolean[]; stop(): void } {
  const seen: boolean[] = [];
  const stop = $effect.root(() => {
    $effect(() => { seen.push(prefersReducedMotion.current); });
  });
  flushSync();
  return { seen, stop };
}
