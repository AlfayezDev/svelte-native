<script lang="ts">
  import { getContext, onDestroy } from "svelte";
  import type { FeMergeNodeProps } from "react-native-svg";
  import { mergeNodesKey, type Registry } from "./registry.ts";

  /** `react-native-svg`'s `FeMergeNode`: one layer of its `FeMerge`, the result named by `in`. It draws nothing; the merge reads its props. */
  let { in: input }: Omit<FeMergeNodeProps, "parent"> = $props();
  const parent = getContext<Registry<string | undefined> | undefined>(mergeNodesKey);
  if (parent) onDestroy(parent.register(() => input));
</script>
