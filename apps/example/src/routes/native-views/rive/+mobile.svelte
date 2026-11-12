<script lang="ts">
  import { Text } from "@example/svelte-native";
  import { Rive, type RiveHandle } from "@example/svelte-native/foreign";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";

  // `Rive` plays a Rive file with rive-react-native's view. The file is `url` (a web address), `resourceName` (a `.riv` in the app) or `source`.
  // `ref` gives `play`, `pause`, `stop` and `reset`, and the callbacks `onPlay`, `onPause` and `onError` tell what happened.
  let rive: RiveHandle | null = null;
  let status = $state("Loading the file");

  // `?demo`: the file comes from the network, so give it time; then pause it and play it again.
  let { url }: { url: URL } = $props();
  useDemo(() => url, [
    [() => rive?.pause(), 1600],
    [() => rive?.play(), 2200],
  ], { settle: 3500, hold: 800 });
</script>

<Page title="Rive" intro="Rive plays interactive animations made in the Rive editor. This screen loads a public example file over the network, so it needs a connection.">
  <Section title="Rive" note="vehicles.riv from Rive's CDN.">
    <Rive
      url="https://cdn.rive.app/animations/vehicles.riv"
      fit="contain"
      accessibilityLabel="A Rive animation of vehicles"
      ref={(handle) => { rive = handle; }}
      onPlay={(name) => { status = `Playing ${name}`; }}
      onPause={() => { status = "Paused"; }}
      onError={(error) => { status = `${error.type}: ${error.message}`; }}
      style={{ height: 200, borderRadius: 12, overflow: "hidden", backgroundColor: theme.colors.border }}
    />
    <Text style={text.caption}>{status}</Text>
    <Button label="Play" onPress={() => rive?.play()} />
    <Button label="Pause" variant="secondary" onPress={() => rive?.pause()} />
  </Section>
</Page>
