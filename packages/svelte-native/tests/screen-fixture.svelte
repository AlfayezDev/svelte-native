<script>
  import Host from "../src/components/Host.svelte";
  import Screen from "../src/components/Screen.svelte";
  import HeaderProbe from "./header-probe.svelte";
  let options = $state({ title: "Inbox" });
  let slots = $state({ left: false, center: false, right: false, results: false });
  let inner = $state(null);
  const log = [];
  export function set(patch) { options = { ...options, ...patch }; }
  export function show(patch) { slots = { ...slots, ...patch }; }
  export function nest(value) { inner = value; }
  export function events() { return log; }
</script>

{#snippet left()}<native-view testID="left"></native-view>{/snippet}
{#snippet center()}<native-view testID="center"></native-view>{/snippet}
{#snippet right()}<native-view testID="right"></native-view>{/snippet}
{#snippet results()}<native-view testID="results"></native-view>{/snippet}

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  <Screen
    {...options}
    headerLeft={slots.left ? left : undefined}
    headerCenter={slots.center ? center : undefined}
    headerRight={slots.right ? right : undefined}
    headerSearch={slots.results ? results : undefined}
    onAppear={() => log.push("appear")}
    onDisappear={() => log.push("disappear")}
    onDismiss={() => log.push("dismiss")}
    onDetentChange={(event) => log.push(`detent ${event.index} ${event.fraction}`)}
  >
    {#if inner}
      <Screen {...inner} onDismiss={() => log.push("inner dismiss")}><native-view testID="page"></native-view><HeaderProbe /></Screen>
    {:else}
      <native-view testID="page"></native-view>
      <HeaderProbe />
    {/if}
  </Screen>
</Host>
