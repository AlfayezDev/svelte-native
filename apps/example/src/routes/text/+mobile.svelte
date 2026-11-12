<script lang="ts">
  import { Text } from "@example/svelte-native";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";
  import { Platform } from "@example/svelte-native/platform";

  // Everything about text: size, weight, style, truncation, inline spans and fonts. Text takes the usual React Native text style keys.
  // A font is chosen by name with `fontFamily`: the system's own (their names differ per platform) or one bundled with the app. This app
  // embeds JetBrains Mono through the `expo-font` plugin in app.config.ts, so its name works as it is, with no loading code.
  const ios = Platform.OS === "ios";
  const longText = "Text wraps to the width of its box. Give it numberOfLines and it ends with an ellipsis instead, which is what a list row wants.";
  let link = $state("A link is a Text with onPress. Tap it.");
  // A Text inside a Text takes its own presses: the sentence around it does not.
  let taps = $state(0);
  let held = $state(false);
  // A style is a value: `base` is the style every line below starts from, and an array adds to it.
  const base = $derived({ color: theme.colors.text, fontSize: 18 });

  // `?demo`: scroll to the inline spans, follow the link and hold the span link down, then on to the long text and the fonts.
  let { url }: { url: URL } = $props();
  const view = scroller();
  useDemo(() => url, [
    [() => view.glide(420, 1400), 400],
    [() => (link = "Followed."), 1000],
    [() => (held = true), 800],
    [() => { held = false; taps += 1; }, 1000],
    [() => view.glide(900, 1400), 1200],
    [() => { link = "A link is a Text with onPress. Tap it."; taps = 0; return view.glide(0, 1000); }, 0],
  ]);
</script>

<Page title="Text and fonts" scrollRef={view.ref} intro="Text is where every word on screen lives. Its style decides the size, weight and font, and numberOfLines decides how much of it to show.">
  <Section title="Size, weight and style">
    <Text style={[base, { fontSize: 12 }]}>Size 12</Text>
    <Text style={base}>Size 18</Text>
    <Text style={[base, { fontSize: 28 }]}>Size 28</Text>
    <Text style={[base, { fontWeight: "800" }]}>Weight 800</Text>
    <Text style={[base, { fontStyle: "italic" }]}>Italic</Text>
    <Text style={[base, { textDecorationLine: "underline" }]}>Underlined</Text>
    <Text style={[base, { letterSpacing: 4, textTransform: "uppercase" }]}>Spaced capitals</Text>
    <Text style={[base, { textAlign: "center" }]}>Centered in its box</Text>
  </Section>

  <Section title="Inline spans" note="A Text inside a Text changes the style of part of a sentence. With onPress it becomes a link that takes its own presses, and the rest of the sentence takes none.">
    <Text style={text.body}>
      Colour a <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>few words</Text>, or make
      <Text style={{ textDecorationLine: "line-through" }}>a mistake</Text> visible.
    </Text>
    <Text style={text.body} testID="outer-link" onPress={() => (link = "Followed.")}>
      <Text style={{ color: theme.colors.accent, textDecorationLine: "underline" }}>{link}</Text>
    </Text>
    <Text style={text.body} testID="span-link-sentence">
      Read the <Text
        role="link"
        style={{ color: held ? theme.colors.danger : theme.colors.accent, textDecorationLine: "underline" }}
        onPress={() => (taps += 1)}
        onPressChange={(pressed) => (held = pressed)}>terms of use</Text> before you go: {held ? "holding the link" : taps === 0 ? "not tapped yet" : `tapped ${taps} ${taps === 1 ? "time" : "times"}`}.
    </Text>
  </Section>

  <Section title="Long text" note="The same sentence twice: all of it, then cut to two lines.">
    <Text style={text.body}>{longText}</Text>
    <Text style={text.body} numberOfLines={2} ellipsizeMode="tail">{longText}</Text>
  </Section>

  <Section title="Fonts" note="The system's sans-serif is the default. Names for the other system families differ per platform.">
    <Text style={base}>System sans-serif (the default)</Text>
    <Text style={[base, { fontFamily: ios ? "Georgia" : "serif" }]}>System serif</Text>
    <Text style={[base, { fontFamily: ios ? "Menlo" : "monospace" }]}>System monospace</Text>
    <Text style={[base, { fontFamily: "JetBrainsMono-Regular" }]}>JetBrains Mono, bundled with the app</Text>
  </Section>
</Page>
