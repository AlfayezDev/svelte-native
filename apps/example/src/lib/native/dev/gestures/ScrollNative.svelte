<script lang="ts">
  import { ScrollView, Text, View } from "@rasheed/svelte-native";
  import { createSharedValue, runOnJS } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  import { theme } from "../../state.svelte.ts";
  import PanBox from "./PanBox.svelte";
  import type { Probe, Session } from "../gestures-lab.ts";

  /** `gestures-scroll-native`: a Pan around a ScrollView, simultaneous with the Native gesture the ScrollView carries; both must be active, and the list must move. */
  let { session, probe }: { session: Session; probe: Probe } = $props();
  createSharedValue(0); // loads Reanimated before the worklets below are made

  function count(event: "begin" | "start" | "finalize", ok: boolean) { session.count("native", event, ok); }
  function ended(ok: boolean) { session.count("native", "end", ok); }
  const native = Gesture.Native()
    .onBegin(() => { runOnJS(count)("begin", true); })
    .onStart(() => { runOnJS(count)("start", true); })
    .onEnd((_event, success) => { runOnJS(ended)(success); })
    .onFinalize((_event, success) => { runOnJS(count)("finalize", success); });
  // svelte-ignore state_referenced_locally
  session.mark("scrollY", 0);
</script>

<View style={{ gap: 12, padding: 16 }}>
  <Text style={{ color: theme.foreground, fontSize: 15 }}>Drag the list: the Pan and the scroll run together</Text>
  <PanBox name="pan" {session} {probe} activeY={[-10, 10]} simultaneous={native} height={420}>
    <ScrollView ref={probe("scroll").ref} testID={probe("scroll").testID} collapsable={false} gesture={native} scrollEventThrottle={16} onScroll={(event) => { session.mark("scrollY", event.nativeEvent.contentOffset.y); }} style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>
      {#each Array.from({ length: 40 }, (_, index) => index + 1) as row (row)}
        <View style={{ height: 44, borderRadius: 8, backgroundColor: theme.background, justifyContent: "center", paddingHorizontal: 12 }}>
          <Text style={{ color: theme.foreground, fontSize: 14 }}>Row {row}</Text>
        </View>
      {/each}
    </ScrollView>
  </PanBox>
</View>
