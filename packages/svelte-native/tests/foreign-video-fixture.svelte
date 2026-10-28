<script>
  import Video from "../src/components/Video.svelte";
  let paused = $state(false);
  let source = $state({ uri: "https://example.com/v.mp4", headers: { a: "b" } });
  const log = [];
  let handle = null;
  export function setPaused(next) { paused = next; }
  export function setSource(next) { source = next; }
  export function eventLog() { return log; }
  export function videoHandle() { return handle; }
</script>
<Video {source} {paused} muted repeat resizeMode="cover" rate={1.5} volume={0.5} controls shutterColor="#112233"
  poster="https://example.com/poster.png" selectedTextTrack={{ type: "index", value: 2 }} style={{ height: 120 }}
  ref={(h) => { handle = h; }}
  onLoadStart={() => log.push(["loadStart"])}
  onLoad={(data) => log.push(["load", data.duration])}
  onProgress={(data) => log.push(["progress", data.currentTime])}
  onEnd={() => log.push(["end"])}
  onError={(data) => log.push(["error", data.error.errorString])}
  onReadyForDisplay={() => log.push(["ready"])} />
