<script lang="ts">
  import { ScrollView, Text, View } from "@rasheed/svelte-native";
  import { theme } from "../../state.svelte.ts";
  import PanBox from "./PanBox.svelte";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-sheet`, the content of a two-detent sheet (the route draws the `Screen`): the grabber's band, a vertical Pan with the
   * default offsets, a vertical Pan with `activeOffsetY([-4, 4])` and a ScrollView. The pans sit above the ScrollView, outside it,
   * so their rectangles do not depend on its offset.
   */
  let { session, probe }: { session: Session; probe: Probe } = $props();
  // svelte-ignore state_referenced_locally
  session.mark("scrollY", 0);
</script>

<View style={{ flex: 1, paddingHorizontal: 16, gap: 10 }}>
  <View ref={probe("grabber").ref} testID={probe("grabber").testID} collapsable={false} style={{ height: 28 }} />
  <PanBox name="boxDefault" {session} {probe} label="Pan, default offsets" />
  <PanBox name="boxFast" {session} {probe} activeY={[-4, 4]} label="Pan, activeOffsetY [-4, 4]" />
  <ScrollView ref={probe("scroll").ref} testID={probe("scroll").testID} collapsable={false} scrollEventThrottle={16} onScroll={(event) => { session.mark("scrollY", event.nativeEvent.contentOffset.y); }} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 24 }}>
    <Text style={{ color: theme.muted, fontSize: 13 }}>Scrolls when the sheet is at its top detent</Text>
    {#each Array.from({ length: 30 }, (_, index) => index + 1) as row (row)}
      <View style={{ height: 48, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.background, justifyContent: "center", paddingHorizontal: 14 }}>
        <Text style={{ color: theme.foreground, fontSize: 14 }}>Sheet row {row}</Text>
      </View>
    {/each}
  </ScrollView>
</View>
