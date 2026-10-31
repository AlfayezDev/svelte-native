<script lang="ts">
  import { Pressable, Text, View } from "@rasheed/svelte-native";
  import { createSharedValue, runOnJS } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  import { theme } from "../../state.svelte.ts";
  import type { Probe, Session } from "../gestures-lab.ts";

  /**
   * `gestures-longpress-tap`: `Exclusive(LongPress(500 ms), Tap)` and `Race(LongPress, Tap)` on two boxes, each with a Pressable
   * inside. Every recogniser counts under `<box>.long` and `<box>.tap`, the Pressable's press under `<box>.press`.
   */
  let { session, probe }: { session: Session; probe: Probe } = $props();
  createSharedValue(0); // loads Reanimated before the worklets below are made

  function count(handler: string, event: "begin" | "start" | "finalize", ok: boolean) { session.count(handler, event, ok); }
  function ended(handler: string, ok: boolean) { session.count(handler, "end", ok); }

  function longPress(box: string) {
    const handler = `${box}.long`;
    return Gesture.LongPress().minDuration(500)
      .onBegin(() => { runOnJS(count)(handler, "begin", true); })
      .onStart(() => { runOnJS(count)(handler, "start", true); })
      .onEnd((_event, success) => { runOnJS(ended)(handler, success); })
      .onFinalize((_event, success) => { runOnJS(count)(handler, "finalize", success); });
  }
  function tap(box: string) {
    const handler = `${box}.tap`;
    return Gesture.Tap()
      .onBegin(() => { runOnJS(count)(handler, "begin", true); })
      .onStart(() => { runOnJS(count)(handler, "start", true); })
      .onEnd((_event, success) => { runOnJS(ended)(handler, success); })
      .onFinalize((_event, success) => { runOnJS(count)(handler, "finalize", success); });
  }
  const exclusive = Gesture.Exclusive(longPress("exclusive"), tap("exclusive"));
  const race = Gesture.Race(longPress("race"), tap("race"));
</script>

{#snippet box(name: "exclusive" | "race", label: string, gesture: typeof exclusive)}
  <View {...probe(name)} {gesture} style={{ height: 120, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, padding: 12, gap: 8 }}>
    <Text style={{ color: theme.foreground, fontSize: 14 }}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={`Press ${name}`} onPress={() => { session.press(`${name}.press`); }} style={{ flex: 1, borderRadius: 8, backgroundColor: "#3685ff", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "white", fontSize: 14 }}>Pressable</Text>
    </Pressable>
  </View>
{/snippet}

<View style={{ gap: 16, padding: 16 }}>
  <Text style={{ color: theme.foreground, fontSize: 15 }}>Tap, hold 700 ms, hold and drift 16 dp</Text>
  {@render box("exclusive", "Exclusive(LongPress, Tap)", exclusive)}
  {@render box("race", "Race(LongPress, Tap)", race)}
</View>
