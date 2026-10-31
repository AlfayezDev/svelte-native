<script lang="ts">
  import { Text, View } from "@rasheed/svelte-native";
  import { AnimatedView, createSharedValue, runOnJS } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  import { theme } from "../../state.svelte.ts";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-pinch-rotate`: `Simultaneous(Pinch, Rotation)` on an AnimatedView, UI thread. The box keeps what the last gesture left
   * (`saved*`), so the iOS driver, which can only pinch and then rotate, ends at the same scale and angle as one two-finger move.
   */
  let { session, probe }: { session: Session; probe: Probe } = $props();

  const scale = createSharedValue(1);
  const rotation = createSharedValue(0);
  const savedScale = createSharedValue(1);
  const savedRotation = createSharedValue(0);

  function count(name: "pinch" | "rotation", event: "begin" | "start" | "finalize", ok: boolean) { session.count(name, event, ok); }
  function ended(name: "pinch" | "rotation", ok: boolean, finalScale: number, finalRotation: number) {
    session.mark("scale", finalScale);
    session.mark("rotationDeg", (finalRotation * 180) / Math.PI);
    session.count(name, "end", ok);
  }

  const pinch = Gesture.Pinch()
    .onBegin(() => { runOnJS(count)("pinch", "begin", true); })
    .onStart(() => { runOnJS(count)("pinch", "start", true); })
    .onUpdate((event) => { scale.value = savedScale.value * event.scale; })
    .onEnd((_event, success) => { savedScale.value = scale.value; runOnJS(ended)("pinch", success, scale.value, rotation.value); })
    .onFinalize((_event, success) => { runOnJS(count)("pinch", "finalize", success); });
  const rotate = Gesture.Rotation()
    .onBegin(() => { runOnJS(count)("rotation", "begin", true); })
    .onStart(() => { runOnJS(count)("rotation", "start", true); })
    .onUpdate((event) => { rotation.value = savedRotation.value + event.rotation; })
    .onEnd((_event, success) => { savedRotation.value = rotation.value; runOnJS(ended)("rotation", success, scale.value, rotation.value); })
    .onFinalize((_event, success) => { runOnJS(count)("rotation", "finalize", success); });
  const both = Gesture.Simultaneous(pinch, rotate);
</script>

<View style={{ gap: 12, padding: 16 }}>
  <Text style={{ color: theme.foreground, fontSize: 15 }}>Pinch and rotate the square</Text>
  <View ref={probe("target").ref} testID={probe("target").testID} collapsable={false} style={{ height: 320, alignItems: "center", justifyContent: "center" }}>
    <AnimatedView collapsable={false} gesture={both} testID="gesture.target.moving"
      style={{ width: 120, height: 120, borderRadius: 14, backgroundColor: "#3685ff" }}
      animatedStyle={() => { "worklet"; return { transform: [{ scale: scale.value }, { rotate: `${rotation.value}rad` }] }; }} />
  </View>
</View>
