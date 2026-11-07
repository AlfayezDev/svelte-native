<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { ActivityIndicator, bootSummary, useRouter } from "@rasheed/svelte-native";
  import * as Font from "expo-font";
  import regularFont from "../../assets/native/fonts/IBMPlexSansArabic-Regular.ttf";
  import mediumFont from "../../assets/native/fonts/IBMPlexSansArabic-Medium.ttf";
  import semiboldFont from "../../assets/native/fonts/IBMPlexSansArabic-SemiBold.ttf";
  import * as v from "valibot";
  import Page from "#lib/native/components/Page.svelte";
  import Button from "#lib/native/components/Button.svelte";
  import Notice from "#lib/native/components/Notice.svelte";
  import { API_URL, nativeLabEnabled, theme, t, watchAppearance, syncStatusBar } from "#lib/native/state.svelte.ts";
  import { installErrorCounter, jsErrorCount } from "#lib/native/dev/errors.ts";
  import { logUpdateReport, lateFault, lateFaultMessage } from "#lib/native/dev/update-probe.ts";
  import { labShown, openLabLaunch } from "#lib/native/dev/launch.ts";
  import { createRetrier, isForeground, startupStatus, type Foreground, type Retrier } from "#lib/native/startup.ts";
  import type { NativeConfiguration } from "#lib/native/session.svelte.ts";
  /** The app shell: `children` is the root navigator, and the router above this layout is `useRouter("root")`. */
  let { children }: { children: Snippet } = $props();
  let configuration = $state<NativeConfiguration | null>(null);
  // The session (SpacetimeDB client, effect, the account screens) is only needed once the configuration is in; loading it
  // after that keeps its module evaluation off the first paint.
  let NativeSession = $state<typeof import("#lib/native/Session.svelte").default | null>(null);
  // A start by a lab link renders the navigator on its own: the lab needs neither the configuration nor an account. The product's start (the
  // configuration, then the session) runs from the start for anything else, and on demand for a lab start that goes to a product screen.
  let lab = $state(false);
  let error = $state<string>();
  let starter: Retrier | undefined;
  let product: Retrier | undefined;
  let foreground: Foreground | undefined;
  const router = nativeLabEnabled ? useRouter("root") : undefined;
  // Whether the router shows lab screens only (always false in the product, which has no lab and no `router` here).
  const labScreens = $derived(router ? labShown(router) : false);
  $effect(syncStatusBar);
  const schema = v.object({ uri: v.pipe(v.string(), v.url()), databaseName: v.pipe(v.string(), v.nonEmpty()) });
  // Each attempt gets 10 s: the configuration is a few hundred bytes, so a longer wait is a backend that is not answering, and a
  // shorter one would give up on a slow link that was about to; the attempts after a failure come by themselves (`startup.ts`).
  const attemptTimeoutMs = 10_000;
  const loadFonts = () => Font.loadAsync({
    "IBMPlexSansArabic-Regular": regularFont,
    "IBMPlexSansArabic-Medium": mediumFont,
    "IBMPlexSansArabic-SemiBold": semiboldFont,
  });
  // The first attempt decides how the app starts. For a lab start the router has the lab's screens already (opened before anything is rendered,
  // so no product screen needs an account) and only the fonts, which are local, are waited for.
  let labLaunch: boolean | undefined;
  async function start(signal: AbortSignal) {
    if (nativeLabEnabled && router) labLaunch ??= await openLabLaunch(router);
    if (!labLaunch) { startProduct(); return; }
    await loadFonts();
    if (!signal.aborted) lab = true;
  }
  async function loadProduct(signal: AbortSignal) {
    const response = await fetch(new URL("/api/configuration", API_URL), { signal: AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]) });
    if (!response.ok) throw new Error(`Platform configuration returned ${response.status}`);
    const config = v.parse(schema, await response.json());
    await loadFonts();
    const session = (await import("#lib/native/Session.svelte")).default;
    if (!signal.aborted) { NativeSession = session; configuration = config; }
  }
  function startProduct() {
    if (product || NativeSession || !foreground) return;
    error = undefined;
    startupStatus.phase = "pending";
    product = createRetrier({ attempt: loadProduct, onFailure: startupFailed, foreground });
    product.start();
  }
  function stopProduct() {
    if (!product) return;
    product.stop();
    product = undefined;
    error = undefined;
  }
  // A lab start has no session. When the router goes to a screen that is not the lab's (a link, the login the iOS capture visits) the navigator
  // waits for the product's start, with the loading page in its place; when it is back on the lab alone the lab does not wait for the backend and
  // the attempts stop. Once the session is there it stays, lab screens included.
  $effect(() => {
    if (!lab || NativeSession) return;
    if (labScreens) stopProduct();
    else startProduct();
  });
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
    // The first failure is an error (the boot gates count them); the attempts after it only say they failed, whatever the backend does.
    if (failures === 1) console.error("[native startup]", cause);
    else console.warn(`[native startup] attempt ${failures} failed`, cause);
    error = t("errors.unavailableBody");
    startupStatus.phase = "failed";
  }
  const retry = () => { error = undefined; (product ?? starter)?.retryNow(); };
  if (nativeLabEnabled) installErrorCounter();
  // QA update harness (SPEC "End to end on a QA channel"): bundles that boot and then throw, to check the launch is not confirmed too early.
  // Behind `nativeLabEnabled`: the product's `#lib/native/dev/` imports are a stub that throws on any read.
  if (nativeLabEnabled && lateFault === "effect") $effect(() => { throw new Error(lateFaultMessage); });
  onMount(() => {
    if (nativeLabEnabled && lateFault === "mount") throw new Error(lateFaultMessage);
    let closed = false;
    const unwatch = watchAppearance();
    void appForeground().then((appState) => {
      if (closed) return;
      foreground = appState;
      starter = createRetrier({ attempt: start, onFailure: startupFailed, foreground });
      starter.start();
    });
    // The QA app hands the native recorder its boot phases, and the update harness the bundle that runs; after the host's first commit, which logs the line they come from.
    if (nativeLabEnabled) setTimeout(() => { logUpdateReport(); void import("#lib/native/dev/qa.ts").then(({ qaModule }) => qaModule?.recordBoot(bootSummary(), jsErrorCount())); }, 0);
    return () => { closed = true; starter?.stop(); product?.stop(); unwatch(); };
  });
</script>
<svelte:boundary {failed}>
  {#if configuration && NativeSession}
    <NativeSession {configuration}>{@render children()}</NativeSession>
  {:else if lab && labScreens}
    {@render children()}
  {:else}
    <Page title="Rasheed">
      {#if error}<Notice message={error} /><Button label={t("common.retry")} onPress={retry} />
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
