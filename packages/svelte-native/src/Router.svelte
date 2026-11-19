<script lang="ts">
  import { getContext, onMount, setContext, type Snippet } from "svelte";
  import Screen from "./components/Screen.svelte";
  import RouteView from "./RouteView.svelte";
  import { BACKGROUND_CONTEXT, IN_STACK_CONTEXT, SCREEN_CONTEXT } from "./fabric/navigation.ts";
  import { styleValue } from "./system-colors.ts";
  import { PLACEHOLDER_CONTEXT, STACK_CONTEXT, type PlaceholderContext, type StackContext } from "./navigator-context.ts";
  // (`type Router as RouterHandle`: the component is named `Router` by its file, and its declaration may not import another `Router`.)
  import { connectHost, type NativeLocation, type Router as RouterHandle } from "./router.svelte.ts";
  /**
   * The native stack of a stack router: a screen per entry. `loading` is what a screen shows while its route's modules load;
   * without it the `loading` of the `<Stack>` around this router is used, and without that the screen is empty until they arrive.
   * The `animation` of that `<Stack>` is the default of its push screens: a modal or a sheet keeps the platform's.
   *
   * A screen a navigation pushes is made once its route's modules are in (or failed), not while they load: its page's own `<Screen>` options (its
   * `animation` above all, which the native stack reads when the push starts, but also its title and header) are then part of the commit that brings the
   * screen in. A navigation starts the load before it pushes, and a bundled route loads in a microtask. With a `loading` snippet the screen comes at once
   * and shows it, as before; a screen that is already leaving, and the first screens of a stack (they load as they render), come at once too.
   */
  let { router, loading }: { router: RouterHandle; loading?: Snippet<[NativeLocation]> } = $props();
  // The router's screens are real screens of its own stack, wherever the router sits (inside a tab pane, a sheet, a page).
  setContext(SCREEN_CONTEXT, undefined);
  setContext(IN_STACK_CONTEXT, true);
  const stack = getContext<StackContext | undefined>(STACK_CONTEXT);
  // The options of a `<Stack>` belong to the stack it wraps, not to routers below its pages.
  setContext(STACK_CONTEXT, undefined);
  // Its background is the one its screens fall back to: a page whose `<Screen style>` has none of its own still looks as the rest of the stack does (`Screen.svelte`).
  const outerBackground = getContext<(() => unknown) | undefined>(BACKGROUND_CONTEXT);
  setContext(BACKGROUND_CONTEXT, () => styleValue(stack?.defaults.style, "backgroundColor") ?? outerBackground?.());
  const placeholder = $derived(loading ?? stack?.loading);
  setContext(PLACEHOLDER_CONTEXT, { get loading() { return placeholder; } } satisfies PlaceholderContext);
  // The root router connects the app to the host (the back key, links); the routers of panes and nested navigators leave it to it.
  onMount(() => connectHost(router));
</script>

<!-- A written element, not `<Host name="native-stack">`: the screens render inside it, and the children of a `<svelte:element>` that render with it lose their `animate:` (`Host.svelte`). -->
<native-stack nativeProps={{ style: { flex: 1 } }}>
  {#each router.screens as { entry, canGoBack, leaving } (entry.key)}
    {#if placeholder || leaving || !router.loading(entry.route)}
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
    {/if}
  {/each}
</native-stack>
