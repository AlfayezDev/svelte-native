<script>
  import ExpoImage from "../../../src/components/ExpoImage.svelte";
  let source = $state("https://example.com/a.png");
  let events = [];
  let handle = null;
  export function setSource(next) { source = next; }
  export function eventLog() { return events; }
  export function imageHandle() { return handle; }
</script>
<ExpoImage {source} placeholder="blurhash:/LEHV6nWB2yk8pyo0adR*.7kCMdnj/32/32" contentFit="contain" transition={200} cachePolicy="memory-disk"
  priority="high" tintColor="#ff0000" recyclingKey="row-1" alt="A picture"
  style={[{ width: 100, height: 80 }, { borderRadius: 8, backgroundColor: "#00ff00", resizeMode: "stretch" }]}
  ref={(h) => { handle = h; }}
  onLoadStart={() => events.push(["loadStart"])}
  onLoad={(event) => events.push(["load", event.cacheType, event.source.url])}
  onProgress={(event) => events.push(["progress", event.loaded, event.total])}
  onError={(event) => events.push(["error", event.error])}
  onLoadEnd={() => events.push(["loadEnd"])}
  onDisplay={() => events.push(["display"])} />
