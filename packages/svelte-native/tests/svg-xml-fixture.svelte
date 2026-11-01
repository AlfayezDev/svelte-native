<script>
  import SvgXml from "../src/components/svg/SvgXml.svelte";
  import SvgUri from "../src/components/svg/SvgUri.svelte";
  import View from "../src/components/View.svelte";
  let xml = $state(null);
  let uri = $state(null);
  let mode = $state("xml");
  let props = $state({});
  let key = $state(0);
  const errors = [];
  let loads = 0;
  /** A new document: the old nodes are unmounted first. */
  export function showXml(next, extra = {}) { key++; mode = "xml"; xml = next; props = extra; }
  /** The same component with another document: the nodes stay and are updated. */
  export function updateXml(next, extra = {}) { mode = "xml"; xml = next; props = extra; }
  export function showUri(next, extra = {}) { mode = "uri"; uri = next; props = extra; }
  export function errorLog() { return errors; }
  export function loadCount() { return loads; }
</script>
{#key key}{#if mode === "xml"}
  <SvgXml {xml} {...props} onError={(error) => errors.push(error.message)}>{#snippet fallback()}<View testID="fallback" />{/snippet}</SvgXml>
{:else}
  <SvgUri {uri} {...props} onLoad={() => { loads++; }} onError={(error) => errors.push(error.message)}>{#snippet fallback()}<View testID="fallback" />{/snippet}</SvgUri>
{/if}{/key}
