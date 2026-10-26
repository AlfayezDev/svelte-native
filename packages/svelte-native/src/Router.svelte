<script lang="ts">
  import { onMount, setContext, type Snippet } from "svelte";
  import BackHandler from "react-native/Libraries/Utilities/BackHandler";
  import Linking from "react-native/Libraries/Linking/Linking";
  import Host from "./components/Host.svelte";
  import Screen from "./components/Screen.svelte";
  import RouteView from "./RouteView.svelte";
  import { SCREEN_CONTEXT } from "./fabric/navigation.ts";
  import type { NativeLocation, createRouter } from "./router.svelte.ts";
  /** `loading` is what a screen shows while its route's modules load; without it the screen is empty until they arrive. */
  let { router, loading }: { router: ReturnType<typeof createRouter>; loading?: Snippet<[NativeLocation]> } = $props();
  // The router's screens are real screens of its own stack, wherever the router sits (inside a tab pane, a sheet, a page).
  setContext(SCREEN_CONTEXT, undefined);
  // The back key belongs to the router only while it is active: a tab's stack answers while its tab is selected.
  // A link is the app's, not a tab's: it opens in the outermost router, or the same URL would also be pushed onto
  // every tab stack whose routes happen to match it.
  const opensLinks = () => !router.nested && router.active();
  onMount(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => router.active() && router.back());
    let live = true;
    const links = Linking.addEventListener("url", ({ url }) => { if (opensLinks()) router.openURL(url); });
    void Linking.getInitialURL().then((url) => { if (live && url && opensLinks()) router.openURL(url); });
    return () => { live = false; back.remove(); links.remove(); };
  });
</script>

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  {#each router.screens as { entry, canGoBack, leaving } (entry.key)}
    <Screen presentation={entry.presentation} {canGoBack} activityState={leaving ? 0 : 2} animation="default" onDismiss={() => router.dismissed(entry.key)} onExited={() => router.exited(entry.key)}>
      <RouteView {entry} {router} {loading} />
    </Screen>
  {/each}
</Host>
