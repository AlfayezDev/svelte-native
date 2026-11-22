<script lang="ts" module>
  // A literal, read when the route table is built: this page enters as a modal that covers the screen below it, header included.
  export const presentation = "modal";
</script>

<script lang="ts">
  import { Pressable, SafeAreaView, Screen, Text, View, useRouter } from "expo-svelte";
  import Button from "#lib/components/Button.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // A modal screen: it slides up over everything. A modal has no back arrow, so it brings its own Close button in the header (`headerLeft`);
  // the swipe down on iOS and the back button on Android close it as well. `router.back()` closes it from code.
  const router = useRouter();

  // `?demo`: stay a while, then close the modal from code. Open it from another screen, so there is one below to go back to: a modal that is the
  // first screen of the app (a cold link) has none, and stays.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [[() => { if (router.entries.length > 1) router.back(); }, 0]], { settle: 6000, hold: 0 });
</script>

{#snippet close()}
  <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: "600" }}>Close</Text>
  </Pressable>
{/snippet}

<Screen title="A modal" headerLeft={close}>
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
    <View style={{ padding: 20, gap: 16 }}>
      <Text style={text.body}>A modal is a page like any other, with `export const presentation = "modal"`. Use it for a task that has a start and an end: composing, editing, signing in.</Text>
      <Button label="Done" onPress={() => router.back()} />
    </View>
  </SafeAreaView>
</Screen>
