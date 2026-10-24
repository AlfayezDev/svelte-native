<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ModalProps } from "react-native";
  import { Keyboard } from "react-native";
  import Host from "./Host.svelte";
  let { children, onRequestClose, ...attributes }: Omit<ModalProps, "children"> & { children?: Snippet } = $props();
  function close(event: Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]) {
    if (Keyboard.isVisible()) Keyboard.dismiss();
    else onRequestClose?.(event);
  }
</script>
<Host name="native-modal" attributes={{ ...attributes, onRequestClose: close }}>{@render children?.()}</Host>
