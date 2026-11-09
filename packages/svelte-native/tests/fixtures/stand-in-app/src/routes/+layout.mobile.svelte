<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { ActivityIndicator, Text, View, useRouter } from "@rasheed/svelte-native";
  import { labEnabled, labRefused } from "#lib/flag.ts";
  import { installErrorCounter } from "#lib/lab/counter.ts";
  import { lateFault, lateFaultMessage } from "#lib/lab/faults.ts";
  import { labShown, openLabLaunch } from "#lib/lab/launch.ts";
  /**
   * The app shell: `children` is the root navigator, and the router above this layout is `useRouter("root")`. The session is loaded and started
   * after the first render, and it may take a while (`globalThis.__standInStart` stands for the backend it waits for). A start by a lab link
   * renders the navigator on its own: the lab needs no session. Anything else starts the session first, and so does a lab start that goes on
   * to a screen of the app.
   */
  let { children }: { children: Snippet } = $props();
  let Session = $state<typeof import("#lib/Session.svelte").default | null>(null);
  let lab = $state(false);
  let error = $state<string>();
  let starting = false;
  let labLaunch: boolean | undefined;
  const router = labEnabled ? useRouter("root") : undefined;
  // Whether the router shows lab screens only (always false in a store build, which has no lab and no `router` here).
  const labScreens = $derived(router ? labShown(router) : false);
  if (labRefused) console.error("[stand-in lab] this bundle carries the development lab, which the store app does not run: the lab is off");
  // Everything of the lab is behind `labEnabled`: a store build's `#lib/lab/` imports are stubs that throw on any use.
  if (labEnabled) installErrorCounter();
  if (labEnabled && lateFault === "effect") $effect(() => { throw new Error(lateFaultMessage); });
  async function startSession() {
    if (starting || Session) return;
    starting = true;
    error = undefined;
    try {
      await (globalThis as { __standInStart?: () => Promise<void> }).__standInStart?.();
      Session = (await import("#lib/Session.svelte")).default;
    } catch (cause) {
      starting = false;
      error = cause instanceof Error ? cause.message : "The session did not start.";
    }
  }
  async function start() {
    if (labEnabled && router) labLaunch ??= await openLabLaunch(router);
    if (labLaunch) lab = true;
    else await startSession();
  }
  // A lab start has no session. When the router goes to a screen that is not the lab's (a link) the navigator waits for the session, with the
  // spinner in its place. Once the session is there it stays, lab screens included.
  $effect(() => {
    if (lab && !Session && !labScreens) void startSession();
  });
  onMount(() => {
    if (labEnabled && lateFault === "mount") throw new Error(lateFaultMessage);
    void start();
  });
</script>
<svelte:boundary {failed}>
  {#if Session}
    <Session>{@render children()}</Session>
  {:else if lab && labScreens}
    {@render children()}
  {:else}
    <View>
      {#if error}<Text>{error}</Text>{:else}<ActivityIndicator />{/if}
    </View>
  {/if}
</svelte:boundary>
{#snippet failed(cause: unknown)}
  <View><Text>Something went wrong: {cause instanceof Error ? cause.message : String(cause)}</Text></View>
{/snippet}
