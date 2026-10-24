# Svelte on React Native

One package owns the native renderer, Svelte primitives, routing and build integration. Native screens are Svelte components running in Hermes. An internal React adapter subscribes to the Svelte host tree and renders real React Native views; there is no WebView and no second React application.

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
- A page can export `const presentation = "modal"` from its module script. `useRouter()` exposes `goto`, `back`, current location and stack entries. Native screen transitions and Android Back use React Native Screens. Cold/warm deep links are matched against mobile routes; unmatched URLs are ignored.
- Primitives expose their React Native prop types and Svelte child snippets. `TextInput` and `Switch` support binding. Use native style objects. Browser HTML, CSS, DOM actions and SvelteKit browser navigation APIs do not become native controls.
- Ordinary `.svelte.ts` modules, context, stores, runes and lifecycle hooks work. Shared validation/domain logic belongs in portable modules. SvelteKit server loads, form actions and remote functions still run on the server; native screens use explicit network boundaries.

## Animation

`@rasheed/svelte-native/animation` adapts Reanimated's animated view and shared values. The internal React host owns `useAnimatedStyle`; the Svelte component owns the shared value's lifetime.

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

Timing, spring, repeat, sequence and delay helpers retain Reanimated's APIs and reduced-motion behavior. This adapter currently handles animated view styles; it does not expose every Reanimated component, gesture or layout-transition API. Expo's Babel preset configures the Worklets plugin automatically. Reanimated and Worklets require a native host rebuild when added or changed.

The platform QA app exposes a **Mobile development lab** from login, workspace selection and the workspace home. `/__dev` covers state, derived values, effects and disposal, stores, reactive collections, context, bindable props, keyed children, await blocks, boundaries and the animation bridge. Its checks only change local test state. The animation probe deliberately blocks JavaScript for one second; the separate 60-second stress panel repeatedly replaces animated children and verifies cancellation after destruction. Functional checks, cleanup checks and frame performance have separate results. Frame sampling includes startup and stop gaps and rejects incomplete coverage. These explicit stress controls ignore reduced motion. The screen keeps its device awake until it unmounts. The lab is enabled in development and the `io.rasheed.svelteqa` build, and excluded from production navigation.

On 24 October 2026, the physical Samsung passed all 28 functional checks and the 60-second cancellation/cleanup run. Scrolling under load still failed: the Android synchronous-props flag reduced the observed 95th-percentile frame duration from 38 ms to 32 ms, above a 60 Hz frame budget. A plain React Native control also stalled under the matched workload. These measurements do not isolate the remaining cause. The final frame-coverage checks and keep-awake cleanup are compiled but await another device run. The iOS QA release was signed with a Personal Team, installed and launched on a physical iPhone SE; its process remained running after launch. Upstream Reanimated's three-minute tag-reuse stress completed on Android. Its broader runtime suite and the iOS functional/stress suites remain pending; a successful app launch does not establish their correctness or performance.

## Integration

The platform's Vite configuration composes `svelteNative({target: mode === "native" ? "native" : "web", kit: ...})`. Web mode runs SvelteKit and excludes mobile entry files from dependency discovery. Native mode discovers routes and invokes Expo's Metro/Hermes export. The native graph rejects `.server.ts`, `src/lib/server`, private environment and ingest imports.

Metro uses `withSvelteNative(getDefaultConfig(__dirname))`. It compiles Svelte with the pinned custom renderer and resolves every native `svelte/*` import to the same runtime. Add `"@rasheed/svelte-native/expo"` to the Expo config's plugins. React Native's Gradle cache does not track Svelte files or external workspace sources, so this plugin rebundles the JavaScript graph on every Android release build; native compilation stays incremental. Expo continues to provide module resolution, native code generation, assets and Hermes compilation. The CLI runs with Node 25's TypeScript support.

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

## Experimental dependency

Native compilation depends on Svelte's [unmerged custom-renderer PR](https://github.com/sveltejs/svelte/pull/18042), pinned to commit `216f258068d93170a927ad4d27ee6864b0b305c5` (5.56.7). The browser app keeps its regular Svelte dependency. The package also owns a small pnpm patch to SvelteKit 3-next.27 so its route scanner accepts mobile siblings. Both pins must be reviewed when updating Svelte or SvelteKit.

The pinned compiler currently requires boundary failure snippets to be declared outside `<svelte:boundary>` and passed with `{failed}`. Svelte DOM transitions, arbitrary third-party React widgets and Svelte DOM libraries are not automatically adapted. Extend the internal host registry for an actual native component when needed. Physical Android has been exercised. Unsigned iOS device compilation is separate from a physical iPhone runtime pass.

pnpm reports Svelte peer-range warnings for the compiler's URL dependency even though its package version is 5.56.7. The compiler/runtime pin is intentional; changing it requires native compilation and device checks.

`bun test tests/renderer.test.ts` exercises compiled reactive updates, keyed identity, conditional removal, event delivery and effect disposal. `pnpm typecheck` validates the public primitives and tooling.

The foundation port was exercised on a physical Samsung SM-A165F (Android API 36), including a standalone release with Metro stopped: login validation, onboarding, profile and photo updates, email verification, device revocation, Arabic/English preferences, workspace creation/deletion, account deletion, session retention, deep links and startup retry. Browser login, onboarding, workspace creation and profile saving were also checked. Hermes exports contain bytecode version 98 and source maps with the original Svelte source contents.
