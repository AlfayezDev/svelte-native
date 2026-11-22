<script lang="ts">
  const probe = globalThis as unknown as { __htmlMisc: Record<string, unknown>; __log: string[] };
  let href = $state<string | undefined>(undefined);
  let css = $state("color: red; font-size: 20px; padding: 1rem !important");
  let amount = $state(5);
  let tag = $state("h2");
  let note = $state("");
  probe.__htmlMisc = {
    setCss: (value: string) => { css = value; },
    setTag: (value: string) => { tag = value; },
    amount: () => amount,
    note: () => note,
  };
</script>
<svelte:head><title>Shared with the web</title></svelte:head>
<a testID="nolink" {href} onclick={() => probe.__log.push("no link clicked")}>No link</a>
<div testID="text-style" style={css}>x</div>
<input testID="number" type="number" bind:value={amount} />
<input testID="named" name="user" id="user-name" oninput={(event) => probe.__log.push(`${event.target.name}/${event.target.id}/${event.target.type}/${event.target.value}`)} />
<textarea testID="initial">Initial {amount} text</textarea>
<textarea testID="initial-bound" bind:value={note}>ignored</textarea>
<form onsubmit={(event) => { event.preventDefault(); probe.__log.push("submitted"); }}>
  <input testID="enter" onkeydown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
  <input testID="enter-free" />
  <button testID="enter-submit">Go</button>
</form>
<svelte:element this={tag} testID="dynamic">Dynamic</svelte:element>
