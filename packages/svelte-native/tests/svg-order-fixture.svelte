<script>
  import FeMerge from "../src/components/svg/FeMerge.svelte";
  import FeMergeNode from "../src/components/svg/FeMergeNode.svelte";
  import LinearGradient from "../src/components/svg/LinearGradient.svelte";
  import RadialGradient from "../src/components/svg/RadialGradient.svelte";
  import Stop from "../src/components/svg/Stop.svelte";
  let middle = $state(false);
  let first = $state(false);
  export function set(values) { if ("middle" in values) middle = values.middle; if ("first" in values) first = values.first; }
</script>
<FeMerge>{#if first}<FeMergeNode in="z" />{/if}<FeMergeNode in="a" />{#if middle}<FeMergeNode in="b" />{/if}<FeMergeNode in="c" /></FeMerge>
<LinearGradient id="line">
  <Stop offset={0} stopColor="#ff0000" />
  {#if middle}<Stop offset={0} stopColor="#00ff00" />{/if}
  <Stop offset={0} stopColor="#0000ff" />
</LinearGradient>
<RadialGradient id="round">
  {#if first}<Stop offset={1} stopColor="#00ff00" />{/if}
  <Stop offset={1} stopColor="#ff0000" />
  <Stop offset={1} stopColor="#0000ff" />
</RadialGradient>
