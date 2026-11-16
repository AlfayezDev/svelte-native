import { flushSync } from "svelte";
import { MediaQuery } from "svelte/reactivity";

/** What an effect that reads `new MediaQuery(query).current` sees: the value, each time it changes. */
export function watch(query: string): { media: MediaQuery; seen: boolean[]; stop(): void } {
  const media = new MediaQuery(query);
  const seen: boolean[] = [];
  const stop = $effect.root(() => {
    $effect(() => { seen.push(media.current); });
  });
  flushSync();
  return { media, seen, stop };
}
