<script lang="ts">
  import { Text } from "@rasheed/svelte-native";
  import { AnimatedView, createSharedValue, runOnJS, withSpring } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  import Button from "#lib/components/Button.svelte";
  import SwipeRow from "#lib/components/native/SwipeRow.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // `Gesture` is react-native-gesture-handler's builders (`Pan`, `Pinch`, `Rotation`, `LongPress`, `Tap`, ...). A gesture goes on a view with
  // `gesture={...}`, and its callbacks are worklets that run on the UI thread, so they write shared values and `runOnJS` reaches Svelte state.
  const x = createSharedValue(0); // the first shared value loads Reanimated
  const y = createSharedValue(0);
  const scale = createSharedValue(1);
  const angle = createSharedValue(0);
  const press = createSharedValue(1);
  let held = $state(0);
  let rows = $state(["Swipe me left", "Swipe me too", "And me"]);
  const markHeld = () => { held += 1; };
  const box = $derived({ width: 96, height: 96, borderRadius: 16, backgroundColor: theme.colors.accent });

  const drag = Gesture.Pan()
    .onUpdate((event) => { x.value = event.translationX; y.value = event.translationY; })
    .onEnd(() => { x.value = withSpring(0); y.value = withSpring(0); });
  const pinchAndRotate = Gesture.Simultaneous(
    Gesture.Pinch().onUpdate((event) => { scale.value = event.scale; }).onEnd(() => { scale.value = withSpring(1); }),
    Gesture.Rotation().onUpdate((event) => { angle.value = event.rotation; }).onEnd(() => { angle.value = withSpring(0); }),
  );
  const hold = Gesture.LongPress()
    .minDuration(600)
    .onBegin(() => { press.value = withSpring(0.9); })
    .onStart(() => { runOnJS(markHeld)(); })
    .onFinalize(() => { press.value = withSpring(1); });
</script>

<Page title="Gestures" intro="Gestures are recognised by the platform, not by JavaScript. Drag the box, pinch and twist the square with two fingers, swipe a row, or hold the button down.">
  <Section title="Pan: drag" note="Drag the box; it springs back when you let go. A touch anywhere else still scrolls the page.">
    <AnimatedView gesture={drag} style={box} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }, { translateY: y.value }] }; }} />
  </Section>

  <Section title="Pinch and rotation" note="Two fingers on the square, at the same time.">
    <AnimatedView gesture={pinchAndRotate} style={{ ...box, alignSelf: "center" }} animatedStyle={() => { "worklet"; return { transform: [{ scale: scale.value }, { rotate: `${angle.value}rad` }] }; }} />
  </Section>

  <Section title="A swipeable row" note="Swipe left past 100 pt to delete. A vertical move still scrolls the page.">
    {#each rows as row (row)}
      <SwipeRow label={row} onDelete={() => { rows = rows.filter((other) => other !== row); }} />
    {/each}
    {#if rows.length === 0}<Button label="Bring the rows back" onPress={() => { rows = ["Swipe me left", "Swipe me too", "And me"]; }} />{/if}
  </Section>

  <Section title="Long press" note="Hold for 0.6 seconds.">
    <AnimatedView
      gesture={hold}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Hold me"
      accessibilityActions={[{ name: "activate", label: "Count a hold" }]}
      onAccessibilityAction={markHeld}
      style={{ minHeight: 56, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.accent }}
      animatedStyle={() => { "worklet"; return { transform: [{ scale: press.value }] }; }}
    >
      <Text style={[text.heading, { color: theme.colors.onAccent }]}>{held === 0 ? "Hold me" : `Held ${held} time${held === 1 ? "" : "s"}`}</Text>
    </AnimatedView>
  </Section>
</Page>
