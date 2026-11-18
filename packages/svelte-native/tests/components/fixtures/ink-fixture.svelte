<script lang="ts">
  import { Text, View } from "@alfayez/svelte-native";
  const probe = globalThis as unknown as { __ink: Record<string, unknown> };
  let colored = $state(false);
  probe.__ink = { setColored: (value: boolean) => { colored = value; } };
</script>

<!-- Texts and inputs with no colour of their own, and the ways a colour reaches one: its style, its class, the HTML elements around it, its parent text. -->
<View>
  <Text testID="plain">Plain <Text testID="span">nested</Text></Text>
  <Text testID="styled" style={{ color: "#ff0000" }}>Styled</Text>
  <Text testID="classed" class="text-white">Classed</Text>
  <Text testID="toggled" style={colored ? { color: "#00ff00" } : undefined}>Toggled</Text>
  <div testID="outer" class="text-white"><p testID="inherited">Inherited</p></div>
  <div testID="run-holder">A bare run</div>
  <input testID="field" />
  <input testID="field-styled" style={{ color: "#0000ff" }} />
</View>
