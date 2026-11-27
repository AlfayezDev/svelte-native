<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { SafeAreaView, Screen, ScrollView, Text, View } from "expo-svelte";
  import { nativeLabEnabled, nativeSmokeEnabled, theme } from "#lib/native/state.svelte.ts";
  import Button from "#lib/native/components/Button.svelte";
  import { smokeModules, runSmoke } from "#lib/native/dev/smoke.ts";
  import type { SmokeResult } from "#lib/native/dev/smoke-log.ts";

  /**
   * The native module smoke test (SPEC.md, "Native modules (smoke test)"): one core call for each native library the production
   * app uses, logged as `[Svelte smoke] <module> ok|fail|skip …`. Only the smoke app (`dev.alfayez.exposvelte.qa.smoke`) links the libraries
   * and runs this; the QA app shows a note.
   * `?run=1` starts the run when the page opens; `native-qa smoke` launches the stress scenario of the same name instead.
   */
  let { url }: { url?: URL } = $props();
  let results = $state<SmokeResult[]>([]);
  let running = $state(false);
  const autorun = untrack(() => url?.searchParams.get("run") === "1");
  const byModule = $derived(new Map(results.map((result) => [result.module, result])));
  const count = (status: SmokeResult["status"]) => results.filter((result) => result.status === status).length;
  let controller: AbortController | undefined;
  async function start() {
    if (running) return;
    running = true;
    results = [];
    controller = new AbortController();
    try {
      await runSmoke((result) => { results = [...results, result]; }, controller.signal);
    } catch (error) {
      console.error("[Svelte smoke]", error);
    } finally {
      running = false;
    }
  }
  onMount(() => {
    if (!nativeSmokeEnabled || !autorun) return;
    const timer = setTimeout(() => { void start(); }, 800);
    return () => clearTimeout(timer);
  });
  onDestroy(() => controller?.abort());
  const color = (status: SmokeResult["status"] | undefined) => (status === "ok" ? "#22a06b" : status === "fail" ? theme.danger : theme.muted);
</script>

{#if nativeLabEnabled}
  <Screen title="Native modules" style={{ backgroundColor: theme.background }}>
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ color: theme.foreground, fontSize: 19, fontWeight: "600" }}>
          {results.length ? `${count("ok")} ok · ${count("fail")} failed · ${count("skip")} skipped of ${smokeModules.length}` : "Native module smoke test"}
        </Text>
        {#if !nativeSmokeEnabled}
          <Text style={{ color: theme.muted, fontSize: 14 }}>The libraries are linked in the smoke app only (APP_VARIANT=smoke, dev.alfayez.exposvelte.qa.smoke); this build has none of them.</Text>
        {/if}
        <Button label={running ? "Running…" : "Run the smoke test"} onPress={start} disabled={running || !nativeSmokeEnabled} />
        {#each smokeModules as module (module)}
          {@const result = byModule.get(module)}
          <View style={{ gap: 2, borderLeftWidth: 3, borderLeftColor: color(result?.status), paddingLeft: 10 }}>
            <Text style={{ color: theme.foreground, fontSize: 15 }}>{module} · {result ? `${result.status.toUpperCase()} · ${result.path} · ${result.ms} ms` : running ? "waiting" : "not run"}</Text>
            {#if result}<Text style={{ color: theme.muted, fontSize: 12 }}>{result.detail}</Text>{/if}
          </View>
        {/each}
      </ScrollView>
    </SafeAreaView>
  </Screen>
{/if}
