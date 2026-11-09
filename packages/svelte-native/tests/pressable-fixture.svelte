<script>
  import View from "../src/components/View.svelte";
  import Text from "../src/components/Text.svelte";
  import Pressable from "../src/components/Pressable.svelte";
</script>
<View style={{ flex: 1 }}>
  <Pressable testID="plain" accessibilityRole="button" accessibilityLabel="Go" onPress={() => {}}><Text>Go</Text></Pressable>
  <Pressable testID="hidden" accessible={false} onPress={() => {}}><Text>Skip</Text></Pressable>
  <Pressable testID="passive"><Text>No handler</Text></Pressable>
  <Text testID="words">Words</Text>
  <Text testID="silent" accessible={false}>Silent</Text>
</View>
