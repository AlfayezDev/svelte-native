<script lang="ts">
  import { Pressable, Text, View } from "@rasheed/svelte-native";
  import { Platform } from "@rasheed/svelte-native/platform";
  let count = $state(0);
</script>

<View>
  <Pressable onPress={() => (count += 1)} onPressChange={() => {}}><Text>{Platform.OS} {count}</Text></Pressable>
</View>
