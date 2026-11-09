<script lang="ts">
  import { Text, View } from "@rasheed/svelte-native";
  import { BlurTargetView, BlurView } from "@rasheed/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text } from "#lib/theme.svelte.ts";

  // `BlurView` is expo-blur's native view. On iOS it blurs whatever is behind it. On Android the real blur draws what a `BlurTargetView` holds:
  // put the content to blur in the target and give the target's `ref` handle to `blurTarget`. Without a target (`blurMethod` "none", the
  // default) Android draws a plain tint. `intensity` goes from 1 to 100.
  const stripes = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6"];
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
  let target = $state<{ tag: number } | null>(null);
  let intensity = $state(60);
</script>

<Page title="Blur" intro="BlurView blurs the content behind it. Change the intensity with the buttons and watch the stripes behind the card.">
  <Section title="BlurView" note="The stripes are in a BlurTargetView; the card on top is the BlurView.">
    <View style={{ height: 140, borderRadius: 12, overflow: "hidden" }}>
      <BlurTargetView ref={(handle) => { target = handle as { tag: number } | null; }} style={{ ...fill, flexDirection: "row" }}>
        {#each stripes as color (color)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
      </BlurTargetView>
      <BlurView
        blurTarget={target}
        blurMethod="dimezisBlurView"
        {intensity}
        tint="light"
        style={{ position: "absolute", left: 24, right: 24, top: 24, bottom: 24, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ color: "#191b1e", fontSize: 16, fontWeight: "600" }}>Intensity {intensity}</Text>
      </BlurView>
    </View>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label="Less" variant="secondary" onPress={() => { intensity = Math.max(10, intensity - 20); }} />
      <Button label="More" variant="secondary" onPress={() => { intensity = Math.min(100, intensity + 20); }} />
    </View>
    <Text style={text.caption}>The view behind a BlurView draws and lays out as usual, but the views inside a BlurTargetView take no touches.</Text>
  </Section>
</Page>
