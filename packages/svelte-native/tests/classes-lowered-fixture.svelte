<script lang="ts">
  // Imported from the package, so the lowering turns these into host tags, as in an app.
  import { SafeAreaView, Text, View } from "@rasheed/svelte-native";

  let { inline = false }: { inline?: boolean } = $props();
  let tone = $state("plain");
  const spread = { class: "card", testID: "spread" };
  export function setTone(next: string) { tone = next; }
</script>

<View testID="card" class={["card", tone === "loud" && "loud"]} style={inline ? { padding: 1 } : undefined}>
  <Text testID="label" class={{ label: true, muted: tone === "plain" }}>Hello</Text>
  <View testID="bare" />
  <View testID="themed" class="themed" />
  <View {...spread} class:loud={tone === "loud"} />
  <SafeAreaView testID="safe" class="p-4" />
</View>
