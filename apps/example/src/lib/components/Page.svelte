<script lang="ts">
  import type { Snippet } from "svelte";
  import { SafeAreaView, Screen, ScrollView, Text } from "@rasheed/svelte-native";
  import { text } from "#lib/theme.svelte.ts";

  // The frame of a feature screen: the native header with the title, a few plain sentences about the feature, then the examples
  // (`children`). It is `Screen` + `SafeAreaView` + `ScrollView`, which the Navigation and Lists screens use directly.
  let { title, intro, children }: { title: string; intro: string; children: Snippet } = $props();
</script>

<Screen {title}>
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Text style={text.body}>{intro}</Text>
      {@render children()}
    </ScrollView>
  </SafeAreaView>
</Screen>
