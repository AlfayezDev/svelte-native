<script lang="ts">
  import { untrack } from "svelte";
  import { flip } from "svelte/animate";
  import { fade, fly, slide } from "svelte/transition";
  import { times } from "./transition-checks.ts";

  /**
   * The lab's screen of transitions on HTML elements (`/__dev/transitions`, and the checks of the native checks lab, `transition-lab.ts`): written with HTML and classes alone, and Svelte's own `in:`, `out:`,
   * `transition:` and `animate:`, which the host plays on the UI thread. What it holds, and what the checks read of it:
   *  - a card that `in:fade`s in and `out:fly`s out when it is shown or hidden;
   *  - a keyed `<ul>` whose items `animate:flip` when the list is shuffled;
   *  - a panel with `transition:slide`, which is one transition both ways: hidden while it opens, it goes back from where it is.
   * `{@attach hold(name)}` keeps the element it is given, the renderer's node (`bind:this` gives a handle, which has no props), so the checks read what the host did to the node itself. Every class is written in full,
   * which is how Tailwind finds it. With `settled` the card and the panel are there from the start (a block that is there when its screen opens plays nothing), which is what the route shows: no animation runs
   * until something is pressed, so a parity reference is stable.
   */
  let { settled = false }: { settled?: boolean } = $props();
  const nodes: Record<string, unknown> = {};
  const hold = (name: string) => (element: unknown) => {
    nodes[name] = element;
    return () => { if (nodes[name] === element) delete nodes[name]; };
  };
  const events: string[] = [];
  /**
   * The events a transition announces, as the attributes of a spread: `onintroend={f}` written on an HTML element is a build warning ("never runs on a device"; the lowering does not list these
   * four events), although the host does call it, and a spread is not looked at.
   */
  const announce = (name: string) => ({ onintroend: () => { events.push(`${name} introend`); }, onoutroend: () => { events.push(`${name} outroend`); } });
  let shown = $state(untrack(() => settled));
  let open = $state(untrack(() => settled));
  let order = $state([1, 2, 3, 4]);

  /** The next order of the list: every item moves (a permutation with no fixed place, which stays one for as long as it is applied again). */
  const shuffled = (items: readonly number[]): number[] => [items[1] ?? 0, items[3] ?? 0, items[0] ?? 0, items[2] ?? 0];
  /** The renderer's node of an element of the screen, by name (the lab reads its animations, its props and its box). */
  export function node(wanted: string): unknown {
    return nodes[wanted];
  }
  /** What the transitions announced (`introend`, `outroend`), as `"fader introend"`, in order. */
  export function seen(): readonly string[] {
    return events;
  }
  /** The items of the list, in the order Svelte was last given. */
  export function items(): readonly number[] {
    return order;
  }
  export function setShown(value: boolean): void {
    shown = value;
  }
  export function setOpen(value: boolean): void {
    open = value;
  }
  export function shuffle(): void {
    order = shuffled(order);
  }
</script>

<div class="gap-4">
  <div class="gap-2">
    <button type="button" onclick={() => { shown = !shown; }} class="items-center rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white">{shown ? "Hide the card" : "Show the card"}</button>
    {#if shown}
      <div
        {@attach hold("fader")}
        in:fade={{ duration: times.fade }}
        out:fly={{ y: 40, duration: times.fly }}
        {...announce("fader")}
        class="rounded-xl border border-sky-200 bg-sky-50 p-4 text-base text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
      >Fades in and flies out.</div>
    {/if}
  </div>

  <div class="gap-2">
    <button type="button" onclick={shuffle} class="items-center rounded-xl bg-sky-600 px-4 py-3 text-base font-semibold text-white">Shuffle the list</button>
    <ul class="gap-2">
      {#each order as item (item)}
        <li {@attach hold(`item-${item}`)} animate:flip={{ duration: times.flip }} class="rounded-xl bg-zinc-200 px-4 py-3 text-base text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">Item {item}</li>
      {/each}
    </ul>
  </div>

  <div class="gap-2">
    <button type="button" onclick={() => { open = !open; }} class="items-center rounded-xl bg-zinc-200 px-4 py-3 text-base text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">{open ? "Close the panel" : "Open the panel"}</button>
    {#if open}
      <div
        {@attach hold("panel")}
        transition:slide={{ duration: times.slide }}
        {...announce("panel")}
        class="rounded-xl border border-zinc-300 p-4 text-base text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
      >Slides open and closed, one transition both ways.</div>
    {/if}
  </div>
</div>
