<script lang="ts">
  import { Text, View } from "@rasheed/svelte-native";
  import { AnimatedView, createSharedValue, runOnJS, runOnUIAsync, withSpring } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  import { theme } from "../../state.svelte.ts";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-box`: one draggable box. The default is a Pan on the UI thread (worklet callbacks that write shared values and
   * report through `runOnJS`) with a spring on release; `js` puts every callback on the JavaScript thread (`runOnJS(true)`).
   */
  let { session, probe, js }: { session: Session; probe: Probe; js: boolean } = $props();
  // svelte-ignore state_referenced_locally
  const onJs = js;

  // Shared values first: creating one loads Reanimated, so the worklets below capture the real `withSpring` and `runOnJS`.
  const tx = createSharedValue(0);
  const ty = createSharedValue(0);
  const updates = createSharedValue(0);
  const peakX = createSharedValue(0);
  const peakY = createSharedValue(0);

  function count(event: "begin" | "start" | "finalize", ok: boolean) { session.count("pan", event, ok); }
  function ended(ok: boolean, moved: number, x: number, y: number) {
    session.count("pan", "update", true, moved);
    session.peak("peakX", x);
    session.peak("peakY", y);
    session.count("pan", "end", ok);
  }

  const pan = onJs
    ? Gesture.Pan().runOnJS(true)
        .onBegin(() => { session.count("pan", "begin"); })
        .onStart(() => { session.count("pan", "start"); })
        .onUpdate((event) => {
          tx.value = event.translationX; ty.value = event.translationY;
          session.count("pan", "update");
          session.peak("peakX", Math.abs(event.translationX));
          session.peak("peakY", Math.abs(event.translationY));
        })
        .onEnd((_event, success) => { session.count("pan", "end", success); tx.value = withSpring(0); ty.value = withSpring(0); })
        .onFinalize((_event, success) => { session.count("pan", "finalize", success); })
    : Gesture.Pan()
        .onBegin(() => { updates.value = 0; peakX.value = 0; peakY.value = 0; runOnJS(count)("begin", true); })
        .onStart(() => { runOnJS(count)("start", true); })
        .onUpdate((event) => {
          tx.value = event.translationX; ty.value = event.translationY; updates.value += 1;
          peakX.value = Math.max(peakX.value, Math.abs(event.translationX));
          peakY.value = Math.max(peakY.value, Math.abs(event.translationY));
        })
        .onEnd((_event, success) => {
          runOnJS(ended)(success, updates.value, peakX.value, peakY.value);
          tx.value = withSpring(0); ty.value = withSpring(0);
        })
        .onFinalize((_event, success) => { runOnJS(count)("finalize", success); });

  // After the spring: the box must have come back to where it started.
  // svelte-ignore state_referenced_locally
  session.onSettle(async () => {
    const rest = await runOnUIAsync(() => { "worklet"; return [tx.value, ty.value]; });
    session.mark("restX", rest[0] ?? 99);
    session.mark("restY", rest[1] ?? 99);
  });
</script>

<View style={{ gap: 12, padding: 16 }}>
  <Text style={{ color: theme.foreground, fontSize: 15 }}>Drag the box ({onJs ? "JavaScript thread" : "UI thread"})</Text>
  <View {...probe("area")} style={{ height: 200 }}>
    <View {...probe("box")} style={{ position: "absolute", left: 24, top: 24, width: 96, height: 96 }}>
      <AnimatedView collapsable={false} gesture={pan} testID="gesture.box.moving"
        style={{ width: 96, height: 96, borderRadius: 12, backgroundColor: "#3685ff" }}
        animatedStyle={() => { "worklet"; return { transform: [{ translateX: tx.value }, { translateY: ty.value }] }; }} />
    </View>
  </View>
</View>
