<script module lang="ts">
  export const presentation = "modal";
</script>
<script lang="ts">
  import { Pressable, Text, View, useRouter } from "@example/svelte-native";
  const router = useRouter();
  const close = () => { if (!router.back()) router.goto("/projects", { reset: true }); };
</script>
<View>
  <Text>Preferences</Text>
  <Pressable accessibilityRole="button" onPress={close}><Text>Close</Text></Pressable>
</View>
