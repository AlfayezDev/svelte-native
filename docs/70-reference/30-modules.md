---
title: Modules
---

Expo Svelte's code is split into a few entry points. An app imports almost everything from the main one and reaches for `/foreign`, `/platform`, `/remote`, `/updates` and `/push` for the rest. This page lists each entry point and what it exports, with a link to the page that explains it.

## expo-svelte

The main entry: components, navigation, the app's state, animation, gestures and SVG.

| Export | Description |
| --- | --- |
| `View` | A box: the building block of every layout. [View](view) |
| `Text` | Text, and the only place text can go. [Text](text) |
| `Pressable` | Anything that reacts to a tap. [Pressable](pressable) |
| `TextInput` | A text field, with `bind:value`. [TextInput](text-input) |
| `Switch` | An on and off toggle, with `bind:value`. [Switch](switch) |
| `Image` | A picture from a file or a URL. [Image](image) |
| `ScrollView` | Content that scrolls. [ScrollView](scroll-view) |
| `List` | A long list that mounts only the rows near the screen. [List](list) |
| `Modal` | Content over the whole screen. [Modal](modal) |
| `SafeAreaView` | A view padded by the safe area. [SafeAreaView](safe-area-view) |
| `KeyboardAvoidingView` | A view that moves out of the keyboard's way. [KeyboardAvoidingView](keyboard-avoiding-view) |
| `KeyboardStickyView` | A view that rides the keyboard, frame by frame. [KeyboardStickyView](keyboard-sticky-view) |
| `KeyboardChatScrollView` | A scroll view for a chat thread, lifted by the keyboard. [KeyboardChatScrollView](keyboard-chat-scroll-view) |
| `KeyboardAwareScrollView` | A scroll view that keeps the focused input above the keyboard. [KeyboardAwareScrollView](keyboard-aware-scroll-view) |
| `ActivityIndicator` | A spinner. [ActivityIndicator](activity-indicator) |
| `Screen` | A screen's header, toolbar, sheet and system bars. [Screen](screen) |
| `Stack` | The options of a stack navigator, in its layout. [Stack](stack) |
| `Tabs` | A tab bar. [Tabs](tabs) |
| `useRouter(scope?)` | The router of the nearest navigator: `goto`, `back`, `current`, `entries`. [Routing](routing#navigating) |
| `openLaunchURL(router, accept?)` | Waits for the link the app was launched with, so the shell can choose what to render. [Routing](routing#deep-links) |
| `useHeader()`, `useToolbar()` | The height of the screen's header or toolbar, to pad content under a translucent bar. [Screen](screen) |
| `inTabPane()` | Whether the caller is inside a tab pane. [Tabs](tabs) |
| `colorScheme` | `colorScheme.current` is `'light'` or `'dark'`, as state. [Styling](styling#light-and-dark-mode) |
| `windowSize` | The window's `width`, `height`, `scale`, `fontScale` and `screen`, as state. [Platform APIs](platform-apis#window-size) |
| `insets` | The safe area and the keyboard, as state. [Platform APIs](platform-apis#safe-area-and-keyboard) |
| `BlurView` | Expo Svelte's own blur. [BlurView](blur-view) |
| `Native` | A native element whose tag is chosen at run time. For library authors. |
| `Router`, `createRouter` | The router's building blocks. The generated entry uses them; an app doesn't need to. |
| `bootSummary()` | How long each phase of the app's start took, as one line of text, for profiling. |

The types of the options are exported too: `ScreenOptions`, `HeaderOptions`, `SheetOptions`, `ToolbarOptions`, `ToolbarItem`, `TabItem`, `StatusBarOptions`, `NavigationBarOptions`, `SearchOptions`, `Presentation`, `Detent`, `BarStyle`, `ScreenAnimation`, `NavigateOptions`, `NativeLocation`, `NativeRouter` and `HostHandle`, and `MobileHooks`, the exports of [`src/hooks.mobile.ts`](hooks).

### Animation

Animations on the UI thread, with Reanimated. [Animation](animation) Reanimated loads the first time one of these is used, not when the app starts.

| Export | Description |
| --- | --- |
| `AnimatedView` | A `View` with `animatedStyle`, `animatedProps` and layout animations. |
| `createSharedValue(initial)` | A value both threads can read, cancelled when the component is destroyed. |
| `createKeyboardMotion()` | The keyboard's `height`, `progress` and `state` as shared values, moved with every frame of its animation. [Animation](animation#keyboard-motion) |
| `withTiming`, `withSpring`, `withRepeat`, `withSequence`, `withDelay` | Animate a shared value. |
| `cancelAnimation(value)` | Stops a shared value's animation. |
| `Easing`, `ReduceMotion` | Timing curves; the reduce motion setting of an animation. |
| `runOnUISync`, `runOnUIAsync` | Run a worklet on the UI thread. |
| `runOnJS`, `scheduleOnRN` | From a worklet, call a function on the JavaScript thread. |
| `SharedValue` | The type of a shared value. |

### Gestures

Native gesture recognisers, with react-native-gesture-handler. [Gestures](gestures) The builders load the first time `Gesture` is read.

| Export | Description |
| --- | --- |
| `Gesture` | The builders: `Tap`, `LongPress`, `Pan`, `Fling`, `Pinch`, `Rotation`, `Native`, `Manual`, and `Simultaneous`, `Race`, `Exclusive`. |
| `GestureDetector` | A `View` that carries a gesture. |
| `gesture` | The action form: `use:gesture={g}`. |
| `GestureStateManager` | Activates or fails a gesture by hand, from its touch callbacks. |
| `State`, `Directions`, `PointerType`, `TouchEventType` | The library's constants. |
| `runOnJS`, `scheduleOnRN` | The same as in the animation exports above. |

### SVG

SVG with react-native-svg, which the library carries itself: `Svg`, `G`, `Path`, `Rect`, `Circle`, `Ellipse`, `Line`, `Polygon`, `Polyline`, `SvgText`, `TSpan`, `TextPath`, `Use`, `SvgImage`, `Defs`, `ClipPath`, `SvgLinearGradient`, `RadialGradient`, `Stop`, `Pattern`, `Mask`, `SvgMarker`, `Symbol`, `ForeignObject`, the filters (`Filter`, `FeBlend`, `FeColorMatrix`, `FeComposite`, `FeDropShadow`, `FeFlood`, `FeGaussianBlur`, `FeMerge`, `FeMergeNode`, `FeOffset`), `SvgXml` and `SvgUri`, and the handle types `SvgHandle` and `SvgRootHandle`. react-native-svg's `Text`, `Image`, `LinearGradient` and `Marker` are `SvgText`, `SvgImage`, `SvgLinearGradient` and `SvgMarker` here, because `Text` and `Image` are the views and `/foreign` has a `LinearGradient` and a `Marker` of its own (expo-linear-gradient and react-native-maps). [SVG](svg)

## expo-svelte/foreign

Native views of other libraries. [Native views](native-views). Each component needs its library turned on in `libraries` of the [plugin's options](configuration#libraries); a component whose library is off throws a message that says so.

| Export | Description |
| --- | --- |
| `ExpoImage` | `expo-image`. |
| `BlurView` | Expo Svelte's own blur ([BlurView](blur-view)). The main entry exports it too. |
| `ExpoBlurView`, `BlurTargetView` | `expo-blur`. |
| `LinearGradient` | `expo-linear-gradient`. |
| `ConicGradient` | `expo-conic-gradient`. |
| `Video` | `react-native-video`. |
| `VideoView`, `createVideoPlayer` | `expo-video`. `createVideoPlayer` is the library's own function, which makes the `player` a `VideoView` shows. |
| `LottieView` | `lottie-react-native`. |
| `Rive` | `rive-react-native`. |
| `DateTimePicker`, `openDatePicker`, `dismissDatePicker` | `@react-native-community/datetimepicker`. |
| `Pdf` | `react-native-pdf` (and `react-native-blob-util`, which it brings). |
| `WebView` | `react-native-webview`. |
| `MapView`, `Marker` | `react-native-maps`. |
| `ViewShot`, `captureRef`, `captureScreen`, `releaseCapture` | `react-native-view-shot`. |
| `ShadowedView`, `shadowStyle` | `react-native-fast-shadow`. |
| `AnimateableText` | `react-native-animateable-text`. |
| `ExpoView`, `defineExpoView` | The native view of any Expo module. |
| `ForeignView` | Any native component, by its Fabric name. |

The handle and option types (`VideoHandle`, `LottieHandle`, `MapHandle`, `WebViewHandle`, `RiveHandle`, `PdfHandle`, `ExpoViewHandle`, `CaptureOptions`, ...) are exported with them.

## expo-svelte/platform

React Native's platform modules, typed: `Platform`, `Appearance`, `Dimensions`, `PixelRatio`, `Linking`, `Keyboard`, `KeyboardController`, `AppState`, `BackHandler`, `Share`, `Vibration` and `Alert`. Each loads the first time it's used. [Platform APIs](platform-apis)

It also has the two lookups of native modules: `turboModule<T>(name)` returns a TurboModule by name and throws when the build doesn't have it, and `nativeModule<T>(name)` returns a legacy NativeModule by name, or `undefined`. [Native libraries](native-libraries#calling-a-native-module-directly)

## expo-svelte/mmkv

react-native-mmkv, for storage of the app's own, and the instance behind `localStorage`. [Web APIs](web-apis#storage)

| Export | Description |
| --- | --- |
| `createMMKV(configuration?)` | react-native-mmkv's: a storage with typed values, encryption and an id of your choosing. |
| `localStorageMMKV()` | The MMKV instance `localStorage` keeps its data in, created on the first call. |
| `MMKV`, `Configuration`, `Mode` | react-native-mmkv's types. |

A page that both the web and the phone import can use it: for the web build, `expoSvelte()` tells Vite to pick react-native-mmkv's web implementation, which keeps its data in the browser's `localStorage`, under keys that start with the instance's id.

## expo-svelte/remote

SvelteKit's remote functions on the device. [Loading data](loading-data#remote-functions)

| Export | Description |
| --- | --- |
| `native(form)` | Types a remote `form` for native inputs: `fields.x.as(type)` returns the props of a `TextInput`, `Switch` or `Pressable`. |
| `configureRemote(options)` | Sets the server, `transport`, `handleError`, `fetch` and `goto` from code, overriding the app config and `src/hooks.mobile.ts`. |
| `remoteHost()` | The server in effect. |
| `refreshAll()` | Refetches every query and reconnects every live query the screens hold. |
| `resetRemoteConfig()` | Drops what `configureRemote` set. |
| `normalizeOrigin(origin)` | Checks and normalises an origin. |
| `RemoteConfigError` | Thrown by a remote function call when no server is configured. |

## expo-svelte/updates

Over-the-air updates, compatible with `eas update`: `isEnabled`, `updateId`, `channel`, `runtimeVersion`, `checkForUpdateAsync`, `fetchUpdateAsync`, `reloadAsync` and `checkOnLaunch`. [Updates](updates)

## expo-svelte/push

Push notifications on the device, once `capabilities.push` turns them on. [Push notifications](push-notifications)

| Export | Description |
| --- | --- |
| `push` | `push.permission` and `push.token` as state, and `push.subscribe({ save })`, `push.unsubscribe()` and `push.on('message', listener)`. |
| `PushHooks`, `PushPresentation` | The types of the `push` export of `src/hooks.mobile.ts`. |
| `PushMessage`, `PushToken`, `PushPermission` | The types of a message, of the token the app saves, and of `push.permission`. |

## expo-svelte/push/server

The sender, for your server (Node, no dependencies; it does not run on the device). [Push notifications](push-notifications#on-the-server)

| Export | Description |
| --- | --- |
| `createPush({ fcm, apns, timeout })` | Makes the sender. It has `send(token, message)`, which sends one message to one device and resolves with a `SendResult`, and `close()`. |
| `PushSend`, `SendResult`, `PushToken`, `Push`, `PushOptions` | The types of a message, of its result, of the token the app saved, of the sender and of its options. |

## Build tools

These entry points run in Node, in your build configuration, not in the app.

| Entry | Export | Used in |
| --- | --- | --- |
| `expo-svelte/vite` | `expoSvelte(options)`: SvelteKit's Vite plugin, wrapped. | `vite.config.ts` |
| `expo-svelte/metro` | `withExpoSvelte(config, options?)`: Expo's Metro config, extended to compile Svelte and find your routes. | `metro.config.cjs` |
| `expo-svelte` | The Expo config plugin, found through the package's `app.plugin.js`. `expo-svelte/app.plugin` is the same file. | `app.json` or `app.config.ts` |

[Configuration](configuration) shows each one with its options. The `expo-svelte` command is the package's binary: see [Command line](cli).

The other entry points (`/app`, `/core`, `/router`, `/routes`, `/renderer`, `/elements`, `/lower`, `/transformer`, `/remote/runtime`, `/remote/globals`) are used by the generated entry, Metro and the library itself. An app doesn't import them.

## Removed entry points

These paths no longer resolve: they were removed in 0.4.0-rc.7. An app that upgrades from 0.4.0-rc.5 or earlier changes the imports as the table says.

| Removed in 0.4.0-rc.7 | Use |
| --- | --- |
| `expo-svelte/animation` | `expo-svelte` |
| `expo-svelte/gestures` | `expo-svelte` |
| `expo-svelte/svg` | `expo-svelte`, where its `Text`, `Image`, `LinearGradient` and `Marker` are `SvgText`, `SvgImage`, `SvgLinearGradient` and `SvgMarker` |
| `expo-svelte/native-modules` | `expo-svelte/platform` |
| `expo-svelte/expo` | `expo-svelte` in `plugins` (`expo-svelte init` rewrites it; `expo-svelte doctor` reports it) |
| `expo-svelte/init`, `/polyfills`, `/fabric` | `expo-svelte/app`: run `expo-svelte sync` and the generated entry imports it |
