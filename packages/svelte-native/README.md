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
- `+layout.mobile.svelte` wraps descendant screens. The root layout receives the generated `routes` prop and creates the app's session/router context. Layouts receive `params`, `url` and a `children` snippet.
- A page can export `const presentation = "modal"` from its module script. `useRouter()` exposes `goto`, `back`, current location and stack entries. Screen transitions and Android Back go through the host's navigation container (`src/fabric/navigation.ts`). Cold/warm deep links are matched against mobile routes; unmatched URLs are ignored.
- Primitives expose their React Native prop types and Svelte child snippets. `TextInput` and `Switch` support binding. `ScrollView` and `TextInput` accept a `ref` callback that receives the host handle (`scrollTo`, `focus`, `blur`, `measure`, `dispatchCommand`; `HostHandle` in `src/fabric/host.ts`). Use native style objects. Browser HTML, CSS, DOM actions and SvelteKit browser navigation APIs do not become native controls.
- Lists: `<List items rowHeight={56} keyOf={(item) => item.id}>{#snippet row(item, index)}...{/snippet}</List>` mounts only the rows near the viewport (`overscan`, default 4 rows each side; 10 rows before the first layout) at absolute positions, so long lists cost a handful of native views instead of hundreds. With `rowHeight` every row has that fixed size and nothing is measured. Without it, rows start at `estimatedRowHeight` (default 48) and each row wrapper's `onLayout` fills a per-key height table; offsets are cached prefix sums rebuilt from the first changed index, the spacer is their sum, and a row whose measured size differs from the estimate shifts the rows after it on the next frame (batched, 16 ms). `rowHeights={(item, index) => number}` supplies sizes up front and skips measuring (edit items in place and the table is not rebuilt; pass a new array). `horizontal` flips the axis (`contentOffset.x`, `layout.width`, `left`, row-direction content; `rowHeight` is then the row width). Also: `initialScrollIndex`, `keyExtractor` (alias of `keyOf`), `empty` snippet shown while `items` is empty, `onViewableItemsChanged({ viewableItems, changed })` (debounced 50 ms; `viewabilityConfig.itemVisiblePercentThreshold`, default 50), `header`/`footer` snippets, `onEndReached` with `onEndReachedThreshold` (fraction of the viewport, default 0.5) and the remaining `ScrollView` props. `recycle` keeps a pool of wrapper nodes (a full window for fixed rows, the high-water mark of the window otherwise) and re-targets them by index (slot = index modulo pool size) instead of mounting and unmounting rows: no host views are created while scrolling, but a row component's own state does not follow its item, so keep row state in `items`; late `onLayout` events after a retarget can mis-measure one row. `bind:this` exposes `scrollToIndex(index, animated)` and `scrollToOffset(offset, animated)`. `onRefresh`/`refreshing` are not provided: the host maps no refresh control. Native view recycling (reusing the native view across items) is not implemented.
- `<Native name="native-screen" attributes={{ ... }}>` renders a host tag chosen at runtime (the router uses it for `native-stack`/`native-screen`). The tags the host maps are `viewNames` in `src/fabric/host.ts`; an unmapped name throws when the host flushes.
- Ordinary `.svelte.ts` modules, context, stores, runes and lifecycle hooks work. Shared validation/domain logic belongs in portable modules. SvelteKit server loads, form actions and remote functions still run on the server; native screens use explicit network boundaries.

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

## Renderer

Mounting is not free: Svelte's runtime (component, effects, host nodes) runs before the host builds the Fabric payload, so 300 lowered `View`/`Text` rows mount in 75–80 ms on the Samsung SM-A165F against 61–65 ms for plain React Native (25 October 2026; details below). Keep unvirtualized lists short, paginate, or use `List`.

Each primitive (`View`, `Text`, …) is one Svelte component that renders a literal host tag such as `<native-view>` with a `nativeProps` attribute, so a list row costs five host nodes (element, anchor, element, anchor, text) rather than the seventeen of a two-layer design; `Host.svelte` (exported as `Native`) keeps the dynamic-tag form. The custom renderer keeps each host node's children in a doubly linked list, so Svelte's inserts, keyed moves, removals and sibling queries are O(1). Every change reaches the host through one invalidation sink (`setInvalidationSink`), which marks the node dirty and commits all dirty nodes in one Fabric transaction per root in a microtask, after the Svelte flush that produced them; a node rebuilds its immutable snapshot lazily when the host reads it. Event handlers reach the host as one stable dispatcher per event type, so native props keep their identity between flushes. `bun test` in this package covers these operations directly and through compiled Svelte components.

### Fabric host

`@rasheed/svelte-native/fabric` drives React Native's Fabric shadow tree directly from the Svelte renderer through the `nativeFabricUIManager` binding, with no React reconciler. `createFabricApp(App, props)` registers the `AppRegistry` runnable React Native's `runApplication` calls; `svelte-native sync` writes the entry that calls it (`SVELTE_NATIVE_ROOT=<path>` makes another component the root, for spikes). Mapped tags (`viewNames` in `src/fabric/host.ts`): `native-view`, `native-pressable`, `native-animated-view`, `native-keyboard`, `native-stack`, `native-screen` → `RCTView`; `native-safe-area` → `RCTView` on Android, `RCTSafeAreaView` on iOS; `native-text` → `RCTText`/`RCTVirtualText`; `native-scroll` → `RCTScrollView` with a `collapsable: false` content container; `native-input`, `native-switch`, `native-spinner`, `native-image` and `native-modal` → the platform's text input, switch, progress bar, image and modal views. Measured on 25 October 2026 (Samsung SM-A165F): a 300-row list mounts in 130 ms with `View`/`Text` components, 75–80 ms with raw tags, against 61–65 ms for plain React Native; details in `.rasheed/native-qa/2026-10-25/README.md`. `bun test tests/fabric.test.ts` runs the host against a fake binding.

Press handling in the Fabric host: any node with `onPress`, `onPressIn`, `onPressOut`, `onLongPress` or `onPressChange` becomes a gesture responder (`src/fabric/responder.ts`) driven by a port of React Native's `Pressability` (`src/fabric/pressability.ts`), so `<Pressable>`, `<Text onPress>` and a `<View onPress>` behave as in React Native: the innermost enabled node takes the touch, a native scroll steals it through `topTouchCancel`, and `hitSlop`, `pressRectOffset`, `delayLongPress` (500 ms), `delayPressIn`, `delayPressOut`, `minPressDuration` (130 ms), `cancelable` and `disabled` apply. Handlers receive `{ nativeEvent, target, currentTarget }`; `onPressIn`/`onPressOut` pair with a delayed `onPressOut` exactly as React Native does, so a quick tap calls `onPress` before `onPressOut`. `onPressChange(pressed: boolean)` is a Svelte convenience: it is called with `true` when the press becomes active and `false` when it ends, so a component can keep `let pressed = $state(false)` and render a pressed state. Custom `onStartShouldSetResponder`, `onMoveShouldSetResponder` (and `...Capture` through `nativeProps`, because Svelte treats a `Capture` attribute suffix as an event option), `onResponderGrant/Move/Release/Terminate` and `onResponderTerminationRequest` attributes are honoured. `bun test tests/responder.test.ts` covers it.

### Primitive lowering

Metro's transformer runs `src/lower.ts` over every `.svelte` file before the Svelte compile. A file that imports `View`, `Text`, `ScrollView`, `Image`, `ActivityIndicator` or `Pressable` from `@rasheed/svelte-native` (or a subpath, with or without `as` aliases) has those tags rewritten to the host tags `native-view`, `native-text`, `native-scroll`, `native-image`, `native-spinner` and `native-pressable`, so a row costs host nodes only, with no component instance per primitive. Attributes, spreads, `bind:this`, `ref`, `class`, `id` and children are carried over unchanged; self-closing tags become paired tags. Nothing else in the file changes, so line numbers are stable (columns shift on lines holding a lowered tag; no source map is produced).

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

Routes load lazily. `.svelte-native/routes.ts` gives each route a `load()` that requires its `+mobile.svelte` and the layouts above it. The router loads the stack's routes when it is created and any other route on its first `goto`/`replaceBase`/`openURL`. Until a route settles its screen is empty, or shows the `loading` snippet passed as `<Router {router} {loading} />`. A failed load is rethrown where the screen renders (the nearest `<svelte:boundary>` draws it) and retried on the next navigation. `presentation` is read when the table is generated, so it must be the literal `export const presentation = "modal" | "push"` in the page's module script. Release bundles stay in one file (Expo's embed export does not split chunks); the loaders defer evaluation, which is what boot pays for.

### Animation API loading

`@rasheed/svelte-native/animation` and the Fabric host both load Reanimated and worklets on first use (≈ 90 ms of boot on a mid-range phone, including a second Hermes runtime): the host on the first node with `animatedStyle`, `entering`/`exiting`/`layout` or CSS animation keys, the module on its first call (`createSharedValue`, `withTiming`, `runOnUISync`, …). Until then the module's exports are loading stubs; after the load they are Reanimated's own functions (live bindings, re-assigned by the shared loader in `src/fabric/reanimated-load.ts`). One rule follows: a worklet that calls `withTiming`/`cancelAnimation` or reads `ReduceMotion`/`Easing` on the UI runtime must be created after some animation call ran on the JavaScript thread (creating the shared value it animates is enough); a worklet created before that captures a stub, which the UI runtime rejects as a remote function.

### Fabric entry dev loop

The entry has its own development loop; it does not use Fast Refresh (there is no React) or Expo's dev client (its launcher UI is React).

- Metro: `cd apps/platform && node ../../packages/svelte-native/src/cli.ts dev --port 8181` (the same as `svelte-native dev`; it writes the entry, then starts Metro).
- Host: a debug APK (`./gradlew assembleDebug -PreactNativeDevServerPort=8181` in `apps/platform/android`, so the debug host asks Metro on port 8181 and not 8081). The Expo plugin's Android build has no dev client. A debug build skips JS bundling and loads `.expo/.virtual-metro-entry` from Metro, which resolves to `.svelte-native/entry.ts`.
- Device: `adb reverse tcp:8181 tcp:8181`, then launch the app. A release APK cannot be pointed at Metro (its Hermes bytecode is embedded and release has no dev support), and a debug build that keeps `expo-dev-client` opens the React launcher instead of the app.
- Edit to screen: Metro pushes the changed module over its `/hot` socket (React Native's `HMRClient`, registered by `init.ts`; Fast Refresh must be on in the dev menu, which is its default). Metro re-runs the edited module and each importer up to the nearest `module.hot.accept()`. The generated entry accepts at the top (`if (__DEV__) module.hot?.accept(() => remountSurfaces())`), so every edit re-runs the entry, which re-registers the fresh root component, and `remountSurfaces()` unmounts every running surface and starts it again on the same root tag with the same initial props.
- Kept across an edit: the navigation stack (each `createRouter` adopts the stack the previous router published on `globalThis.__svelteNativeHmrState`, skipping routes that no longer exist), native state (engine overlay, native modules, the JS heap outside re-run modules) and any module Metro did not re-run. Lost: component state, and state held by re-run modules. An edited `*.svelte.ts` store is re-run together with its importers, so its connections are not reused; close them in a `module.hot.dispose` handler if that matters.
- Errors: in development an uncaught fatal error, or a throw while mounting or flushing a surface, replaces the surface with a red `ErrorScreen` (message, first stack frames, a Reload button that remounts). The error is reported to the native exception manager as non-fatal so the process survives and the screen stays; `console.error` is also forwarded to `reportSoftException`, so it reaches logcat. Frames are unsymbolicated bundle positions. An error before the first surface exists (while the entry's modules load) has no surface to draw on; it is reported natively only. Release builds keep the fatal path.

Verified on an Android emulator (API 36) with this recipe: a save reaches the screen through `remountSurfaces()` about one second later, a `throw` at the top of a route's script shows the error screen with the process alive, and reverting the file restores the app. Three details the loop depends on: `svelte-native dev` writes the entry before Metro starts; `react-native/Libraries/Core/InitializeCore` resolves to this package's `init.ts`, because Expo's `src/winter` runtime (run before the entry) imports it; and `Expo.fx` registers a placeholder "main" component in development, which the `AppRegistry` accepts and ignores. Do not start Metro with `CI=1`: Expo then disables the file watcher and serves stale bundles. Package-file edits are hot too, since the monorepo root is watched. Not verified: the loop on iOS, and edit latency on a physical Android device (the emulator runs over an SSH forward).

## Experimental dependency

Native compilation depends on Svelte's [unmerged custom-renderer PR](https://github.com/sveltejs/svelte/pull/18042), pinned to commit `216f258068d93170a927ad4d27ee6864b0b305c5` (5.56.7). The browser app keeps its regular Svelte dependency. The package also owns a small pnpm patch to SvelteKit 3-next.27 so its route scanner accepts mobile siblings. Both pins must be reviewed when updating Svelte or SvelteKit.

The pinned compiler currently requires boundary failure snippets to be declared outside `<svelte:boundary>` and passed with `{failed}`. Svelte DOM transitions, React widgets and Svelte DOM libraries are not adapted; a further native view needs an entry in the host's view-name table (`viewNames` in `src/fabric/host.ts`). Physical Android has been exercised. Unsigned iOS device compilation is separate from a physical iPhone runtime pass.

pnpm reports Svelte peer-range warnings for the compiler's URL dependency even though its package version is 5.56.7. The compiler/runtime pin is intentional; changing it requires native compilation and device checks.

`bun test tests/renderer.test.ts` exercises compiled reactive updates, keyed identity, conditional removal, event delivery and effect disposal. `pnpm typecheck` validates the public primitives and tooling.

The foundation port was exercised on a physical Samsung SM-A165F (Android API 36), including a standalone release with Metro stopped: login validation, onboarding, profile and photo updates, email verification, device revocation, Arabic/English preferences, workspace creation/deletion, account deletion, session retention, deep links and startup retry. Browser login, onboarding, workspace creation and profile saving were also checked. Hermes exports contain bytecode version 98 and source maps with the original Svelte source contents.
