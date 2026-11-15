<script>
  import Host from "../../../src/components/Host.svelte";
  import Screen from "../../../src/components/Screen.svelte";
  import Tabs from "../../../src/components/Tabs.svelte";
  import Modal from "../../../src/components/Modal.svelte";
  import PaneProbe from "./pane-probe.svelte";
  let open = $state(true);
  export function setOpen(value) { open = value; }
</script>

{#snippet pane()}
  <PaneProbe name="pane" />
  <Modal visible={open}>
    <PaneProbe name="modal-in-pane" />
    <Screen title="Pane modal"><native-view testID="pane-inner"></native-view></Screen>
  </Modal>
{/snippet}

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  <Screen title="Outer">
    <native-view testID="outer"></native-view>
    <PaneProbe name="screen" />
    <Modal visible={open}>
      <Screen title="Inner"><native-view testID="inner"></native-view></Screen>
    </Modal>
    <Tabs items={[{ key: "one", title: "One" }]} selected="one" content={pane} />
  </Screen>
</Host>
