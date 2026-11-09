<script>
  import SvgNode from "../src/components/svg/SvgNode.svelte";
  let node = $state(null);
  let key = $state(0);
  /** A new document: the old one is unmounted first. */
  export function show(next) { key++; node = next; }
  /** The same document with other props: the nodes stay. */
  export function update(next) { node = next; }
</script>
{#key key}{#if node}<SvgNode {node} />{/if}{/key}
