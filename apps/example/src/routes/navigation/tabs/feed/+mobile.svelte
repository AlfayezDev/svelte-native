<script lang="ts">
  import { Pressable, SafeAreaView, Screen, ScrollView, Text, useRouter } from "@example/svelte-native";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // The first tab. A tab is a stack of its own: a post opens inside the tab and the tab bar stays. The Close button in the header leaves the
  // whole tab bar: from the first screen of a tab, `back()` pops the stack above it, which is the app's root stack.
  const router = useRouter();
  const root = useRouter("root");
  const posts = [1, 2, 3];

  // `?demo`: open a post inside this tab, switch to Profile, come back (the post is still open), then close it. The demo link is this tab's:
  // `svelte-native:///navigation/tabs/feed?demo`; the link to `/navigation/tabs` drops its query, because a tab bar's entry has none.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => root.goto("/navigation/tabs/feed/2"), 1800],
    [() => root.goto("/navigation/tabs/profile"), 1800],
    [() => root.goto("/navigation/tabs/feed/2"), 1800],
    [() => router.back(), 1200],
  ]);
</script>

{#snippet close()}
  <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => root.back()} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: "600" }}>Close</Text>
  </Pressable>
{/snippet}

<Screen title="Feed" subtitle="First tab" headerLeft={close}>
  <SafeAreaView edges={["left", "right"]} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={text.body}>Switch tabs with the bar below. Each tab remembers where you were.</Text>
      {#each posts as post (post)}
        <Pressable accessibilityRole="button" onPress={() => router.goto(`/navigation/tabs/feed/${post}`)} style={{ padding: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
          <Text style={text.heading}>Post {post}</Text>
          <Text style={text.caption}>Opens inside this tab.</Text>
        </Pressable>
      {/each}
    </ScrollView>
  </SafeAreaView>
</Screen>
