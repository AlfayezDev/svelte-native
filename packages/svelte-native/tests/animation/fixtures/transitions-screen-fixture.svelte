<script lang="ts">
  import Screen from "../../../src/components/Screen.svelte";
  import Page from "./transitions-flip-page.svelte";
</script>

<!-- A screen no stack holds is rendered in a `native-stack` of its own, and its page renders inside it with the screen: the first render of a page is what `animate:` has to work in. -->
<Screen title="Flip"><Page /></Screen>
