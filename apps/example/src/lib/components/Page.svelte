<script lang="ts">
  import type { ComponentProps, Snippet } from "svelte";
  import { SafeAreaView, Screen, ScrollView, Text } from "@example/svelte-native";
  import { text } from "#lib/theme.svelte.ts";

  // The frame of a feature screen: the native header with the title, a few plain sentences about the feature, then the examples
  // (`children`). It is `Screen` + `SafeAreaView` + `ScrollView`, which the Navigation and Lists screens use directly. `scrollRef` gets the
  // ScrollView's handle, which a demo (`#lib/demo.ts`) scrolls the page with.
  let { title, intro, scrollRef, children }: { title: string; intro: string; scrollRef?: ComponentProps<typeof ScrollView>["ref"]; children: Snippet } = $props();
</script>

<Screen {title}>
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 24 }}>
      <Text style={text.body}>{intro}</Text>
      {@render children()}
    </ScrollView>
  </SafeAreaView>
</Screen>
