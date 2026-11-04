import { releaseNow } from "./environment.ts";

/**
 * Ties a query object to the effect that is running. SvelteKit's query cache frees an entry (and closes a live query's stream) when the last query
 * object that uses it is collected; where the engine collects late, or has no way to tell (`environment.ts`), the entry is freed when the effect that
 * made the object is torn down instead: a component that is destroyed, or an expression that runs again for another argument. Outside an effect (an event
 * handler, a store) nothing owns the object, and collection decides, as on the web. Returns `proxy`.
 */
export function releaseWithOwner<T extends object>(proxy: T): T {
  try {
    $effect.pre(() => () => { releaseNow(proxy); });
  } catch {
    // No effect to own it.
  }
  return proxy;
}
