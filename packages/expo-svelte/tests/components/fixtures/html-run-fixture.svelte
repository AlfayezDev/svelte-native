<script lang="ts">
  import { View } from "expo-svelte";
  import Btn from "./html-btn-fixture.svelte";
  const probe = globalThis as unknown as { __htmlRun: Record<string, unknown> };
  let n = $state(0);
  probe.__htmlRun = { setN: (value: number) => { n = value; } };
</script>

{#snippet label()}Save{/snippet}
<Btn testID="child-text">Child text</Btn>
<button testID="snippet">{@render label()}</button>
<div testID="hello">Hello {#if n}{n}{/if}!</div>
<div testID="spans"><span>a</span><span>b</span></div>
<div testID="spaced"><span>a</span> <span>b</span></div>
<div testID="blocks"><p>one</p> <p>two</p></div>
<div testID="edges"><h1>T</h1>
  some text
<h2>U</h2></div>
<div testID="mixed">before <button testID="inner">inner</button> after</div>
<p testID="press">Press <button testID="here">here</button> now</p>
<span testID="s7">text <div testID="s7-box"><p testID="s7-para">inner</p></div></span>
<dialog testID="dialog" open>Dialog text</dialog>
<View testID="rn">not drawn</View>
<View testID="rn-two">nor this</View>
