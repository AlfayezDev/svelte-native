<script lang="ts">
  import { onMount } from "svelte";
  import { ActivityIndicator, type NativeRoute } from "@rasheed/svelte-native";
  import * as Font from "expo-font";
  import regularFont from "../../assets/native/fonts/IBMPlexSansArabic-Regular.ttf";
  import mediumFont from "../../assets/native/fonts/IBMPlexSansArabic-Medium.ttf";
  import semiboldFont from "../../assets/native/fonts/IBMPlexSansArabic-SemiBold.ttf";
  import * as v from "valibot";
  import NativeSession from "#lib/native/Session.svelte";
  import Page from "#lib/native/components/Page.svelte";
  import Button from "#lib/native/components/Button.svelte";
  import Notice from "#lib/native/components/Notice.svelte";
  import { API_URL, theme, t, watchAppearance, syncStatusBar } from "#lib/native/state.svelte.ts";
  import type { NativeConfiguration } from "#lib/native/session.svelte.ts";
  let { routes }: { routes: NativeRoute[] } = $props();
  let configuration = $state<NativeConfiguration | null>(null);
  let error = $state<string>();
  $effect(syncStatusBar);
  const schema = v.object({ uri: v.pipe(v.string(), v.url()), databaseName: v.pipe(v.string(), v.nonEmpty()) });
  async function load(signal?: AbortSignal) {
    error = undefined;
    try {
      const response = await fetch(new URL("/api/configuration", API_URL), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Platform configuration returned ${response.status}`);
      const config = v.parse(schema, await response.json());
      await Font.loadAsync({
        "IBMPlexSansArabic-Regular": regularFont,
        "IBMPlexSansArabic-Medium": mediumFont,
        "IBMPlexSansArabic-SemiBold": semiboldFont,
      });
      if (!signal?.aborted) configuration = config;
    } catch (cause) {
      if (signal?.aborted) return;
      console.error("[native startup]", cause);
      error = t("errors.unavailableBody");
    }
  }
  onMount(() => {
    const controller = new AbortController();
    const unwatch = watchAppearance();
    void load(controller.signal);
    return () => { controller.abort(); unwatch(); };
  });
</script>
<svelte:boundary {failed}>
  {#if configuration}
    <NativeSession {configuration} {routes} />
  {:else}
    <Page title="Rasheed">
      {#if error}<Notice message={error} /><Button label={t("common.retry")} onPress={() => load()} />
      {:else}<ActivityIndicator color={theme.foreground} accessibilityLabel={t("common.loading")} />{/if}
    </Page>
  {/if}
</svelte:boundary>
{#snippet failed(cause: unknown, reset: () => void)}
  <Page title={t("errors.somethingWentWrong")}>
    <Notice message={cause instanceof Error ? cause.message : t("errors.unavailableBody")} />
    <Button label={t("common.retry")} onPress={reset} />
  </Page>
{/snippet}
