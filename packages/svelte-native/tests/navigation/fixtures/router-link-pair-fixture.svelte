<script>
  import Root from "./router-link-root.svelte";
  let first = $state(false);
  let second = $state(false);
  export function show(which, value) { if (which === "first") first = value; else second = value; }
</script>
{#if first}<Root name="first" />{/if}
{#if second}<Root name="second" />{/if}
