<script>
  import Svg from "../../../../src/components/svg/Svg.svelte";
  import Circle from "../../../../src/components/svg/Circle.svelte";
  import Defs from "../../../../src/components/svg/Defs.svelte";
  import Filter from "../../../../src/components/svg/Filter.svelte";
  import FeFlood from "../../../../src/components/svg/FeFlood.svelte";
  let { fill, flood } = $props();
  const ring = () => { "worklet"; return { fill: fill.value, stroke: "#0000ff", r: 3 }; };
  const water = () => { "worklet"; return { floodColor: flood.value }; };
</script>
<Svg width={20} height={20}>
  <Defs><Filter id="f"><FeFlood animatedProps={water} /></Filter></Defs>
  <Circle r={1} animatedProps={ring} />
</Svg>
