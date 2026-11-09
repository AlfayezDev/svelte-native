<script lang="ts">
  import { Switch, Text, View } from "@rasheed/svelte-native";
  import { AnimatedView, createSharedValue, withRepeat, withSpring, withTiming } from "@rasheed/svelte-native/animation";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // `AnimatedView` is a View that Reanimated can move on the UI thread. A shared value holds a number; `withTiming`, `withSpring` and
  // `withRepeat` change it over time; `animatedStyle` is a worklet that turns the shared values into style on every frame. Create the shared
  // values first (the first one loads Reanimated). A worklet cannot read `$state`, so Svelte state goes into a shared value on the JavaScript side.
  const opacity = createSharedValue(1);
  const x = createSharedValue(0);
  const beat = createSharedValue(0);
  const grow = createSharedValue(0);
  let right = $state(false);
  let big = $state(false);
  beat.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  $effect(() => { grow.value = withTiming(big ? 1 : 0, { duration: 250 }); });
  const box = $derived({ width: 56, height: 56, borderRadius: 12, backgroundColor: theme.colors.accent });
</script>

<Page title="Animation" intro="Animations run on the UI thread, so they stay smooth while JavaScript is busy. Each example below is a shared value, a helper that moves it, and a worklet that turns it into style.">
  <Section title="Fade (withTiming)" note="Opacity goes to 0 or 1 over half a second.">
    <AnimatedView style={{ ...box, width: "100%" }} animatedStyle={() => { "worklet"; return { opacity: opacity.value }; }} />
    <Button label="Fade" variant="secondary" onPress={() => { opacity.value = withTiming(opacity.value < 0.5 ? 1 : 0, { duration: 500 }); }} />
  </Section>

  <Section title="Spring (withSpring)" note="The box overshoots and settles.">
    <AnimatedView style={box} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }} />
    <Button label="Move" variant="secondary" onPress={() => { right = !right; x.value = withSpring(right ? 160 : 0, { damping: 8, stiffness: 120 }); }} />
  </Section>

  <Section title="Loop (withRepeat, and CSS keyframes)" note="Left: a worklet repeats a shared value. Right: the same motion as CSS keyframes, which run in native code without a worklet.">
    <View style={{ flexDirection: "row", gap: 24 }}>
      <AnimatedView style={box} animatedStyle={() => { "worklet"; return { transform: [{ scale: 0.7 + 0.5 * beat.value }] }; }} />
      <AnimatedView
        style={{
          ...box,
          animationName: { from: { transform: [{ scale: 0.7 }] }, to: { transform: [{ scale: 1.2 }] } },
          animationDuration: "700ms",
          animationIterationCount: "infinite",
          animationDirection: "alternate",
          animationTimingFunction: "ease-in-out",
        }}
      />
    </View>
  </Section>

  <Section title="Driven by state" note="The switch is $state. An effect writes the target into a shared value, and the worklet follows it.">
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Text style={text.body}>Big</Text>
      <Switch value={big} onValueChange={(next) => { big = next; }} accessibilityLabel="Big" />
    </View>
    <AnimatedView style={box} animatedStyle={() => { "worklet"; return { opacity: 0.5 + 0.5 * grow.value, transform: [{ scale: 1 + 0.6 * grow.value }] }; }} />
  </Section>
</Page>
