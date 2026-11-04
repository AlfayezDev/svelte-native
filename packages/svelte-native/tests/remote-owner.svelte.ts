import { flushSync } from "svelte";

// Runs `make` inside an effect root, as a component's script does, and says when to tear it down.
export function inOwner<T>(make: () => T): { value: T; destroy(): void } {
  let value!: T;
  const destroy = $effect.root(() => { value = make(); });
  return { value, destroy };
}

// A component-level `$derived` that makes a query object; the first reader is inside a branch that goes away, and a second reader reads it later.
export function sharedDerived(make: () => { readonly current: unknown }) {
  let show = $state(true);
  let second = $state(false);
  const out: { first?: unknown; second?: unknown; error?: string } = {};
  const destroy = $effect.root(() => {
    const shared = $derived(make());
    $effect(() => {
      if (show) {
        $effect(() => { out.first = shared.current; });
      }
    });
    $effect(() => {
      if (second) {
        try { out.second = shared.current; } catch (error) { out.error = (error as Error).message; }
      }
    });
  });
  return {
    out,
    hideFirst() { show = false; flushSync(); },
    readSecond() { second = true; flushSync(); },
    destroy,
  };
}
