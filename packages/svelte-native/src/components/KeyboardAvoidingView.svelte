<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import { createNativeProps } from "../native-props.ts";
  import { avoidingStyle, keyboardOverlap, type AvoidBehavior } from "../fabric/insets.ts";
  import { connectInsets, insets } from "../insets.svelte.ts";
  import type { KeyboardAvoidingViewProps } from "react-native";
  /**
   * React Native's KeyboardAvoidingView on the insets store: "padding" adds bottom padding, "height" shrinks the view,
   * "position" lifts an inner container, each by how far the keyboard overlaps the view (measured in window coordinates).
   * No keyboard animation yet.
   */
  let { children, behavior, contentContainerStyle, enabled = true, keyboardVerticalOffset = 0, style, onLayout, ...attributes }: Omit<KeyboardAvoidingViewProps, "children"> & { children?: Snippet } = $props();
  connectInsets();
  const resolveProps = createNativeProps();
  const resolveInner = createNativeProps();
  let handle: { measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void } | null = null;
  let frame = $state<{ y: number; height: number } | null>(null);
  let initialHeight = 0;
  let bottom = $state(0);

  function measure() {
    handle?.measureInWindow((_x, y, _width, height) => {
      if (!initialHeight) initialHeight = height;
      if (!frame || frame.y !== y || frame.height !== height) frame = { y, height };
    });
  }
  function layout(event: Parameters<NonNullable<KeyboardAvoidingViewProps["onLayout"]>>[0]) {
    measure();
    onLayout?.(event);
  }
  $effect(() => {
    const keyboard = insets.keyboardVisible ? insets.keyboardHeight : 0;
    if (keyboard === 0) { bottom = 0; return; }
    if (!frame) { measure(); return; }
    bottom = keyboardOverlap({ viewY: frame.y, viewHeight: frame.height, rootHeight: insets.frame.height, keyboardHeight: keyboard, offset: keyboardVerticalOffset, behavior: behavior as AvoidBehavior, previous: untrack(() => bottom) });
  });
  const applied = $derived(enabled ? bottom : 0);
  const outer = $derived(resolveProps({ ...attributes, style: avoidingStyle(behavior as AvoidBehavior, style, applied, initialHeight), onLayout: layout, ref: (value: typeof handle) => { handle = value; } }));
  const inner = $derived(resolveInner({ style: [contentContainerStyle, { bottom: applied }] }));
</script>
{#if behavior === "position"}
  <native-view nativeProps={outer}><native-view nativeProps={inner}>{@render children?.()}</native-view></native-view>
{:else}
  <native-view nativeProps={outer}>{@render children?.()}</native-view>
{/if}
