<script lang="ts">
  import { Pressable, Text, View } from "@example/svelte-native";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";

  // `class` takes Tailwind's utilities and the classes of src/global.css. Svelte Native compiles them to React Native styles when Metro builds
  // the app, and `dark:` follows the system's appearance. `class` takes what it takes on a DOM element in Svelte: a string, an array
  // or an object, so a class can depend on state. An inline `style` still wins over the classes.
  let selected = $state(false);
</script>

<Page title="Classes" intro="Tailwind classes, compiled to native styles when Metro starts. dark: follows the system's appearance; your own classes come from src/global.css.">
  <Section title="Utilities" note="Padding, rounded corners, a border and a background, all from classes.">
    <View class="items-center rounded-3xl border-2 border-sky-500 bg-sky-50 p-5 dark:bg-sky-950">
      <Text class="text-lg font-semibold text-sky-900 dark:text-sky-100">p-5 rounded-3xl border-2</Text>
    </View>
  </Section>

  <Section title="Classes from state" note="Tap the card: an array of classes, one of which applies only while it is selected.">
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={() => (selected = !selected)} class={["card", selected && "border-4 border-emerald-500"]}>
      <Text class="text-base text-zinc-900 dark:text-zinc-100">{selected ? "Selected" : "Not selected"}</Text>
    </Pressable>
  </Section>

  <Section title="Layout" note="Flexbox from classes: a row with gaps, and boxes that share the width.">
    <View class="flex-row gap-3">
      <View class="h-12 flex-1 rounded-lg bg-rose-500" />
      <View class="h-12 flex-2 rounded-lg bg-amber-500" />
      <View class="h-12 flex-1 rounded-lg bg-violet-500" />
    </View>
  </Section>

  <Section title="Window size" note="md: applies from 768 points wide: teal on a phone, fuchsia on a tablet. It follows the window, so it changes when the window does.">
    <View class="h-12 items-center justify-center rounded-lg bg-teal-500 md:bg-fuchsia-500">
      <Text class="font-semibold text-white">bg-teal-500 md:bg-fuchsia-500</Text>
    </View>
  </Section>

  <Section title="Safe area" note="pt-safe is the height of the status bar, the inset SafeAreaView would add: the label sits that far down.">
    <View testID="safe-box" class="rounded-lg bg-indigo-500 pt-safe">
      <Text testID="safe-label" class="px-3 pb-2 text-white">pt-safe</Text>
    </View>
  </Section>

  <Section title="Class and style" note="The style attribute wins over the classes: this box has the class bg-zinc-400 and a style with an orange background.">
    <View class="h-12 rounded-lg bg-zinc-400" style={{ backgroundColor: "#f97316" }} />
  </Section>
</Page>
