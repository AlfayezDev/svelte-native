<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { IN_STACK_CONTEXT, PANE_CONTEXT, SCREEN_CONTEXT } from "../fabric/navigation.ts";
  import type { ModalProps } from "react-native";
  import KeyboardModule from "react-native/Libraries/Components/Keyboard/Keyboard";
  import Platform from "react-native/Libraries/Utilities/Platform";
  const Keyboard = KeyboardModule as unknown as { isVisible(): boolean; dismiss(): void };
  let { children, onRequestClose, onDismiss, ...attributes }: Omit<ModalProps, "children"> & { children?: Snippet } = $props();
  function close(event: Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]) {
    if (Keyboard.isVisible()) Keyboard.dismiss();
    else onRequestClose?.(event);
  }
  // iOS mounts the host only while it is shown, as React Native's `Modal.js` does: a hidden `RCTModalHostView` is still a
  // screen-sized view in the tree, and its hit test takes every touch meant for the app below it. After `visible` turns false the
  // host stays until UIKit has dismissed the controller (`onDismiss`), so the dismissal animates. Android's engine keeps the host
  // and shows or hides its overlay layer from `visible` (`EngineModal`, whose frame takes no touches).
  const ios = Platform.OS === "ios";
  let presented = $state(attributes.visible === true);
  $effect.pre(() => {
    if (attributes.visible === true) presented = true;
  });
  function dismissed() {
    presented = false;
    onDismiss?.();
  }
  const mounted = $derived(!ios || attributes.visible === true || presented);
  // A modal's content is a layer of its own, not part of the screen, the stack or the tab pane that holds the `<Modal>`: a `Screen` inside
  // it is the outermost one and draws its own header there (in a stack of its own), instead of handing its options (the title) to the screen
  // below, and the bottom inset is the content's to pad (a modal covers the tab bar).
  setContext(SCREEN_CONTEXT, undefined);
  setContext(IN_STACK_CONTEXT, undefined);
  setContext(PANE_CONTEXT, undefined);
  const resolveProps = createNativeProps();
</script>
{#if mounted}
  <native-modal nativeProps={resolveProps({ ...attributes, onRequestClose: close, onDismiss: dismissed })}>{@render children?.()}</native-modal>
{/if}
