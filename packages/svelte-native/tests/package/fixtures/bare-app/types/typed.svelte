<!-- What the library's README and REFERENCE document, as an app would write it. `tests/package/node-modules.test.ts` type-checks this file with svelte-check in an
     app that has the packed package in its node_modules and no declaration of its own: it has to pass, and so does everything the library's own source imports. -->
<script lang="ts">
  import {
    View, Text, TextInput, Pressable, ScrollView, Image, Switch, ActivityIndicator, Modal, SafeAreaView, KeyboardAvoidingView, List,
    Screen, Stack, Tabs, Native, useRouter, useHeader, useToolbar, inTabPane, insets, bootSummary, openLaunchURL,
    AnimatedView, createSharedValue, withTiming, withSpring, withRepeat, withSequence, withDelay, runOnUISync, runOnUIAsync,
    Gesture, GestureDetector, BlurView, Svg, Path, SvgText, SvgImage, type SvgHandle,
  } from "@alfayez/svelte-native";
  import { Platform, Appearance, Dimensions, Linking, Keyboard, AppState, BackHandler, PixelRatio, Share, Vibration, Alert, turboModule, nativeModule } from "@alfayez/svelte-native/platform";
  import { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
  import { checkForUpdateAsync, fetchUpdateAsync, reloadAsync, isEnabled } from "@alfayez/svelte-native/updates";

  let name = $state("");
  let on = $state(false);
  let pressed = $state(false);
  let list: { scrollToIndex(index: number, animated?: boolean): void; scrollToOffset(offset: number, animated?: boolean): void } | undefined = $state();
  const router = useRouter();
  const header = useHeader();
  const toolbar = useToolbar();
  const x = createSharedValue(0);
  const pan = Gesture.Pan().onUpdate((e) => { x.value = e.translationX; }).onEnd(() => { x.value = withSpring(0); });
  const root = useRouter("root");
  router.back(); router.replaceBase("/x"); void router.openURL("x"); void [router.current.url, router.entries, router.screens, root.current.params];
  const rows = [{ id: 1, title: "a" }];
  const os: "ios" | "android" = Platform.OS;
  const version = Platform.OS === "ios" ? Platform.Version.toUpperCase() : Platform.Version.toFixed(0);
  const picked = Platform.select({ ios: 1, android: 2 });
  const scheme = Appearance.getColorScheme();
  const size = Dimensions.get("window").width;
  void Linking.getInitialURL();
  const sub = Linking.addEventListener("url", ({ url }) => url);
  sub.remove();
  Keyboard.dismiss();
  const appState = AppState.currentState;
  BackHandler.addEventListener("hardwareBackPress", () => true).remove();
  void [PixelRatio.get(), Share.share({ message: "x" }), Vibration.vibrate(), Alert.alert("t")];
  const svgHandle: SvgHandle | null = null;
  void [svgHandle, GestureDetector, SvgImage, BlurView, os, version, picked, scheme, size, appState, header.height, toolbar.height, inTabPane(), insets.top, bootSummary, openLaunchURL, turboModule, nativeModule, checkForUpdateAsync, fetchUpdateAsync, reloadAsync, isEnabled, withTiming, withRepeat, withSequence, withDelay, runOnUISync, runOnUIAsync];
</script>

<Stack header={{ large: true }} animation="slide_from_right">
  <Screen
    title="Account" subtitle="sub"
    header={{ large: true, translucent: true, hidden: false, hideBack: true, backTitle: "Back", tint: "#fff", background: "#000" }}
    search={{ placeholder: "s", onChangeText: () => {}, onSubmit: () => {}, onCancel: () => {} }}
    sheet={{ detents: [0.4, 0.9], grabber: true, dismissible: true, backdrop: "dim" }}
    presentation="sheet"
    toolbar={{ items: [{ key: "a", title: "A", icon: 1, badge: 2, disabled: false }, { key: "g", spacer: true }], onPress: (key) => key, translucent: true }}
    statusBar={{ style: "auto", hidden: false }}
    navigationBar={{ color: "#000", style: "light" }}
    onAppear={() => {}} onDisappear={() => {}} onDismiss={() => {}} onDetentChange={(c) => c.index}
  >
    {#snippet headerLeft()}<Text>l</Text>{/snippet}
    {#snippet headerCenter()}<Text>c</Text>{/snippet}
    {#snippet headerRight()}<Text>r</Text>{/snippet}
    {#snippet headerSearch()}<Text>s</Text>{/snippet}
    {#snippet toolbarCenter()}<Text>t</Text>{/snippet}
    <View
      style={{ padding: 24, gap: 16 }} accessibilityLabel="x" accessible accessibilityRole="button" hitSlop={8}
      aria-label="l" aria-checked aria-selected aria-disabled aria-expanded aria-busy aria-hidden aria-live="polite" aria-labelledby="id"
      aria-valuemin={0} aria-valuemax={1} aria-valuenow={1} aria-valuetext="x" role="button"
      accessibilityState={{ selected: true }} accessibilityValue={{ min: 0, max: 1, now: 1, text: "x" }} accessibilityHint="h"
      accessibilityActions={[{ name: "activate" }]} onAccessibilityAction={(e) => e.nativeEvent.actionName}
      accessibilityLiveRegion="polite" importantForAccessibility="yes"
      onPress={() => {}} onLongPress={() => {}} onPressIn={() => {}} onPressOut={() => {}} onPressChange={(p) => (pressed = p)}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={() => {}} onResponderMove={() => {}} onResponderRelease={() => {}} onResponderTerminate={() => {}} onResponderTerminationRequest={() => true}
      gesture={pan} ref={(h) => h?.measure((x, y, width, height) => void [x, y, width, height])} testID="t" nativeID="n" onLayout={() => {}} pointerEvents="box-only"
    >
      <TextInput bind:value={name} accessibilityLabel="Name" ref={(h) => { h?.focus(); h?.blur(); h?.dispatchCommand("focus", []); }} returnKeyType="done" keyboardType="numeric" secureTextEntry />
      <Pressable
        onPress={() => router.goto("/x", { reset: true, replaceState: true, presentation: "modal" })}
        onPressChange={(p) => (pressed = p)} onPressIn={() => {}} onPressOut={() => {}} onLongPress={() => {}}
        hitSlop={8} pressRectOffset={20} pressRetentionOffset={20} delayLongPress={500} delayPressIn={10} delayPressOut={10} minPressDuration={130} cancelable disabled={false}
        accessibilityRole="button" gesture={pan}
      >
        <Text onPress={() => {}} onLongPress={() => {}} onPressChange={(p) => (pressed = p)} numberOfLines={2} gesture={pan}>Settings {pressed}</Text>
      </Pressable>
      <Switch bind:value={on} accessibilityLabel="s" />
      <ActivityIndicator animating size="large" />
      <Image source={{ uri: "x" }} resizeMode="cover" gesture={pan} />
      <ScrollView ref={(h) => { h?.scrollTo({ y: 0 }); h?.dispatchCommand("scrollToEnd", [true]); }} gesture={pan} horizontal />
      <SafeAreaView edges={["top"]} />
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={10} />
      <Modal visible={on} transparent onRequestClose={() => {}} animationType="fade" />
      <List bind:this={list} items={rows} rowHeight={56} keyOf={(row) => row.id} estimatedRowHeight={40} rowHeights={() => 5} horizontal initialScrollIndex={0}
        onEndReached={() => {}} onEndReachedThreshold={0.5} onViewableItemsChanged={({ viewableItems }) => viewableItems.length} viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
        overscan={4} recycle keyExtractor={(row) => row.id} scrollEventThrottle={16}>
        {#snippet row(item, index)}<Text>{item.title}{index}</Text>{/snippet}
        {#snippet header()}<Text>h</Text>{/snippet}
        {#snippet footer()}<Text>f</Text>{/snippet}
        {#snippet empty()}<Text>e</Text>{/snippet}
      </List>
      <Tabs items={[{ key: "a", title: "A", badge: true }]} selected="a" onSelect={() => {}} tint="#fff">
        {#snippet content(tab)}<Text>{tab.key}</Text>{/snippet}
      </Tabs>
      <AnimatedView gesture={pan} style={{ width: 96, height: 96 }} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }} />
      <AnimatedView entering={FadeIn} exiting={FadeOut} layout={LinearTransition} animatedProps={() => { "worklet"; return {}; }} style={{ transitionProperty: "opacity", transitionDuration: 300, animationName: { from: { opacity: 0 }, to: { opacity: 1 } }, animationDuration: 500 }} />
      <GestureDetector gesture={pan}><View /></GestureDetector>
      <BlurView intensity={40} tint="light" style={{ height: 40 }}><Text>blur</Text></BlurView>
      <Svg width={40} height={40}><Path d="M0 0L10 10" stroke="#000" /><SvgText x={1} y={2}>t</SvgText><SvgImage href="x" width={4} height={4} /></Svg>
      <Native name="native-view" attributes={{}} />
      <native-view nativeStyle={{ flex: 1 }} onPress={() => {}}></native-view>
      <native-pressable onPressChange={() => {}}></native-pressable>
    </View>
  </Screen>
</Stack>
