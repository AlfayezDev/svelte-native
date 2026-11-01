<script>
  import Rive from "../src/components/Rive.svelte";
  import Text from "../src/components/Text.svelte";
  import View from "../src/components/View.svelte";
  let { initial } = $props();
  const log = [];
  let handle = null;
  export function eventLog() { return log; }
  export function riveHandle() { return handle; }
</script>
{#if initial?.bad}
  <Rive />
{:else}
  <View>
    <Rive url="https://cdn.rive.app/animations/vehicles.riv" artboardName="Main" stateMachineName="State Machine 1" fit="cover" alignment="topLeft" layoutScaleFactor={2}
      referencedAssets={{ font: { source: { uri: "https://example.com/f.ttf" } }, logo: { source: 9 }, local: { source: { fileName: "pic.png", path: "assets" } } }}
      style={{ height: 120 }} ref={(h) => { handle = h; }}
      onPlay={(name, machine) => log.push(["play", name, machine])} onPause={(name, machine) => log.push(["pause", name, machine])} onStop={(name, machine) => log.push(["stop", name, machine])}
      onLoopEnd={(name, mode) => log.push(["loop", name, mode])} onStateChanged={(machine, state) => log.push(["state", machine, state])}
      onRiveEventReceived={(event) => log.push(["rive", event])} onError={(error) => log.push(["error", error.type, error.message])}>
      <Text>behind</Text>
    </Rive>
    <Rive resourceName="rating" autoplay={false} animationName="idle" />
    <Rive source={9} />
  </View>
{/if}
