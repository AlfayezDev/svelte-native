<script lang="ts">
  import { Pressable, Text, View } from "expo-svelte";
  import { Platform } from "expo-svelte/platform";
  let count = $state(0);
</script>

<View>
  <Pressable onPress={() => (count += 1)} onPressChange={() => {}}><Text>{Platform.OS} {count}</Text></Pressable>
</View>
