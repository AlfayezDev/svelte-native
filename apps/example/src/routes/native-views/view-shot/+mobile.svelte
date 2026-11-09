<script lang="ts">
  import { Image, Text, View } from "@rasheed/svelte-native";
  import { ViewShot } from "@rasheed/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // `ViewShot` is react-native-view-shot: a View that can draw itself into an image. `ref` gives `capture()`, which answers where the image
  // is; `options.result` chooses a file (`tmpfile`, the default), `base64` or a `data-uri`, which an `Image` shows as it is. `captureRef(handle)`
  // does the same for any view that has a `ref`.
  const stripes = ["#e5484d", "#f5d90a", "#30a46c", "#0091ff"];
  let shot: { capture(): Promise<string> } | null = null;
  let picture = $state<string | null>(null);
  let failed = $state("");
  async function capture() {
    failed = "";
    try { picture = (await shot?.capture()) ?? null; }
    catch (error) { failed = String(error); }
  }
</script>

<Page title="View capture" intro="ViewShot turns a view into a picture. Press the button and the stripes below are drawn into an image, shown next to them.">
  <Section title="capture()">
    <View style={{ flexDirection: "row", gap: 16, alignItems: "center", justifyContent: "space-around" }}>
      <ViewShot ref={(handle) => { shot = handle; }} options={{ format: "png", result: "data-uri" }} style={{ width: 120, height: 80, flexDirection: "row", borderRadius: 16, overflow: "hidden" }}>
        {#each stripes as color (color)}<View style={{ flex: 1, backgroundColor: color }} />{/each}
      </ViewShot>
      {#if picture}
        <Image source={{ uri: picture }} accessibilityLabel="The captured picture" style={{ width: 120, height: 80, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border }} />
      {:else}
        <View style={{ width: 120, height: 80, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center" }}>
          <Text style={text.caption}>No picture yet</Text>
        </View>
      {/if}
    </View>
    <Button label="Capture" onPress={capture} />
    {#if failed}<Text accessibilityRole="alert" style={[text.caption, { color: theme.colors.danger }]}>{failed}</Text>{/if}
  </Section>
</Page>
