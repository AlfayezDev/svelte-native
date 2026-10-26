<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import type { ModalProps } from "react-native";
  import KeyboardModule from "react-native/Libraries/Components/Keyboard/Keyboard";
  const Keyboard = KeyboardModule as unknown as { isVisible(): boolean; dismiss(): void };
  let { children, onRequestClose, ...attributes }: Omit<ModalProps, "children"> & { children?: Snippet } = $props();
  function close(event: Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]) {
    if (Keyboard.isVisible()) Keyboard.dismiss();
    else onRequestClose?.(event);
  }
  const resolveProps = createNativeProps();
</script>
<native-modal nativeProps={resolveProps({ ...attributes, onRequestClose: close })}>{@render children?.()}</native-modal>
