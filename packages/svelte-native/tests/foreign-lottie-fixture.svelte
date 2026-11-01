<script>
  import LottieView from "../src/components/LottieView.svelte";
  import View from "../src/components/View.svelte";
  const animation = { v: "5.7.0", fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] };
  let source = $state(animation);
  let progress = $state(0.25);
  const log = [];
  let handle = null;
  export function setSource(next) { source = next; }
  export function setProgress(next) { progress = next; }
  export function eventLog() { return log; }
  export function lottieHandle() { return handle; }
</script>
<View>
  <LottieView {source} {progress} autoPlay loop={false} speed={2} colorFilters={[{ keypath: "layer", color: "#ff0000" }]} style={{ width: 100, height: 100 }}
    ref={(h) => { handle = h; }}
    onAnimationFinish={(cancelled) => log.push(["finish", cancelled])}
    onAnimationFailure={(error) => log.push(["failure", error])}
    onAnimationLoaded={() => log.push(["loaded"])} />
  <LottieView source={animation} duration={1000} speed={9} />
</View>
