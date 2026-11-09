<script lang="ts">
  import { Text, TextInput } from "@rasheed/svelte-native";
  import { configureRemote, remoteHost } from "@rasheed/svelte-native/remote";
  import Button from "#lib/components/Button.svelte";
  import RemoteExamples from "#lib/components/native/RemoteExamples.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { text, theme } from "#lib/theme.svelte.ts";

  // SvelteKit's remote functions (`query`, `command`, `form`) called from a screen. The functions live in a `*.remote.ts` module, here
  // src/lib/remote/notes.remote.ts, and run on a SvelteKit server; the app only needs to know where it is. The host is `extra.svelteNative.remote`
  // in the app config (app.config.ts writes it from `SVELTE_NATIVE_REMOTE_ORIGIN`), and `configureRemote({ origin })` sets it while the app runs.
  // Without a host a remote function throws when it is called, so this screen says so and shows the examples only when there is one.
  let origin = $state(remoteHost().origin);
  let typed = $state("");
  let problem = $state("");
  function useHost() {
    try {
      configureRemote({ origin: typed });
      origin = remoteHost().origin;
      problem = "";
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<Page title="Remote functions" intro="A remote function is a function that runs on your SvelteKit server and is called from the app like a local one. The app sends the call over HTTP and gets the result back, with the loading and error state a screen needs.">
  <Section title="Host" note={origin ? "Calls go to this server." : "This build has no host, so no remote function can run. Build with SVELTE_NATIVE_REMOTE_ORIGIN=https://your-server, or enter an origin here."}>
    <Text selectable style={text.body}>{origin ?? "No host"}</Text>
    <TextInput
      bind:value={typed}
      accessibilityLabel="Origin"
      placeholder="http://192.168.1.10:3000"
      placeholderTextColor={theme.colors.muted}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      style={{ minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 12, color: theme.colors.text, fontSize: 16 }}
    />
    <Button label="Use this host" variant="secondary" onPress={useHost} />
    {#if problem}<Text accessibilityRole="alert" style={[text.caption, { color: theme.colors.danger }]}>{problem}</Text>{/if}
  </Section>

  {#if origin}
    <RemoteExamples />
  {:else}
    <Section title="Examples">
      <Text style={text.caption}>A query, a command and a form appear here once the app has a host.</Text>
    </Section>
  {/if}
</Page>
