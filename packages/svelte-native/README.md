# Svelte on React Native

One package owns the native renderer, Svelte primitives, routing and build integration. Native screens are Svelte components running in Hermes. The host (`src/fabric/`) drives React Native's Fabric shadow tree directly from the Svelte host tree; there is no React reconciler and no WebView.

## Authoring

```svelte
<script lang="ts">
  import { View, Text, TextInput, Pressable, useRouter } from "@rasheed/svelte-native";
  let name = $state("");
  const router = useRouter();
</script>

<View style={{ padding: 24, gap: 16 }}>
  <TextInput bind:value={name} accessibilityLabel="Name" />
  <Text>Hello {name}</Text>
  <Pressable onPress={() => router.goto("/account")} accessibilityRole="button">
    <Text>Account</Text>
  </Pressable>
</View>
```

- `src/routes/**/+mobile.svelte` defines native pages alongside browser `+page.svelte` files. Route groups, named parameters, optional parameters and rest parameters are supported. Static routes precede parameter routes. Parameter matchers are not implemented.
- `+layout.mobile.svelte` wraps the content of every screen below it (pages and navigator screens alike), outermost first; layouts receive `params`, `url` and a `children` snippet. The root layout is the app shell: it wraps the root navigator, receives it as `children`, and runs inside the router's context (`useRouter("root")`). A layout can also be a navigator (next section).
- A page can export `const presentation = "modal"` from its module script. `useRouter()` is the nearest navigator's router: `goto`, `back`, `replaceBase`, `openURL`, `current` (the deepest shown entry) and `entries`/`screens` (its own stack). Screen transitions and Android Back go through the host's navigation container (`src/fabric/navigation.ts`). Cold/warm deep links are matched against the route tree; unmatched URLs are ignored. The link the app was launched with is opened with `reset` (a direct load has no history: its screen is the base of the stack, with no back arrow); links that arrive later are plain `goto`s.
- `<Screen toolbar={{ items: [{ key: "reply", title: "Reply", icon: replyAsset }, { key: "gap", spacer: true }, { key: "archive", title: "Archive", icon: archiveSnippet, badge: 2 }], onPress: (key) => … }}>` adds a native toolbar at the bottom of the screen (`UIToolbar` on iOS, a Material bottom bar on Android), in flow below the content unless `translucent`. An item takes `key`, `title`, `icon` (an asset, drawn as a tinted template image, or a snippet), `badge` (text, a number, or `true` for a dot), `disabled`, `accessibilityLabel`, `testID`; `{ key, spacer: true }` is flexible space. `toolbar.hidden`, `translucent`, `tint` and `background` work as the header's, a `toolbarCenter` snippet puts custom content between the items, and nested `Screen`s merge their `toolbar` like their `header`. `useToolbar()` returns the toolbar's `{ height, inset }` (0 without one) to pad content under a translucent bar. Inside a `Tabs` pane the bar sits above the tab bar and takes no bottom inset of its own. Contract: `apps/platform/modules/svelte-engine/SPEC.md`, "Toolbar".
- A `<Screen>` inside a page (or a layout) hands its options to the router's screen around it; inside a `<Modal>` or a tab pane it is the outermost one and draws its own header there; a `Screen` that no stack holds (a modal's content, the app shell) is rendered in a one-entry `native-stack` of its own, which iOS needs to draw the header. `inTabPane()` is true inside a pane, which ends at the tab bar and covers the bottom inset (a page pads that inset itself only outside a pane; `useHeader()` and `useToolbar()` give the header's and toolbar's heights).
- Primitives expose their React Native prop types and Svelte child snippets. `TextInput` and `Switch` support binding. `ScrollView` and `TextInput` accept a `ref` callback that receives the host handle (`scrollTo`, `focus`, `blur`, `measure`, `dispatchCommand`; `HostHandle` in `src/fabric/host.ts`). Use native style objects. Browser HTML, CSS, DOM actions and SvelteKit browser navigation APIs do not become native controls.
- Lists: `<List items rowHeight={56} keyOf={(item) => item.id}>{#snippet row(item, index)}...{/snippet}</List>` mounts only the rows near the viewport (`overscan`, default 4 rows each side; 10 rows before the first layout) at absolute positions, so long lists cost a handful of native views instead of hundreds. With `rowHeight` every row has that fixed size and nothing is measured. Without it, rows start at `estimatedRowHeight` (default 48) and each row wrapper's `onLayout` fills a per-key height table; offsets are cached prefix sums rebuilt from the first changed index, the spacer is their sum, and a row whose measured size differs from the estimate shifts the rows after it on the next frame (batched, 16 ms). `rowHeights={(item, index) => number}` supplies sizes up front and skips measuring (edit items in place and the table is not rebuilt; pass a new array). `horizontal` flips the axis (`contentOffset.x`, `layout.width`, `left`, row-direction content; `rowHeight` is then the row width). Also: `initialScrollIndex`, `keyExtractor` (alias of `keyOf`), `empty` snippet shown while `items` is empty, `onViewableItemsChanged({ viewableItems, changed })` (debounced 50 ms; `viewabilityConfig.itemVisiblePercentThreshold`, default 50), `header`/`footer` snippets, `onEndReached` with `onEndReachedThreshold` (fraction of the viewport, default 0.5) and the remaining `ScrollView` props. `recycle` keeps a pool of wrapper nodes (a full window for fixed rows, the high-water mark of the window otherwise) and re-targets them by index (slot = index modulo pool size) instead of mounting and unmounting rows: no host views are created while scrolling, but a row component's own state does not follow its item, so keep row state in `items`; late `onLayout` events after a retarget can mis-measure one row. `bind:this` exposes `scrollToIndex(index, animated)` and `scrollToOffset(offset, animated)`. `onRefresh`/`refreshing` are not provided: the host maps no refresh control. Native view recycling (reusing the native view across items) is not implemented.
- `<Native name="native-screen" attributes={{ ... }}>` renders a host tag chosen at runtime (the router uses it for `native-stack`/`native-screen`). The tags the host maps are `viewNames` in `src/fabric/host.ts`; an unmapped name throws when the host flushes.
- Ordinary `.svelte.ts` modules, context, stores, runes and lifecycle hooks work. Shared validation/domain logic belongs in portable modules. SvelteKit server loads, form actions and remote functions still run on the server; native screens use explicit network boundaries.

### File routing: layouts as navigators

The directory tree decides which stack or tab pane a page belongs to (contract: `apps/platform/modules/svelte-engine/SPEC.md`, "Route tree: layouts as navigators"; code: `src/route-tree.ts`, `src/router.svelte.ts`, `src/build.ts`).

| file | role |
|---|---|
| `+mobile.svelte` | a page: one screen of the nearest navigator above it. `export const presentation` (a literal: `push`, `modal`, `transparentModal`, `sheet`, `formSheet`) is read at build time. Title, header, slots, search, sheet and system bars are set at run time with `<Screen>` inside the page. |
| `+layout.mobile.svelte` with `export const navigator = "stack" \| "tabs"` (a literal) | a navigator layout: its directory is one screen of the parent navigator, and the pages and navigators below it are its own. |
| `+layout.mobile.svelte` without it | a content layout around every screen below it. The root one is the app shell. |
| `(group)` | transparent for paths; a group directly under a tabs layout is flattened, its child directories become panes. |

```
src/routes/                                    the platform app's tree (tests/app-tree.test.ts pins it)
  +layout.mobile.svelte                        app shell: receives the root navigator as `children`
  (public)/auth/login/+mobile.svelte           a root stack page (so are onboarding/profile, workspaces, workspaces/create)
  (account)/account/+mobile.svelte             export const presentation = "modal": a root page, it covers the workspace's tab bar
  (workspace)/[slug]/
    +layout.mobile.svelte                      export const navigator = "tabs"; gets `panes` and `children`
    home/+mobile.svelte                        pane "home": a stack whose base is this page
    settings/+mobile.svelte                    pane "settings": base page, the sections
    settings/[section]/+mobile.svelte          pushed within the settings pane
  __dev/tree/                                  the route-tree lab: tabs with panes home and inbox
    inbox/+layout.mobile.svelte                export const navigator = "stack": the pane's stack options (optional)
    inbox/compose/+mobile.svelte               export const presentation = "sheet": a sheet of the inbox pane's stack
```

A tabs layout renders `<Tabs {items}>{@render children()}</Tabs>` with `items` keyed by the pane keys (in the bar's order); a stack layout renders `<Stack header={{ large: true }} animation="slide_from_right">{@render children()}</Stack>`, whose props are defaults under each screen's own `<Screen>` options (`loading` is the snippet shown while a route's modules load; `animation` is the default of push screens only, a modal or sheet keeps the platform's). A pane's stack layout is given the `params` and `url` of the tabs screen, and the pane shows the placeholder of the router around the tabs while the layout loads. Without `<Tabs>` or `<Stack>`, `{@render children()}` gets the defaults. `<Tabs>` outside a tabs layout stays what it was: `selected`, `onSelect` and a `content` snippet.

- Build errors name the file: a page next to a navigator layout, a pane without an index page, a page directly under a tabs layout, a tab bar inside a tab bar, a root layout that is a navigator, a navigator whose path is also another route's in its stack.
- `goto(href)` resolves over the whole tree and plans one operation per navigator on the way: tabs select the pane, the owning stack pushes, or pops to the entry when it already holds that href (Expo Router's `navigate`: the same screen is never stacked twice; another query is another href) (`replaceState` replaces its top, `reset` keeps the pane's index page and the target), and a stack above pops to the navigator's screen if it is on it (a modal over the tabs goes away) or pushes it (a deep link into tabs). `reset` is a new root for the whole chain: every stack above the owner resets to its screen (the root keeps only the tabs screen, the instance it had when it had one, so nothing remounts), every tabs node selects the pane, and the owner resets to the target; `goto("/acme", { reset: true })` from the platform app's workspace list leaves the root as `[tabs]`, so the first screen has no back arrow and Android back leaves the app. `replaceState` replaces the owner's top only. The same href as the shown entry does nothing.
- `back()` pops the router's stack when it has more than one screen (a tabs router's is the selected pane's); at a pane's base it neither pops the pane nor switches tabs but lets the stack above pop; the root at one screen returns `false`. The Android key and links belong to the root router alone, which hands the key to the innermost active navigator: a pane under a covering modal is not active. The header's back arrow shows on the first screen of a nested stack navigator when its own screen has one below it (its first back pops it); a pane's base has none.
- Navigators below the root get their routers where their screens render: a pane's is named by its key, a nested navigator's by its node id, the root's by `"root"`. Each navigator screen owns its navigator's state, so two workspaces' tabs do not share stacks.
- Modals, sheets and form sheets belong to the stack of their page: one that must cover the tab bar lives outside the tabs directory.
- The navigation survives an Android Activity that is recreated (a font scale or locale change) and a process that was killed in the background: the root router's state (every stack, every tabs selection, the launch link already opened) is what a hot update keeps. The last surface to stop leaves it for the next one (in release builds too, unless the user is leaving the app), and the router writes it as JSON through the engine module after every change, which `MainActivity` keeps in the Activity's saved instance state and passes back as `initialProps.navigation` (the config plugin patches the generated Activity). A launch link that the restored state was opened with is not opened again; a different one resets. iOS restarts at the launch link after a kill. See `apps/platform/modules/svelte-engine/SPEC.md`, "Navigation state across recreation and process death".

## Animation

`@rasheed/svelte-native/animation` adapts Reanimated's animated view and shared values. The host runs `animatedStyle` worklets through Reanimated's mappers (`src/fabric/animation.ts`, `useAnimatedStyle` without the hook); the Svelte component owns the shared value's lifetime.

```svelte
<script lang="ts">
  import { AnimatedView, createSharedValue, withTiming } from "@rasheed/svelte-native/animation";
  let expanded = $state(false);
  const progress = createSharedValue(0);
  const animatedStyle = () => {
    "worklet";
    return { transform: [{ translateX: progress.value * 120 }] };
  };
  $effect(() => { progress.value = withTiming(expanded ? 1 : 0); });
</script>

<AnimatedView {animatedStyle} style={{ width: 48, height: 48, backgroundColor: "blue" }} />
```

Capture plain shared-value handles in worklets. Read Svelte state on the JavaScript side and write the target into a shared value. A worklet cannot read a Svelte signal or proxy on the UI runtime. Call `createSharedValue` during component initialization; it cancels the current animation when the component is destroyed. Reanimated cancellation is asynchronous. `runOnUIAsync` and `runOnUISync` are available for explicit worklet calls.

Timing, spring, repeat, sequence and delay helpers retain Reanimated's APIs and reduced-motion behavior. `AnimatedView` also accepts Reanimated's CSS animation and transition style keys without a worklet, for example `style={{ animationName: { from: { opacity: 0.3 }, to: { opacity: 1 } }, animationDuration: "400ms", animationIterationCount: "infinite", animationDirection: "alternate" }}`; those run in C++ on the UI thread. On the Samsung, 48 such tiles cost 1.0 ms of UI-thread time per frame versus 2.3 ms for the same motion written as a `useAnimatedStyle` worklet, so prefer CSS keyframes for repeating or decorative motion on Android and keep worklets for values that follow state. This adapter does not expose every Reanimated component, gesture or layout-transition API.

On Android, the package's pnpm patch `patches/react-native-reanimated@4.5.1.patch` adds a direct path in Reanimated's `NativeProxy.synchronouslyUpdateUIProps`: when a frame update contains only `opacity` and a transform made of `translateX`, `translateY`, `scale`, `scaleX` or `scaleY` in pixels, it is written straight to the Android `View` (alpha, translation, scale, with the React Native transform tag kept current) instead of going through the view manager's prop diff and 4×4 matrix decomposition. Rotations, skews, matrices, percentages, a transform origin or any other prop take Reanimated's regular path. Review the patch when Reanimated changes. Expo's Babel preset configures the Worklets plugin automatically. Reanimated and Worklets require a native host rebuild when added or changed.

The platform QA app exposes a **Mobile development lab** from login, workspace selection and the workspace home. `/__dev` covers state, derived values, effects and disposal, stores, reactive collections, context, bindable props, keyed children, await blocks, boundaries and the animation bridge. Its checks only change local test state. The animation probe deliberately blocks JavaScript for one second.

The lab's **stress** panel is a scenario runner. Every scenario samples UI-runtime frame intervals with a monitor that lives on the UI runtime (`frames.ts`; nothing crosses threads per frame), calibrates the display's frame period first, and passes when at most 1% of intervals exceed 1.5 periods and none exceeds 4 periods. Scenarios: `idle` calibration; `animation-48` (48 Reanimated tiles), `animation-48-square` (no rounded corners) and `animation-48-translate` (one animated property) to attribute per-frame cost; `churn-static` and `churn-animated` (32 of 48 views replaced every 250 ms); `list-300` and `list-300-clipped` (mount, programmatic scroll and unmount of 300 rows, with and without `removeClippedSubviews`); `input-120` (controlled `bind:value` round trips) and `input-typing` (20 s of real keyboard input); `modal-8`; `navigation-8` (push and pop `/__dev/screen`); `churn-60s` (the cleanup verdict: every retired shared value must stop changing after destruction) and `soak-120s` (heap before and after). Each result is logged as `[Svelte stress] {json}` for adb capture. These explicit stress controls ignore reduced motion. The screen keeps its device awake until it unmounts. The lab is enabled in development and the `io.rasheed.svelteqa` build, and excluded from production navigation.

On 25 October 2026 the physical Samsung SM-A165F (90 Hz) passed all 28 functional checks on the final build, and Perfetto plus gfxinfo traced the stress-test "scroll lag" to React Native Android itself rather than scrolling or this renderer: scrolling the lab without the stress runs at p50 7.9 ms with no frame over 17 ms, while the 48-tile animated churn costs 13–14 ms per frame whether or not the page scrolls (Reanimated's synchronous Java prop path ≈ 3.3 ms per frame for 48 views, Fabric view creation ≈ 0.5 ms per view, RenderThread drawing of rounded semi-transparent views, 3–5 ms of GPU). React Native's experimental Android view recycling halved view creation but did not change frame times, so it stays off. In the lab's own scenarios, idle, square or single-property animation of 48 tiles, keyboard typing and the cleanup checks pass at 90 Hz; animated churn, the first draw of 300 unvirtualized rows, JavaScript-driven text values and Android dialog creation exceed the budget on this device. The same build on the physical iPhone SE (3rd generation, iOS 26.6, 60 Hz) passed all 28 checks and every quick scenario, driven by the `rasheed-svelte:///__dev?run=checks,quick` deep link and read back from `Documents/lab-results.json` with `devicectl`. Details, traces and the measurement tools are in `.rasheed/native-qa/2026-10-25/` (not committed).


## Foreign views

`@rasheed/svelte-native/foreign` mounts views other native libraries own inside the engine's tree (design and measurements in `apps/platform/modules/svelte-engine/SPEC.md`, "Foreign views"). The components mount the native view by its Fabric name and port what the library's React code does before it; none imports the library or React.

```svelte
<script lang="ts">
  import { ExpoImage, BlurTargetView, BlurView, LinearGradient, Video, LottieView, DateTimePicker, openDatePicker, WebView, MapView, Marker } from "@rasheed/svelte-native/foreign";
  import { Pdf, ViewShot, captureRef, Rive, ConicGradient, ShadowedView, shadowStyle, AnimateableText } from "@rasheed/svelte-native/foreign";
</script>
```

| Library | Components | Notes |
|---|---|---|
| expo-image | `ExpoImage` | `source`, `placeholder` (URL, `{ uri, headers }`, `require`d asset, blurhash, thumbhash), `contentFit`, `transition`, `cachePolicy`, `priority`, `recyclingKey`, `tintColor`, `onLoad`/`onError`. Our `Image` is unchanged. Static methods and the view's functions are not ported (use `requireNativeModule("ExpoImage")`). |
| expo-blur | `BlurView`, `BlurTargetView` | iOS blurs what is behind. On Android `blurMethod="none"` (the default) is a translucent tint; the real blur renders a `BlurTargetView`, whose `ref` goes to `blurTarget`. The target's children are mounted by React Native: they draw and lay out but take no JavaScript touch events. |
| expo-linear-gradient | `LinearGradient` | `colors` (any colour React Native takes), `locations`, `start`, `end`; the children are the engine's views. |
| react-native-video 6 | `Video` | `source`, `paused`, `muted`, `repeat`, `resizeMode`, `rate`, `volume`, `controls`, `poster` and the library's callbacks; `ref` gives `seek`, `pause`, `resume`, `setVolume`, `getCurrentPosition`, `setSource`, ... through the library's `VideoManager`. `renderLoader` and FairPlay's `getLicense` are not ported. |
| @react-native-community/datetimepicker | `DateTimePicker` (iOS), `openDatePicker` (Android) | One pattern: `{#if Platform.OS === "ios"}<DateTimePicker {value} onValueChange={(_, date) => (value = date)} />{:else}…await openDatePicker({ value, mode: "date" })…{/if}`; `openDatePicker` answers with the `Date`, or `null` when the dialog is dismissed. |
| lottie-react-native | `LottieView` | `source` (a name, `{ uri }`, a `.lottie` asset or the animation object), `autoPlay`, `loop`, `speed`, `duration`, `progress`, `colorFilters`, `onAnimationFinish`; `ref` gives `play`, `pause`, `resume`, `reset`. |
| react-native-pdf (with react-native-blob-util) | `Pdf` | `source` (`{ uri, headers, method, body, cache, cacheFileName, expiration }` for a URL, `bundle-assets://`, a `data:application/pdf;base64,` URI or a file; or a `require`d asset; loaded through blob-util's module as the library does), `page`, `scale`, `horizontal`, `enablePaging`, `fitPolicy`, `spacing`, `password`, `onLoadComplete`, `onPageChanged`, `onError`, `onPressLink`, a `loading` snippet; `ref` gives `setPage`. No download progress, no `usePDFKit={false}`. |
| react-native-view-shot | `captureRef`, `captureScreen`, `releaseCapture`, `ViewShot` | `captureRef(handle, options)` takes the handle a `ref` gives and answers a `file://` URI (or `base64`, `data-uri`). The Android engine draws its own views itself (`SvelteEngine.captureView`: png, jpg, webm; not `raw`, `zip-base64`, `snapshotContentContainer`); the library's module draws foreign views and, on iOS, every view. A `View` needs `collapsable={false}` or something to draw; `ViewShot` sets it and has `capture()`, `captureMode="mount"` and `"continuous"`. |
| rive-react-native | `Rive` | `resourceName`, `url` or `source`, `artboardName`, `stateMachineName`, `autoplay`, `fit`, `alignment`, `onPlay`, `onPause`, `onStateChanged`, `onError`; `ref` gives `play`, `pause`, `stop`, `reset`, `setInputState`, `fireState`, the state getters, text runs and data-binding setters. The property hooks (`useRiveNumber`, ...) are not ported. |
| expo-conic-gradient | `ConicGradient` | `colors`, `locations`, `center`, `angle`; fills a container that carries the style and the children. |
| react-native-fast-shadow | `ShadowedView`, `shadowStyle` | Android shadows from the style's `shadowColor`, `shadowOpacity`, `shadowRadius`, `shadowOffset` and corner radii; the children stay the engine's. A plain `View` on iOS. `overflow: "hidden"` on it clips the shadow: put it on the child. |
| react-native-animateable-text | `AnimateableText` | `text`, `animatedProps` (a worklet returning `{ text }` that reads a shared value; the host attaches it like `animatedStyle`), the `Text` props. |

Every library is an app dependency (`npx expo install`) and a native rebuild. `animatedProps` works on any element, next to `animatedStyle`, for props that are not style. The config plugin's `androidOnDemandViewManagers` option keeps a package's view managers off the host's start (`{ "com.brentvatne.react.ReactVideoPackage": ["RCTVideo"] }`: the package's class name and the Fabric names it provides); it also works for packages that still build their native modules with `createNativeModules`. A view inside a list row or a sheet follows the platform's touch rules. Run `bun test tests/foreign*.test.ts` for the component, view-config and bundle checks; devices are needed for rendering.

### react-native-svg

`@rasheed/svelte-native/svg` is [react-native-svg](https://github.com/software-mansion/react-native-svg) 15.15.4 (`npx expo install react-native-svg`, a native rebuild) as Svelte components: `Svg`, `G`, `Path`, `Rect`, `Circle`, `Ellipse`, `Line`, `Polygon`, `Polyline`, `Text`, `TSpan`, `TextPath`, `Use`, `Image`, `Defs`, `ClipPath`, `LinearGradient`, `RadialGradient`, `Stop`, `Pattern`, `Mask`, `Marker`, `Symbol`, `ForeignObject`, the filters `Filter`, `FeBlend`, `FeColorMatrix`, `FeComposite`, `FeDropShadow`, `FeFlood`, `FeGaussianBlur`, `FeMerge`, `FeMergeNode`, `FeOffset`, and `SvgXml` and `SvgUri`. The props are the library's (its own prop extraction runs, imported by deep path; no React is bundled: `tests/svg-bundle.test.ts`), and so is what each element sends the native view (`tests/svg-elements.test.ts` compares every element with the library's own class). `Text` and `Image` here are the SVG elements: import them under another name beside the primitives (`import { Text as SvgText } from "@rasheed/svelte-native/svg"`); the primitive lowering leaves this entry alone.

```svelte
<script lang="ts">
  import { Svg, Defs, LinearGradient, Stop, Rect, Circle, Text as SvgText, SvgXml } from "@rasheed/svelte-native/svg";
  import { createSharedValue, withRepeat, withTiming } from "@rasheed/svelte-native/animation";
  const radius = createSharedValue(6);
  radius.value = withRepeat(withTiming(12, { duration: 800 }), -1, true);
  const pulse = () => { "worklet"; return { r: radius.value }; };
</script>

<Svg width={96} height={64} viewBox="0 0 96 64">
  <Defs><LinearGradient id="card" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#ff7a18" /><Stop offset="1" stopColor="#319197" /></LinearGradient></Defs>
  <Rect width="96" height="64" rx="12" fill="url(#card)" />
  <Circle cx="24" cy="32" r="6" fill="#fff" animatedProps={pulse} />
  <SvgText x="48" y="38" fill="#fff" fontSize="14" fontWeight="bold">SVG</SvgText>
</Svg>
<SvgXml xml={`<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="#191b1e" stroke-width="2"/></svg>`} width={24} height={24} />
```

- On Android the `Svg` is a foreign view (SPEC.md, "react-native-svg"): everything inside it is mounted by React Native, in the frame the engine keeps for it; on iOS the same nodes are ordinary Fabric components. The 29 Android view managers are created on first use (`com.horcrux.svg.SvgPackage` in the config plugin's `androidOnDemandViewManagers`).
- Text: a string between the tags of a `Text` or `TextPath` is a `TSpan` of its own and the only string in a `TSpan` is its `content`. Whitespace between elements is text, as in HTML. A `Stop` or an `FeMergeNode` tells its parent its props and draws nothing.
- `ref` gives the handle with `tag`, `measure`, `dispatchCommand`, `setNativeProps` and the library's `getBBox(options)`, `getTotalLength()`, `getPointAtLength(length)`, `isPointInFill({ x, y })`, `isPointInStroke`, `getCTM`, `getScreenCTM`; the `Svg`'s adds `toDataURL(callback, options)`. Results are plain objects.
- Touch: `onPress`, `onLongPress` and the responder handlers are the library's props, answered by the host's Pressability and responder system. On Android a touch inside a foreign view never reaches JavaScript, so a shape's `onPress` does not run there; `pointerEvents="box-only"` on the `Svg` keeps the touches of its frame for JavaScript, and the `Svg`'s own `onPress` works. iOS follows React Native's touch path (not run).
- Animation: `animatedProps` on any element is a worklet returning native props (`{ r }`, `{ cx }`, `{ d }`, `{ strokeDashoffset }`, `{ opacity }`; a colour as `{ type: 0, payload: <ARGB integer> }`), written on the UI thread by Reanimated.
- `SvgXml xml` and `SvgUri uri` (network, file or SVG data URI) draw a document with the library's parser; `onError`, a `fallback` snippet, `onLoad`. Not ported: `SvgCss` and the other style-sheet forms, `SvgFromXml`/`SvgFromUri`/`SvgAst`, `FilterImage`, the filter elements the library leaves to the web, the `SVGMatrix` and `SVGPoint` classes. `bun test tests/svg*.test.ts` runs the element, view-config, XML, bundle, touch and animation checks; devices are needed for rendering.

## Renderer

Mounting is not free: Svelte's runtime (component, effects, host nodes) runs before the host builds the Fabric payload, so 300 lowered `View`/`Text` rows mount in 75–80 ms on the Samsung SM-A165F against 61–65 ms for plain React Native (25 October 2026; details below). Keep unvirtualized lists short, paginate, or use `List`.

Each primitive (`View`, `Text`, …) is one Svelte component that renders a literal host tag such as `<native-view>` with a `nativeProps` attribute, so a list row costs five host nodes (element, anchor, element, anchor, text) rather than the seventeen of a two-layer design; `Host.svelte` (exported as `Native`) keeps the dynamic-tag form. The custom renderer keeps each host node's children in a doubly linked list, so Svelte's inserts, keyed moves, removals and sibling queries are O(1). Every change reaches the host through one invalidation sink (`setInvalidationSink`), which marks the node dirty and commits all dirty nodes in one Fabric transaction per root in a microtask, after the Svelte flush that produced them; a node rebuilds its immutable snapshot lazily when the host reads it. Event handlers reach the host as one stable dispatcher per event type, so native props keep their identity between flushes. `bun test` in this package covers these operations directly and through compiled Svelte components.

### Fabric host

`@rasheed/svelte-native/fabric` drives React Native's Fabric shadow tree directly from the Svelte renderer through the `nativeFabricUIManager` binding, with no React reconciler. `createFabricApp(App, props)` registers the `AppRegistry` runnable React Native's `runApplication` calls; `svelte-native sync` writes the entry that calls it (`SVELTE_NATIVE_ROOT=<path>` makes another component the root, for spikes). Mapped tags (`viewNames` in `src/fabric/host.ts`): `native-view`, `native-pressable`, `native-animated-view`, `native-keyboard`, `native-stack`, `native-screen` → `RCTView`; `native-safe-area` → `RCTView` on Android, `RCTSafeAreaView` on iOS; `native-text` → `RCTText`/`RCTVirtualText`; `native-scroll` → `RCTScrollView` with a `collapsable: false` content container; `native-input`, `native-switch`, `native-spinner`, `native-image` and `native-modal` → the platform's text input, switch, progress bar, image and modal views. Measured on 25 October 2026 (Samsung SM-A165F): a 300-row list mounts in 130 ms with `View`/`Text` components, 75–80 ms with raw tags, against 61–65 ms for plain React Native; details in `.rasheed/native-qa/2026-10-25/README.md`. `bun test tests/fabric.test.ts` runs the host against a fake binding.

Press handling in the Fabric host: any node with `onPress`, `onPressIn`, `onPressOut`, `onLongPress` or `onPressChange` becomes a gesture responder (`src/fabric/responder.ts`) driven by a port of React Native's `Pressability` (`src/fabric/pressability.ts`), so `<Pressable>`, `<Text onPress>` and a `<View onPress>` behave as in React Native: the innermost enabled node takes the touch, a native scroll steals it through `topTouchCancel`, and `hitSlop`, `pressRectOffset`, `delayLongPress` (500 ms), `delayPressIn`, `delayPressOut`, `minPressDuration` (130 ms), `cancelable` and `disabled` apply. Handlers receive `{ nativeEvent, target, currentTarget }`; `onPressIn`/`onPressOut` pair with a delayed `onPressOut` exactly as React Native does, so a quick tap calls `onPress` before `onPressOut`. `onPressChange(pressed: boolean)` is a Svelte convenience: it is called with `true` when the press becomes active and `false` when it ends, so a component can keep `let pressed = $state(false)` and render a pressed state. Custom `onStartShouldSetResponder`, `onMoveShouldSetResponder` (and `...Capture` through `nativeProps`, because Svelte treats a `Capture` attribute suffix as an event option), `onResponderGrant/Move/Release/Terminate` and `onResponderTerminationRequest` attributes are honoured. `bun test tests/responder.test.ts` covers it.

### Primitive lowering

Metro's transformer runs `src/lower.ts` over every `.svelte` file before the Svelte compile. A file that imports `View`, `Text`, `ScrollView`, `Image`, `ActivityIndicator` or `Pressable` from `@rasheed/svelte-native` (or a subpath, with or without `as` aliases) has those tags rewritten to the host tags `native-view`, `native-text`, `native-scroll`, `native-image`, `native-spinner` and `native-pressable`, so a row costs host nodes only, with no component instance per primitive. Attributes, spreads, `bind:this`, `ref`, `class`, `id` and children are carried over unchanged; self-closing tags become paired tags. Nothing else in the file changes, so line numbers are stable (columns shift on lines holding a lowered tag; no source map is produced). Imports from `@rasheed/svelte-native/svg` are never lowered: its `Text` and `Image` are SVG elements.

Left as components: `TextInput`, `SafeAreaView` (padding from the insets store), `Switch`, `Modal`, `AnimatedView`, `KeyboardAvoidingView`, `<svelte:component>`, local components that share a name, and any primitive tag using `let:`, a `bind:` other than `bind:this`, a `children` attribute, a snippet declared inside the tag, or (for `Pressable`) a `style` that is not an object literal or plain text. `use:`, `transition:` and `animate:` on a lowered tag are passed through and reported with a warning. Files that do not mention the package are not parsed, and files that fail to parse are returned unchanged for the compiler to report. The same transform is exported as a Svelte preprocessor: `import { lower } from "@rasheed/svelte-native/lower"` and add it to `preprocess` for tooling such as svelte-check.

`style={…}` on a lowered tag is renamed to `nativeStyle={…}`: Svelte compiles a `style` attribute on any element to a string before the renderer sees it, so the host reads style objects from `nativeStyle` (hand-written `native-*` tags must use `nativeStyle` or `nativeProps` too).

## Integration

The platform's Vite configuration composes `svelteNative({target: mode === "native" ? "native" : "web", kit: ...})`. Web mode runs SvelteKit and excludes mobile entry files from dependency discovery. Native mode discovers routes and invokes Expo's Metro/Hermes export. The native graph rejects `.server.ts`, `src/lib/server`, private environment and ingest imports.

Metro uses `withSvelteNative(getDefaultConfig(__dirname))`. It compiles Svelte with the pinned custom renderer and resolves every native `svelte/*` import to the same runtime. Add `"@rasheed/svelte-native/expo"` to the Expo config's plugins. React Native's Gradle cache does not track Svelte files or external workspace sources, so this plugin rebundles the JavaScript graph on every Android release build; native compilation stays incremental. Expo continues to provide module resolution, native code generation, assets and Hermes compilation. The CLI runs with Node 25's TypeScript support.

The plugin accepts `["@rasheed/svelte-native/expo", { androidViewRecycling: true }]` to enable React Native's experimental Android view recycling (`enableViewRecycling` plus the `<View>`/`<Text>` opt-ins, or an object choosing `view`, `text`, `image`, `scrollView`). It writes a `ReactNativeFeatureFlags.dangerouslyForceOverride` block after `loadReactNative(this)` in the generated `MainApplication.kt`. It is off by default: on 25 October 2026 it halved native view creation time on the Samsung (0.27 ms versus 0.5 ms per view) without improving frame times.

```sh
svelte-native sync
svelte-native dev --port 8081
svelte-native android --device
svelte-native ios --device
vite build --mode native
# Or export iOS bytecode without building its native host:
svelte-native build --platform ios
```

Generated entries and exports live under ignored `.svelte-native/`. Android export produces `dist/android/index.hbc`, its composed source map and assets there. A native host must still be built with Expo/Gradle or Xcode. Release host builds use the same Metro transformer and generated entry. The native dev server reloads changed Svelte files; preserving component state across edits is not guaranteed.

### Route loading

Routes load lazily. `.svelte-native/routes.ts` exports `tree` (the route tree `buildTree` makes of `src/routes`): a `load()` per page that requires its `+mobile.svelte` and the content layouts above it, and a `layout()` per navigator layout. A navigation loads the routes it pushes right away; a screen that renders loads its own route (the first screen, a restored stack), so creating the router loads nothing. Until a route settles its screen is empty, or shows the `loading` snippet of the `<Stack>` around it (or the one passed as `<Router {router} {loading} />`). A failed load is rethrown where the screen renders (the nearest `<svelte:boundary>` draws it) and retried on the next navigation (for a navigator layout, one through any navigator of its chain, so a pane's layout is retried by the next navigation into the pane). `presentation` and `navigator` are read when the table is generated, so they must be literals in the module script (`export const presentation = "modal"`, `export const navigator = "tabs"`). Release bundles stay in one file (Expo's embed export does not split chunks); the loaders defer evaluation, which is what boot pays for.

### Animation API loading

`@rasheed/svelte-native/animation` and the Fabric host both load Reanimated and worklets on first use (≈ 90 ms of boot on a mid-range phone, including a second Hermes runtime): the host on the first node with `animatedStyle`, `entering`/`exiting`/`layout` or CSS animation keys, the module on its first call (`createSharedValue`, `withTiming`, `runOnUISync`, …). Until then the module's exports are loading stubs; after the load they are Reanimated's own functions (live bindings, re-assigned by the shared loader in `src/fabric/reanimated-load.ts`). One rule follows: a worklet that calls `withTiming`/`cancelAnimation` or reads `ReduceMotion`/`Easing` on the UI runtime must be created after some animation call ran on the JavaScript thread (creating the shared value it animates is enough); a worklet created before that captures a stub, which the UI runtime rejects as a remote function.

### Fabric entry dev loop

The entry has its own development loop; it does not use Fast Refresh (there is no React) or Expo's dev client (its launcher UI is React).

- Metro: `cd apps/platform && node ../../packages/svelte-native/src/cli.ts dev --port 8181` (the same as `svelte-native dev`; it writes the entry, then starts Metro).
- Host: a debug APK (`./gradlew assembleDebug -PreactNativeDevServerPort=8181` in `apps/platform/android`, so the debug host asks Metro on port 8181 and not 8081). The Expo plugin's Android build has no dev client. A debug build skips JS bundling and loads `.expo/.virtual-metro-entry` from Metro, which resolves to `.svelte-native/entry.ts`.
- Device: `adb reverse tcp:8181 tcp:8181`, then launch the app. A release APK cannot be pointed at Metro (its Hermes bytecode is embedded and release has no dev support), and a debug build that keeps `expo-dev-client` opens the React launcher instead of the app.
- Edit to screen: Metro pushes the changed module over its `/hot` socket (React Native's `HMRClient`, registered by `init.ts`; Fast Refresh must be on in the dev menu, which is its default). Metro re-runs the edited module and each importer up to the nearest `module.hot.accept()`. The generated entry accepts at the top (`if (__DEV__) module.hot?.accept(() => remountSurfaces())`), so every edit re-runs the entry, which re-registers the fresh root component, and `remountSurfaces()` unmounts every running surface and starts it again on the same root tag with the same initial props.
- Kept across an edit: the navigation state (every stack and every tabs selection: each root `createRouter` adopts what the previous router published on `globalThis.__svelteNativeHmrState`, nested along the entries and recorded by route id (restored by id, else by href), and drops what no longer exists; a hand-made router with a `scope` takes its own the first time it is created), native state (engine overlay, native modules, the JS heap outside re-run modules) and any module Metro did not re-run. Lost: component state, and state held by re-run modules. An edited `*.svelte.ts` store is re-run together with its importers, so its connections are not reused; close them in a `module.hot.dispose` handler if that matters.
- Errors: in development an uncaught fatal error, or a throw while mounting or flushing a surface, replaces the surface with a red `ErrorScreen` (message, first stack frames, a Reload button that remounts). The error is reported to the native exception manager as non-fatal so the process survives and the screen stays; `console.error` is also forwarded to `reportSoftException`, so it reaches logcat. Frames are unsymbolicated bundle positions. An error before the first surface exists (while the entry's modules load) has no surface to draw on; it is reported natively only. Release builds keep the fatal path.

Verified on an Android emulator (API 36) with this recipe: a save reaches the screen through `remountSurfaces()` about one second later, a `throw` at the top of a route's script shows the error screen with the process alive, and reverting the file restores the app. Three details the loop depends on: `svelte-native dev` writes the entry before Metro starts; `react-native/Libraries/Core/InitializeCore` resolves to this package's `init.ts`, because Expo's `src/winter` runtime (run before the entry) imports it; and `Expo.fx` registers a placeholder "main" component in development, which the `AppRegistry` accepts and ignores. Do not start Metro with `CI=1`: Expo then disables the file watcher and serves stale bundles. Package-file edits are hot too, since the monorepo root is watched. Not verified: the loop on iOS, and edit latency on a physical Android device (the emulator runs over an SSH forward).

## Experimental dependency

Native compilation depends on Svelte's [unmerged custom-renderer PR](https://github.com/sveltejs/svelte/pull/18042), pinned to commit `216f258068d93170a927ad4d27ee6864b0b305c5` (5.56.7). The browser app keeps its regular Svelte dependency. The package also owns a small pnpm patch to SvelteKit 3-next.27 so its route scanner accepts mobile siblings. Both pins must be reviewed when updating Svelte or SvelteKit.

The pinned compiler currently requires boundary failure snippets to be declared outside `<svelte:boundary>` and passed with `{failed}`. Svelte DOM transitions, React widgets and Svelte DOM libraries are not adapted; a further native view needs an entry in the host's view-name table (`viewNames` in `src/fabric/host.ts`). Physical Android has been exercised. Unsigned iOS device compilation is separate from a physical iPhone runtime pass.

pnpm reports Svelte peer-range warnings for the compiler's URL dependency even though its package version is 5.56.7. The compiler/runtime pin is intentional; changing it requires native compilation and device checks.

`bun test tests/renderer.test.ts` exercises compiled reactive updates, keyed identity, conditional removal, event delivery and effect disposal. `pnpm typecheck` validates the public primitives and tooling.

The foundation port was exercised on a physical Samsung SM-A165F (Android API 36), including a standalone release with Metro stopped: login validation, onboarding, profile and photo updates, email verification, device revocation, Arabic/English preferences, workspace creation/deletion, account deletion, session retention, deep links and startup retry. Browser login, onboarding, workspace creation and profile saving were also checked. Hermes exports contain bytecode version 98 and source maps with the original Svelte source contents.
