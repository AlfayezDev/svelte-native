<script>
  import Svg from "../../../../src/components/svg/Svg.svelte";
  import G from "../../../../src/components/svg/G.svelte";
  import Path from "../../../../src/components/svg/Path.svelte";
  import Circle from "../../../../src/components/svg/Circle.svelte";
  import Rect from "../../../../src/components/svg/Rect.svelte";
  import Text from "../../../../src/components/svg/Text.svelte";
  let { log, radius, cx, dash } = $props();
  const handles = {};
  let shown = $state(true);
  export function handle(name) { return handles[name]; }
  export function hide() { shown = false; }
  const ring = () => { "worklet"; return { r: radius.value, cx: cx.value }; };
  const outline = () => { "worklet"; return { d: dash.value }; };
</script>
{#if shown}
<Svg width={20} height={20} pointerEvents="box-only" onPress={() => log("svg press")} ref={(h) => { handles.svg = h; }}>
  <Path d="M0 0L10 0" stroke="red" ref={(h) => { handles.path = h; }} onPress={() => log("path press")} onPressIn={() => log("path in")} onLongPress={() => log("path long")} delayLongPress={300} />
  <G ref={(h) => { handles.group = h; }} opacity={0.5}>
    <Circle r={3} ref={(h) => { handles.circle = h; }} animatedProps={ring} />
  </G>
  <Rect width={2} height={2} onStartShouldSetResponder={() => true} onResponderGrant={() => log("rect grant")} onResponderRelease={() => log("rect release")} />
  <Path d="M0 0" animatedProps={outline} />
  <Text x={1}>label</Text>
</Svg>
{/if}
