<script>
  import ConicGradient from "../src/components/ConicGradient.svelte";
  import Text from "../src/components/Text.svelte";
  let colors = $state(["#ff0000", "rgba(0, 0, 255, 0.5)", "green"]);
  let handle = null;
  export function setColors(next) { colors = next; }
  export function conicHandle() { return handle; }
</script>
<ConicGradient {colors} locations={[0, 0.5, 1]} center={[0.25, 0.75]} angle={45} style={{ height: 80, borderRadius: 10, overflow: "hidden" }} accessibilityLabel="Sweep" ref={(h) => { handle = h; }}>
  <Text>inside</Text>
</ConicGradient>
