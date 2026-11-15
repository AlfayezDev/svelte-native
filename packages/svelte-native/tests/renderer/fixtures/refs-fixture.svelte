<script>
  import View from "../../../src/components/View.svelte";
  import ViewShot from "../../../src/components/ViewShot.svelte";
  let show = $state(true);
  let which = $state(0);
  let order = $state(["x", "y", "z"]);
  let shotWhich = $state(0);
  let shotShown = $state(true);
  const log = [];
  const named = (name) => (handle) => { log.push([name, handle === null ? null : "handle"]); };
  const choices = [named("a"), named("b"), undefined];
  const child = named("child");
  const wrapped = [1, 2].map((number) => (handle) => { log.push([`w${number}`, handle === null ? null : typeof handle.capture]); });
  const items = { x: named("x"), y: named("y"), z: named("z") };
  export function set(values) {
    if ("show" in values) show = values.show;
    if ("which" in values) which = values.which;
    if ("order" in values) order = values.order;
    if ("shotWhich" in values) shotWhich = values.shotWhich;
    if ("shotShown" in values) shotShown = values.shotShown;
  }
  export function events() { return log; }
  export function clear() { log.length = 0; }
</script>
{#if show}
  <View ref={choices[which]}><View ref={child} collapsable={false} /></View>
{/if}
<View>
  {#each order as key (key)}<View ref={items[key]} collapsable={false} />{/each}
</View>
{#if shotShown}<ViewShot ref={wrapped[shotWhich]} style={{ width: 10, height: 10 }} />{/if}
