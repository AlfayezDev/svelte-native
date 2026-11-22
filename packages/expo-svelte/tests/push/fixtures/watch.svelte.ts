import { flushSync } from "svelte";
import { push } from "../../../src/push/push.svelte.ts";

/** What an effect that reads `push.permission` and `push.token` sees: both, each time either changes. */
export function watch(): { seen: string[]; stop(): void } {
  const seen: string[] = [];
  const stop = $effect.root(() => {
    $effect(() => { seen.push(`${push.permission} ${push.token?.token ?? "-"}`); });
  });
  flushSync();
  return { seen, stop };
}
