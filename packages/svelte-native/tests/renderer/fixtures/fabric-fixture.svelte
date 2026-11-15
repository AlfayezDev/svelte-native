<script>
  import ScrollView from "../../../src/components/ScrollView.svelte";
  import View from "../../../src/components/View.svelte";
  import Text from "../../../src/components/Text.svelte";
  let rows = $state([]);
  let label = $state("before");
  export function fill(n) { rows = Array.from({ length: n }, (_, i) => i); }
  export function clear() { rows = []; }
  export function rename(next) { label = next; }
  let padding = $state(8);
  export function pad(next) { padding = next; }
  let direct = $state([]);
  let handle = null;
  let layouts = [];
  export function fillDirect(n) { direct = Array.from({ length: n }, (_, i) => i); }
  export function layoutLog() { return layouts; }
  export function handleOf() { return handle; }
</script>
<View style={{ flex: 1 }}>
  <Text style={{ fontSize: 20 }}>{label}</Text>
  <ScrollView style={{ height: 360 }} contentContainerStyle={{ padding }}>
    {#each rows as row (row)}
      <View style={{ padding: 10 }} onLayout={row === rows.length - 1 ? () => {} : undefined}><Text style={{ fontSize: 14 }}>Row {row + 1}</Text></View>
    {/each}
  </ScrollView>
  <native-view testID="styled" style={{ padding: 1 }}></native-view>
  <native-view testID="direct" ref={(h) => { handle = h; }} nativeProps={{ pointerEvents: "box-none", testID: "legacy" }}>
    {#each direct as row (row)}
      <native-view nativeStyle={{ padding: 4 + row }} style="color: red" class="row" id="row-{row}" data-row={row} accessible={true} onLayout={(event) => layouts.push([row, event.nativeEvent.layout.height])}>
        <native-text nativeStyle={{ fontSize: 12 }}>Direct {row + 1}</native-text>
      </native-view>
    {/each}
  </native-view>
</View>
