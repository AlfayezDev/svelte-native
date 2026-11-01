<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { IN_STACK_CONTEXT, PANE_CONTEXT, SCREEN_CONTEXT } from "../fabric/navigation.ts";
  import type { ModalProps } from "react-native";
  import { keyboard } from "../keyboard.ts";
  let { children, onRequestClose, ...attributes }: Omit<ModalProps, "children"> & { children?: Snippet } = $props();
  function close(event: Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]) {
    if (keyboard().isVisible()) keyboard().dismiss();
    else onRequestClose?.(event);
  }
  // A modal's content is a layer of its own, not part of the screen, the stack or the tab pane that holds the `<Modal>`: a `Screen` inside
  // it is the outermost one and draws its own header there (in a stack of its own), instead of handing its options (the title) to the screen
  // below, and the bottom inset is the content's to pad (a modal covers the tab bar).
  setContext(SCREEN_CONTEXT, undefined);
  setContext(IN_STACK_CONTEXT, undefined);
  setContext(PANE_CONTEXT, undefined);
  const resolveProps = createNativeProps();
</script>
<native-modal nativeProps={resolveProps({ ...attributes, onRequestClose: close })}>{@render children?.()}</native-modal>
