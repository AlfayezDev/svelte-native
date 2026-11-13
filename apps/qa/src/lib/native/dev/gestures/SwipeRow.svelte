<script lang="ts">
  import { Text, View, AnimatedView, createSharedValue, runOnJS, withSpring, Gesture } from "@alfayez/svelte-native";
  import { theme } from "../../state.svelte.ts";
  import { ROW_THRESHOLD, type Probe, type Session } from "../gestures-lab.ts";

  /** One swipe-to-delete row of `gestures-row`: a Pan that fails on a vertical drag, and past the threshold asks the list to remove the row. */
  let { id, session, probe, aimed, remove }: { id: number; session: Session; probe: Probe; aimed: boolean; remove: (id: number) => void } = $props();
  // svelte-ignore state_referenced_locally
  const rowId = id;
  const name = `row-${rowId}`;
  const threshold = ROW_THRESHOLD;

  const tx = createSharedValue(0);
  const updates = createSharedValue(0);
  function count(event: "begin" | "start" | "finalize", ok: boolean) { session.count(name, event, ok); }
  function ended(ok: boolean, moved: number, x: number) {
    session.count(name, "update", true, moved);
    session.count(name, "end", ok);
    if (ok && x < -threshold) remove(rowId);
  }

  const pan = Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-10, 10])
    .onBegin(() => { updates.value = 0; runOnJS(count)("begin", true); })
    .onStart(() => { runOnJS(count)("start", true); })
    .onUpdate((event) => { tx.value = event.translationX; updates.value += 1; })
    .onEnd((_event, success) => {
      runOnJS(ended)(success, updates.value, tx.value);
      if (!(success && tx.value < -threshold)) tx.value = withSpring(0);
    })
    .onFinalize((_event, success) => { runOnJS(count)("finalize", success); });

  // Only the rows a step aims at are measured: every rectangle is a line of the handshake.
  // svelte-ignore state_referenced_locally
  const measured = aimed ? probe(name) : { collapsable: false as const };
</script>

<View {...measured} style={{ height: 56, marginBottom: 6, borderRadius: 10, overflow: "hidden", backgroundColor: "#d9534f", justifyContent: "center", alignItems: "flex-end", paddingRight: 16 }}>
  <Text style={{ color: "white", fontSize: 13, position: "absolute", right: 16 }}>Delete</Text>
  <AnimatedView collapsable={false} gesture={pan}
    style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, justifyContent: "center", paddingHorizontal: 14 }}
    animatedStyle={() => { "worklet"; return { transform: [{ translateX: tx.value }] }; }}>
    <Text style={{ color: theme.foreground, fontSize: 15 }}>Row {rowId}</Text>
  </AnimatedView>
</View>
