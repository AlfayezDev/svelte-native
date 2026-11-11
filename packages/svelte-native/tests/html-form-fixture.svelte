<script lang="ts">
  import Field from "./html-field-fixture.svelte";
  const probe = globalThis as unknown as { __htmlLog: (entry: string) => void; __htmlForm: Record<string, unknown> };
  const log = (entry: string) => probe.__htmlLog(entry);
  let name = $state("");
  let color = $state("red");
  let width = $state<string | number>("50%");
  probe.__htmlForm = {
    setColor: (value: string) => { color = value; },
    setWidth: (value: string | number) => { width = value; },
  };
</script>

<form testID="form" onsubmit={(event: SubmitEvent) => log(`submit ${event.type} ${event.target === event.currentTarget} [${name}]`)}>
  <Field bind:name />
  <button testID="own-submit">Own</button>
  <button testID="plain" type="button" onclick={() => log("plain")}>Plain</button>
  <button testID="prevented" onclick={(event) => { event.preventDefault(); log("prevented"); }}>Prevented</button>
  <textarea testID="notes"></textarea>
</form>
<button testID="loose">Loose</button>
<div testID="keys"><input testID="keyed" onkeydown={(event) => log(`down ${event.key}`)} onkeyup={(event) => log(`up ${event.key}`)} /></div>
<div testID="string-style" style="padding: 4px 8px; color: red; line-height: 1.5; font-size: 20px">s</div>
<div testID="directives" style:color={color} style:font-size="12px" style:width={width} style:opacity={0.5}>d</div>
<div testID="mixed" style={{ margin: 2 }} style:color={color}>m</div>
<div testID="dev-handler" onmouseover={() => log("never")}>x</div>
