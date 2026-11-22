<script lang="ts">
  // Mounted by the Fabric host itself when the app throws; deliberately built from host tags only, so it still renders when the app's own components are what failed.
  let { title, message, frames, onReload }: { title: string; message: string; frames: string[]; onReload: () => void } = $props();
</script>
<native-view nativeStyle={{ flex: 1, backgroundColor: "#7f1d1d", paddingTop: 56, paddingHorizontal: 20, paddingBottom: 24 }}>
  <native-text nativeStyle={{ color: "#fecaca", fontSize: 13, fontWeight: "700", marginBottom: 8 }}>{title}</native-text>
  <native-scroll nativeStyle={{ flex: 1 }}>
    <native-text nativeStyle={{ color: "#ffffff", fontSize: 17, fontWeight: "600", marginBottom: 16 }}>{message}</native-text>
    {#each frames as frame, index (index)}
      <native-text nativeStyle={{ color: "#fecaca", fontSize: 12, marginBottom: 6 }}>{frame}</native-text>
    {/each}
  </native-scroll>
  <native-pressable accessibilityRole="button" onPress={onReload} nativeStyle={{ backgroundColor: "#ffffff", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 12 }}>
    <native-text nativeStyle={{ color: "#7f1d1d", fontSize: 16, fontWeight: "700" }}>Reload</native-text>
  </native-pressable>
</native-view>
