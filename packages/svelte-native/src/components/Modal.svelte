<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { SCREEN_CONTEXT } from "../fabric/navigation.ts";
  import type { ModalProps } from "react-native";
  import KeyboardModule from "react-native/Libraries/Components/Keyboard/Keyboard";
  const Keyboard = KeyboardModule as unknown as { isVisible(): boolean; dismiss(): void };
  let { children, onRequestClose, ...attributes }: Omit<ModalProps, "children"> & { children?: Snippet } = $props();
  function close(event: Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]) {
    if (Keyboard.isVisible()) Keyboard.dismiss();
    else onRequestClose?.(event);
  }
  // A modal's content is a layer of its own, not part of the screen that holds the `<Modal>`: a `Screen` inside it is the outermost one
  // and draws its own header there, instead of handing its options (the title) to the screen below.
  setContext(SCREEN_CONTEXT, undefined);
  const resolveProps = createNativeProps();
</script>
<native-modal nativeProps={resolveProps({ ...attributes, onRequestClose: close })}>{@render children?.()}</native-modal>
