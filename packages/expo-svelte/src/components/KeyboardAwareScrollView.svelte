<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ScrollViewInstance as NativeScrollView, ScrollViewProps } from "react-native";
  import type { ClassProps } from "../classes.ts";
  import type { GestureProps } from "../gestures/types.ts";
  import type { HostHandle } from "../fabric/host.ts";
  import ScrollView from "./ScrollView.svelte";
  import { driveKeyboard, keyboardDriven } from "../keyboard-drive.ts";
  /**
   * A `ScrollView` that keeps the input being edited in view, as react-native-keyboard-controller's `KeyboardAwareScrollView` (its `insets` mode): when the keyboard opens it
   * scrolls the focused input above it, frame by frame as the keyboard rises, and back as it closes; moving to another input while the keyboard is up scrolls to that one. The
   * scroll view keeps the room the keyboard takes at its bottom while it is up. The scrolling is the engine's, on the main thread (Android); elsewhere this is a `ScrollView`.
   */
  let { children, bottomOffset = 0, extraKeyboardSpace = 0, disableScrollOnKeyboardHide = false, enabled = true, ref, ...attributes }: Omit<ScrollViewProps, "children" | "ref"> & GestureProps & ClassProps & {
    children?: Snippet;
    /** The distance, in dp, to keep between the keyboard and the bottom of the input. */
    bottomOffset?: number;
    /** Room, in dp, added at the bottom of the scrollable area while the keyboard is up. */
    extraKeyboardSpace?: number;
    /** Leave the scroll position where it is when the keyboard closes. */
    disableScrollOnKeyboardHide?: boolean;
    /** `false` turns the scrolling and the room off. */
    enabled?: boolean;
    /** Receives the host handle: React Native's ScrollView instance (`scrollTo`, `scrollToEnd`, `measure`) plus `dispatchCommand`, or null on unmount. */
    ref?: (instance: NativeScrollView | null) => void;
  } = $props();
  const driven = keyboardDriven();
  let handle = $state<HostHandle | null>(null);
  $effect(() => {
    if (!driven || !handle) return;
    const tag = handle.tag;
    driveKeyboard(tag, enabled ? "aware" : "release", [bottomOffset, extraKeyboardSpace, !disableScrollOnKeyboardHide]);
  });
  const keep = (instance: NativeScrollView | null) => { handle = instance as unknown as HostHandle | null; ref?.(instance); };
</script>
<ScrollView {...attributes} ref={keep}>{@render children?.()}</ScrollView>
