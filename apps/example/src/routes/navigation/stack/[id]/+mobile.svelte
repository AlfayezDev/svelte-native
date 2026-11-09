<script lang="ts">
  import { Pressable, SafeAreaView, Screen, ScrollView, Text, View, useRouter } from "@rasheed/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // A screen with a route parameter: the folder is named [id], so the page gets `params.id` (a string) as a prop. The header has a button in
  // its right slot (`headerRight`, a snippet), a subtitle and its own back label. `router.entries` is the stack: it grows with every push.
  let { params }: { params: { id: string } } = $props();
  const router = useRouter();
  const next = $derived(Number(params.id) + 1);
</script>

{#snippet nextButton()}
  <Pressable accessibilityRole="button" accessibilityLabel={`Push item ${next}`} hitSlop={8} onPress={() => router.goto(`/navigation/stack/${next}`)} style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: "600" }}>Next</Text>
  </Pressable>
{/snippet}

<Screen title={`Item ${params.id}`} subtitle="A pushed screen" headerRight={nextButton} header={{ backTitle: "Stack" }}>
  <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={text.heading}>Item {params.id}</Text>
      <Text style={text.body}>The stack holds {router.entries.length} screens: this one and the {router.entries.length - 1} below it.</Text>
      <View style={{ gap: 8 }}>
        <Button label={`Push item ${next}`} onPress={() => router.goto(`/navigation/stack/${next}`)} />
        <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        <Button label="Back to the first screen" variant="secondary" onPress={() => router.goto("/navigation/stack")} />
      </View>
      <Text style={text.caption}>goto the first screen again does not push a second copy: the screens above it are popped.</Text>
    </ScrollView>
  </SafeAreaView>
</Screen>
