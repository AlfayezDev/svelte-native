<script lang="ts">
  import { nativeLabEnabled } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";
  import TransitionsScreen from "#lib/native/dev/TransitionsScreen.svelte";

  /**
   * The lab's screen of transitions on HTML elements (`qa/README.md`, "Transitions"): `TransitionsScreen` is written with HTML and Tailwind classes alone, and the checks of the native checks lab read the same screen
   * (`transition-lab.ts`) while it runs. Here it opens settled (the card shown and the panel open, as a block that is there when its screen opens plays nothing), so the page is a parity and accessibility
   * case (`transitions`) that has no animation running when it is photographed.
   */
</script>

{#if nativeLabEnabled}
  <Page title="Transitions" description="in:, out:, transition: and animate:flip on HTML elements, played on the UI thread.">
    <TransitionsScreen settled />
  </Page>
{/if}
