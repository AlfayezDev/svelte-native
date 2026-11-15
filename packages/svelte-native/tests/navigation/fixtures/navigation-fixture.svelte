<script>
  import Host from "../../../src/components/Host.svelte";
  import View from "../../../src/components/View.svelte";
  let keys = $state([1]);
  let dismissed = [];
  export function push(key) { keys = [...keys, key]; }
  export function pop() { keys = keys.slice(0, -1); }
  export function dismissedLog() { return dismissed; }
</script>

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  {#each keys as key (key)}
    <Host name="native-screen" attributes={{
      style: { backgroundColor: "white" },
      activityState: 2,
      stackPresentation: key === 3 ? "modal" : "push",
      stackAnimation: "default",
      gestureEnabled: key !== 2,
      onDismissed: () => dismissed.push(key),
    }}>
      <View />
    </Host>
  {/each}
</Host>
