<script lang="ts">
  // Imported from the package, so the lowering turns these into host tags, as in an app.
  import { Text, View } from "@example/svelte-native";

  let { inline = false }: { inline?: boolean } = $props();
  let tone = $state("plain");
  export function setTone(next: string) { tone = next; }
</script>

<View testID="card" class={["card", tone === "loud" && "loud"]} style={inline ? { padding: 1 } : undefined}>
  <Text testID="label" class={{ label: true, muted: tone === "plain" }}>Hello</Text>
  <View testID="bare" />
  <View testID="themed" class="themed" />
</View>
