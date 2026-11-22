<script lang="ts">
  import { Text, View } from "expo-svelte";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo, scroller } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // Layout is flexbox, computed by Yoga, the engine React Native uses. A View lays its children out in a column by default; flexDirection,
  // justifyContent, alignItems, flexWrap, gap and flex are the same as in CSS, with a few differences (no units, everything is flex, the
  // default direction is a column). Positions are relative to the parent unless a view is `position: "absolute"`.
  const options = ["flex-start", "center", "flex-end", "space-between", "space-around"] as const;
  let justify = $state<(typeof options)[number]>("flex-start");
  const box = $derived({ width: 40, height: 40, borderRadius: 8, backgroundColor: theme.colors.accent });
  const track = $derived({ borderRadius: 8, backgroundColor: theme.colors.border });

  // `?demo`: walk through the values of justifyContent, then scroll down to the other examples and back.
  let { url }: { url: URL } = $props();
  const scroll = scroller();
  useDemo(() => url, [
    [() => (justify = "center")],
    [() => (justify = "flex-end")],
    [() => (justify = "space-between")],
    [() => (justify = "space-around")],
    [() => (justify = "flex-start")],
    [() => scroll.glide(760, 2000), 800],
    [() => scroll.glide(0, 1500), 0],
  ], { hold: 1200 });
</script>

<Page title="Layout" scrollRef={scroll.ref} intro="Boxes are placed by flexbox. Pick a value below and watch the boxes move: the layout is recomputed natively, and the views are not rebuilt.">
  <Section title="Column and row" note="A column stacks its children, a row puts them side by side.">
    <View style={{ flexDirection: "row", gap: 32 }}>
      <View style={{ gap: 8 }}>
        <Text style={text.caption}>column</Text>
        <View style={{ gap: 8 }}><View style={box} /><View style={box} /><View style={box} /></View>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={text.caption}>row</Text>
        <View style={{ flexDirection: "row", gap: 8 }}><View style={box} /><View style={box} /><View style={box} /></View>
      </View>
    </View>
  </Section>

  <Section title="justifyContent" note="Places the children along the main axis, here the row.">
    <View style={[track, { flexDirection: "row", justifyContent: justify, padding: 8 }]}>
      <View style={box} /><View style={box} /><View style={box} />
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {#each options as option (option)}
        <Button label={option} variant={justify === option ? "primary" : "secondary"} onPress={() => (justify = option)} />
      {/each}
    </View>
  </Section>

  <Section title="alignItems" note="Places the children across the main axis. Boxes of different heights, centered.">
    <View style={[track, { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }]}>
      <View style={[box, { height: 24 }]} /><View style={[box, { height: 56 }]} /><View style={[box, { height: 40 }]} />
    </View>
  </Section>

  <Section title="flexWrap and gap" note="Children that do not fit move to the next line, and gap spaces them.">
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as value (value)}
        <View style={[box, { width: 56 }]} />
      {/each}
    </View>
  </Section>

  <Section title="flex" note="Free space is shared in proportion: 1, 2 and 1.">
    <View style={{ flexDirection: "row", gap: 8, height: 40 }}>
      <View style={[track, { flex: 1 }]} /><View style={[track, { flex: 2, backgroundColor: theme.colors.accent }]} /><View style={[track, { flex: 1 }]} />
    </View>
  </Section>

  <Section title="Absolute position" note="An absolute view leaves the flow and sits at a distance from the edges of its parent.">
    <View style={[track, { height: 96 }]}>
      <View style={[box, { position: "absolute", top: 8, left: 8 }]} />
      <View style={[box, { position: "absolute", bottom: 8, right: 8, backgroundColor: theme.colors.text }]} />
    </View>
  </Section>
</Page>
