<script>
  import ViewShot from "../src/components/ViewShot.svelte";
  import Text from "../src/components/Text.svelte";
  import View from "../src/components/View.svelte";
  import { captureRef } from "../src/fabric/foreign-capture.ts";
  let { mode, options = { result: "base64" } } = $props();
  const log = [];
  let visible = $state(true);
  let shot = null;
  let plain = null;
  export function eventLog() { return log; }
  export function hide() { visible = false; }
  export function shotRef() { return shot; }
  export function capture() { return shot.capture(); }
  export function shotHandle() { return shot; }
  export function plainHandle() { return plain; }
  export function captureHandle(handle, options) { return captureRef(handle, options); }
</script>
<View ref={(h) => { plain = h; }} collapsable={false} style={{ width: 10, height: 10 }} />
{#if visible}
<ViewShot {options} captureMode={mode} ref={(h) => { shot = h; }} style={{ width: 100, height: 50 }}
  onCapture={(uri) => log.push(["capture", uri])} onCaptureFailure={(error) => log.push(["failure", error.message])}>
  <Text>Shot</Text>
</ViewShot>
{/if}
