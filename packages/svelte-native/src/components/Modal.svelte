<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { IN_STACK_CONTEXT, PANE_CONTEXT, SCREEN_CONTEXT } from "../fabric/navigation.ts";
  import type { ModalProps } from "react-native";
  let { children, onRequestClose, ...attributes }: Omit<ModalProps, "children"> & { children?: Snippet } = $props();
  // Loaded on the first back press: `Keyboard` pulls in LayoutAnimation and with it UIManager.js, whose module body reads the
  // constants of every view manager (16 JNI calls, 21 ms of the JavaScript thread on the Galaxy A16) before the first commit.
  function close(event: Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Keyboard = (require("react-native/Libraries/Components/Keyboard/Keyboard") as { default: { isVisible(): boolean; dismiss(): void } }).default;
    if (Keyboard.isVisible()) Keyboard.dismiss();
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
