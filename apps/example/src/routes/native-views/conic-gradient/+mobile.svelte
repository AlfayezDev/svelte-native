<script lang="ts">
  import { Text } from "@rasheed/svelte-native";
  import { ConicGradient } from "@rasheed/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";

  // `ConicGradient` is expo-conic-gradient's native view: the colours sweep around `center` (fractions of the box). `locations` are fractions
  // of the turn, one per colour, and `angle` rotates the start (0 is the top). The gradient fills a box that holds the style and the children;
  // round its corners with `borderRadius` and `overflow: "hidden"`.
  let angle = $state(0);
  const wheel = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6", "#e5484d"];
</script>

<Page title="Conic gradient" intro="ConicGradient sweeps colours around a centre, like a colour wheel or a progress ring. Its angle moves where the sweep starts.">
  <Section title="Colour wheel" note="Each press turns the start by 45 degrees.">
    <ConicGradient colors={wheel} locations={[0, 0.2, 0.4, 0.6, 0.8, 1]} center={[0.5, 0.5]} {angle} style={{ width: 160, height: 160, alignSelf: "center", borderRadius: 80, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "600" }}>{angle} degrees</Text>
    </ConicGradient>
    <Button label="Turn" variant="secondary" onPress={() => { angle = (angle + 45) % 360; }} />
  </Section>
</Page>
