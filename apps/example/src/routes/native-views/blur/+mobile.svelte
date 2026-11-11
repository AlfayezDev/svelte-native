<script lang="ts">
  import { Text, View } from "@example/svelte-native";
  import { BlurView, ExpoImage } from "@example/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text } from "#lib/theme.svelte.ts";
  import photo from "../../../../assets/images/photo.png";

  // `BlurView` is Svelte Native's own: it blurs whatever is behind it on the screen, with no other package and nothing to point it at.
  // `intensity` goes from 0 to 100 and `tint` sets the frost (`"light"`, `"dark"`, or `"default"`, which follows dark mode). Its children
  // are drawn sharp, on top. (expo-blur's view is `ExpoBlurView`, if you need its props.)
  const stripes = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff", "#8e4ec6"];
  const fill = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;
  let intensity = $state(60);
</script>

<Page title="Blur" intro="BlurView blurs the content behind it. Change the intensity with the buttons and watch the stripes behind the card.">
  <Section title="BlurView" note="The stripes are ordinary views; the card on top is the BlurView.">
    <View testID="blur-stage" style={{ height: 140, borderRadius: 12, overflow: "hidden" }}>
      <View style={{ ...fill, flexDirection: "row" }}>
        {#each stripes as color (color)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
      </View>
      <BlurView
        {intensity}
        tint="light"
        style={{ position: "absolute", left: 24, right: 24, top: 24, bottom: 24, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ color: "#191b1e", fontSize: 16, fontWeight: "600" }}>Intensity {intensity}</Text>
      </BlurView>
    </View>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Button label="Less" variant="secondary" onPress={() => { intensity = Math.max(0, intensity - 20); }} />
      <Button label="More" variant="secondary" onPress={() => { intensity = Math.min(100, intensity + 20); }} />
    </View>
    <Text style={text.caption}>On Android 12 and later the blur is real; earlier versions draw the tint only.</Text>
  </Section>

  <Section title="Over a photo" note="A frosted caption over an image: the photo behind the bar is blurred, the text on it is sharp.">
    <View testID="blur-photo" style={{ height: 180, borderRadius: 12, overflow: "hidden" }}>
      <ExpoImage source={photo} contentFit="cover" accessibilityLabel="A photo behind a blur" style={fill} />
      <BlurView intensity={70} tint="dark" style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 12, paddingHorizontal: 16 }}>
        <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "600" }}>A frosted caption</Text>
      </BlurView>
    </View>
  </Section>
</Page>
