<script lang="ts">
  import { Text, View } from "expo-svelte";
  import { ExpoImage } from "expo-svelte/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";
  import sample from "../../../../assets/images/sample.png";

  // `ExpoImage` is expo-image's native view with that package's props: `source` (a bundled asset here, or a URL), `contentFit`, `placeholder`
  // (a blurhash), `transition` and `cachePolicy`. The library's own `Image` is the lighter choice for plain pictures; this one adds the
  // placeholder, the fade and the disk cache.
  const fits = ["cover", "contain", "fill", "scale-down"] as const;
  let attempt = $state(0);
  let loaded = $state("");
  const again = () => { loaded = ""; attempt += 1; };

  // `?demo`: scroll to the placeholder example and load the picture twice: the blurhash shows, then the picture fades in.
  let { url }: { url: URL } = $props();
  const view = scroller();
  useDemo(() => url, [
    [() => view.glide(220, 900), 600],
    [again, 2200],
    [again, 2200],
    [() => view.glide(0, 800), 0],
  ]);
</script>

<Page title="Image" scrollRef={view.ref} intro="ExpoImage shows a picture with expo-image's native view. It fits the picture into its box, can show a blurred placeholder while the picture loads, and fades the picture in.">
  <Section title="contentFit" note="The same 96 x 64 picture in four 80 pt boxes.">
    <View style={{ flexDirection: "row", gap: 8 }}>
      {#each fits as fit (fit)}
        <View style={{ flex: 1, gap: 4 }}>
          <ExpoImage source={sample} contentFit={fit} accessibilityLabel={`Sample picture, ${fit}`} style={{ height: 80, borderRadius: 8, backgroundColor: theme.colors.border }} />
          <Text style={text.caption}>{fit}</Text>
        </View>
      {/each}
    </View>
  </Section>

  <Section title="Placeholder and transition" note="A blurhash shows first, then the picture fades in over 600 ms. cachePolicy is none so it loads again each time.">
    {#key attempt}
      <ExpoImage
        source={sample}
        placeholder="blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj/32/32"
        transition={600}
        cachePolicy="none"
        accessibilityLabel="Sample picture with a placeholder"
        onLoad={(event) => { loaded = `${event.source.width} x ${event.source.height}, loaded from ${event.cacheType}`; }}
        style={{ height: 120, borderRadius: 8 }}
      />
    {/key}
    <Text style={text.caption}>{loaded || "Loading"}</Text>
    <Button label="Load again" variant="secondary" onPress={again} />
  </Section>
</Page>
