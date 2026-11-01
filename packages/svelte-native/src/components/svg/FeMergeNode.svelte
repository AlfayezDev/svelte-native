<script lang="ts">
  import { getContext, onDestroy } from "svelte";
  import type {} from "../../elements.d.ts";
  import type { FeMergeNodeProps } from "react-native-svg";
  import { mergeNodesKey, type Registry } from "./registry.ts";

  /** `react-native-svg`'s `FeMergeNode`: one layer of its `FeMerge`, the result named by `in`. It draws nothing; the merge reads its props. */
  let { in: input }: Omit<FeMergeNodeProps, "parent"> = $props();
  const parent = getContext<Registry<string | undefined> | undefined>(mergeNodesKey);
  const member = parent?.register(() => input);
  if (member) onDestroy(member.unregister);
</script>
{#if member}<native-anchor ref={member.place}></native-anchor>{/if}
