<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  let { name, attributes = {}, children }: {
    name: string;
    attributes?: object;
    children?: Snippet;
  } = $props();
  const nativeProps = $derived({ ...attributes });
</script>

<svelte:element this={name} {nativeProps}>{@render children?.()}</svelte:element>
