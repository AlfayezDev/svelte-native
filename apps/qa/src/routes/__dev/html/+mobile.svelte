<script lang="ts">
  import { nativeLabEnabled } from "#lib/native/state.svelte.ts";
  import Page from "#lib/native/components/Page.svelte";
  import HtmlScreen from "#lib/native/dev/HtmlScreen.svelte";

  /**
   * The lab's screen of HTML elements and classes (SPEC.md, "HTML elements"): `HtmlScreen` is written with HTML and Tailwind classes alone, and the checks of the native checks lab read the same screen
   * (`html-lab.ts`) while it runs. The page is a parity and accessibility case (`html-elements`).
   */
</script>

{#if nativeLabEnabled}
  <Page title="HTML elements" description="Written with HTML elements and Tailwind classes: the build turns them into native views.">
    <HtmlScreen />
  </Page>
{/if}
