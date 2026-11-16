<script>
  import Modal from "../../../src/components/Modal.svelte";
  let open = $state(false);
  let dismissals = $state(0);
  export function setOpen(value) { open = value; }
  export function dismissed() { return dismissals; }
</script>

<native-view testID="page"></native-view>
<Modal visible={open} onDismiss={() => dismissals++}>
  <native-view testID="content"></native-view>
</Modal>
