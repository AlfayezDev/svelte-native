<script>
  import Screen from "../../../src/components/Screen.svelte";
  let mode = $state("menu");
  export function change(value) { mode = value; }
</script>
<Screen>
  {#if mode === "menu"}
    <Screen title="Native screens"><native-text>Menu</native-text></Screen>
  {:else if mode === "header"}
    <Screen title="Screen 1" subtitle="Native header"><native-text>Rows</native-text></Screen>
  {:else if mode === "toolbar"}
    <Screen title="Toolbar" toolbar={{ items: [{ key: "reply", title: "Reply" }] }}><native-text>Toolbar rows</native-text></Screen>
  {:else if mode === "plain"}
    <Screen><native-text>Plain</native-text></Screen>
  {:else}
    <native-text>No child screen</native-text>
  {/if}
</Screen>
