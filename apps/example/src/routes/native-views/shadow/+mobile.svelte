<script lang="ts">
  import { Text, View } from "@alfayez/svelte-native";
  import { ShadowedView, shadowStyle } from "@alfayez/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // `ShadowedView` is react-native-fast-shadow: a View whose shadow is drawn the same on Android as on iOS, shaped by its corner radii. The
  // shadow is the style's `shadowColor`, `shadowOpacity`, `shadowRadius` and `shadowOffset`; `shadowStyle` writes them from one set of numbers
  // (a radius and offset as in design tools). Do not put `overflow: "hidden"` on it, that clips the shadow.
  let opacity = $state(0.35);
  const card = $derived({ alignItems: "center", justifyContent: "center", height: 96, borderRadius: 16, backgroundColor: theme.colors.surface } as const);

  // `?demo`: raise the shadow's opacity, drop it to almost nothing and bring it back.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => (opacity = 0.75), 1500],
    [() => (opacity = 0.15), 1500],
    [() => (opacity = 0.55), 1500],
    [() => (opacity = 0.35), 0],
  ]);
</script>

<Page title="Shadow" intro="ShadowedView draws a soft shadow around a box on both platforms. React Native's own shadow props only work on iOS; Android would need elevation.">
  <Section title="ShadowedView" note="The shadow is black, 14 pt blur, 6 pt down. Press the button to change its opacity.">
    <View style={{ flexDirection: "row", gap: 16, padding: 8 }}>
      <ShadowedView style={{ flex: 1, ...card, ...shadowStyle({ color: "#000000", opacity, radius: 14, offset: [0, 6] }) }}>
        <Text style={text.body}>Opacity {opacity.toFixed(2)}</Text>
      </ShadowedView>
      <View style={{ flex: 1, ...card, borderWidth: 1, borderColor: theme.colors.border }}>
        <Text style={text.body}>Plain View</Text>
      </View>
    </View>
    <Button label="Change opacity" variant="secondary" onPress={() => { opacity = opacity >= 0.75 ? 0.15 : opacity + 0.2; }} />
  </Section>
</Page>
