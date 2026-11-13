<script>
  import { View } from "@alfayez/svelte-native";
  // The harness stubs the package entry for primitives; exercise the real helper module.
  import { gestureAttachment } from "../../src/gestures/action.ts";
  let { first } = $props();
  let current = $state.raw(first);
  let shown = $state(true);
  export function use(next) { current = next; }
  export function hide() { shown = false; }
</script>
{#if shown}<View testID="attachment" {@attach gestureAttachment(current)} />{/if}
