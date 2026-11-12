<script lang="ts">
  import { Text } from "@example/svelte-native";
  import { Video, type VideoHandle } from "@example/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text } from "#lib/theme.svelte.ts";
  import pattern from "../../../../assets/media/pattern.mp4";

  // `Video` is react-native-video's native view with its props and callbacks: `source` (a bundled file here, or `{ uri }`), `paused`, `muted`,
  // `repeat`, `resizeMode`, `onProgress`... `ref` gives the library's functions (`seek`, `pause`, `resume`, `setVolume`, ...).
  let paused = $state(false);
  let seconds = $state(0);
  let player: VideoHandle | null = null;

  // `?demo`: let the clip play, pause it, play on, and seek back to the start.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => (paused = true), 1600],
    [() => (paused = false), 1800],
    [() => player?.seek(0), 1500],
  ], { settle: 2500, hold: 800 });
</script>

<Page title="Video" intro="Video plays a file with react-native-video. The clip is three seconds long, bundled with the app and looped. Pause it with the prop, or jump back with the player's seek function.">
  <Section title="Video" note="No sound in this clip.">
    <Video
      source={pattern}
      {paused}
      repeat
      muted
      resizeMode="cover"
      accessibilityLabel="Looping test pattern"
      ref={(handle) => { player = handle; }}
      onProgress={(event) => { seconds = event.currentTime; }}
      style={{ height: 200, borderRadius: 12, overflow: "hidden" }}
    />
    <Text style={text.caption}>Position {seconds.toFixed(1)} s</Text>
    <Button label={paused ? "Play" : "Pause"} onPress={() => { paused = !paused; }} />
    <Button label="Back to the start" variant="secondary" onPress={() => player?.seek(0)} />
  </Section>
</Page>
