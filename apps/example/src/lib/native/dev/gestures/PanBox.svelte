<script lang="ts">
  import type { Snippet } from "svelte";
  import { Text, View } from "@rasheed/svelte-native";
  import { createSharedValue, runOnJS } from "@rasheed/svelte-native/animation";
  import { Gesture, type GestureAttribute, type GestureType } from "@rasheed/svelte-native/gestures";
  import { theme } from "../../state.svelte.ts";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * A View with a Pan on it that counts what it reports under `name` (UI thread); `rect` names its rectangle when that is not `name`. The offsets and the
   * relations are the page's choice: `activeY` is `activeOffsetY`, `activeX` `activeOffsetX`, `failX`/`failY` the fail offsets,
   * `simultaneous` a gesture (a `Gesture.Native()` of a scroll view) the pan runs with. Children are drawn inside; without any, `label`.
   */
  let { name, rect, session, probe, activeX, activeY, failX, failY, simultaneous, label, height = 64, children }: {
    name: string; rect?: string; session: Session; probe: Probe;
    activeX?: [number, number]; activeY?: [number, number]; failX?: [number, number]; failY?: [number, number];
    simultaneous?: GestureType; label?: string; height?: number; children?: Snippet;
  } = $props();
  // svelte-ignore state_referenced_locally
  const handler = name;
  // svelte-ignore state_referenced_locally
  const external = simultaneous;
  // svelte-ignore state_referenced_locally
  const rectName = rect ?? name;

  const updates = createSharedValue(0);
  function count(event: "begin" | "start" | "finalize", ok: boolean) { session.count(handler, event, ok); }
  function ended(ok: boolean, moved: number) {
    session.count(handler, "update", true, moved);
    session.count(handler, "end", ok);
  }

  const pan = Gesture.Pan()
    .onBegin(() => { updates.value = 0; runOnJS(count)("begin", true); })
    .onStart(() => { runOnJS(count)("start", true); })
    .onUpdate(() => { updates.value += 1; })
    .onEnd((_event, success) => { runOnJS(ended)(success, updates.value); })
    .onFinalize((_event, success) => { runOnJS(count)("finalize", success); });
  // svelte-ignore state_referenced_locally
  if (activeX) pan.activeOffsetX(activeX);
  // svelte-ignore state_referenced_locally
  if (activeY) pan.activeOffsetY(activeY);
  // svelte-ignore state_referenced_locally
  if (failX) pan.failOffsetX(failX);
  // svelte-ignore state_referenced_locally
  if (failY) pan.failOffsetY(failY);
  if (external) pan.simultaneousWithExternalGesture(external);
  const attribute: GestureAttribute = pan;
</script>

<View {...probe(rectName)} gesture={attribute} style={{ height, borderRadius: 10, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, justifyContent: "center", padding: 10 }}>
  {#if children}{@render children()}{:else}<Text style={{ color: theme.foreground, fontSize: 14 }}>{label ?? name}</Text>{/if}
</View>
