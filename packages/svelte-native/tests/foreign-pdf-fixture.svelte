<script>
  import Pdf from "../src/components/Pdf.svelte";
  import Text from "../src/components/Text.svelte";
  import View from "../src/components/View.svelte";
  let { initial } = $props();
  // svelte-ignore state_referenced_locally
  let source = $state(initial ?? { uri: "data:application/pdf;base64,JVBERi0xLjQK" });
  let page = $state(1);
  const log = [];
  let handle = null;
  export function setSource(next) { source = next; }
  export function setPage(next) { page = next; }
  export function eventLog() { return log; }
  export function pdfHandle() { return handle; }
</script>
<View>
  <Pdf {source} {page} horizontal enablePaging fitPolicy={0} spacing={4} password="pw" style={{ height: 200 }} ref={(h) => { handle = h; }}
    onLoadComplete={(pages, path, size, contents) => log.push(["loaded", pages, path, size, contents])}
    onPageChanged={(current, pages) => log.push(["page", current, pages])}
    onError={(error) => log.push(["error", error.message])}
    onPressLink={(url) => log.push(["link", url])}
    onPageSingleTap={(current, x, y) => log.push(["tap", current, x, y])}
    onScaleChanged={(scale) => log.push(["scale", scale])}>
    {#snippet loading()}<Text>Loading</Text>{/snippet}
  </Pdf>
</View>
