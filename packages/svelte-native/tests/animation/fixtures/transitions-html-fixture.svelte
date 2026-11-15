<script lang="ts">
  import { fade } from "svelte/transition";
  import { flip } from "svelte/animate";
  const probe = globalThis as unknown as { __tx: Record<string, unknown> };
  let on = $state(false);
  let shown = $state(false);
  let bold = $state(true);
  let items = $state([1, 2, 3]);
  let faded = $state(false);
  let color = $state("red");
  let evented = $state(false);
  const heard: string[] = [];
  probe.__tx = {
    setOn: (value: boolean) => { on = value; },
    setShown: (value: boolean) => { shown = value; },
    setBold: (value: boolean) => { bold = value; },
    setItems: (value: number[]) => { items = value; },
    setFaded: (value: boolean) => { faded = value; },
    setColor: (value: string) => { color = value; },
    setEvented: (value: boolean) => { evented = value; },
    heard: () => heard,
  };
</script>

<!-- A span that is a span of the text it is in while there is text beside it, and a text of its own when there is not: it is made again as the one or the other. -->
<div testID="run">{#if on}Hi {/if}{#if shown}<span testID="remade" in:fade={{ duration: 100 }}>x</span>{/if}</div>

<!-- Text inside a text has no view of its own: an outro on it runs its length and draws nothing. -->
<p testID="para">Hello {#if bold}<b testID="bold" out:fade={{ duration: 100 }}>world</b>{/if}!</p>

<ul testID="list">
  {#each items as item (item)}
    <li testID={`item-${item}`} animate:flip={{ duration: 300 }}>{item}</li>
  {/each}
</ul>

{#if faded}
  <div testID="fading" style={{ color, fontSize: 20 }} in:fade={{ duration: 100 }}>
    <p testID="fading-child">Hi</p>
  </div>
{/if}

<!-- The events Svelte's transitions send the element: they reach the handlers written on it, and the lowering does not warn that they never run. -->
{#if evented}
  <div testID="evented" in:fade={{ duration: 100 }} out:fade={{ duration: 100 }} onintrostart={() => heard.push("introstart")} onintroend={() => heard.push("introend")} onoutrostart={() => heard.push("outrostart")} onoutroend={() => heard.push("outroend")}>x</div>
{/if}
