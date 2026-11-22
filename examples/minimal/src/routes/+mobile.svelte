<script lang="ts">
  import { Pressable, Screen, Text, View, useRouter } from "expo-svelte";
  const router = useRouter();
  let taps = $state(0);
</script>

<Screen title="Minimal" header={{ large: true }}>
  <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: "center" }}>
    <Text style={{ fontSize: 28, fontWeight: "700" }}>Expo Svelte</Text>
    <Text style={{ fontSize: 16 }}>Tapped {taps} {taps === 1 ? "time" : "times"}.</Text>
    <Pressable onPress={() => taps++} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: "#1d4ed8" }}>
      <Text style={{ color: "#ffffff", fontSize: 16, fontWeight: "600" }}>Tap</Text>
    </Pressable>
    <Pressable onPress={() => router.goto("/details")} accessibilityRole="button" style={{ padding: 14, borderRadius: 12, backgroundColor: "#e5e7eb" }}>
      <Text style={{ fontSize: 16, fontWeight: "600" }}>Open details</Text>
    </Pressable>
  </View>
</Screen>
