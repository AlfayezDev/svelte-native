<script lang="ts">
  import { Pressable, Text, View } from "@example/svelte-native";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // There is no CSS and there are no classes: a style is a plain object with React Native's style keys (camelCase, numbers in density-independent
  // pixels). Because a style is a value you can keep it in a constant, return it from `$derived` so it follows the theme, and combine
  // several in an array: later ones win, and `false` is skipped. Colours come from src/lib/theme.svelte.ts, which follows the system's dark mode.
  let selected = $state(false);
  const card = $derived({ padding: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface });
  const swatches = $derived(Object.entries(theme.colors));
</script>

<Page title="Styling" intro="A style is an object. Keep it in a constant, compute it from state, or combine several in an array. The colours here follow the system's light and dark mode.">
  <Section title="A style object" note="The whole style of this box is the object written on the view.">
    <View style={{ padding: 20, borderRadius: 24, borderWidth: 3, borderColor: theme.colors.accent, backgroundColor: theme.colors.background, alignItems: "center" }}>
      <Text style={text.heading}>padding, borderRadius, borderWidth</Text>
    </View>
  </Section>

  <Section title="Combining styles" note="Tap the card. The array is the card's style, plus an object that applies only while it is selected.">
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => (selected = !selected)} style={[card, selected && { borderColor: theme.colors.accent, borderWidth: 3 }]}>
      <Text style={text.body}>{selected ? "Selected" : "Not selected"}</Text>
    </Pressable>
  </Section>

  <Section title="Theme colours" note={`Now in ${theme.dark ? "dark" : "light"} mode. Change the system's appearance and these swatches change with it.`}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
      {#each swatches as [name, color] (name)}
        <View style={{ alignItems: "center", gap: 4 }}>
          <View style={{ width: 56, height: 56, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: color }} />
          <Text style={[text.caption, { fontSize: 12 }]}>{name}</Text>
        </View>
      {/each}
    </View>
  </Section>

  <Section title="Shadow" note="iOS draws a shadow from the shadow keys, Android from elevation: set both.">
    <View style={[card, { shadowColor: "#000000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 6 }]}>
      <Text style={text.body}>A raised card</Text>
    </View>
  </Section>

  <Section title="Transform and opacity" note="Rotate, scale and move a view without changing its layout.">
    <View style={{ flexDirection: "row", gap: 24, paddingVertical: 12 }}>
      <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: theme.colors.accent, transform: [{ rotate: "15deg" }] }} />
      <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: theme.colors.accent, transform: [{ scale: 1.25 }] }} />
      <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: theme.colors.accent, opacity: 0.4 }} />
    </View>
  </Section>
</Page>
