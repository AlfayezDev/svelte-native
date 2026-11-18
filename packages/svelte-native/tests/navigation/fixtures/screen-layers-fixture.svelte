<script>
  import Host from "../../../src/components/Host.svelte";
  import Modal from "../../../src/components/Modal.svelte";
  import Screen from "../../../src/components/Screen.svelte";
  import Tabs from "../../../src/components/Tabs.svelte";
  const items = [{ key: "home", title: "Home" }];
  let outer = $state({ backgroundColor: "#123456" });
  let presentation = $state("push");
  let modal = $state(null);
  export function setOuter(style) { outer = style; }
  export function setPresentation(value) { presentation = value; }
  export function setModal(value) { modal = value; }
</script>

<!-- A screen holding a tab bar (whose pane has a stack of its own) and, when asked, a `<Modal>` with a screen in it: none of the inner screens gives itself a background. -->
{#snippet pane(tab)}
  <Host name="native-stack" attributes={{ style: { flex: 1 } }}>
    <Screen title={`Pane ${tab.key}`}><native-view testID={`pane-${tab.key}`}></native-view></Screen>
  </Host>
{/snippet}

<Host name="native-stack" attributes={{ style: { flex: 1 } }}>
  <Screen title="Root" style={outer} {presentation}>
    <Tabs {items} selected="home" content={pane} />
    {#if modal}
      <Modal visible transparent={modal.transparent}>
        <Screen title="In the modal"><native-view testID="modal-page"></native-view></Screen>
      </Modal>
    {/if}
  </Screen>
</Host>
