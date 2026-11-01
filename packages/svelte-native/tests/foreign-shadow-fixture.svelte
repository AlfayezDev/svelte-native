<script>
  import ShadowedView from "../src/components/ShadowedView.svelte";
  import Text from "../src/components/Text.svelte";
  let color = $state("#112233");
  let handle = null;
  export function setColor(next) { color = next; }
  export function shadowHandle() { return handle; }
</script>
<ShadowedView accessibilityLabel="card" ref={(h) => { handle = h; }}
  style={[{ shadowColor: color, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 5, height: 3 }, backgroundColor: "#ffffff", borderRadius: 10, borderTopLeftRadius: 2, borderWidth: 1, borderColor: "#cccccc", padding: 8, margin: 4, opacity: 0.9, width: 120 }, false]}>
  <Text>content</Text>
</ShadowedView>
