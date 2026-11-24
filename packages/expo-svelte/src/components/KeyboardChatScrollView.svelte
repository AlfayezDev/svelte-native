<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { NativeScrollEvent, NativeSyntheticEvent, ScrollViewInstance as NativeScrollView, ScrollViewProps } from "react-native";
  import type { ClassProps } from "../classes.ts";
  import type { GestureProps } from "../gestures/types.ts";
  import type { HostHandle } from "../fabric/host.ts";
  import ScrollView from "./ScrollView.svelte";
  import { driveKeyboard, keyboardDriven, onEndVisible as endVisible } from "../keyboard-drive.ts";
  /**
   * A `ScrollView` for a chat thread, as react-native-keyboard-controller's `KeyboardChatScrollView`: when the keyboard opens the content lifts with it, frame by frame, so
   * the last message stays where the keyboard pushes it, and `keyboardLiftBehavior` says when. The scroll view keeps the room the keyboard takes at its bottom while the
   * keyboard is up, so the list can be scrolled past its last message. The lift is the engine's, on the main thread (Android); elsewhere this is a `ScrollView`.
   */
  let { children, keyboardLiftBehavior = "always", offset = 0, onEndVisible, onScroll, scrollEventThrottle, ref, ...attributes }: Omit<ScrollViewProps, "children" | "ref"> & GestureProps & ClassProps & {
    children?: Snippet;
    /**
     * When the content lifts with the keyboard. `"always"`: whatever the scroll position. `"whenAtEnd"`: only when the last message is in view (within 20 dp of
     * the end), so a thread scrolled up to older messages stays where it is. `"never"`: never; the room is still made at the bottom.
     */
    keyboardLiftBehavior?: "always" | "whenAtEnd" | "never";
    /** The distance, in dp, between the bottom of the scroll view and the bottom of the screen (a tab bar, an inset): the content lifts by the keyboard's height less this. */
    offset?: number;
    /** Called when the end of the content comes into view (`true`) or leaves it (`false`), and once when the scroll view has been laid out. */
    onEndVisible?: (visible: boolean) => void;
    /** Receives the host handle: React Native's ScrollView instance (`scrollTo`, `scrollToEnd`, `measure`) plus `dispatchCommand`, or null on unmount. */
    ref?: (instance: NativeScrollView | null) => void;
  } = $props();
  const driven = keyboardDriven();
  let handle = $state<HostHandle | null>(null);
  const watched = $derived(onEndVisible !== undefined);
  $effect(() => {
    if (!driven || !handle) return;
    const tag = handle.tag;
    driveKeyboard(tag, "lift", [keyboardLiftBehavior, offset, watched]);
    const stop = watched ? endVisible(tag, (visible) => onEndVisible?.(visible)) : undefined;
    return () => stop?.();
  });
  // Without the engine the end is worked out from the scroll events, which a thread that the engine watches does not have to send.
  const watching = $derived(!driven && onEndVisible !== undefined);
  let lastEnd: boolean | undefined;
  function scrolled(event: NativeSyntheticEvent<NativeScrollEvent>) {
    onScroll?.(event);
    if (!onEndVisible) return;
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const visible = contentOffset.y + layoutMeasurement.height >= contentSize.height - 20;
    if (visible !== lastEnd) { lastEnd = visible; onEndVisible(visible); }
  }
  const keep = (instance: NativeScrollView | null) => { handle = instance as unknown as HostHandle | null; ref?.(instance); };
</script>
<ScrollView {...attributes} scrollEventThrottle={watching ? 16 : scrollEventThrottle} onScroll={watching ? scrolled : onScroll} ref={keep}>{@render children?.()}</ScrollView>
