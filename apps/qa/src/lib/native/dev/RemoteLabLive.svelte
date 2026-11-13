<script lang="ts">
  import { Text, View } from "@alfayez/svelte-native";
  import { refreshAll } from "@alfayez/svelte-native/remote";
  import { theme } from "#lib/native/state.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";
  import { labClock, labStats } from "#lib/native/dev/remote-lab.remote.ts";

  /**
   * The live clock of the remote functions lab page, 30 ticks 400 ms apart, and what the server counts: the streams it has open (this clock is one; a second
   * means a stream was left open by a screen that is gone). A component of its own, shown once the app has a host: making the clock calls a remote function,
   * which says "no host" when there is none, and the page has to stay up to take one.
   */
  const clock = labClock(30);
  let serverStats = $state("");
  async function showStats() {
    try {
      const stats = labStats();
      await stats.refresh();
      serverStats = JSON.stringify(stats.current);
    } catch (error) {
      serverStats = `error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
</script>

<View style={{ gap: 8 }}>
  <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Live query</Text>
  <Text testID="remote.live" style={{ color: theme.foreground, fontSize: 28, fontVariant: ["tabular-nums"] }}>{clock.current ?? "-"}</Text>
  <Text style={{ color: theme.muted, fontSize: 13 }}>{clock.connected ? "connected" : clock.done ? "finished" : "connecting"}</Text>
  <Button label="Reconnect" variant="secondary" onPress={() => clock.reconnect()} />
  <Button label="Refresh everything" variant="secondary" onPress={() => refreshAll()} />
  <Button label="Server stats" variant="secondary" onPress={showStats} />
  <Text testID="remote.stats" selectable style={{ color: theme.muted, fontSize: 13 }}>{serverStats}</Text>
</View>
