<script lang="ts">
  import { Text } from "@rasheed/svelte-native";
  import { LottieView, type LottieHandle } from "@rasheed/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text } from "#lib/theme.svelte.ts";
  import pulse from "../../../../assets/media/pulse.json";

  // `LottieView` plays a Lottie animation with lottie-react-native's view. `source` is a name, a `{ uri }`, or the animation itself: a `.json`
  // file imported here is the object. `autoPlay`, `loop` and `speed` are props; `ref` gives `play`, `pause`, `resume` and `reset`.
  let player: LottieHandle | null = null;
  let playing = $state(true);
  let speed = $state(1);
</script>

<Page title="Lottie" intro="LottieView plays an animation exported from After Effects. This one is a 1 KB blue dot that grows and shrinks, loaded from a JSON file in the app.">
  <Section title="LottieView" note="Pause and resume with the player's functions; the speed is a prop.">
    <LottieView
      source={pulse}
      autoPlay
      loop
      {speed}
      accessibilityLabel="A blue dot that pulses"
      ref={(handle) => { player = handle; }}
      style={{ height: 160 }}
    />
    <Text style={text.caption}>Speed {speed}x</Text>
    <Button
      label={playing ? "Pause" : "Resume"}
      onPress={() => { if (playing) player?.pause(); else player?.resume(); playing = !playing; }}
    />
    <Button label="Faster" variant="secondary" onPress={() => { speed = speed >= 3 ? 1 : speed + 1; }} />
  </Section>
</Page>
