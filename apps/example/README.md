# Svelte Native showcase

A tour of [`@alfayez/svelte-native`](../../packages/svelte-native/README.md): a small app where every feature of the library is its own screen with one short example. It is written the way an app that installs the library would be written, and it imports nothing but the library's public entries (`@alfayez/svelte-native`, `/animation`, `/gestures`, `/foreign`, `/svg`, ...). Read it with the library's [README](../../packages/svelte-native/README.md) and [REFERENCE](../../packages/svelte-native/REFERENCE.md) beside it.

The app id is `io.rasheed.sveltenative.example`, the name is "Svelte Native" and the link scheme is `svelte-native://`.

## Run it

You need the repository's tools (Node 25, pnpm, see the [root README](../../README.md)), and for a device the Android SDK or Xcode.

```sh
pnpm install --frozen-lockfile      # once, from the repository root
pnpm --dir apps/example android     # svelte-native android: prebuild, build and install on a device or emulator
pnpm --dir apps/example ios         # svelte-native ios (a Mac with Xcode)
pnpm --dir apps/example start       # only the Metro server, for a build that is already installed
pnpm --dir apps/example check-setup # svelte-native doctor: checks the app's setup (peer versions, patches, Metro and Expo wiring)
```

`android` and `ios` are the library's command line (`svelte-native android|ios`), which writes the route table into `.svelte-native/` and runs `expo run:android|ios`. A change to a native dependency or to `app.config.ts` needs a new native build; a change to a screen does not (a save remounts the app).

## How the app is put together

- `src/routes/` is the navigation: a folder with a `+mobile.svelte` file is a screen, so `src/routes/layout/+mobile.svelte` is the route `/layout`. `+layout.mobile.svelte` at the top is the app shell; one with `export const navigator = "tabs"` makes its folder a tab bar.
- `src/lib/features/` lists the features. The home screen reads `core.ts` and `native.ts` and shows their entries by group. A feature is a folder in `src/routes` and one entry in a registry; `test/routes.test.ts` fails when the two disagree.
- `src/lib/components/` holds the small shared pieces: `Page` (the frame of a feature screen: header, explanation, scrolling body), `Section` (a captioned example), `Button` and the home screen's `FeatureRow`. `src/lib/theme.svelte.ts` has the colours for light and dark mode.
- Every screen starts with a comment that says what it shows and which API it uses, and stays short. Where a variant is interesting both versions are on the screen side by side.

## Features

The home screen groups these under Basics, Layout and style, Lists and input, Navigation and Platform. `src/lib/features/core.ts` is the source of this table. The groups Motion and touch and Native views (animation, gestures, foreign views, SVG) are listed in `src/lib/features/native.ts`.

| Feature | Route | What it shows |
| ------- | ----- | ------------- |
| Primitives | `/primitives` | `View`, `Text`, `Image` (a bundled file and a URL), `Pressable`, a horizontal `ScrollView`, `ActivityIndicator`, `Modal` |
| HTML elements | `/html` | A screen written only with HTML elements and Tailwind classes: a card list (`ul`, `li`, `img`, `button`), a form (`input`, a checkbox, `button type="submit"`), links (`a href`) and a `dialog` |
| Text and fonts | `/text` | Size, weight, style, spans and links, `numberOfLines`, system fonts per platform, a font bundled with the `expo-font` plugin |
| State and reactivity | `/state` | `$state`, `$derived`, `$effect` with a cleanup, a `$state` array whose fields are bound to `Switch`es, `{#await}` |
| Layout | `/layout` | Flexbox through Yoga: column and row, `justifyContent` (live), `alignItems`, `flexWrap` and `gap`, `flex`, absolute position |
| Styling | `/styling` | Style objects, arrays and `$derived` styles, the theme and dark mode, shadow and elevation, transforms |
| Lists | `/lists` | A `ScrollView` with `{#each}` beside the windowed `List` of 5,000 rows |
| Inputs and forms | `/inputs` | `TextInput` and `Switch` with `bind:value`, a form with validation, `returnKeyType`, input refs, `KeyboardAvoidingView` |
| Stack | `/navigation/stack`, `/navigation/stack/[id]` | `router.goto` and `back`, a route parameter, a large title, `headerRight`, the stack growing |
| Tabs | `/navigation/tabs`, `/navigation/tabs/feed`, `/navigation/tabs/feed/[id]`, `/navigation/tabs/profile` | A layout with `navigator = "tabs"`, `Tabs` with icons from snippets and a badge, a stack inside a tab, closing the bar from its first screen |
| Header and toolbar | `/navigation/header` | `search` and `headerSearch` in the native header, a bottom `toolbar` with items, a badge and `onPress`, `useToolbar()` |
| Sheet | `/navigation/sheet` | `presentation = "sheet"`, `sheet={{ detents, grabber }}`, `onDetentChange` |
| Modal | `/navigation/modal` | `presentation = "modal"` with its own Close button in `headerLeft` |
| Links | `/navigation/links` | The launch URL, `Linking`, `router.openURL`, and the `adb` and `xcrun` commands that open the app on a screen |
| Platform | `/platform` | `Platform`, `Dimensions`, the `insets` store (safe area and keyboard), the status bar option of `Screen`, the system's appearance |
| Internationalization | `/i18n` | English and Arabic, `Intl` plurals, numbers and dates, `direction: "rtl"` and `marginStart` |
| Accessibility | `/accessibility` | Labels, roles, state, hints, grouping, hidden decoration, live regions, `accessibilityActions` |

## Native views, motion and touch, platform

The features of `src/lib/features/native.ts`: the library's wrappers of other native libraries (and `defineExpoView`, for an Expo library it has none for), its animation and gesture API, and two platform features. Each is one route and one short file. The native views are optional peer dependencies of the library; this app installs them (see `package.json`), so a change to that list needs a native build.

| Feature | Route | What it shows |
| ------- | ----- | ------------- |
| Image (expo-image) | `/native-views/image` | `ExpoImage`: `contentFit`, a blurhash `placeholder`, `transition`, `onLoad` |
| Blur | `/native-views/blur` | Svelte Native's own `BlurView` over striped views: `intensity`, `tint`, children on top |
| Linear gradient | `/native-views/linear-gradient` | `LinearGradient`: `colors`, `start`, `end`, `locations`, children |
| Conic gradient | `/native-views/conic-gradient` | `ConicGradient`: `colors`, `locations`, `center`, `angle` |
| Video (react-native-video) | `/native-views/video` | `Video` with a bundled clip: `paused`, `repeat`, `onProgress`, `ref.seek` |
| Lottie | `/native-views/lottie` | `LottieView` with a bundled JSON file: `autoPlay`, `loop`, `speed`, `ref.pause` |
| PDF (react-native-pdf) | `/native-views/pdf` | `Pdf`: `enablePaging`, `onLoadComplete`, `onPageChanged`, `ref.setPage` |
| SVG (react-native-svg) | `/native-views/svg` | the SVG components of `@alfayez/svelte-native`: shapes, gradient, `SvgText`, `animatedProps`, `SvgXml` |
| Rive | `/native-views/rive` | `Rive` from a URL (needs the network): `ref.play`, `onPlay`, `onError` |
| Shadow (fast-shadow) | `/native-views/shadow` | `ShadowedView` and `shadowStyle` |
| Animateable text | `/native-views/animateable-text` | `AnimateableText`: a counter written on the UI thread by a worklet |
| View capture (view-shot) | `/native-views/view-shot` | `ViewShot` and `capture()` into a data URI |
| Date and time picker | `/native-views/date-time-picker` | `DateTimePicker` on iOS, `openDatePicker` on Android |
| WebView | `/native-views/web-view` | `WebView` with inline HTML: `onMessage`, `ref.injectJavaScript` |
| Map (react-native-maps) | `/native-views/map` | `MapView`, `Marker`, `ref.animateToRegion` |
| Any Expo view | `/native-views/any-expo-view` | `defineExpoView` for an Expo library with no wrapper: expo-camera's `ExpoCamera` (`onCameraReady`, `ref.takePicture`) and expo-image's `ExpoImage` (`onLoad`, `ref.reloadAsync`) |
| Animation | `/animation` | `AnimatedView` with `withTiming`, `withSpring`, `withRepeat`, CSS keyframes, and state written into a shared value |
| Gestures | `/gestures` | `Gesture.Pan`, `Pinch`, `Rotation`, `LongPress` and a swipeable row (`components/native/SwipeRow.svelte`) |
| Remote functions | `/remote` | the host (`extra.svelteNative.remote`, `configureRemote`) and a query, a command and a form of `src/lib/remote/notes.remote.ts` |
| Updates | `/updates` | `isEnabled`, `updateId`, `channel`, `checkForUpdateAsync`, `fetchUpdateAsync`, `reloadAsync` |

Things a build or a device must provide:

- **Assets.** `assets/images/sample.png` (15 KB), `assets/media/pattern.mp4` (4 KB) and `assets/media/pulse.json` (1 KB) are the lab's samples, kept small. The PDF is a data URI in `src/lib/media.ts`: react-native-pdf opens a `require`d file on iOS only.
- **Map.** iOS draws Apple Maps. Android needs a Google Maps key in the manifest: build with `GOOGLE_MAPS_API_KEY=...` (`app.config.ts` passes it to react-native-maps' plugin). With the placeholder key the map mounts and draws no tiles.
- **Remote functions.** The functions run on a SvelteKit server, which this app does not have. To try them, copy `src/lib/remote/notes.remote.ts` to the same path in a SvelteKit app (the function ids are a hash of the path from the app's root) with `experimental: { remoteFunctions: true }`, make the server load the module, and build this app with `SVELTE_NATIVE_REMOTE_ORIGIN=https://that-server` (an `http:` origin works for a development server; `adb reverse` reaches a PC). Without a host the screen says so and offers a field for an origin.
- **Updates.** The app config has no `updates` key, so the screen reads "off in this build". To turn updates on, add `updates.url`, `runtimeVersion` and a channel (`UPDATES_CHANNEL`), as the library's README describes under "Updates".
- **Rive** loads `vehicles.riv` from Rive's CDN: it needs a connection.
- **Any Expo view** needs the camera permission: the `expo-camera` plugin in `app.config.ts` writes the prompt text (iOS) and `CAMERA` (Android), and the screen asks for it with a button. On an emulator or a simulator with no camera, expo-camera answers `takePicture` with a picture it draws itself. An app built before `expo-camera` was added does not have its native module, so the screen cannot load there: build the app again.

## Notes for a reader

- **React Native's JavaScript modules are imported by path** (`react-native/Libraries/Utilities/Platform`, `Appearance`, `Dimensions`, `Linking`): the library has none of its own, and the `react-native` index would load React's components. React Native ships no types for these paths, so `src/lib/modules.d.ts` declares the few members the app uses. It also declares two modules the library's own source imports, because a workspace link is type-checked with the app.
- **`hermes-intl` is a dependency of the app** although it is not a peer of the library: the library's polyfills require it, and Metro cannot bundle without it.
- **`react-native-quick-crypto`, `react-native-mmkv`, `react-native-nitro-modules` and `react-native-quick-base64` are dependencies of the app** because they are required peers of the library: `crypto` and `localStorage` are made of them (a native rebuild adds their modules).
- **`@sveltejs/kit` and `vite` are dependencies too**, because the library lists them as peers (the web target and remote functions use them). A native-only app like this one does not run either.
- **`expo-system-ui`** makes `userInterfaceStyle: "automatic"` in `app.config.ts` apply on Android, so the app follows the system's dark mode there (Expo warns at prebuild without it).
- **Dark mode** is the theme's: `src/lib/theme.svelte.ts` keeps the system's colour scheme in `$state` (React Native's `Appearance`), and a screen reads `theme.colors`. There is no in-app switch; change the phone's appearance.
- **Fonts**: the system fonts need no setup. `JetBrainsMono-Regular.ttf` (SIL Open Font License, `assets/fonts/OFL.txt`) is embedded by the `expo-font` plugin in `app.config.ts`.

## Demo mode

Every screen that has something to show can play a short scripted interaction by itself, for recording the docs' videos on a device or a simulator without touch injection. A screen opened with `?demo` in its link runs its script once after it mounts; without the parameter nothing runs.

```sh
adb shell am start -a android.intent.action.VIEW -d "svelte-native:///animation/transitions?demo" io.rasheed.sveltenative.example
xcrun simctl openurl booted "svelte-native:///animation/transitions?demo"
```

- `src/lib/demo.ts` is the helper. A page gets its link as the prop `url` (the router passes it with `params`), and calls `useDemo(() => url, steps)` with a list of steps, `[run, pauseMs]`: the screen's own state and functions (a toggle, a shuffle, `router.goto`, a text field's bound value typed letter by letter with `typeInto`, a scroll with `scroller().glide`). A settle comes before the first step and a hold after the last. The script logs `[demo] start <path>` and `[demo] end <path> after <ms> ms` (`adb logcat -s ReactNativeJS`), which a recording tool can wait for.
- `src/lib/features/demos.ts` is the manifest: for each docs page, the route to open, how long the script runs, and whether the recording needs touch input (gestures, a native dialog) with the touches described. `test/demos.test.ts` keeps it in step with the docs, the registries and the screens; `test/demo.test.ts` tests the helper.
- The router drops the query of a tab bar's link, so the Tabs demo is on `/navigation/tabs/feed`. A sheet or a modal needs a screen below it to be dismissed to: open the app first, then the link. A link to the screen already on top does nothing (the same address), so a second take on the same screen uses `?demo=2` or another screen first.
- The router saves a screen's link, `?demo` included, in the state it restores: when Android restarts the app's process, or a hot reload remounts the screen in development, the restored screen plays its script again. Close the app between takes.

## Tests

```sh
cd apps/example
pnpm typecheck    # svelte-check on the app, tsc on the tests
pnpm lint         # eslint
pnpm test         # bun test: the registries, the screens and the Metro bundles
```

- `test/routes.test.ts`: every route of `src/routes` is listed in a registry and every listed route is a folder; screens stay short; the app imports only the library's public entries.
- `test/screens.test.ts`: every screen of the core registry mounts on the library's fake Fabric binding (Android and iOS) without an error, and every demo script of a screen it can mount plays to its end on a fake clock. The scripts of the native-view and gesture screens run on a device only (the test lists them with the library that stops it).
- `test/bundle.test.ts`: the Metro bundle of the app is made for Android and iOS (`expo export:embed`, release, not minified), which is what a build runs before Hermes. None of these needs a device.
