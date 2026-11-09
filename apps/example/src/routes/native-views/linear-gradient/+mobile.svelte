<script lang="ts">
  import { Text, View } from "@example/svelte-native";
  import { LinearGradient } from "@example/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text } from "#lib/theme.svelte.ts";

  // `LinearGradient` is expo-linear-gradient's native view. `colors` is a list of any colours React Native takes, `start` and `end` are points
  // as fractions of the box (`{ x: 0, y: 0 }` is the top left), `locations` places each colour along the line. Children are drawn on top.
  const palettes = [
    ["#ff7a18", "#af002d", "#319197"],
    ["#0091ff", "#8e4ec6", "#e5484d"],
    ["#30a46c", "#f5d90a", "#ff7a18"],
  ];
  let index = $state(0);
  const colors = $derived(palettes[index] ?? []);
</script>

<Page title="Linear gradient" intro="LinearGradient fills a box with a colour ramp. The box can hold children, so a card with a gradient background is one component.">
  <Section title="Diagonal, with children" note="Press the button to change the colours.">
    <LinearGradient {colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ height: 120, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "600" }}>Gradient</Text>
    </LinearGradient>
    <Button label="Next colours" variant="secondary" onPress={() => { index = (index + 1) % palettes.length; }} />
  </Section>

  <Section title="Direction and locations" note="Left: top to bottom. Right: left to right, with the middle colour held until 80 % of the way.">
    <View style={{ flexDirection: "row", gap: 12 }}>
      <LinearGradient {colors} start={[0, 0]} end={[0, 1]} style={{ flex: 1, height: 80, borderRadius: 12 }} />
      <LinearGradient {colors} locations={[0, 0.8, 1]} start={[0, 0]} end={[1, 0]} style={{ flex: 1, height: 80, borderRadius: 12 }} />
    </View>
    <Text style={text.caption}>start and end also take [x, y] arrays.</Text>
  </Section>
</Page>
