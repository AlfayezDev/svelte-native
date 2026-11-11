<script lang="ts">
  import { flip } from "svelte/animate";
  import { fade, fly, scale, slide } from "svelte/transition";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";

  // Svelte's own transitions and animations, written as on the web: `in:`, `out:`, `transition:` with `svelte/transition`, `animate:flip` in a keyed
  // `{#each}`, on HTML elements (the build turns them into native views, texts and pressables). Svelte decides when they run and works out their frames;
  // Svelte Native plays them on the UI thread, so a busy JavaScript thread does not make them stutter: try "Busy for 1 s" while one runs.
  let shown = $state(true);
  let open = $state(false);
  let items = $state([1, 2, 3, 4, 5]);
  let next = 6;
  const colors = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6", "#f76b15"];

  function busy() {
    const until = Date.now() + 1000;
    while (Date.now() < until) { /* the JavaScript thread does nothing else for a second */ }
  }
  function shuffle() { items = [...items].sort(() => Math.random() - 0.5); }
</script>

<Page title="Transitions" intro="Svelte's transitions and animate:flip, as on the web, played on the UI thread.">
  <Section title="in: and out:" note="fly in from below, fade out. Toggle it, then toggle it again before it finishes: it turns around from where it is.">
    <div class="h-[72px]">
      {#if shown}
        <div in:fly={{ y: 40, duration: 500 }} out:fade={{ duration: 400 }} class="rounded-xl bg-red-600 p-4">
          <p class="font-semibold text-white">in:fly, out:fade</p>
        </div>
      {/if}
    </div>
    <div class="flex-row gap-2">
      <button onclick={() => (shown = !shown)} class="min-h-12 items-center justify-center rounded-xl bg-red-600 px-4 text-base font-semibold text-white">{shown ? "Hide" : "Show"}</button>
      <button onclick={busy} class="min-h-12 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">Busy for 1 s</button>
    </div>
  </Section>

  <Section title="slide and scale" note="transition:slide grows the height (a layout change each frame); transition:scale draws only.">
    <button onclick={() => (open = !open)} class="min-h-12 items-center justify-center rounded-xl bg-red-600 px-4 text-base font-semibold text-white">{open ? "Close" : "Open"}</button>
    {#if open}
      <div transition:slide={{ duration: 400 }} class="gap-2">
        <p class="text-base text-zinc-900 dark:text-zinc-100">The text under a slide moves with it.</p>
        <div transition:scale={{ start: 0.6, duration: 400 }} class="rounded-xl bg-red-600 p-4">
          <p class="text-white">scale</p>
        </div>
      </div>
    {/if}
  </Section>

  <Section title="animate:flip" note="A keyed list: shuffle, add or remove, and each row moves to its new place.">
    <div class="flex-row gap-2">
      <button onclick={shuffle} class="min-h-12 items-center justify-center rounded-xl bg-red-600 px-4 text-base font-semibold text-white">Shuffle</button>
      <button onclick={() => (items = [...items, next++])} class="min-h-12 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">Add</button>
      <button onclick={() => (items = items.slice(1))} class="min-h-12 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-base font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">Remove</button>
    </div>
    <ul class="gap-[6px]">
      {#each items as item (item)}
        <li animate:flip={{ duration: 350 }} in:fade out:fade={{ duration: 200 }} class="rounded-lg p-3" style:background-color={colors[item % colors.length]}>
          <p class="font-semibold text-white">Row {item}</p>
        </li>
      {/each}
    </ul>
  </Section>
</Page>
