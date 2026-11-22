<script>
  import Host from "../../../src/components/Host.svelte";
  import Screen from "../../../src/components/Screen.svelte";
  import Tabs from "../../../src/components/Tabs.svelte";
  const items = [{ key: "home", title: "Home" }];
  let outer = $state({ backgroundColor: "#123456" });
  export function setOuter(style) { outer = style; }
</script>

<!-- A screen whose content is a tab bar, and the screen of the tab's own stack inside it, with no background of its own. -->
{#snippet pane(tab)}
  <Host name="native-stack" attributes={{ style: { flex: 1 } }}>
    <Screen title={`Pane ${tab.key}`}><native-view testID={`pane-${tab.key}`}></native-view></Screen>
  </Host>
{/snippet}

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  <Screen title="Root" style={outer}>
    <Tabs {items} selected="home" content={pane} />
  </Screen>
</Host>
