<script lang="ts">
  import { Text, View } from "@rasheed/svelte-native";
  import { flip } from "svelte/animate";
  import { fade, fly, scale, slide } from "svelte/transition";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // Svelte's own transitions and animations, written as on the web: `in:`, `out:`, `transition:` with `svelte/transition`, `animate:flip` in a keyed
  // `{#each}`. Svelte decides when they run and works out their frames; Svelte Native plays them on the UI thread, so a busy JavaScript thread does
  // not make them stutter: try "Busy for 1 s" while one runs.
  let shown = $state(true);
  let open = $state(false);
  let items = $state([1, 2, 3, 4, 5]);
  let next = 6;
  const colors = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6", "#f76b15"];
  const box = { padding: 16, borderRadius: 12, backgroundColor: theme.colors.accent };

  function busy() {
    const until = Date.now() + 1000;
    while (Date.now() < until) { /* the JavaScript thread does nothing else for a second */ }
  }
  function shuffle() { items = [...items].sort(() => Math.random() - 0.5); }
</script>

<Page title="Transitions" intro="Svelte's transitions and animate:flip, as on the web, played on the UI thread.">
  <Section title="in: and out:" note="fly in from below, fade out. Toggle it, then toggle it again before it finishes: it turns around from where it is.">
    <View style={{ height: 72 }}>
      {#if shown}
        <View testID="flying" in:fly={{ y: 40, duration: 500 }} out:fade={{ duration: 400 }} style={box}>
          <Text style={{ color: "#ffffff", fontWeight: "600" }}>in:fly, out:fade</Text>
        </View>
      {/if}
    </View>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label={shown ? "Hide" : "Show"} onPress={() => (shown = !shown)} />
      <Button label="Busy for 1 s" variant="secondary" onPress={busy} />
    </View>
  </Section>

  <Section title="slide and scale" note="transition:slide grows the height (a layout change each frame); transition:scale draws only.">
    <Button label={open ? "Close" : "Open"} onPress={() => (open = !open)} />
    {#if open}
      <View transition:slide={{ duration: 400 }} style={{ gap: 8 }}>
        <Text style={text.body}>The text under a slide moves with it.</Text>
        <View transition:scale={{ start: 0.6, duration: 400 }} style={box}>
          <Text style={{ color: "#ffffff" }}>scale</Text>
        </View>
      </View>
    {/if}
  </Section>

  <Section title="animate:flip" note="A keyed list: shuffle, add or remove, and each row moves to its new place.">
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label="Shuffle" onPress={shuffle} />
      <Button label="Add" variant="secondary" onPress={() => (items = [...items, next++])} />
      <Button label="Remove" variant="secondary" onPress={() => (items = items.slice(1))} />
    </View>
    <View style={{ gap: 6 }}>
      {#each items as item (item)}
        <View animate:flip={{ duration: 350 }} in:fade out:fade={{ duration: 200 }} style={{ padding: 12, borderRadius: 8, backgroundColor: colors[item % colors.length] }}>
          <Text style={{ color: "#ffffff", fontWeight: "600" }}>Row {item}</Text>
        </View>
      {/each}
    </View>
  </Section>
</Page>
