<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  /** A host element whose tag is chosen at runtime; the host throws on a name it does not map. */
  let { name, attributes = {}, children }: {
    name: string;
    attributes?: object;
    children?: Snippet;
  } = $props();
  const resolveProps = createNativeProps();
  const nativeProps = $derived(resolveProps(attributes));
</script>

<svelte:element this={name} {nativeProps}>{@render children?.()}</svelte:element>
