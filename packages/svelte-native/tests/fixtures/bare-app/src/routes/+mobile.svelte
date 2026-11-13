<script lang="ts">
  import { Pressable, Text, View } from "@alfayez/svelte-native";
  import { Platform } from "@alfayez/svelte-native/platform";
  let count = $state(0);
</script>

<View>
  <Pressable onPress={() => (count += 1)} onPressChange={() => {}}><Text>{Platform.OS} {count}</Text></Pressable>
</View>
