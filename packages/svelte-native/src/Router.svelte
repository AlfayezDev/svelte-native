<script lang="ts">
  import { getContext, onMount, setContext, type Snippet } from "svelte";
  import BackHandler from "react-native/Libraries/Utilities/BackHandler";
  import Linking from "react-native/Libraries/Linking/Linking";
  import Host from "./components/Host.svelte";
  import Screen from "./components/Screen.svelte";
  import RouteView from "./RouteView.svelte";
  import { SCREEN_CONTEXT, STACK_CONTEXT, type StackContext } from "./fabric/navigation.ts";
  import type { NativeLocation, Router } from "./router.svelte.ts";
  /**
   * The native stack of a stack router: a screen per entry. `loading` is what a screen shows while its route's modules load;
   * without it the `loading` of the `<Stack>` around this router is used, and without that the screen is empty until they arrive.
   */
  let { router, loading }: { router: Router; loading?: Snippet<[NativeLocation]> } = $props();
  // The router's screens are real screens of its own stack, wherever the router sits (inside a tab pane, a sheet, a page).
  setContext(SCREEN_CONTEXT, undefined);
  const stack = getContext<StackContext | undefined>(STACK_CONTEXT);
  // The options of a `<Stack>` belong to the stack it wraps, not to routers below its pages.
  setContext(STACK_CONTEXT, undefined);
  const placeholder = $derived(loading ?? stack?.loading);
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
    <Screen
      {...stack?.defaults}
      presentation={entry.presentation}
      {canGoBack}
      activityState={leaving ? 0 : 2}
      animation={stack?.defaults.animation ?? "default"}
      onDismiss={() => router.dismissed(entry.key)}
      onExited={() => router.exited(entry.key)}
    >
      <RouteView {entry} {router} loading={placeholder} />
    </Screen>
  {/each}
</Host>
