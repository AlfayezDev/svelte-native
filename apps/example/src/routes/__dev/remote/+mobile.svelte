<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Switch, Text, TextInput, View } from "@rasheed/svelte-native";
  import { native, refreshAll, remoteHost } from "@rasheed/svelte-native/remote";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";
  import Button from "#lib/native/components/Button.svelte";
  import { labClock, labSignup, labStats } from "#lib/native/dev/remote-lab.remote.ts";
  import { checks } from "#lib/native/dev/remote-lab-checks.ts";
  import { applyLabOrigin } from "#lib/native/dev/remote-lab-host.ts";

  /**
   * The remote functions lab (packages/svelte-native/README.md, "Remote functions"): one of each kind of SvelteKit remote function, imported from
   * `remote-lab.remote.ts` as a web page would and answered by the platform app's dev server (`pnpm dev`, port 3000), whose origin is the build's
   * `extra.svelteNative.remote` (`SVELTE_NATIVE_REMOTE_ORIGIN` when the QA app was built) or what is typed below. `?run=1` runs the checks on
   * mount and logs `[remote lab results] {json}` (and `?origin=<origin>` points the page at a server first); a person can also press "Run the
   * checks" and use the form and the live clock below. Every result is a `Text` with `testID` `remote.check.<id>` whose text starts with
   * `pass` or `fail`.
   */
  let { url }: { url?: URL } = $props();
  const autorun = untrack(() => url?.searchParams.get("run") === "1");
  const initialOrigin = untrack(() => url?.searchParams.get("origin"));
  // (Only a build with the lab on lets a link or the field below change the host.)
  applyLabOrigin(initialOrigin, nativeLabEnabled);

  let host = $state(remoteHost().origin ?? "none: set extra.svelteNative.remote or type an origin");
  let typed = $state(remoteHost().origin ?? "");
  let hostError = $state("");
  function useHost() {
    try {
      applyLabOrigin(typed, nativeLabEnabled);
      host = remoteHost().origin ?? "none";
      hostError = "";
    } catch (error) {
      hostError = error instanceof Error ? error.message : String(error);
    }
  }

  let results = $state<Record<string, string>>({});
  let running = $state(false);
  async function runChecks() {
    running = true;
    results = {};
    for (const check of checks) {
      try { results[check.id] = `pass: ${await check.run()}`; }
      catch (error) { results[check.id] = `fail: ${error instanceof Error ? error.message : String(error)}`; }
    }
    running = false;
    console.info("[remote lab results]", JSON.stringify({ origin: remoteHost().origin, results: $state.snapshot(results) }));
  }
  onMount(() => {
    if (!nativeLabEnabled || !autorun) return;
    const timer = setTimeout(() => { void runChecks(); }, 800);
    return () => clearTimeout(timer);
  });

  // The form a person fills in: SvelteKit's `form` with TextInput and Switch.
  const signup = native(labSignup);
  let outcome = $state("");
  async function submit() {
    outcome = "";
    try { outcome = (await signup.submit()) ? "sent" : "not accepted"; }
    catch (error) { outcome = `error: ${error instanceof Error ? error.message : String(error)}`; }
  }
  // What the server counts: the streams it has open (this page's clock is one; a second means a stream was left open by a screen that is gone).
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
  // The live clock: 30 ticks, 400 ms apart.
  const clock = labClock(30);
  const field = { minHeight: 52, borderWidth: 1, borderColor: theme.border, borderRadius: 12, overflow: "hidden" as const, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: theme.surface, color: theme.foreground, fontSize: 17 };
</script>

{#if nativeLabEnabled}
  <Page title="Remote functions" description="SvelteKit remote functions called from this screen, over HTTP, as a web page would call them.">
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Host</Text>
      <Text testID="remote.host" selectable style={{ color: theme.muted, fontSize: 15 }}>{host}</Text>
      <TextInput bind:value={typed} accessibilityLabel="Origin" autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://localhost:3000" placeholderTextColor={theme.muted} style={field} />
      <Button label="Use this host" variant="secondary" onPress={useHost} />
      {#if hostError}<Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 14 }}>{hostError}</Text>{/if}
    </View>

    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Checks</Text>
      <Button label="Run the checks" onPress={runChecks} busy={running} />
      {#each checks as check (check.id)}
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.foreground, fontSize: 15 }}>{check.title}</Text>
          <Text testID={`remote.check.${check.id}`} selectable style={{ color: results[check.id]?.startsWith("fail") ? theme.danger : theme.muted, fontSize: 13 }}>{results[check.id] ?? (running ? "running" : "not run")}</Text>
        </View>
      {/each}
    </View>

    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Form</Text>
      <TextInput {...signup.fields.name.as("text")} accessibilityLabel="Name" placeholder="Name" placeholderTextColor={theme.muted} style={field} />
      {#each signup.fields.name.issues() ?? [] as issue (issue.message)}<Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 14 }}>{issue.message}</Text>{/each}
      <TextInput {...signup.fields.age.as("number")} accessibilityLabel="Age" placeholder="Age" placeholderTextColor={theme.muted} style={field} />
      {#each signup.fields.age.issues() ?? [] as issue (issue.message)}<Text accessibilityRole="alert" style={{ color: theme.danger, fontSize: 14 }}>{issue.message}</Text>{/each}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: theme.foreground, fontSize: 16 }}>Subscribe</Text>
        <Switch {...signup.fields.subscribe.as("checkbox")} accessibilityLabel="Subscribe" />
      </View>
      <Button label="Sign up" onPress={submit} busy={signup.pending > 0} />
      <Text testID="remote.form.outcome" style={{ color: theme.muted, fontSize: 13 }}>{outcome}{signup.result ? ` ${JSON.stringify(signup.result)}` : ""}</Text>
    </View>

    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: theme.foreground, fontSize: 20, fontWeight: "600" }}>Live query</Text>
      <Text testID="remote.live" style={{ color: theme.foreground, fontSize: 28, fontVariant: ["tabular-nums"] }}>{clock.current ?? "-"}</Text>
      <Text style={{ color: theme.muted, fontSize: 13 }}>{clock.connected ? "connected" : clock.done ? "finished" : "connecting"}</Text>
      <Button label="Reconnect" variant="secondary" onPress={() => clock.reconnect()} />
      <Button label="Refresh everything" variant="secondary" onPress={() => refreshAll()} />
      <Button label="Server stats" variant="secondary" onPress={showStats} />
      <Text testID="remote.stats" selectable style={{ color: theme.muted, fontSize: 13 }}>{serverStats}</Text>
    </View>
  </Page>
{/if}
