<script lang="ts">
  import { getContext, onDestroy } from "svelte";
  import type {} from "../../elements.d.ts";
  import type { StopProps as LibraryStopProps } from "#vendor/react-native-svg";
  import type { StopProps } from "../../fabric/foreign-svg-extract.ts";
  import { stopsKey, type Registry } from "./registry.ts";

  /** `react-native-svg`'s `Stop`: a colour at an `offset` of its `LinearGradient` or `RadialGradient`. It draws nothing; the gradient reads its props. */
  let { offset, stopColor, stopOpacity, style }: Omit<LibraryStopProps, "parent"> & { style?: Record<string, unknown> } = $props();
  const parent = getContext<Registry<StopProps> | undefined>(stopsKey);
  const member = parent?.register(() => ({ offset, stopColor, stopOpacity, style }));
  if (member) onDestroy(member.unregister);
</script>
{#if member}<native-anchor ref={member.place}></native-anchor>{/if}
