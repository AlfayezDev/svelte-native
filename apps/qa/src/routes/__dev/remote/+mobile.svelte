<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Text, TextInput, View } from "expo-svelte";
  import { remoteHost } from "expo-svelte/remote";
  import { nativeLabEnabled, theme } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";
  import Button from "#lib/native/components/Button.svelte";
  import RemoteLabForm from "#lib/native/dev/RemoteLabForm.svelte";
  import RemoteLabLive from "#lib/native/dev/RemoteLabLive.svelte";
  import { checks } from "#lib/native/dev/remote-lab-checks.ts";
  import { applyLabOrigin } from "#lib/native/dev/remote-lab-host.ts";
  import { field } from "#lib/native/dev/remote-lab-style.ts";

  /**
   * The remote functions lab (packages/expo-svelte/README.md, "Remote functions"): one of each kind of SvelteKit remote function, imported from
   * `remote-lab.remote.ts` as a web page would and answered by the QA app's dev server (`pnpm dev`, port 3000), whose origin is the build's
   * `extra.expoSvelte.remote` (`EXPO_SVELTE_REMOTE_ORIGIN` when the QA app was built) or what is typed below. `?run=1` runs the checks on
   * mount and logs `[remote lab results] {json}` (and `?origin=<origin>` points the page at a server first); a person can also press "Run the
   * checks" and use the form and the live clock below. Every result is a `Text` with `testID` `remote.check.<id>` whose text starts with
   * `pass` or `fail`. The form and the clock are components that are shown once there is a host (making them calls a remote function, which says "no host"
   * when there is none): this script calls no remote function, so a build without a host still gets the page to type one into.
   */
  let { url }: { url?: URL } = $props();
  const autorun = untrack(() => url?.searchParams.get("run") === "1");
  const initialOrigin = untrack(() => url?.searchParams.get("origin"));
  // (Only a build with the lab on lets a link or the field below change the host.)
  applyLabOrigin(initialOrigin, nativeLabEnabled);

  let hostError = $state("");
  // (An app config that is wrong makes this throw; the page then says so and takes a host to use instead.)
  function currentOrigin(): string | undefined {
    try { return remoteHost().origin; }
    catch (error) { hostError = error instanceof Error ? error.message : String(error); return undefined; }
  }
  const initial = currentOrigin();
  let origin = $state(initial);
  const host = $derived(origin ?? "none: set extra.expoSvelte.remote or type an origin");
  let typed = $state(initial ?? "");
  function useHost() {
    try {
      applyLabOrigin(typed, nativeLabEnabled);
      hostError = "";
      origin = currentOrigin();
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

    {#if origin !== undefined}
      <RemoteLabForm />
      <RemoteLabLive />
    {:else}
      <Text style={{ color: theme.muted, fontSize: 15 }}>The form and the live clock appear once the app has a host.</Text>
    {/if}
  </Page>
{/if}
