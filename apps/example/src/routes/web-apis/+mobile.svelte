<script lang="ts">
  import { Image, Text, View } from "@alfayez/svelte-native";
  import Button from "#lib/components/Button.svelte";
  import Page from "#lib/components/Page.svelte";
  import Section from "#lib/components/Section.svelte";
  import { scroller, useDemo } from "#lib/demo.ts";
  import { text, theme } from "#lib/theme.svelte.ts";
  import { checkCount, runChecks, type CheckResult } from "#lib/web-api-checks.ts";

  // The web's own fetch, Blob, crypto and localStorage, with no import: the library installs them on the device, backed by native code. A response's
  // bytes stay native until the code reads them; `response.blob()` and `URL.createObjectURL` never copy them through JavaScript.
  let { url }: { url: URL } = $props();
  const row = { flexDirection: "row", justifyContent: "space-between", gap: 12 } as const;
  // `?site=<origin>`: where the two files come from (the docs site, or a copy for a machine that cannot reach it, as when recording the docs video).
  const site = $derived(url.searchParams.get("site") ?? "https://svelte-native.alfayez.dev/videos");
  const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

  // Download: the response body as a stream, chunk by chunk, for the progress bar; then its SHA-256 with crypto.subtle. The picture is
  // `response.blob()` shown through an object URL.
  let received = $state(0);
  let total = $state(0);
  let digest = $state("");
  let seconds = $state(0);
  let picture = $state<string | null>(null);
  let busy = $state(false);
  let failure = $state("");
  async function download() {
    busy = true;
    failure = "";
    received = 0;
    digest = "";
    try {
      const started = performance.now();
      const response = await fetch(`${site}/sveltekit-modules-android.mp4`);
      total = Number(response.headers.get("content-length") ?? 0);
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      for (let next = await reader.read(); !next.done; next = await reader.read()) {
        chunks.push(next.value);
        received += next.value.length;
      }
      const bytes = new Uint8Array(received);
      chunks.reduce((at, chunk) => (bytes.set(chunk, at), at + chunk.length), 0);
      digest = hex(await crypto.subtle.digest("SHA-256", bytes));
      seconds = (performance.now() - started) / 1000;
      const poster = await (await fetch(`${site}/sveltekit-modules-ios.jpg`)).blob();
      if (picture) URL.revokeObjectURL(picture);
      picture = URL.createObjectURL(poster);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  // localStorage keeps the count across launches (it is MMKV underneath); randomUUID is crypto's.
  const opens = Number(localStorage.getItem("web-apis.opens") ?? 0) + 1;
  localStorage.setItem("web-apis.opens", String(opens));
  let uuid = $state(crypto.randomUUID());

  // navigator: the clipboard (the library's native module), the system share sheet and the device's language.
  let copied = $state("");
  const report = (error: unknown) => (failure = error instanceof Error ? error.message : String(error));
  async function copy() {
    // On a build without the native module `navigator.clipboard` is undefined: the failure is shown, not thrown.
    await Promise.resolve().then(() => navigator.clipboard.writeText(uuid)).then(async () => (copied = await navigator.clipboard.readText())).catch(report);
  }
  async function shareDocs() {
    try {
      await navigator.share({ title: "Svelte Native", text: "Web APIs on the device", url: "https://svelte-native.alfayez.dev/docs/web-apis" });
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) report(error);
    }
  }

  // `?checks=<origin>`: the device checks against the library's test server (#lib/web-api-checks.ts).
  const checksOrigin = $derived(url.searchParams.get("checks"));
  let results = $state<CheckResult[]>([]);
  let summary = $state("");
  $effect(() => {
    const origin = checksOrigin;
    if (!origin) return;
    results = [];
    summary = "running";
    void runChecks(origin, (result) => results.push(result)).then(({ pass, fail, skip }) => (summary = `${pass} passed, ${fail} failed, ${skip} skipped`));
  });

  const view = scroller();
  useDemo(() => url, [
    [() => view.glide(200, 600), 300],
    [() => void download(), 2600],
    [() => view.glide(700, 900), 600],
    [() => (uuid = crypto.randomUUID()), 900],
    [() => (uuid = crypto.randomUUID()), 900],
    [() => view.glide(1100, 600), 600],
    [() => void copy(), 1200],
  ], { hold: 1200 });
</script>

<Page title="Web APIs" scrollRef={view.ref} intro="fetch, Blob, crypto, localStorage and navigator's clipboard and share are the web's own, with nothing to import. On the device they are native code: a download stays native bytes until the code reads it, and a Blob or an object URL never copies them through JavaScript.">
  <Section title="fetch and Blob" note="The video's bytes arrive as a stream, chunk by chunk; crypto.subtle hashes them. The picture is response.blob() shown through URL.createObjectURL.">
    <Button label={busy ? "Downloading…" : "Download"} onPress={download} disabled={busy} />
    <View style={{ height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: theme.colors.border }}>
      <View style={{ height: 8, width: `${total ? Math.min(100, (received / total) * 100) : 0}%`, backgroundColor: theme.colors.accent }} />
    </View>
    <View style={row}><Text style={text.body}>Received</Text><Text style={text.body}>{(received / 1024).toFixed(0)} of {(total / 1024).toFixed(0)} KB</Text></View>
    {#if digest}
      <View style={row}><Text style={text.body}>Time</Text><Text style={text.body}>{seconds.toFixed(2)} s</Text></View>
      <Text style={text.caption} numberOfLines={1}>SHA-256 {digest}</Text>
    {/if}
    {#if failure}<Text style={{ ...text.body, color: theme.colors.danger }}>{failure}</Text>{/if}
    {#if picture}<Image source={{ uri: picture }} resizeMode="contain" accessibilityLabel="The poster frame of a docs video" style={{ width: "100%", height: 220, borderRadius: 8 }} />{/if}
  </Section>

  <Section title="crypto and localStorage" note="randomUUID and getRandomValues come from crypto. localStorage counts how often this screen opened, and keeps the count when the app restarts.">
    <View style={row}><Text style={text.body}>Opened</Text><Text style={text.body}>{opens} {opens === 1 ? "time" : "times"}</Text></View>
    <Text style={text.caption}>{uuid}</Text>
    <Button label="New UUID" variant="secondary" onPress={() => (uuid = crypto.randomUUID())} />
  </Section>

  <Section title="navigator" note="The clipboard is the system's, through a native module of the library's. share opens the system share sheet.">
    <View style={row}><Text style={text.body}>Language</Text><Text style={text.body}>{navigator.language}</Text></View>
    <Button label="Copy the UUID" variant="secondary" onPress={copy} />
    {#if copied}<Text style={text.caption} numberOfLines={1}>Clipboard: {copied}</Text>{/if}
    <Button label="Share" variant="secondary" onPress={shareDocs} />
  </Section>

  {#if checksOrigin}
    <Section title="Checks" note={`${checkCount} checks against ${checksOrigin}: ${summary}`}>
      {#each results as result (result.name)}
        <View style={row}>
          <Text style={{ ...text.body, flex: 1 }}>{result.name}</Text>
          <Text style={{ ...text.body, color: result.status === "fail" ? theme.colors.danger : theme.colors.muted }}>{result.status}</Text>
        </View>
        {#if result.status !== "pass"}<Text style={text.caption}>{result.detail}</Text>{/if}
      {/each}
    </Section>
  {/if}
</Page>
