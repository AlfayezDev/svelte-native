<script lang="ts">
  import { Pressable, Text, useRouter } from "@example/svelte-native";
  const router = useRouter();
</script>
<Pressable accessibilityRole="button" onPress={() => router.goto("/__dev")}><Text>Open the lab</Text></Pressable>
