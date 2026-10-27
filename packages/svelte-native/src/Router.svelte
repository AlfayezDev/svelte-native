<script lang="ts">
  import { getContext, onMount, setContext, type Snippet } from "svelte";
  import Host from "./components/Host.svelte";
  import Screen from "./components/Screen.svelte";
  import RouteView from "./RouteView.svelte";
  import { SCREEN_CONTEXT } from "./fabric/navigation.ts";
  import { PLACEHOLDER_CONTEXT, STACK_CONTEXT, type PlaceholderContext, type StackContext } from "./navigator-context.ts";
  import { connectHost, type NativeLocation, type Router } from "./router.svelte.ts";
  /**
   * The native stack of a stack router: a screen per entry. `loading` is what a screen shows while its route's modules load;
   * without it the `loading` of the `<Stack>` around this router is used, and without that the screen is empty until they arrive.
   * The `animation` of that `<Stack>` is the default of its push screens: a modal or a sheet keeps the platform's.
   */
  let { router, loading }: { router: Router; loading?: Snippet<[NativeLocation]> } = $props();
  // The router's screens are real screens of its own stack, wherever the router sits (inside a tab pane, a sheet, a page).
  setContext(SCREEN_CONTEXT, undefined);
  const stack = getContext<StackContext | undefined>(STACK_CONTEXT);
  // The options of a `<Stack>` belong to the stack it wraps, not to routers below its pages.
  setContext(STACK_CONTEXT, undefined);
  const placeholder = $derived(loading ?? stack?.loading);
  setContext(PLACEHOLDER_CONTEXT, { get loading() { return placeholder; } } satisfies PlaceholderContext);
  // The root router connects the app to the host (the back key, links); the routers of panes and nested navigators leave it to it.
  onMount(() => connectHost(router));
</script>

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  {#each router.screens as { entry, canGoBack, leaving } (entry.key)}
    <Screen
      {...stack?.defaults}
      presentation={entry.presentation}
      {canGoBack}
      activityState={leaving ? 0 : 2}
      animation={entry.presentation === "push" ? stack?.defaults.animation ?? "default" : "default"}
      onDismiss={() => router.dismissed(entry.key)}
      onExited={() => router.exited(entry.key)}
    >
      <RouteView {entry} {router} loading={placeholder} />
    </Screen>
  {/each}
</Host>
