<script>
  import Host from "../../../src/components/Host.svelte";
  import Screen from "../../../src/components/Screen.svelte";
  import Tabs from "../../../src/components/Tabs.svelte";
  let selected = $state("home");
  let lazy = $state(true);
  let items = $state([
    { key: "home", title: "Home", icon: { uri: "asset:/home.png" }, selectedIcon: { uri: "asset:/home-fill.png" } },
    { key: "inbox", title: "Inbox", badge: 120, accessibilityLabel: "Inbox, new messages", testID: "tab-inbox" },
    { key: "me", title: "Me", icon: glyph, badge: true, disabled: true },
  ]);
  const log = [];
  const handles = {};
  export function select(key) { selected = key; }
  export function setItems(next) { items = next; }
  export function setLazy(value) { lazy = value; }
  export function selection() { return selected; }
  export function events() { return log; }
  export function handle(key) { return handles[key]; }
  function register(tab) { handles[tab.key] = tab; return tab; }
</script>

{#snippet glyph(isSelected)}<native-view testID={`glyph-${isSelected}`}></native-view>{/snippet}
{#snippet pane(tab)}
  {@const known = register(tab)}
  <Host name="native-stack" attributes={{ style: { flex: 1 } }}>
    <Screen title={`Pane ${known.key}`}><native-view testID={`pane-${known.key}`}></native-view></Screen>
  </Host>
{/snippet}

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  <Screen title="Root">
    <Tabs {items} {selected} {lazy} onSelect={(key) => log.push(key)} content={pane} tint="#0a84ff" inactiveTint="#8e8e93" background="#fff" />
  </Screen>
</Host>
