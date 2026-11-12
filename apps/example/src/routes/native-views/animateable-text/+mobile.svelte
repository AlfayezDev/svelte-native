<script lang="ts">
  import { View } from "@rasheed/svelte-native";
  import { createSharedValue, withTiming } from "@rasheed/svelte-native/animation";
  import { AnimateableText } from "@rasheed/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { theme } from "#lib/theme.svelte.ts";

  // `AnimateableText` is react-native-animateable-text: a text whose string a worklet can set on the UI thread. `animatedProps` returns `{ text }`
  // from shared values, so the number changes every frame without the JavaScript thread. `text` is only what shows before the first frame.
  // Runes mode, which the library compiles every component in by default, keeps `count` a plain constant. In legacy mode Svelte would make it state, because the buttons below mutate it, and a worklet cannot read state.
  const count = createSharedValue(0); // first: it loads Reanimated, so the worklet below captures the real functions
  const countText = () => { "worklet"; return { text: String(Math.round(count.value)) }; };

  // `?demo`: count up to 1000 and back to zero.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => { count.value = withTiming(1000, { duration: 3000 }); }, 3600],
    [() => { count.value = withTiming(0, { duration: 900 }); }, 1000],
  ], { hold: 800 });
</script>

<Page title="Animateable text" intro="AnimateableText counts without JavaScript. The number is a shared value; a worklet turns it into the text on every frame, on the UI thread.">
  <Section title="A counter" note="Count to 1000 in three seconds, or back to zero.">
    <View style={{ alignItems: "center", paddingVertical: 12 }}>
      <AnimateableText text="0" animatedProps={countText} accessibilityLabel="Counter" style={{ color: theme.colors.text, fontSize: 48, fontWeight: "700" }} />
    </View>
    <Button label="Count up" onPress={() => { count.value = withTiming(1000, { duration: 3000 }); }} />
    <Button label="Back to zero" variant="secondary" onPress={() => { count.value = withTiming(0, { duration: 600 }); }} />
  </Section>
</Page>
