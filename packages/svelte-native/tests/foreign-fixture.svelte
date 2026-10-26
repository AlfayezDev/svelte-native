<script>
  import ForeignView from "../src/components/ForeignView.svelte";
  import WebView from "../src/components/WebView.svelte";
  import MapView from "../src/components/MapView.svelte";
  import Marker from "../src/components/Marker.svelte";
  import View from "../src/components/View.svelte";
  import VideoView from "../src/components/VideoView.svelte";
  import { expoViewName } from "../src/fabric/foreign.ts";
  let html = $state("<p>one</p>");
  let messages = [];
  let loads = [];
  let webHandle = null;
  let mapHandleOf = null;
  let engineViewHandle = null;
  let foreignChildHandle = null;
  let requests = [];
  let pans = 0;
  let surface = $state("surfaceView");
  let frames = 0;
  let denyNext = false;
  export function setHtml(next) { html = next; }
  export function messageLog() { return messages; }
  export function loadLog() { return loads; }
  export function webView() { return webHandle; }
  export function map() { return mapHandleOf; }
  export function engineView() { return engineViewHandle; }
  export function foreignChild() { return foreignChildHandle; }
  export function requestLog() { return requests; }
  export function deny(value) { denyNext = value; }
  export function panCount() { return pans; }
  export function setSurface(type) { surface = type; }
  export function firstFrames() { return frames; }
</script>
<View ref={(h) => { engineViewHandle = h; }} style={{ flex: 1 }}>
  <WebView source={{ html, headers: { a: "b" } }} style={{ height: 200 }} ref={(h) => { webHandle = h; }}
    onMessage={(event) => messages.push(event.nativeEvent.data)}
    onLoadStart={(event) => loads.push(["start", event.nativeEvent.url])}
    onLoad={(event) => loads.push(["load", event.nativeEvent.url])}
    onLoadEnd={(event) => loads.push(["end", event.nativeEvent.url])}
    onShouldStartLoadWithRequest={(request) => { requests.push(request.url); return !denyNext; }} />
  <MapView ref={(h) => { mapHandleOf = h; }} onPanDrag={() => { pans++; }} initialRegion={{ latitude: 1, longitude: 2, latitudeDelta: 0.1, longitudeDelta: 0.1 }} style={{ height: 160 }}>
    <Marker coordinate={{ latitude: 1, longitude: 2 }} title="Here" pinColor="#ff0000" />
    <View ref={(h) => { foreignChildHandle = h; }} style={{ width: 10, height: 10 }} />
  </MapView>
  <ForeignView component={expoViewName("Thing", "View")} someProp={3} />
  <VideoView player={{ __expo_shared_object_id__: 7 }} surfaceType={surface} nativeControls={false} onFirstFrameRender={() => { frames++; }} style={{ height: 100 }} />
</View>
