<script lang="ts">
  import Text from "../src/components/Text.svelte";
  import View from "../src/components/View.svelte";

  let { inline = false }: { inline?: boolean } = $props();
  let tone = $state("plain");
  export function setTone(next: string) { tone = next; }
</script>

<View testID="card" class={["card", tone === "loud" && "loud"]} style={inline ? { padding: 1 } : undefined}>
  <Text testID="label" class={{ label: true, muted: tone === "plain" }}>Hello</Text>
  <View testID="bare" />
  <View testID="themed" class="themed" />
</View>
