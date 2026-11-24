<script lang="ts">
  import type { Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ViewProps } from "react-native";
  import type { ClassProps } from "../classes.ts";
  import type { HostHandle } from "../fabric/host.ts";
  import { createNativeProps } from "../native-props.ts";
  import { connectInsets, insets } from "../insets.svelte.ts";
  import { driveKeyboard, keyboardDriven } from "../keyboard-drive.ts";
  /**
   * A view that sticks to the keyboard: its translation follows the keyboard's height, `height + interpolate(progress, [0, 1], [closed, opened])`, as
   * react-native-keyboard-controller's `KeyboardStickyView`. On Android the engine moves it with every frame of the keyboard's animation, on the main thread, in the
   * frame the window moves in, whatever JavaScript is doing; elsewhere it moves once, when the keyboard starts to move.
   */
  let { children, offset, enabled = true, ref, ...attributes }: Omit<ViewProps, "children"> & ClassProps & {
    children?: Snippet;
    /** Extra translation (dp) added to the keyboard's, `closed` while the keyboard is closed and `opened` while it is open, in between in proportion. */
    offset?: { closed?: number; opened?: number };
    /** `false` leaves the view at its `closed` offset whatever the keyboard does. */
    enabled?: boolean;
    /** Receives the host handle (`HostHandle` in `fabric/host.ts`), or null on unmount. */
    ref?: (handle: HostHandle | null) => void;
  } = $props();
  connectInsets();
  const driven = keyboardDriven();
  const resolveProps = createNativeProps();
  let handle = $state<HostHandle | null>(null);
  const closed = $derived(offset?.closed ?? 0);
  const opened = $derived(offset?.opened ?? 0);
  // The engine is told once, and again when the offsets or `enabled` change; the frames do not pass through here.
  $effect(() => {
    if (driven && handle) driveKeyboard(handle.tag, "follow", [closed, opened, enabled]);
  });
  // Without the engine's frames the view is where the keyboard will be, at once.
  const stepped = $derived({ transform: [{ translateY: enabled ? -(insets.keyboardVisible ? insets.keyboardHeight : 0) + closed + (opened - closed) * (insets.keyboardVisible ? 1 : 0) : closed }] });
  // The component goes: nothing of the registration is left in the engine (a scroll view's report of its end, its room), whenever the view itself goes.
  $effect(() => {
    const tag = handle?.tag;
    return () => { if (tag !== undefined) driveKeyboard(tag, "release"); };
  });
  const keep = (value: HostHandle | null) => { handle = value; ref?.(value); };
  // `collapsable: false`: a view that has no transform of its own does not form a stacking context, and Fabric then flattens its children out of it (they would stay where they are while the view moves).
  const nativeProps = $derived(resolveProps({ ...attributes, collapsable: false, style: driven ? attributes.style : [attributes.style, stepped], ref: keep }));
</script>
<native-view {nativeProps}>{@render children?.()}</native-view>
