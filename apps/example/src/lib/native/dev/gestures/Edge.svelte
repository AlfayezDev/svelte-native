<script lang="ts">
  import { Text, View } from "@rasheed/svelte-native";
  import { theme } from "../../state.svelte.ts";
  import PanBox from "./PanBox.svelte";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-pushed-edge`: a pushed screen with a full-width horizontal Pan. A swipe from the screen's edge pops the screen (the
   * navigation's swipe wins its zone); one from further in starts the pan and leaves the screen where it is.
   */
  let { session, probe }: { session: Session; probe: Probe } = $props();
</script>

<View style={{ gap: 12, paddingVertical: 16 }}>
  <Text style={{ color: theme.foreground, fontSize: 15, paddingHorizontal: 16 }}>Swipe from the left edge, and from 100 dp in</Text>
  <PanBox name="pan" rect="box" {session} {probe} activeX={[-10, 10]} height={200} label="Full-width horizontal Pan" />
</View>
