# @rasheed/svelte-native

Svelte 5 components that run as native Android and iOS apps. The components are compiled by a pinned Svelte compiler, run in Hermes, and drive React Native's Fabric shadow tree and Yoga directly. There is no React reconciler, no React Native component layer and no WebView. The build and release pipeline stays Expo: `expo prebuild`, config plugins, autolinking, Gradle and CocoaPods, EAS Build, EAS Submit and EAS Update.

On Android the mounting is the package's own engine: Fabric's C++ transaction goes to typed Kotlin views instead of React Native's Java mounting. On iOS React Native's mounting is kept and the package adds its own UIKit navigation, sheets, tabs and toolbar. The engine is specified in [apps/platform/modules/svelte-engine/SPEC.md](../../apps/platform/modules/svelte-engine/SPEC.md); this file is the way in, [REFERENCE.md](REFERENCE.md) holds the detail of the JavaScript side, [CHANGELOG.md](CHANGELOG.md) what changed, and [PLAN.md](PLAN.md) what was measured and what is open.

## Supported platforms

| | Exercised on | Notes |
|---|---|---|
| Android | Samsung SM-A165F (Android 16, 90 Hz), an API 36 emulator (x86_64) | arm64 and x86_64 builds; phones only, no tablet or foldable layouts |
| iOS | iPhone SE 3rd generation (iOS 26.6, 60 Hz) | phones only; the Android-only engine pieces (view pool, overlay modal, foreign-view split) do not apply |
| Web | the same app builds for browsers through SvelteKit | separate target: `+page.svelte` for browsers, `+mobile.svelte` for native |

It targets Expo SDK 57 and React Native 0.86.3 with Hermes, Reanimated 4.5.1, react-native-worklets 0.10.1 and react-native-gesture-handler 2.32. The Svelte compiler is Svelte's [unmerged custom-renderer pull request](https://github.com/sveltejs/svelte/pull/18042), pinned to commit `216f258068d93170a927ad4d27ee6864b0b305c5` (5.56.7); the browser app keeps regular Svelte. The package is private to this repository and carries pnpm patches for SvelteKit, `expo-modules-core`, Reanimated, worklets and gesture-handler (`patches/`). Unsupported: Svelte DOM transitions and libraries, React widgets, the Expo dev client, Fast Refresh (a save remounts the root; see "Development loop"), tvOS, and tablet layouts (not exercised).

## Set up an app

The platform app (`apps/platform`) is the working example.

```ts
// vite.config.ts: browser and native share one config
plugins: [svelteNative({ target: mode === "native" ? "native" : "web", kit: { /* … */ } })]
```
```js
// metro.config.cjs
const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@rasheed/svelte-native/metro");
module.exports = withSvelteNative(getDefaultConfig(__dirname));
```
```ts
// app.config.ts
plugins: [["@rasheed/svelte-native/expo", { autolinkingExclude: [], androidOnDemandViewManagers: {} }]]
```

```sh
svelte-native dev --port 8081   # writes the generated entry and the route table, starts Metro
svelte-native android --device  # expo run:android
svelte-native ios --device      # expo run:ios
svelte-native build --platform ios   # export Hermes bytecode without building the host
svelte-native sync              # only regenerate .svelte-native/
```

Generated files live in the ignored `.svelte-native/`. A change to native dependencies, to the config plugin options or to a patch needs a native rebuild; a change to Svelte code does not. Details of the plugin, Metro options and variants: [REFERENCE.md](REFERENCE.md#integration).

## Add a screen

A screen is `src/routes/<path>/+mobile.svelte`, next to the browser's `+page.svelte`. Route groups `(group)`, `[param]`, `[[optional]]` and `[...rest]` work; parameter matchers do not.

```svelte
<script lang="ts">
  import { Screen, View, Text, TextInput, Pressable, useRouter } from "@rasheed/svelte-native";
  let { params }: { params: { slug: string } } = $props();
  let name = $state("");
  const router = useRouter();
</script>

<Screen title="Account" header={{ large: true }}>
  <View style={{ padding: 24, gap: 16 }}>
    <TextInput bind:value={name} accessibilityLabel="Name" />
    <Text>Hello {name} in {params.slug}</Text>
    <Pressable onPress={() => router.goto(`/${params.slug}/settings`)} accessibilityRole="button">
      <Text>Settings</Text>
    </Pressable>
  </View>
</Screen>
```

- Use native style objects (`style={{ padding: 24 }}`); there is no CSS. Primitives: `View`, `Text`, `TextInput` (`bind:value`), `Pressable` (`onPress`, `onPressChange`, `hitSlop`), `ScrollView`, `Image`, `Switch`, `ActivityIndicator`, `Modal`, `SafeAreaView`, `KeyboardAvoidingView`, `List`. At build time `View`, `Text`, `ScrollView`, `Image`, `ActivityIndicator` and `Pressable` are lowered to host tags, so a row costs host nodes and no component instances.
- `router` is the nearest navigator's: `goto(href, { reset?, replaceState?, presentation? })`, `back()`, `current`, `entries`. `goto` resolves over the whole tree and never stacks the same screen twice. A link the app was launched with becomes the stack's base; later links are plain `goto`s.
- `ref` callbacks follow React's contract: the handle when the element is built, `null` when it is destroyed, and the old callback gets `null` before a new one gets the handle. `ScrollView` and `TextInput` handles have `scrollTo`, `focus`, `blur`, `measure`, `dispatchCommand`.
- `export const presentation = "modal"` in the module script (a literal: `push`, `modal`, `transparentModal`, `sheet`, `formSheet`) sets how a page enters.
- Runes, stores, context, snippets, `{#await}`, `<svelte:boundary>` and `.svelte.ts` modules work. Keep shared validation and domain logic in portable modules; native screens call explicit network boundaries.

Long lists use `List`, which mounts only the rows near the viewport:

```svelte
<List items={rows} rowHeight={56} keyOf={(row) => row.id}>
  {#snippet row(item)}<Text>{item.title}</Text>{/snippet}
</List>
```

Fixed `rowHeight`, measured rows (`estimatedRowHeight`), `rowHeights`, `horizontal`, `initialScrollIndex`, `header`, `footer`, `empty`, `onEndReached` and `onViewableItemsChanged` are in [REFERENCE.md](REFERENCE.md). An unvirtualized list of hundreds of rows costs one long mount frame.

## Navigators and screens

The directory tree decides the navigation structure. A `+layout.mobile.svelte` that exports `navigator` makes its directory a stack or a tab bar; without the export it is a content layout around every screen below it, and the root one is the app shell.

```
src/routes/
  +layout.mobile.svelte                  app shell (children = the root navigator)
  auth/login/+mobile.svelte              a root stack page
  (workspace)/[slug]/
    +layout.mobile.svelte                export const navigator = "tabs"
    home/+mobile.svelte                  tab "home": a stack whose base is this page
    settings/+mobile.svelte              tab "settings"
    settings/[section]/+mobile.svelte    pushed inside the settings tab
  account/+mobile.svelte                 export const presentation = "modal": covers the tab bar
```

```svelte
<!-- (workspace)/[slug]/+layout.mobile.svelte -->
<script lang="ts" module>export const navigator = "tabs";</script>
<script lang="ts">
  import type { Snippet } from "svelte";
  import { Tabs } from "@rasheed/svelte-native";
  let { panes, children }: { panes: readonly { key: string }[]; children: Snippet } = $props();
</script>
<Tabs items={panes.map((pane) => ({ key: pane.key, title: pane.key }))}>{@render children()}</Tabs>
```

A stack layout renders `<Stack header={{ large: true }} animation="slide_from_right">{@render children()}</Stack>`; its props are defaults under each screen's own `<Screen>`. `<Screen>` is where a page configures its native chrome:

| Option | What it gives |
|---|---|
| `title`, `subtitle`, `header` | native header; `header` takes `large`, `translucent`, `hidden`, `hideBack`, `backTitle`, `tint`, `background` |
| `headerLeft`, `headerCenter`, `headerRight`, `headerSearch`, `search` | slots, a search field and its results |
| `sheet`, `presentation` | detents (`[0.4, 0.9]`, `"auto"`), grabber, dismissible, backdrop; `sheet`/`formSheet` |
| `toolbar` | bottom bar: items with `icon`, `badge`, `disabled`, spacers, a `toolbarCenter` snippet, `translucent` |
| `statusBar`, `navigationBar` | status bar style and visibility; Android navigation bar color |
| `onAppear`, `onDisappear`, `onDismiss`, `onDetentChange` | lifecycle and user-dismissal events |

`useHeader()` and `useToolbar()` return the bars' heights to pad content under a translucent bar; `inTabPane()` says whether the screen ends at the tab bar. Header slots read start to end (mirrored in right-to-left), the title is a heading, sheets and modals trap screen-reader focus, and Android back goes to the innermost active navigator. The stack, the sheet drag and the edge swipe are UIKit's on iOS and the engine's on Android. The navigation state survives an Android Activity recreation and a process kill, and on iOS a process the system ended (not one the user swiped away; the `SvelteNavigation` module). The contracts are in SPEC: "Screen API contract", "Route tree: layouts as navigators", "Native screens, Android" and "Native screens, iOS". The file-routing rules, `goto`/`back`/`reset` semantics and build errors are in [REFERENCE.md](REFERENCE.md#file-routing-layouts-as-navigators).

## Gestures

`@rasheed/svelte-native/gestures` puts react-native-gesture-handler on Svelte views: its recognisers and arbitration unchanged, its `Gesture.Pan()`, `Tap()`, `Pinch()`, `Rotation()`, `Fling()`, `LongPress()`, `Native()` and `Manual()` builders and `Race`/`Simultaneous`/`Exclusive` as they are. The app wraps nothing.

```svelte
<script lang="ts">
  import { AnimatedView, createSharedValue, withSpring } from "@rasheed/svelte-native/animation";
  import { Gesture } from "@rasheed/svelte-native/gestures";
  const x = createSharedValue(0); // first: it loads Reanimated
  const pan = Gesture.Pan()
    .onUpdate((e) => { x.value = e.translationX; })  // a worklet, on the UI thread
    .onEnd(() => { x.value = withSpring(0); });
</script>
<AnimatedView gesture={pan} style={{ width: 96, height: 96 }} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }} />
```

`gesture={g}` works on `View`, `Pressable`, `ScrollView`, `AnimatedView`, `Image`, `Text` and host tags; `<GestureDetector>` and `use:gesture` are the same. Callbacks that are all worklets run on the UI thread; any plain callback or `.runOnJS(true)` moves the whole gesture to the JavaScript thread. A UI callback can capture shared values, numbers, strings and plain objects, not `$state`, `$derived` or `$props`: development builds throw naming the variable. A swipeable row or a carousel needs an accessibility alternative of its own (a button or `accessibilityActions`); a view that only carries a gesture is not an accessibility action. Not supported: RNGH's component API (`Swipeable`, `DrawerLayout`, the buttons), `Gesture.ForceTouch`, the web. Contract and arbitration rules per platform: SPEC "Gestures (react-native-gesture-handler)"; usage detail: [REFERENCE.md](REFERENCE.md#gestures).

## Animation

`@rasheed/svelte-native/animation` adapts Reanimated: `AnimatedView` with `animatedStyle` or `animatedProps` worklets, `createSharedValue` (cancelled when the component is destroyed), `withTiming`, `withSpring`, `withRepeat`, `withSequence`, `withDelay`, `runOnUISync`/`runOnUIAsync`, entering/exiting/layout animations. `AnimatedView` also takes Reanimated's CSS animation and transition style keys without a worklet; those run in C++ on the UI thread and are the cheaper choice for repeating or decorative motion. Read Svelte state on the JavaScript side and write the target into a shared value; a worklet cannot read a signal. Reanimated and worklets load on first use. See [REFERENCE.md](REFERENCE.md#animation) and SPEC "Animated write path".

## Native views from other libraries

`@rasheed/svelte-native/foreign` mounts views other libraries own inside the tree, and `@rasheed/svelte-native/svg` is react-native-svg as Svelte components. None imports the library's React code, and none loads at boot unless the app imports it. Install the libraries you use (`npx expo install <name>`; they are optional peer dependencies) and rebuild the native host.

| Library | Components |
|---|---|
| expo-image, expo-blur, expo-linear-gradient, expo-conic-gradient | `ExpoImage`; `BlurView`, `BlurTargetView`; `LinearGradient`; `ConicGradient` |
| react-native-video, expo-video, lottie-react-native, rive-react-native | `Video`; `VideoView`; `LottieView`; `Rive` |
| @react-native-community/datetimepicker | `DateTimePicker` (iOS), `openDatePicker` (Android dialog) |
| react-native-pdf, react-native-view-shot | `Pdf`; `captureRef`, `ViewShot` |
| react-native-webview, react-native-maps | `WebView`; `MapView`, `Marker` |
| react-native-fast-shadow, react-native-animateable-text | `ShadowedView`, `shadowStyle`; `AnimateableText` |
| react-native-svg 15.15.4 | `Svg`, shapes, text, gradients, filters, `SvgXml`, `SvgUri` (36 components) |
| anything else | `ForeignView` mounts a Fabric component by name |

A touch inside a foreign view goes to the view and not to JavaScript (`pointerEvents="box-only"` keeps the frame's touches for JavaScript). Foreign views work inside list rows and sheets. Props, events, what is not ported and the verification of each library: SPEC "Foreign views" and [REFERENCE.md](REFERENCE.md#foreign-views).

## Native modules

Use a native module the way React Native's JavaScript does, without React:

```ts
import { turboModule, nativeModule } from "@rasheed/svelte-native/native-modules";
import { requireNativeModule } from "expo-modules-core";

const blobUtil = turboModule<{ getConstants(): object }>("ReactNativeBlobUtil"); // a TurboModule by name; throws if none
const legacy = nativeModule<{ ping(): void }>("MyLegacyModule");                   // a legacy NativeModule; undefined if none
const fileSystem = requireNativeModule("ExpoFileSystem");                          // Expo modules as usual
```

Libraries whose own JavaScript needs React cannot be imported; call their native module by name, as the wrappers do. The platform app proves the production app's native libraries load under this host: a smoke app (`APP_VARIANT=smoke`, `io.rasheed.svelteqa.smoke`) loads 36 native modules and `pnpm native-qa smoke` fails when one stops loading. The product and the QA app link none of those libraries. SPEC "Native modules (smoke test)" lists each module and what it needed.

## Updates

`@rasheed/svelte-native/updates` is `expo-updates` reduced to what this host needs, compatible with `eas update` (manifest protocol 1, assets, rollback directives). The app config's `updates` and `runtimeVersion` keys are the ones Expo's plugin already writes.

```ts
import { checkForUpdateAsync, fetchUpdateAsync, reloadAsync, isEnabled } from "@rasheed/svelte-native/updates";
if (isEnabled && (await checkForUpdateAsync()).isAvailable) { await fetchUpdateAsync(); await reloadAsync(); }
```

A build made for a channel (`UPDATES_CHANNEL`, sent as `expo-channel-name`) checks once after the first commit and downloads the newest update; it launches on the next start. A launch is confirmed only after a healthy window (the first idle callback, 3 s after the first commit, no fatal error): an update that throws in its first seconds is marked failed at the next start, which runs the previous update or the embedded bundle, and a launch that was merely killed does not blacklist a good update the first time. Development builds and builds without a channel never check. On iOS a failing update needs two unconfirmed launches. SPEC "Updates" has the protocol coverage, the store, launch selection and the end-to-end procedure on a QA channel.

## Development loop

```sh
cd apps/platform && node ../../packages/svelte-native/src/cli.ts dev --port 8181
adb reverse tcp:8181 tcp:8181      # Android device; the debug host asks Metro on that port
```

A debug build loads the bundle from Metro. A save re-runs the changed module and the entry, which remounts every surface on the same root; navigation state and native state are kept, component state is not. An uncaught error in development replaces the surface with a red error screen with a Reload button. Do not start Metro with `CI=1` (the file watcher is disabled and bundles go stale). A release build cannot be pointed at Metro. Recipe and limits: [REFERENCE.md](REFERENCE.md#fabric-entry-dev-loop).

## Testing and quality

```sh
cd packages/svelte-native
bun test                 # renderer, host against a fake Fabric binding, router, lowering, gestures, foreign libraries, updates
pnpm typecheck           # svelte-check
pnpm lint                # eslint
npx biome check .        # from the repository root: lint for the TypeScript packages
```

Devices are driven by the `native-qa` harness in `apps/platform/qa` (see its [README](../../apps/platform/qa/README.md)): `pnpm native-qa build|lab|boot|parity|a11y|resilience|soak|crashes|gestures|foreign|smoke|updates|product|report|gates` builds the QA app, runs the lab on an emulator, the Samsung or the iPhone, and judges `gates.json`. The lab (28 functional checks plus the stress scenarios) is in the platform app's `/__dev` routes, present in development and QA builds and absent from the product. Pixel references, accessibility-tree checks and the resilience loop are automated; what a person must check with TalkBack and VoiceOver is in [apps/platform/qa/A11Y-MANUAL.md](../../apps/platform/qa/A11Y-MANUAL.md). The state of the production bar, the exceptions and the final gate table (every device's result on the final build, with its decision where a bar is missed) are in [PLAN.md](PLAN.md).

## Known limits

- Hot reload remounts the root; there is no Fast Refresh and no state-preserving HMR.
- The Android engine is verified on one phone model and an emulator; iOS on one iPhone. The frame bar on the phones is at most one late interval per run and no frame over 33 ms, in nine runs of ten. Documented misses, each with its measurement and decision in [PLAN.md](PLAN.md): animated churn on the Samsung (Reanimated's worklet runtime), the iOS header (UIKit's navigation bar), the Samsung's `churn-static` (short late intervals at 90 Hz, capped) and the first touch of a process. The Samsung's boot p90 (364 / 371 ms against 350) and the windowed list's cold mount there (28.3 ms against 10) are accepted exceptions too; the iPhone meets its boot and list-mount bars.
- On the iPhone the gesture and resilience steps (XCUITest) have no result on the final build yet (pending), and the signed-in screens (the Rasheed app's account screens, not the library) are not in the parity and accessibility references; the thirteen view libraries are verified on the iPhone (390 checks on the final build). [PLAN.md](PLAN.md) lists what is open.
- Screen-reader behavior (TalkBack order and announcements, VoiceOver focus) is covered by the automated oracle and by a manual checklist, not by a recorded person-run yet.
- The Android engine now publishes `accessibilityState`, `accessibilityValue`, `accessibilityHint`, `accessibilityActions`, `accessibilityLiveRegion` and `role` (checked by the automated oracle); what TalkBack says for them has not been confirmed by a person yet, see the checklist.
- The Svelte compiler is an unmerged pull request: review the pin when updating Svelte or SvelteKit. Boundary `failed` snippets must be declared outside `<svelte:boundary>` and passed with `{failed}`.
