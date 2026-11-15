<script>
  import Host from "../../../src/components/Host.svelte";
  import Screen from "../../../src/components/Screen.svelte";
  import Tabs from "../../../src/components/Tabs.svelte";
  import ToolbarProbe from "../../toolbar-probe.svelte";
  const items = [{ key: "home", title: "Home" }, { key: "inbox", title: "Inbox" }];
  const toolbar = { items: [{ key: "reply", title: "Reply" }, { key: "gap", spacer: true }, { key: "archive", title: "Archive" }] };
  let selected = $state("home");
  export function select(key) { selected = key; }
</script>

{#snippet pane(tab)}
  <Host name="native-stack" attributes={{ style: { flex: 1 } }}>
    <Screen title={`Pane ${tab.key}`} {toolbar}><native-view testID={`pane-${tab.key}`}></native-view><ToolbarProbe /></Screen>
  </Host>
{/snippet}

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  <Screen title="Root">
    <Tabs {items} {selected} content={pane} />
  </Screen>
</Host>
