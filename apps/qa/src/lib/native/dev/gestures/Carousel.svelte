<script lang="ts">
  import { ScrollView, Text, View } from "@alfayez/svelte-native";
  import { AnimatedView, createSharedValue, runOnJS, withSpring } from "@alfayez/svelte-native/animation";
  import { Gesture } from "@alfayez/svelte-native/gestures";
  import { theme } from "../../state.svelte.ts";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-carousel`: a horizontal Pan pager (snap to a page) inside a vertical ScrollView. `activeOffsetX` and `failOffsetY` let the
   * dominant axis win: a horizontal or 30 degree swipe turns the page, a vertical one fails the pan and scrolls.
   */
  let { session, probe }: { session: Session; probe: Probe } = $props();
  const pages = ["#3685ff", "#22a06b", "#d9534f"];
  const x = createSharedValue(0);
  const base = createSharedValue(0);
  const width = createSharedValue(0);

  function count(event: "begin" | "start" | "finalize", ok: boolean) { session.count("pager", event, ok); }
  function ended(ok: boolean, page: number) {
    session.count("pager", "end", ok);
    session.mark("page", page);
  }

  const pan = Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-10, 10])
    .onBegin(() => { runOnJS(count)("begin", true); })
    .onStart(() => { runOnJS(count)("start", true); })
    .onUpdate((event) => { x.value = base.value + event.translationX; })
    .onEnd((event, success) => {
      let next = Math.round(-base.value / width.value);
      if (success && event.translationX < -width.value / 4) next = Math.min(2, next + 1);
      else if (success && event.translationX > width.value / 4) next = Math.max(0, next - 1);
      base.value = -next * width.value;
      x.value = withSpring(base.value);
      runOnJS(ended)(success, next);
    })
    .onFinalize((_event, success) => { runOnJS(count)("finalize", success); });
  // svelte-ignore state_referenced_locally
  session.mark("page", 0);
  // svelte-ignore state_referenced_locally
  session.mark("scrollY", 0);
</script>

<ScrollView {...probe("scroll")} scrollEventThrottle={16} onScroll={(event) => { session.mark("scrollY", event.nativeEvent.contentOffset.y); }}
  style={{ height: 560 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
  <Text style={{ color: theme.foreground, fontSize: 15 }}>Swipe the pager sideways; drag up to scroll the page</Text>
  <View {...probe("pager")} gesture={pan} onLayout={(event) => { width.value = event.nativeEvent.layout.width; }} style={{ height: 160, borderRadius: 12, overflow: "hidden" }}>
    <AnimatedView collapsable={false} style={{ flexDirection: "row", width: "300%", height: 160 }} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }}>
      {#each pages as color, index (color)}
        <View style={{ width: "33.3333%", height: 160, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "white", fontSize: 22, fontWeight: "600" }}>Page {index + 1}</Text>
        </View>
      {/each}
    </AnimatedView>
  </View>
  {#each Array.from({ length: 24 }, (_, index) => index + 1) as row (row)}
    <View style={{ height: 48, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, justifyContent: "center", paddingHorizontal: 14 }}>
      <Text style={{ color: theme.foreground, fontSize: 14 }}>Row {row}</Text>
    </View>
  {/each}
</ScrollView>
