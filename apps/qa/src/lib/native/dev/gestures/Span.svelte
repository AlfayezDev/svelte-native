<script lang="ts">
  import { View, createSharedValue, runOnJS, Gesture } from "expo-svelte";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-span`: a press inside a paragraph goes to the span under the finger (SPEC.md, "Touches on nested Text"), and a press elsewhere in it to the paragraph. The sentence is HTML, a `<p>` of two lines
   * (a line height of 32 dp, so the first line is the top half of its rectangle and the second the bottom half) with an `<a>` that begins the second line and some plain words after it. The link
   * counts its presses under `link` and the paragraph its own under `paragraph`; a `Tap` on the view around them counts every tap under `area.tap`, which is what each step waits for, because a tap that
   * presses nothing has no other trace.
   */
  let { session, probe }: { session: Session; probe: Probe } = $props();
  createSharedValue(0); // loads Reanimated before the worklets below are made

  function count(event: "begin" | "start" | "finalize", ok: boolean) { session.count("area.tap", event, ok); }
  function ended(ok: boolean) { session.count("area.tap", "end", ok); }
  const tap = Gesture.Tap()
    .onBegin(() => { runOnJS(count)("begin", true); })
    .onStart(() => { runOnJS(count)("start", true); })
    .onEnd((_event, success) => { runOnJS(ended)(success); })
    .onFinalize((_event, success) => { runOnJS(count)("finalize", success); });
</script>

<View {...probe("area")} gesture={tap} style={{ padding: 16 }}>
  <p {...probe("sentence")} onclick={() => { session.press("paragraph"); }} style="font-size: 18px; line-height: 32px" class="text-zinc-900 dark:text-zinc-100">Tap here: not the link.<br /><a href="#span" onclick={() => { session.press("link"); }} class="text-sky-600 underline">the link</a> then plain words</p>
</View>
