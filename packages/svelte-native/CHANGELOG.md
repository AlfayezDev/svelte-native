# Changelog

Notable changes to `@rasheed/svelte-native`, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are `0.x` while the package is private and its Svelte compiler is pinned to an unmerged pull request, so a minor version may break. Each line is what an app that uses the package gets.

## Unreleased

### Added

- Android: a screen reader now gets `accessibilityState` (selected, disabled, checked including mixed, busy, expanded), `accessibilityValue` (a slider's range and text), `accessibilityHint`, `accessibilityActions` with `onAccessibilityAction` (`{ nativeEvent: { actionName } }`), `accessibilityLiveRegion`, `importantForAccessibility` and `role` from the engine's views, the way React Native's Android views publish them (same TalkBack announcements, same node info, React Native's own role strings in the device's language). The engine dropped all of them before.
- `aria-*` props (`aria-label`, `aria-checked`, `aria-selected`, `aria-disabled`, `aria-expanded`, `aria-busy`, `aria-hidden`, `aria-live`, `aria-labelledby`, `aria-valuemin|max|now|text`) work on both platforms: React Native resolves them in `View.js`, which a Svelte host has none of, so they were ignored on iOS and on the Android engine alike.

### Changed

- The windowed `List` mounts its overscan four frames after the rows that show, not one (the one-frame flush went ahead of the layout event of the visible rows on a phone with slow cores), and the wrapper of a row of a list whose rows have one size is described once per row. Once the animation layer is loaded only the nodes that can need it go through it, and a node the host has not built no longer reports its changes.
- Android boot (Samsung A16, 2 November 2026; SPEC "Boot on the phone, round 2"): the Expo plugin now generates `override fun attachBaseContext(base: Context)` into `MainApplication.kt`, which calls `BootBoost.preloadLibraries(base)` (SoLoader and the start's native libraries load on a thread of its own while the Application is set up). **A `MainApplication.kt` that already overrides `attachBaseContext` clashes with it**: `prebuild` now stops with a message unless the existing override calls `expo.modules.svelteengine.BootBoost.preloadLibraries(base)` itself (then the plugin adds nothing). `MainActivity.onCreate` gets two generated calls (`BootBoost.activityCreated()`, `ViewWarmup.begin(this)`).
- Android boot: `expo-blur`, `expo-conic-gradient`, `expo-image` and `expo-linear-gradient` are built when their first component is mounted (like `expo-video`), not with the host, so `requireNativeModule` on them builds the module on first use. The boot pin no longer asks the system whether the process is on screen: it is made in the app's main process (not in another process of the app), kept when the Activity says it exists, and dropped when no Activity came.
- A text under a live region tells it when its text changes (an engine text is a plain view); a role description is React Native's string ("Link", "Tab") instead of the engine's own lowercase one; a `button`, `imagebutton` or `togglebutton` role makes the node clickable.

### Fixed

- `List`: `scrollToIndex` and `scrollToOffset` called before the scroll view is bound and has its first layout (a page that scrolls its list in the effect that runs as the list mounts) sent the command to no view and the list stayed at the top. The last such request is kept and sent when both are there. The two commands no longer subscribe the effect that calls them to the list's window, row sizes and header.

## 0.2.0 - 2026-11-01

Built from `48d746e54`. Device results behind this release are in [PLAN.md](PLAN.md), "Production plan"; the gates of the final build are still to be filled in there.

### Added

- Gestures: `@rasheed/svelte-native/gestures` runs react-native-gesture-handler 2.32 on Svelte views (`gesture={...}` on any primitive, `<GestureDetector>`, `use:gesture`), with worklet callbacks on the UI thread, relations across components and development-time checks of what a worklet captures.
- Native-view wrappers in `@rasheed/svelte-native/foreign` for twelve libraries (expo-image, expo-blur, expo-linear-gradient, react-native-video, @react-native-community/datetimepicker, lottie-react-native, react-native-pdf, react-native-view-shot, rive-react-native, expo-conic-gradient, react-native-fast-shadow, react-native-animateable-text), next to `WebView`, `MapView`/`Marker`, `VideoView` and the generic `ForeignView`; all are optional peer dependencies.
- `@rasheed/svelte-native/svg`: react-native-svg 15.15.4 as 36 Svelte components (every element and filter, `SvgXml`, `SvgUri`) with the library's own prop extraction, refs with `getBBox`/`getTotalLength`/`toDataURL`, and `animatedProps`.
- `animatedProps` next to `animatedStyle` on any element, for animated props that are not style.
- `@rasheed/svelte-native/native-modules`: `turboModule(name)` and `nativeModule(name)` reach a native module without React; a smoke app (`APP_VARIANT=smoke`, `io.rasheed.svelteqa.smoke`) loads 36 native modules of the production app and `native-qa smoke` fails when one stops loading.
- File-based navigators: a `+layout.mobile.svelte` with `export const navigator = "stack" | "tabs"` makes its directory a stack or a tab bar, `<Stack>` and `<Tabs>` render it, and `goto`, `back`, `reset` and deep links resolve over the whole tree.
- Native screens through `<Screen>`: header (title, subtitle, back, left/center/right slots, search, large-title collapse, translucent), sheets with detents and drag, form sheets, tab bars with icons and badges, per-screen system bar colors, `onAppear`/`onDisappear`; `useHeader()` and `useToolbar()` report the bars' heights.
- A native bottom toolbar (`<Screen toolbar={...}>`): `UIToolbar` on iOS, a Material bar on Android, with badges, spacers, a center snippet and a translucent mode.
- Navigation state survives an Android Activity recreation (font scale, locale) and a process kill, and the launch link is the stack's base. On iOS it survives a process the system ended while the app was in the background (the `SvelteNavigation` module and an `AppDelegate.swift` patch from the Expo plugin), not one the user swiped away.
- A screen popped by JavaScript stays mounted until the stack reports `topExited`, on both platforms, so the transition finishes before the screen is destroyed.
- Expo Updates compatible with `eas update`: `@rasheed/svelte-native/updates` (`checkForUpdateAsync`, `fetchUpdateAsync`, `reloadAsync`) with a native store and launcher; a launch is confirmed only after a healthy window (idle, 3 s, no fatal), a fatal rolls the update back at the next start, and one unconfirmed launch does not blacklist a good update (on iOS a failing update needs two unconfirmed launches).
- Virtualized `List`: fixed or measured row heights, `horizontal`, `initialScrollIndex`, `header`/`footer`/`empty`, `onEndReached`, `onViewableItemsChanged`, row wrapper recycling.
- `KeyboardAvoidingView`, an insets store (`insets`, safe area and keyboard) on both platforms, and `Modal` presented on an engine overlay layer on Android.
- Config plugin options `autolinkingExclude` (leave packages and local Expo modules out of both autolinkers) and `androidOnDemandViewManagers` (keep a package's view managers off the app start).
- New entries `core`, `init`, `fabric`, `foreign`, `svg`, `gestures`, `updates`, `native-modules`, `animation`, `routes`, `lower`, `expo` and `elements`; `bootSummary()` exposes the boot phases.

### Changed

- The Android host is the package's own engine (`apps/platform/modules/svelte-engine`): Fabric's mounting is replaced by typed Kotlin views, so mounting 600 views costs about a fifth of React Native's on the Samsung A16 and the Reanimated frame path no longer builds Java maps. iOS keeps React Native's mounting.
- There is no React in the render path: the React host, `react-native-screens`, `react-native-safe-area-context` and the dev client are gone, and Metro maps `InitializeCore` to the package's own `init.ts`.
- `<View>`, `<Text>`, `<ScrollView>`, `<Image>`, `<ActivityIndicator>` and `<Pressable>` are lowered to host tags at compile time, so a row costs host nodes only.
- Boot on Android: route modules load on first use, the Expo module registry and the Reanimated and gesture hosts load lazily, view configs are static, start-up threads stay on the big cores until the first mount, and a baseline profile ships for the engine and updates modules.
- Frames on Android: pooled views, a text layout cache, views with partial alpha are no longer promoted to hardware layers, screens hidden with alpha instead of `INVISIBLE`, layout events delivered in the batch that mounted them, and a fixed native heap leak in animated views.
- Route tables are generated per bundle variant (`.svelte-native/routes.<variant>.ts`); Metro writes the table for the variant it bundles and refuses a bundle whose table belongs to another.
- The windowed `List` mounts the rows that fit first and its overscan a frame later, and fixed-height rows skip the layout report.
- `ref` callbacks follow React's contract on every element and component: the handle when the element is built, `null` when it is destroyed, and the old callback gets `null` before a replacement gets the handle.
- On iOS `Modal` mounts its native host only while it is shown, as React Native's does.
- A function-valued `ref` or attribute survives a spread on a lowered primitive.
- A popped iOS screen stays mounted until the stack reports its exit.
- Peer dependencies: `react-native-gesture-handler`, `react-native-reanimated` and `react-native-worklets` are required (a native rebuild); the libraries behind the wrappers are optional.
- The product (`APP_VARIANT=production`) contains no development lab: route discovery skips `__dev` directories and `export const lab = true` pages, Metro stubs the lab's modules, and a bundle whose table names the lab is refused.

### Removed

- The `@rasheed/svelte-native/host` export and the React entry (`SVELTE_NATIVE_FABRIC`, `androidHeadless`, the dev client).
- The Android `Dialog` behind `Modal`.

### Fixed

- iOS: a hidden `Modal` swallowed every touch on pushed screens.
- A scroll view's content container follows `contentContainerStyle` and `horizontal` after the first render.
