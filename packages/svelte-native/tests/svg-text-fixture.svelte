<script>
  import Text from "../src/components/svg/Text.svelte";
  import TSpan from "../src/components/svg/TSpan.svelte";
  import TextPath from "../src/components/svg/TextPath.svelte";
  let lone = $state("one");
  let word = $state("a");
  let more = $state(false);
  let name = $state("world");
  let nested = $state(false);
  export function set(values) { if ("lone" in values) lone = values.lone; if ("word" in values) word = values.word; if ("more" in values) more = values.more; if ("name" in values) name = values.name; if ("nested" in values) nested = values.nested; }
</script>
<TSpan x={1}>{lone}</TSpan>
<Text y={2}>{word}{#if more}<TSpan fill="red">c</TSpan>d{/if}</Text>
<Text y={3}>Hello {name}!</Text>
<Text y={4}>
  <TSpan>one</TSpan>
  <TSpan>two</TSpan>
</Text>
<TextPath href="#curve">Along {name}</TextPath>
<TSpan>a{#if nested}<TSpan>b</TSpan>{/if}</TSpan>
