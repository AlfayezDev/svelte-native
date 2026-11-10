---
title: Modules
---

Svelte Native's code is split into entry points, so an app loads only what it uses. This page lists each entry point and what it exports, with a link to the page that explains it.

## @example/svelte-native

The main entry: components, navigation and the app's state.

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
| `ActivityIndicator` | A spinner. [ActivityIndicator](activity-indicator) |
| `Screen` | A screen's header, toolbar, sheet and system bars. [Screen](screen) |
| `Stack` | The options of a stack navigator, in its layout. [Stack](stack) |
| `Tabs` | A tab bar. [Tabs](tabs) |
| `useRouter(scope?)` | The router of the nearest navigator: `goto`, `back`, `current`, `entries`. [Routing](routing#navigating) |
| `openLaunchURL(router, accept?)` | Waits for the link the app was launched with, so the shell can choose what to render. [Routing](routing#deep-links) |
| `useHeader()`, `useToolbar()` | The height of the screen's header or toolbar, to pad content under a translucent bar. [Screen](screen) |
| `inTabPane()` | Whether the caller is inside a tab pane. [Tabs](tabs) |
| `colorScheme` | `colorScheme.current` is `'light'` or `'dark'`, as state. [Styling](styling#light-and-dark-mode) |
| `insets` | The safe area and the keyboard, as state. [Platform APIs](platform-apis#safe-area-and-keyboard) |
| `Native` | A native element whose tag is chosen at run time. For library authors. |
| `Router`, `createRouter` | The router's building blocks. The generated entry uses them; an app doesn't need to. |
| `bootSummary()` | How long each phase of the app's start took, as one line of text, for profiling. |

The types of the options are exported too: `ScreenOptions`, `HeaderOptions`, `SheetOptions`, `ToolbarOptions`, `ToolbarItem`, `TabItem`, `StatusBarOptions`, `NavigationBarOptions`, `SearchOptions`, `Presentation`, `Detent`, `BarStyle`, `ScreenAnimation`, `NavigateOptions`, `NativeLocation`, `NativeRouter` and `HostHandle`.

## @example/svelte-native/animation

Animations on the UI thread, with Reanimated. [Animation](animation)

| Export | Description |
| --- | --- |
| `AnimatedView` | A `View` with `animatedStyle`, `animatedProps` and layout animations. |
| `createSharedValue(initial)` | A value both threads can read, cancelled when the component is destroyed. |
| `withTiming`, `withSpring`, `withRepeat`, `withSequence`, `withDelay` | Animate a shared value. |
| `cancelAnimation(value)` | Stops a shared value's animation. |
| `Easing`, `ReduceMotion` | Timing curves; the reduce motion setting of an animation. |
| `runOnUISync`, `runOnUIAsync` | Run a worklet on the UI thread. |
| `runOnJS`, `scheduleOnRN` | From a worklet, call a function on the JavaScript thread. |
| `SharedValue` | The type of a shared value. |

## @example/svelte-native/gestures

Native gesture recognisers, with react-native-gesture-handler. [Gestures](gestures)

| Export | Description |
| --- | --- |
| `Gesture` | The builders: `Tap`, `LongPress`, `Pan`, `Fling`, `Pinch`, `Rotation`, `Native`, `Manual`, and `Simultaneous`, `Race`, `Exclusive`. |
| `GestureDetector` | A `View` that carries a gesture. |
| `gesture` | The action form: `use:gesture={g}`. |
| `GestureStateManager` | Activates or fails a gesture by hand, from its touch callbacks. |
| `State`, `Directions`, `PointerType`, `TouchEventType` | The library's constants. |
| `runOnJS`, `scheduleOnRN` | The same as in `/animation`. |

## @example/svelte-native/foreign

Native views of other libraries. [Native views](native-views)

| Export | Description |
| --- | --- |
| `ExpoImage` | `expo-image`. |
| `BlurView`, `BlurTargetView` | `expo-blur`. |
| `LinearGradient` | `expo-linear-gradient`. |
| `ConicGradient` | `expo-conic-gradient`. |
| `Video` | `react-native-video`. |
| `VideoView` | `expo-video`. |
| `LottieView` | `lottie-react-native`. |
| `Rive` | `rive-react-native`. |
| `DateTimePicker`, `openDatePicker`, `dismissDatePicker` | `@react-native-community/datetimepicker`. |
| `Pdf` | `react-native-pdf`. |
| `WebView` | `react-native-webview`. |
| `MapView`, `Marker` | `react-native-maps`. |
| `ViewShot`, `captureRef`, `captureScreen`, `releaseCapture` | `react-native-view-shot`. |
| `ShadowedView`, `shadowStyle` | `react-native-fast-shadow`. |
| `AnimateableText` | `react-native-animateable-text`. |
| `ExpoView`, `defineExpoView` | The native view of any Expo module. |
| `ForeignView` | Any native component, by its Fabric name. |

The handle and option types (`VideoHandle`, `LottieHandle`, `MapHandle`, `WebViewHandle`, `RiveHandle`, `PdfHandle`, `ExpoViewHandle`, `CaptureOptions`, ...) are exported with them.

## @example/svelte-native/svg

SVG with react-native-svg: `Svg` (also the default export), `G`, `Path`, `Rect`, `Circle`, `Ellipse`, `Line`, `Polygon`, `Polyline`, `Text`, `TSpan`, `TextPath`, `Use`, `Image`, `Defs`, `ClipPath`, `LinearGradient`, `RadialGradient`, `Stop`, `Pattern`, `Mask`, `Marker`, `Symbol`, `ForeignObject`, the filters (`Filter`, `FeBlend`, `FeColorMatrix`, `FeComposite`, `FeDropShadow`, `FeFlood`, `FeGaussianBlur`, `FeMerge`, `FeMergeNode`, `FeOffset`), `SvgXml` and `SvgUri`, and the handle types `SvgHandle` and `SvgRootHandle`. [SVG](svg)

## @example/svelte-native/platform

React Native's platform modules, typed: `Platform`, `Appearance`, `Dimensions`, `PixelRatio`, `Linking`, `Keyboard`, `AppState`, `BackHandler`, `Share`, `Vibration` and `Alert`. Each loads the first time it's used. [Platform APIs](platform-apis)

## @example/svelte-native/remote

SvelteKit's remote functions on the device. [Loading data](loading-data#remote-functions)

| Export | Description |
| --- | --- |
| `native(form)` | Types a remote `form` for native inputs: `fields.x.as(type)` returns the props of a `TextInput`, `Switch` or `Pressable`. |
| `configureRemote(options)` | Sets the server, `transport`, `handleError`, `fetch` and `goto` from code, overriding the app config. |
| `remoteHost()` | The server in effect. |
| `refreshAll()` | Refetches every query and reconnects every live query the screens hold. |
| `resetRemoteConfig()` | Drops what `configureRemote` set. |
| `normalizeOrigin(origin)` | Checks and normalises an origin. |
| `RemoteConfigError` | Thrown by a remote function call when no server is configured. |

## @example/svelte-native/updates

Over-the-air updates, compatible with `eas update`: `isEnabled`, `updateId`, `channel`, `runtimeVersion`, `checkForUpdateAsync`, `fetchUpdateAsync`, `reloadAsync` and `checkOnLaunch`. [Updates](updates)

## @example/svelte-native/native-modules

`turboModule<T>(name)` returns a TurboModule by name and throws when the build doesn't have it. `nativeModule<T>(name)` returns a legacy NativeModule by name, or `undefined`. [Native libraries](native-libraries#calling-a-native-module-directly)

## Build tools

These entry points run in Node, in your build configuration, not in the app.

| Entry | Export | Used in |
| --- | --- | --- |
| `@example/svelte-native/vite` | `svelteNative(options)`: SvelteKit's Vite plugin, wrapped. | `vite.config.ts` |
| `@example/svelte-native/metro` | `withSvelteNative(config, options?)`: Expo's Metro config, extended to compile Svelte and find your routes. | `metro.config.cjs` |
| `@example/svelte-native/expo` | The Expo config plugin. `@example/svelte-native` names the same plugin. | `app.json` or `app.config.ts` |

[Configuration](configuration) shows each one with its options. The `svelte-native` command is the package's binary: see [Command line](cli).

The other entry points (`/core`, `/router`, `/routes`, `/renderer`, `/fabric`, `/elements`, `/polyfills`, `/init`, `/lower`, `/transformer`, `/remote/runtime`, `/remote/globals`) are used by the generated entry, Metro and the library itself. An app doesn't import them.
