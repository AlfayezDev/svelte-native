<script lang="ts">
  import { Text, View } from "@rasheed/svelte-native";
  import { channel, checkForUpdateAsync, fetchUpdateAsync, isEnabled, reloadAsync, runtimeVersion, updateId } from "@rasheed/svelte-native/updates";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text } from "#lib/theme.svelte.ts";

  // `@rasheed/svelte-native/updates` is expo-updates reduced to what this host needs, and works with `eas update`. `isEnabled`, `updateId`,
  // `channel` and `runtimeVersion` say what is running; `checkForUpdateAsync()` asks the server, `fetchUpdateAsync()` downloads, `reloadAsync()`
  // restarts on the new update. In a build that has updates off (a development build, or no `updates.url` in app.config.ts) every call answers
  // "updatesDisabled" and does nothing.
  const facts = [
    ["Updates", isEnabled ? "on" : "off in this build"],
    ["Running", updateId ?? "the bundle embedded in the app"],
    ["Channel", channel ?? "none"],
    ["Runtime version", runtimeVersion ?? "none"],
  ] as const;
  let status = $state("Not checked yet");
  let available = $state(false);
  async function check() {
    status = "Checking";
    try {
      const result = await checkForUpdateAsync();
      available = result.isAvailable;
      status = result.isAvailable ? "An update is available" : result.isRollBackToEmbedded ? "The server asks to go back to the embedded bundle" : `No update (${result.reason})`;
    } catch (error) {
      status = `The check failed: ${String(error)}`;
    }
  }
  async function install() {
    status = "Downloading";
    try {
      await fetchUpdateAsync();
      await reloadAsync();
    } catch (error) {
      status = `The download failed: ${String(error)}`;
    }
  }
</script>

<Page title="Updates" intro="Over-the-air updates replace the app's JavaScript without a store release. The screen shows which bundle is running and asks the update server whether there is a newer one.">
  <Section title="What is running" note="A build for a channel checks once after it starts and downloads the newest update for the next start. Add updates.url, runtimeVersion and UPDATES_CHANNEL to the app config to turn it on.">
    {#each facts as [label, value] (label)}
      <View style={{ gap: 2 }}>
        <Text style={text.caption}>{label}</Text>
        <Text selectable style={text.body}>{value}</Text>
      </View>
    {/each}
  </Section>

  <Section title="Check for an update">
    <Text style={text.body}>{status}</Text>
    <Button label="Check for an update" onPress={check} />
    {#if available}<Button label="Download and restart" variant="secondary" onPress={install} />{/if}
  </Section>
</Page>
