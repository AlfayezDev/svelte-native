<script>
  import Host from "../../../src/components/Host.svelte";
  import Screen from "../../../src/components/Screen.svelte";
  import ToolbarProbe from "./toolbar-probe.svelte";
  const log = [];
  const press = (key) => log.push(`press ${key}`);
  let options = $state({ title: "Thread" });
  let toolbar = $state({
    items: [
      { key: "reply", title: "Reply", icon: { uri: "asset:/reply.png" }, accessibilityLabel: "Reply to thread", testID: "tb-reply" },
      { key: "archive", title: "Archive", icon: glyph, badge: 120 },
      { key: "gap", spacer: true },
      { key: "flag", title: "Flag", icon: { uri: "asset:/flag.png" }, badge: true },
      { key: "delete", title: "Delete", disabled: true },
    ],
    onPress: press,
  });
  let center = $state(false);
  let inner = $state(null);
  export function set(patch) { options = { ...options, ...patch }; }
  export function setToolbar(patch) { toolbar = patch === undefined ? undefined : { ...toolbar, ...patch }; }
  export function showCenter(value) { center = value; }
  export function nest(value) { inner = value; }
  export function events() { return log; }
</script>

{#snippet glyph(pressed)}<native-view testID={`glyph-${pressed}`}></native-view>{/snippet}
{#snippet composer()}<native-view testID="composer"></native-view>{/snippet}

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  <Screen {...options} {toolbar} toolbarCenter={center ? composer : undefined}>
    {#if inner}
      <Screen {...inner}><native-view testID="page"></native-view><ToolbarProbe /></Screen>
    {:else}
      <native-view testID="page"></native-view>
      <ToolbarProbe />
    {/if}
  </Screen>
</Host>
