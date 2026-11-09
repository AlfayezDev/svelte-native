<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { ActivityIndicator, bootSummary, useRouter } from "@rasheed/svelte-native";
  import * as Font from "expo-font";
  import regularFont from "../../assets/native/fonts/IBMPlexSansArabic-Regular.ttf";
  import mediumFont from "../../assets/native/fonts/IBMPlexSansArabic-Medium.ttf";
  import semiboldFont from "../../assets/native/fonts/IBMPlexSansArabic-SemiBold.ttf";
  import Page from "#lib/native/components/Page.svelte";
  import Button from "#lib/native/components/Button.svelte";
  import Notice from "#lib/native/components/Notice.svelte";
  import { nativeLabEnabled, theme, t, watchAppearance, syncStatusBar } from "#lib/native/state.svelte.ts";
  import { installErrorCounter, jsErrorCount } from "#lib/native/dev/errors.ts";
  import { logUpdateReport, lateFault, lateFaultMessage } from "#lib/native/dev/update-probe.ts";
  import { openLabLaunch } from "#lib/native/dev/launch.ts";
  import { enforceLab } from "#lib/native/lab-guard.ts";
  import { createRetrier, isForeground, type Foreground, type Retrier } from "#lib/native/startup.ts";
  /** The app shell: `children` is the root navigator, and the router above this layout is `useRouter("root")`. */
  let { children }: { children: Snippet } = $props();
  let ready = $state(false);
  let error = $state<string>();
  let starter: Retrier | undefined;
  let launchOpened = false;
  const router = useRouter("root");
  $effect(syncStatusBar);
  // A path under the lab is for a bundle that carries the lab only: any other build sends a link to it to the home screen.
  $effect(() => { enforceLab(router, nativeLabEnabled); });
  const loadFonts = () => Font.loadAsync({
    "IBMPlexSansArabic-Regular": regularFont,
    "IBMPlexSansArabic-Medium": mediumFont,
    "IBMPlexSansArabic-SemiBold": semiboldFont,
  });
  // The start: the lab link the app was launched with is opened into the router before anything is rendered (so a lab start never shows the
  // home screen first), then the fonts, which are local, are waited for. Nothing else is waited for, so the first render is the screen itself.
  async function start(signal: AbortSignal) {
    if (nativeLabEnabled && !launchOpened) { await openLabLaunch(router); launchOpened = true; }
    await loadFonts();
    if (!signal.aborted) ready = true;
  }
  // React Native's `AppState`, which is loaded after the first commit (the boot gates count what runs before it). Without it the app starts anyway
  // and counts as always in the foreground. `background` and `inactive` (Control Center, the app switcher, a system dialog) are not (`isForeground`).
  async function appForeground(): Promise<Foreground> {
    try {
      const { default: AppState } = await import("react-native/Libraries/AppState/AppState");
      return {
        active: () => isForeground(AppState.currentState),
        subscribe(listener) {
          const subscription = AppState.addEventListener("change", (state) => { listener(isForeground(state)); });
          return () => subscription.remove();
        },
      };
    } catch (cause) {
      console.error("[native startup] the app state is unavailable", cause);
      return { active: () => true, subscribe: () => () => {} };
    }
  }
  function startupFailed(cause: unknown, failures: number) {
    // The first failure is an error (the boot gates count them); the attempts after it only say they failed.
    if (failures === 1) console.error("[native startup]", cause);
    else console.warn(`[native startup] attempt ${failures} failed`, cause);
    error = t("errors.startFailed");
  }
  const retry = () => { error = undefined; starter?.retryNow(); };
  if (nativeLabEnabled) installErrorCounter();
  // QA update harness (SPEC "End to end on a QA channel"): bundles that boot and then throw, to check the launch is not confirmed too early.
  // Behind `nativeLabEnabled`: the product's `#lib/native/dev/` imports are a stub that throws on any read.
  if (nativeLabEnabled && lateFault === "effect") $effect(() => { throw new Error(lateFaultMessage); });
  onMount(() => {
    if (nativeLabEnabled && lateFault === "mount") throw new Error(lateFaultMessage);
    let closed = false;
    const unwatch = watchAppearance();
    void appForeground().then((foreground) => {
      if (closed) return;
      starter = createRetrier({ attempt: start, onFailure: startupFailed, foreground });
      starter.start();
    });
    // The QA app hands the native recorder its boot phases, and the update harness the bundle that runs; after the host's first commit, which logs the line they come from.
    if (nativeLabEnabled) setTimeout(() => { logUpdateReport(); void import("#lib/native/dev/qa.ts").then(({ qaModule }) => qaModule?.recordBoot(bootSummary(), jsErrorCount())); }, 0);
    return () => { closed = true; starter?.stop(); unwatch(); };
  });
</script>
<svelte:boundary {failed}>
  {#if ready}
    {@render children()}
  {:else}
    <Page title={t("home.title")}>
      {#if error}<Notice message={error} /><Button label={t("common.retry")} onPress={retry} />
      {:else}<ActivityIndicator color={theme.foreground} accessibilityLabel={t("common.loading")} />{/if}
    </Page>
  {/if}
</svelte:boundary>
{#snippet failed(cause: unknown, reset: () => void)}
  <Page title={t("errors.somethingWentWrong")}>
    <Notice message={cause instanceof Error ? cause.message : t("errors.startFailed")} />
    <Button label={t("common.retry")} onPress={reset} />
  </Page>
{/snippet}
