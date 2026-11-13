<script lang="ts">
  import { Pressable, Screen, Text, View, useRouter } from "@alfayez/svelte-native";
  const router = useRouter();
</script>

<Screen title="Details">
  <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: "center" }}>
    <Text style={{ fontSize: 16 }}>A second screen, pushed onto the stack. The header's back button, the edge swipe and Android's back return to the home screen.</Text>
    <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: "#e5e7eb" }}>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>Back</Text>
    </Pressable>
  </View>
</Screen>
