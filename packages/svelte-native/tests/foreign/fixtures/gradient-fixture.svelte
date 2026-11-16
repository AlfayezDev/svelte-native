<script>
  import LinearGradient from "../../../src/components/LinearGradient.svelte";
  import Text from "../../../src/components/Text.svelte";
  import View from "../../../src/components/View.svelte";
  let colors = $state(["#ff0000", "rgba(0, 0, 255, 0.5)", "green"]);
  let handle = null;
  export function setColors(next) { colors = next; }
  export function gradientHandle() { return handle; }
</script>
<View style={{ flex: 1 }}>
  <LinearGradient {colors} locations={[0, 0.5, 1, 2]} start={{ x: 0, y: 0 }} end={[1, 1]} dither={false}
    style={{ height: 80, borderRadius: 10, borderTopLeftRadius: 4 }} accessibilityLabel="Fade" ref={(h) => { handle = h; }}>
    <Text>over the gradient</Text>
  </LinearGradient>
</View>
