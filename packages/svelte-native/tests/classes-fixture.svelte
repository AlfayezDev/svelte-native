<script lang="ts">
  import Text from "../src/components/Text.svelte";
  import View from "../src/components/View.svelte";
  import SafeAreaView from "../src/components/SafeAreaView.svelte";

  let { inline = false }: { inline?: boolean } = $props();
  let tone = $state("plain");
  const spread = { class: "card", testID: "spread" };
  export function setTone(next: string) { tone = next; }
</script>

<View testID="card" class={["card", tone === "loud" && "loud"]} style={inline ? { padding: 1 } : undefined}>
  <Text testID="label" class={{ label: true, muted: tone === "plain" }}>Hello</Text>
  <View testID="bare" />
  <View testID="themed" class="themed" />
  <View {...spread} />
  <SafeAreaView testID="safe" class="p-4" />
</View>
