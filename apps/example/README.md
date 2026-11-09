# Svelte Native showcase

A tour of [`@example/svelte-native`](../../packages/svelte-native/README.md): a small app where every feature of the library is its own screen with one short example. It is written the way an app that installs the library would be written, and it imports nothing but the library's public entries (`@example/svelte-native`, `/animation`, `/gestures`, `/foreign`, `/svg`, ...). Read it with the library's [README](../../packages/svelte-native/README.md) and [REFERENCE](../../packages/svelte-native/REFERENCE.md) beside it.

The app id is `io.example.sveltenative.example`, the name is "Svelte Native" and the link scheme is `svelte-native://`.

## Run it

You need the repository's tools (Node 25, pnpm, see the [root README](../../README.md)), and for a device the Android SDK or Xcode.

```sh
pnpm install --frozen-lockfile      # once, from the repository root
cd apps/example
pnpm android                        # svelte-native android: prebuild, build and install on a device or emulator
pnpm ios                            # svelte-native ios (a Mac with Xcode)
pnpm start                          # only the Metro server, for a build that is already installed
pnpm check-setup                    # svelte-native doctor: checks the app's setup (peer versions, patches, Metro and Expo wiring)
```

`pnpm android` and `pnpm ios` are the library's command line (`svelte-native android|ios`), which writes the route table into `.svelte-native/` and runs `expo run:android|ios`. A change to a native dependency or to `app.config.ts` needs a new native build; a change to a screen does not (a save remounts the app).

## How the app is put together

- `src/routes/` is the navigation: a folder with a `+mobile.svelte` file is a screen, so `src/routes/layout/+mobile.svelte` is the route `/layout`. `+layout.mobile.svelte` at the top is the app shell; one with `export const navigator = "tabs"` makes its folder a tab bar.
- `src/lib/features/` lists the features. The home screen reads `core.ts` and `native.ts` and shows their entries by group. A feature is a folder in `src/routes` and one entry in a registry; `test/routes.test.ts` fails when the two disagree.
- `src/lib/components/` holds three small shared pieces: `Page` (the frame of a feature screen: header, explanation, scrolling body), `Section` (a captioned example) and `Button`. `src/lib/theme.svelte.ts` has the colours for light and dark mode.
- Every screen starts with a comment that says what it shows and which API it uses, and stays short. Where a variant is interesting both versions are on the screen side by side.

## Features

| Feature | Route | What it shows |
| ------- | ----- | ------------- |

## Native views, motion and touch, platform

The features of `src/lib/features/native.ts`: the library's wrappers of other native libraries, its animation and gesture API, and two platform features. Each is one route and one short file. The native views are optional peer dependencies of the library; this app installs them (see `package.json`), so a change to that list needs a native build.

| Feature | Route | What it shows |
| ------- | ----- | ------------- |
| Image (expo-image) | `/native-views/image` | `ExpoImage`: `contentFit`, a blurhash `placeholder`, `transition`, `onLoad` |
| Blur (expo-blur) | `/native-views/blur` | `BlurView` over a `BlurTargetView` (Android's real blur), `intensity` |
| Linear gradient | `/native-views/linear-gradient` | `LinearGradient`: `colors`, `start`, `end`, `locations`, children |
| Conic gradient | `/native-views/conic-gradient` | `ConicGradient`: `colors`, `locations`, `center`, `angle` |
| Video (react-native-video) | `/native-views/video` | `Video` with a bundled clip: `paused`, `repeat`, `onProgress`, `ref.seek` |
| Lottie | `/native-views/lottie` | `LottieView` with a bundled JSON file: `autoPlay`, `loop`, `speed`, `ref.pause` |
| PDF (react-native-pdf) | `/native-views/pdf` | `Pdf`: `enablePaging`, `onLoadComplete`, `onPageChanged`, `ref.setPage` |
| SVG (react-native-svg) | `/native-views/svg` | `@example/svelte-native/svg`: shapes, gradient, text, `animatedProps`, `SvgXml` |
| Rive | `/native-views/rive` | `Rive` from a URL (needs the network): `ref.play`, `onPlay`, `onError` |
| Shadow (fast-shadow) | `/native-views/shadow` | `ShadowedView` and `shadowStyle` |
| Animateable text | `/native-views/animateable-text` | `AnimateableText`: a counter written on the UI thread by a worklet |
| View capture (view-shot) | `/native-views/view-shot` | `ViewShot` and `capture()` into a data URI |
| Date and time picker | `/native-views/date-time-picker` | `DateTimePicker` on iOS, `openDatePicker` on Android |
| WebView | `/native-views/web-view` | `WebView` with inline HTML: `onMessage`, `ref.injectJavaScript` |
| Map (react-native-maps) | `/native-views/map` | `MapView`, `Marker`, `ref.animateToRegion` |
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
