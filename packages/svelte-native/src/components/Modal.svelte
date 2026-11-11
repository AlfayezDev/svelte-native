<script lang="ts">
  import { setContext, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { IN_STACK_CONTEXT, PANE_CONTEXT, SCREEN_CONTEXT } from "../fabric/navigation.ts";
  import type { ModalProps } from "react-native";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import { keyboard } from "../keyboard.ts";
  let { children, onRequestClose, onDismiss, onShow, ...attributes }: Omit<ModalProps, "children"> & { children?: Snippet } & ClassProps = $props();
  function close(event: Parameters<NonNullable<ModalProps["onRequestClose"]>>[0]) {
    if (keyboard().isVisible()) keyboard().dismiss();
    else onRequestClose?.(event);
  }
  // iOS mounts the host only while it is shown, as React Native's `Modal.js` does: a hidden `RCTModalHostView` is still a
  // screen-sized view in the tree, and its hit test takes every touch meant for the app below it. After `visible` turns false the
  // host stays until UIKit has dismissed the controller (`onDismiss`), so the dismissal animates. Android's engine keeps the host
  // and shows or hides its overlay layer from `visible` (`EngineModal`, whose frame takes no touches).
  //
  // UIKit reports `onDismiss` only for a controller it presented (`RCTModalHostViewComponentView`: `_isPresented`, which needs a
  // window), and it reports `onShow` when the presentation has finished. A modal toggled true to false while its host has no window
  // (a hidden eager tab pane) is never presented, so no `onDismiss` would unmount it and the hidden host would keep taking the
  // pane's touches. The host therefore leaves with `visible` unless `onShow` came since `visible` turned true.
  const ios = Platform.OS === "ios";
  let presented = $state(false);
  let wasVisible = false;
  let shown = false;
  $effect.pre(() => {
    const visible = attributes.visible === true;
    if (visible && !wasVisible) {
      presented = true;
      shown = false;
    } else if (!visible && wasVisible && !shown) presented = false;
    wasVisible = visible;
  });
  function showed(event: Parameters<NonNullable<ModalProps["onShow"]>>[0]) {
    shown = true;
    onShow?.(event);
  }
  function dismissed() {
    presented = false;
    shown = false;
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
  <native-modal nativeProps={resolveProps({ ...attributes, onRequestClose: close, onShow: showed, onDismiss: dismissed })}>{@render children?.()}</native-modal>
{/if}
