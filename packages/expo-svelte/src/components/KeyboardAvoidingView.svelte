<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import type { ClassProps } from "../classes.ts";
  import { createNativeProps } from "../native-props.ts";
  import { avoidingStyle, keyboardOverlap, type AvoidBehavior } from "../fabric/insets.ts";
  import { connectInsets, insets } from "../insets.svelte.ts";
  import { driveKeyboard, keyboardDriven } from "../keyboard-drive.ts";
  import type { HostHandle } from "../fabric/host.ts";
  import type { KeyboardAvoidingViewProps } from "react-native";
  /**
   * React Native's KeyboardAvoidingView on the insets store: "padding" adds bottom padding, "height" shrinks the view,
   * "position" lifts an inner container, each by how far the keyboard overlaps the view (measured in window coordinates).
   * "position" moves with every frame of the keyboard's animation on Android (the engine moves the container, `KeyboardDrive`); the others change once, when it starts.
   */
  let { children, behavior, contentContainerStyle, enabled = true, keyboardVerticalOffset = 0, style, onLayout, ...attributes }: Omit<KeyboardAvoidingViewProps, "children"> & { children?: Snippet } & ClassProps = $props();
  connectInsets();
  const resolveProps = createNativeProps();
  const resolveInner = createNativeProps();
  let handle: HostHandle | null = null;
  const engine = keyboardDriven();
  const driven = $derived(engine && behavior === "position");
  let inner = $state<HostHandle | null>(null);
  let outer = $state<HostHandle | null>(null);
  let frame = $state<{ y: number; height: number } | null>(null);
  let initialHeight = 0;
  let bottom = $state(0);

  function measure() {
    handle?.measureInWindow((_x, y, _width, height) => {
      // The height the view has when nothing is taken off it: the one measured while it is not avoiding the keyboard, so a view resized while the keyboard is closed
      // (the window, a split screen) shrinks from its new height the next time the keyboard opens, not from the first one it had (#117).
      if (!initialHeight || untrack(() => applied) === 0) initialHeight = height;
      if (!frame || frame.y !== y || frame.height !== height) frame = { y, height };
    });
  }
  function layout(event: Parameters<NonNullable<KeyboardAvoidingViewProps["onLayout"]>>[0]) {
    measure();
    onLayout?.(event);
  }
  // The engine works out how far the keyboard covers the view itself, when the keyboard starts to open, and moves the container with the keyboard's progress.
  $effect(() => {
    if (driven && inner && outer) driveKeyboard(inner.tag, "avoid", [outer.tag, keyboardVerticalOffset, enabled]);
  });
  $effect(() => {
    if (driven) return;
    const keyboard = insets.keyboardVisible ? insets.keyboardHeight : 0;
    if (keyboard === 0) { bottom = 0; return; }
    if (!frame) { measure(); return; }
    bottom = keyboardOverlap({ viewY: frame.y, viewHeight: frame.height, rootHeight: insets.frame.height, keyboardHeight: keyboard, offset: keyboardVerticalOffset, behavior: behavior as AvoidBehavior, previous: untrack(() => bottom) });
  });
  // One function for the life of the component: a new `ref` each time the props are built would be called with null and then the handle again.
  const keep = (value: HostHandle | null) => { handle = value; outer = value; };
  const keepInner = (value: HostHandle | null) => { inner = value; };
  const applied = $derived(enabled ? bottom : 0);
  const outerProps = $derived(resolveProps({ ...attributes, style: avoidingStyle(behavior as AvoidBehavior, style, applied, initialHeight), onLayout: layout, ref: keep }));
  // A container the engine moves keeps its own view and its children (`collapsable: false`: Fabric flattens a view that forms no stacking context, and its children out of it).
  const content = $derived(resolveInner({ style: driven ? contentContainerStyle : [contentContainerStyle, { bottom: applied }], ...(driven ? { collapsable: false } : {}), ref: keepInner }));
</script>
{#if behavior === "position"}
  <native-view nativeProps={outerProps}><native-view nativeProps={content}>{@render children?.()}</native-view></native-view>
{:else}
  <native-view nativeProps={outerProps}>{@render children?.()}</native-view>
{/if}
