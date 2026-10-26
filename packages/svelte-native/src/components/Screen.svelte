<script lang="ts" module>
  export { useHeader } from "../fabric/navigation.ts";
</script>

<script lang="ts">
  import { getContext, setContext, type Snippet } from "svelte";
  import type {} from "../elements.d.ts";
  import Platform from "react-native/Libraries/Utilities/Platform";
  import { createNativeProps } from "../native-props.ts";
  import { connectInsets, insets } from "../insets.svelte.ts";
  import {
    HEADER_CONTEXT, SCREEN_CONTEXT, SLOT_CENTER, SLOT_LEFT, SLOT_RIGHT, SLOT_SEARCH,
    headerHeight, mergeScreenOptions,
    type DetentChange, type HeaderMetrics, type NavigationPlatform, type ScreenOptions,
  } from "../fabric/navigation.ts";

  /**
   * One screen of a stack, with its header, sheet and system bar configuration (contract: SPEC.md "Screen API contract").
   * The outermost `Screen` of a stack entry renders the `native-screen`, its `native-header` and a content view; a `Screen`
   * inside another one (a page inside the router's screen, a page inside a layout's) renders only its content and hands its
   * options to the outer one: the inner value wins per option, object options merge, event handlers all run.
   * The header is opt-in: it is shown when `title`, `subtitle`, `header`, a header snippet or `search` is given.
   */
  let { children, ...own }: ScreenOptions & { children?: Snippet } = $props();

  const parent = getContext<{ set(options: ScreenOptions): void; clear(): void } | undefined>(SCREEN_CONTEXT);
  let nested = $state.raw<ScreenOptions>({});
  const options = $derived(mergeScreenOptions(own, nested));
  setContext(SCREEN_CONTEXT, { set(value: ScreenOptions) { nested = value; }, clear() { nested = {}; } });
  if (parent) $effect.pre(() => { parent.set(options); return () => parent.clear(); });

  const platform: NavigationPlatform = Platform.OS === "ios" ? "ios" : "android";
  connectInsets();
  const presentation = $derived(options.presentation ?? "push");
  const header = $derived(options.header ?? {});
  const large = $derived(header.large === true);
  const slots = $derived((options.headerLeft ? SLOT_LEFT : 0) | (options.headerCenter ? SLOT_CENTER : 0) | (options.headerRight ? SLOT_RIGHT : 0) | (options.search ? SLOT_SEARCH : 0));
  const shown = $derived(header.hidden !== true && (options.title !== undefined || options.subtitle !== undefined || options.header !== undefined || slots !== 0));
  // The arrow means "pop": modals and sheets leave their close affordance to the screen's own header buttons.
  const back = $derived(options.canGoBack === true && presentation === "push" && header.hideBack !== true && !options.headerLeft);

  // The estimate is exact on Android (fixed bar, inset from the store); the native side reports its own height, which corrects iOS.
  let measured = $state<(HeaderMetrics & { large: boolean }) | null>(null);
  const current = $derived(measured && measured.large === large ? measured : null);
  const inset = $derived(current?.inset ?? insets.top);
  const height = $derived(current?.height ?? headerHeight(platform, insets.top, large));
  function metrics(event: { nativeEvent: HeaderMetrics }) { measured = { height: event.nativeEvent.height, inset: event.nativeEvent.inset, large }; }
  if (!parent) setContext(HEADER_CONTEXT, { get height() { return shown ? height : 0; }, get inset() { return shown ? inset : 0; } });

  // Search text is native-owned; `value` is applied by the native side only while no newer edit than the acknowledged count is pending.
  let count = $state(0);
  function change(event: { nativeEvent: { text: string; eventCount: number } }) {
    count = event.nativeEvent.eventCount;
    options.search?.onChangeText?.(event.nativeEvent.text);
  }
  const submit = (event: { nativeEvent: { text: string } }) => options.search?.onSubmit?.(event.nativeEvent.text);
  const cancel = () => options.search?.onCancel?.();

  const appear = () => options.onAppear?.();
  const disappear = () => options.onDisappear?.();
  const dismissed = () => options.onDismiss?.();
  const detentChange = (event: { nativeEvent: DetentChange }) => options.onDetentChange?.(event.nativeEvent);

  const resolveScreen = createNativeProps();
  const resolveHeader = createNativeProps();
  const resolveCenter = createNativeProps();
  const resolveSearch = createNativeProps();
  const resolveContent = createNativeProps();
  const screenProps = $derived(resolveScreen({
    style: options.style,
    activityState: options.activityState,
    stackPresentation: presentation,
    stackAnimation: options.animation,
    gestureEnabled: options.gestureEnabled,
    nativeBackButtonDismissalEnabled: options.nativeBackButtonDismissalEnabled,
    sheetDetents: options.sheet?.detents,
    sheetInitialDetent: options.sheet?.initialDetent,
    sheetGrabber: options.sheet?.grabber,
    sheetDismissible: options.sheet?.dismissible,
    sheetBackdrop: options.sheet?.backdrop,
    availableHeight: insets.frame.height > 0 ? insets.frame.height - insets.top : undefined,
    topInset: insets.top,
    statusBarStyle: options.statusBar?.style,
    statusBarHidden: options.statusBar?.hidden,
    navigationBarColor: options.navigationBar?.color,
    navigationBarStyle: options.navigationBar?.style,
    onAppear: options.onAppear && appear,
    onDisappear: options.onDisappear && disappear,
    onDismissed: dismissed,
    onDetentChange: options.onDetentChange && detentChange,
  }));
  const headerProps = $derived(resolveHeader({
    title: options.title,
    subtitle: options.subtitle,
    backTitle: header.backTitle,
    large,
    translucent: header.translucent,
    back,
    hideShadow: header.hideShadow,
    tint: header.tint,
    background: header.background,
    slots,
    headerHeight: height,
    headerInset: inset,
    onMetrics: metrics,
  }));
  const centerProps = $derived(resolveCenter({ align: platform === "ios" ? "center" : "start" }));
  const searchProps = $derived(resolveSearch({
    placeholder: options.search?.placeholder,
    value: options.search?.value,
    eventCount: count,
    surfaceHeight: insets.frame.height > 0 ? insets.frame.height : undefined,
    headerHeight: height,
    onChange: change,
    onSubmitEditing: submit,
    onCancel: cancel,
  }));
  const contentProps = $derived(resolveContent({ style: { flex: 1 } }));
</script>

{#if parent}
  {@render children?.()}
{:else}
  <native-screen nativeProps={screenProps}>
    {#if shown}
      <native-header nativeProps={headerProps}>
        {#if options.headerLeft}<native-header-left>{@render options.headerLeft()}</native-header-left>{/if}
        {#if options.headerCenter}<native-header-center nativeProps={centerProps}>{@render options.headerCenter()}</native-header-center>{/if}
        {#if options.headerRight}<native-header-right>{@render options.headerRight()}</native-header-right>{/if}
        {#if options.search}<native-header-search nativeProps={searchProps}>{@render options.headerSearch?.()}</native-header-search>{/if}
      </native-header>
    {/if}
    <native-view nativeProps={contentProps}>{@render children?.()}</native-view>
  </native-screen>
{/if}
