# @alfayez/svelte-native

Svelte 5 components that run as native Android and iOS apps. The components are compiled by a pinned Svelte compiler, run in Hermes, and drive React Native's Fabric shadow tree and Yoga directly. There is no React reconciler, no React Native component layer and no WebView. The build and release pipeline stays Expo: `expo prebuild`, config plugins, autolinking, Gradle and CocoaPods, EAS Build, EAS Submit and EAS Update.

On Android the mounting is the package's own engine: Fabric's C++ transaction goes to typed Kotlin views instead of React Native's Java mounting. On iOS React Native's mounting is kept and the package adds its own UIKit navigation, sheets, tabs and toolbar. The engine is specified in [native/svelte-engine/SPEC.md](native/svelte-engine/SPEC.md); this file is the way in, [REFERENCE.md](REFERENCE.md) holds the detail of the JavaScript side, [CHANGELOG.md](CHANGELOG.md) what changed, and [PLAN.md](PLAN.md) what was measured and what is open.

## Supported platforms

| | Exercised on | Notes |
|---|---|---|
| Android | Samsung SM-A165F (Android 16, 90 Hz), an API 36 emulator (x86_64) | arm64 and x86_64 builds; phones only, no tablet or foldable layouts |
| iOS | iPhone SE 3rd generation (iOS 26.6, 60 Hz) | phones only; the Android-only engine pieces (view pool, overlay modal, foreign-view split) do not apply |
| Web | the same app builds for browsers through SvelteKit | separate target: `+page.svelte` for browsers, `+mobile.svelte` for native |

It targets Expo SDK 57 and React Native 0.86.3 with Hermes, Reanimated 4.5.1, react-native-worklets 0.10.1 and react-native-gesture-handler 2.32. The Svelte compiler is Svelte's [unmerged custom-renderer pull request](https://github.com/sveltejs/svelte/pull/18042), pinned to commit `216f258068d93170a927ad4d27ee6864b0b305c5` (5.56.7). The package names it as a peer dependency, `svelte` 5.56.7 **with the `./renderer` export**, which the registry's 5.56.7 does not have; the repository vendors the build as `vendor/svelte-5.56.7-216f258.tgz`, and the package and the example app install that tarball by `file:` (a development dependency here, so a dependent never sees it). The library carries pnpm patches for SvelteKit, `expo-modules-core`, Reanimated, worklets, and gesture-handler, and for four of the view libraries it wraps (`react-native-pdf`, `react-native-video`, `react-native-maps`, `lottie-react-native`; `patches/`); an app that installs the package applies them itself ("Install in an app"). Svelte's compiler is not patched: the custom-renderer build refuses `transition:`, `in:`, `out:` and `animate:` on native elements, and the Metro transformer removes the two refusals from the compiler's sources as it loads them (`module.registerHooks`, Node 22.15 or newer; the app's range is 22.17 or newer). Svelte's `transition:`, `in:`, `out:` and `animate:` play on native elements, on the UI thread ("Animation"); write them on HTML elements (`<div in:fly>`), which svelte-check accepts: on a component such as `<View in:fly>` Metro compiles the directive, but svelte-check reports it (a directive on a component). Unsupported: libraries that need the DOM, React widgets, the Expo dev client, Fast Refresh (a save remounts the root; see "Development loop"), tvOS, and tablet layouts (not exercised).

## Install in an app

This section and the next two are the reference for what an app needs. To start an app, follow the [guide](../../docs/10-getting-started/10-introduction.md): `npx sv create`, `pnpm add` of the library, then `pnpm exec svelte-native init`, which does the steps below for you (and `init --dry-run` prints what it would do). To add the library to an Expo app you already have, see [its page](../../docs/60-appendix/10-adding-to-an-existing-expo-app.md).

The package is private. An app outside this repository depends on a tag of it through pnpm's git dependency, over SSH, naming the package's directory. [`examples/minimal`](../../examples/minimal) is the smallest app that does everything below (copy it to start); `scripts/consumer-check.sh` installs and builds it from a scratch directory outside the repository, once with the library as a packed tarball and once as a git dependency of the repository's own commit.

```sh
pnpm add "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native" \
         "svelte@https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5"
```

```json
{
  "dependencies": {
    "@alfayez/svelte-native": "git+ssh://git@github.com/AlfayezDev/svelte-native.git#<tag>&path:packages/svelte-native",
    "svelte": "https://pkg.pr.new/svelte@216f258068d93170a927ad4d27ee6864b0b305c5"
  }
}
```

`<tag>` is any tag, branch or commit of the repository, and the lockfile records the commit it resolved to. Any other repository URL takes the same `#<ref>&path:packages/svelte-native` suffix (`git+file:///path/to/checkout#<commit>&path:packages/svelte-native` is what the check script installs).

**Node.** An app runs on Node 24 LTS (24.3 or newer), Node 22.17 or newer, or Node 26 or newer (`svelte-native doctor` checks it); not Node 25. React Native 0.86.3 allows Node 25, but asks for `@react-native/metro-config` by a range, so a fresh install takes 0.88, whose tools exclude it, and pnpm stops with `ERR_PNPM_UNSUPPORTED_ENGINE` at the first `pnpm add` (the `engineStrict: true` that `sv create` writes), before `svelte-native init` can pin the package to React Native's version. The library's Node-side code ships as JavaScript, so an app needs no TypeScript in Node. This repository's own tools (its scripts and tests run TypeScript through Node) need Node 25 or newer, which is the repository's requirement and not an app's.

**A machine that reaches the repository only over SSH needs one git setting.** pnpm resolves a `github.com` git dependency over HTTPS whatever the specifier says (`git+ssh://git@github.com/…` included): `pnpm add` writes `github:AlfayezDev/svelte-native#<tag>&path:packages/svelte-native` to `package.json` and `https://github.com/AlfayezDev/svelte-native.git` to the lockfile, so that the lockfile works on every machine. Where git can read the private repository only with an SSH key, `pnpm add` stops with `ERR_PNPM_GIT_RESOLVE_FAILED` and a later `pnpm install` with `ERR_PNPM_GIT_FETCH_FAILED` (`could not read Username for 'https://github.com'`). Tell git to use SSH for this account's repositories, once (pnpm's own advice, narrowed to this account):

```sh
git config --global url."git@github.com:AlfayezDev/".insteadOf "https://github.com/AlfayezDev/"
```


A release is a tag with its [changelog](CHANGELOG.md) entry. What `pnpm install` copies is the package as `files` packs it (`pnpm pack` lists it): `src/` (TypeScript that Metro compiles), `dist/node/` (the JavaScript that Node itself loads, built from `src/`; see "Set up an app"), `native/` (the library's native modules), `expo-module.config.json`, `patches/` and the documents. Nothing is built at install time and nothing outside the package directory is needed: pnpm builds nothing for a git dependency, and refuses one whose `package.json` has a `prepare`, `prepack` or `prepublish` script (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`, until the app lists it under `allowBuilds`, and then it installs the package's development dependencies and runs the script in a clone), so `dist/node/` is committed and the package has no such script (a test checks both).

- **Svelte.** The renderer needs [the custom-renderer build](https://github.com/sveltejs/svelte/pull/18042), not the registry's `svelte`, whose 5.56.7 has the same version string and no `./renderer` export. Install it from pkg.pr.new (above), or from the tarball the repository vendors (`vendor/svelte-5.56.7-216f258.tgz`, byte for byte the same build: `pnpm add ./svelte-5.56.7-216f258.tgz`, which writes `"svelte": "file:./svelte-5.56.7-216f258.tgz"`). The package declares `svelte` as a peer dependency (`5.56.7`), so a package manager that finds another build warns, and pnpm reports the URL or `file:` build as an unmet peer (`pnpm peers check`); that warning is expected. `withSvelteNative` (Metro), the Metro transformer and the native target of `svelteNative()` (Vite) check the installed package for `./renderer` and fail with the same instructions. The web target of SvelteKit runs on the same build.
- **Dependencies of the app.** Next to the library and `svelte`, the app's `package.json` lists the peers that are not optional, at the versions it was exercised on:
  - `expo` 57.0.30 and `expo-constants` 57.0.22 (the peer ranges are `~57.0.27` and `~57.0.21`), `react` 19.2.7 and `react-native` 0.86.3;
  - `react-native-gesture-handler` 2.32.0, `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1, exactly: a patch (below) is for one version;
  - `hermes-intl` ^0.1.2, a dependency of the app itself: the polyfills import it for the `Intl` constructors Hermes lacks (`PluralRules`, `RelativeTimeFormat`, `ListFormat`, `Locale`), Metro stops with `Unable to resolve module hermes-intl` without it, and it carries a native module that React Native's autolinking links only from the app's own dependencies (`svelte-native doctor` checks both).

  `@sveltejs/kit` (3.1.1 exactly) and `vite` are **optional**: remote functions and the web target need them (SvelteKit's client runtime is reused, and the Vite plugin runs the web build). An app that builds for native only installs neither, and the Metro plugin, the transformer and the runtime load and bundle without them; a feature that does need SvelteKit fails with a message that names the package.

  The view-library wrappers are optional peers: install the ones the app uses with `npx expo install <name>`, and declare their patches if they have one (`lottie-react-native`, `react-native-maps`, `react-native-pdf`, `react-native-video`).
- **`package.json` entries.** `"main": ".svelte-native/entry.ts"`, the file `svelte-native sync` (and the Metro config) writes; without it Expo falls back to `expo/AppEntry.js`, which is not the library's entry. And Reanimated's feature flag, which its package ships off:

  ```json
  { "reanimated": { "staticFeatureFlags": { "ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS": true } } }
  ```

  The patched Android update (the native sink of the engine's animation write path) is reached only through the synchronous update this flag turns on; the QA app sets it and the animation numbers in [PLAN.md](PLAN.md) were measured with it.
- **pnpm settings.** pnpm 12 reads them from the app's `pnpm-workspace.yaml` (an app that is not a workspace has the file with these keys only):

  ```yaml
  allowBuilds:
    esbuild: true              # a dependency of the package; pnpm 12 stops with ERR_PNPM_IGNORED_BUILDS until its install script is allowed
  overrides:
    expo-modules-core: 57.0.23 # expo asks for ~57.0.23, so a fresh install takes the newest 57.0.x, which the patch below is not for
    "@react-native/metro-config": 0.86.3 # react-native asks for it by a range, so a fresh install takes 0.88 beside React Native 0.86.3 (Metro 0.87, tools that exclude Node 25)
  ```

  Without the first override a fresh install takes 57.0.25 and pnpm stops with `ERR_PNPM_UNUSED_PATCH`; `svelte-native doctor` reports a different version of `expo-modules-core` with this fix. The second is React Native's version (the one in `dependencies`): without it the install takes `@react-native/metro-config` 0.88 and Metro 0.87, whose engines exclude Node 25 (see "Node" above).

  The `patchedDependencies` entries go in the same file ("Apply the patches").
- **Native modules.** Nothing is copied into the app. The package's `expo-module.config.json` links six native projects through Expo's autolinking (Android Gradle projects `:svelte-engine` and `:svelte-updates`; iOS pods `SvelteScreensIOS`, `SvelteInsets`, `SvelteNavigation`, `SvelteCapture`, `SvelteUpdates`), so `expo prebuild` and `pod install` find them in `node_modules/@alfayez/svelte-native/native/`. Keep the app's own Expo modules in its `modules/` directory as usual.
- **Patches.** The patches the library relies on are in the package's `patches/` directory; "Apply the patches" below says how an app copies and registers them (`patchedDependencies`), and `pnpm exec svelte-native doctor` checks the result.
- **App config.** The Metro, Vite and Expo wiring is the one in "Set up an app" below; run `npx expo prebuild` after the first install and after a native dependency or a plugin option changes.
- **CI.** Declaring the patches changes the lockfile, and with `CI=1` pnpm refuses a frozen install of a lockfile that does not match: run `pnpm install --no-frozen-lockfile` once and commit `pnpm-lock.yaml`.

## Set up an app

[`examples/minimal`](../../examples/minimal) is the smallest working app: a root layout, a home screen and a screen pushed on top of it, with the `app.json`, `metro.config.cjs` and `pnpm-workspace.yaml` below. It is its own pnpm workspace and imports nothing from this repository by path. `apps/example` is the showcase (a screen for each feature) and `apps/qa` the QA app; both link the library through their workspace dependency, as an app outside the repository does.

```ts
// vite.config.ts: browser and native share one config
plugins: [svelteNative({ target: mode === "native" ? "native" : "web", kit: { /* … */ } })]
```
```js
// metro.config.cjs
const { getDefaultConfig } = require("expo/metro-config");
const { withSvelteNative } = require("@alfayez/svelte-native/metro");
module.exports = withSvelteNative(getDefaultConfig(__dirname));
```
```json
// app.json
{ "expo": { "plugins": ["@alfayez/svelte-native"] } }
```
```ts
// or app.config.ts, with options
plugins: [["@alfayez/svelte-native", { autolinkingExclude: [], androidOnDemandViewManagers: {} }]]
```

Name the plugin by the package's own name, as for any Expo library: the package has an `app.plugin.js` at its root, which Expo looks for before the package's main entry. `@alfayez/svelte-native/expo` is the same plugin by its path and keeps working (an `app.json` or `app.config` that names it is fine). No `babel.config.js` is needed: Expo's default preset gives the same bundle (checked byte for byte). The app needs `src/routes/+layout.mobile.svelte` (the generated entry imports it as the app shell) and at least one `+mobile.svelte`.

Run the commands as `pnpm exec svelte-native <command>`, or from `package.json` scripts (`"android": "svelte-native android"`):

```sh
svelte-native dev --port 8081   # writes the generated entry and the route table, starts Metro
svelte-native android --device  # expo run:android
svelte-native ios --device      # expo run:ios
svelte-native build --platform ios   # export Hermes bytecode without building the host
svelte-native sync              # only regenerate .svelte-native/
```

**No TypeScript loader is needed in the app.** The package ships TypeScript, and Node refuses to run TypeScript from under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, Node 25 and 26). So the entries a Node process loads are built to JavaScript in `dist/node/`, and `package.json` points them there (`types` stays the `.ts` source); the entries Metro compiles stay TypeScript:

| Entry | Loaded by | Shipped as |
|---|---|---|
| `svelte-native` (the bin) | the shell, `pnpm exec`, an npm script | `dist/node/cli.js` (ES module, shebang) |
| `@alfayez/svelte-native/metro` | `metro.config.cjs`, which `require`s it | `dist/node/metro.cjs` |
| `@alfayez/svelte-native/transformer` | Metro's workers (`babelTransformerPath`, which `withSvelteNative` sets) | `dist/node/transformer.cjs` |
| `@alfayez/svelte-native/expo`, and the bare `@alfayez/svelte-native` (Expo's lookup of a package's `app.plugin.js`) | `@expo/config` and `expo prebuild`, which `require` the plugin | `dist/node/expo.cjs` (`app.plugin.js` re-exports it) |
| `@alfayez/svelte-native/vite` | Vite, which imports the plugin from `node_modules` natively | `dist/node/vite.js` (ES module) |
| `@alfayez/svelte-native/lower` | Node, for a tool that lowers `.svelte` files | `dist/node/lower.js` (ES module) |
| `@alfayez/svelte-native/routes` | the web build (the table is empty there); Metro resolves it to the generated table | `dist/node/routes.js` (empty) |
| `.` and every other entry (`/core`, `/router`, `/fabric`, `/renderer`, `/animation`, `/gestures`, `/foreign`, `/svg`, `/updates`, `/remote`, `/native-modules`, `/platform`, `/polyfills`, `/init`) | Metro, which compiles them with the app (they import `react-native`) | `src/*.ts` |

The built files are bundles of the Node-side code (the command line, the route generator, the Metro integration, the remote function transform, the doctor) with every package left as an import: they use the app's `svelte`, `expo`, `@sveltejs/kit` and the package's own dependencies, and name the runtime files Metro compiles (`src/fabric/…`) by path into the installed package.

Generated files live in the ignored `.svelte-native/`: the entry and one route table per variant (`routes.<variant>.ts`, from `APP_VARIANT`; `routes.app.ts` for an app that sets none). A change to native dependencies, to the config plugin options or to a patch needs a native rebuild; a change to Svelte code does not. Details of the plugin, Metro options and variants: [REFERENCE.md](REFERENCE.md#integration).

## Add a screen

A screen is `src/routes/<path>/+mobile.svelte`, next to the browser's `+page.svelte`. Route groups `(group)`, `[param]`, `[[optional]]` and `[...rest]` work; parameter matchers do not.

```svelte
<script lang="ts">
  import { Screen, View, Text, TextInput, Pressable, useRouter } from "@alfayez/svelte-native";
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

- Use native style objects (`style={{ padding: 24 }}`); there is no CSS. Primitives: `View`, `Text`, `TextInput` (`bind:value`), `Pressable` (`onPress`, `onPressChange`, `hitSlop`; `View` and `Text` take the same handlers), `ScrollView`, `Image`, `Switch`, `ActivityIndicator`, `Modal`, `SafeAreaView`, `KeyboardAvoidingView`, `List`. At build time `View`, `Text`, `ScrollView`, `Image`, `ActivityIndicator` and `Pressable` are lowered to host tags, so a row costs host nodes and no component instances. HTML elements work too, in the app's own files: `div`, `p`, `button`, `a`, `img`, `input`, `textarea`, `dialog` and the rest of the table in `docs/20-core-concepts/50-html-elements.md` become the same host tags and the `TextInput`, `Switch` and `Modal` components when the app is built for a device (never for the web), so one file can serve SvelteKit and the phone.
- `router` is the nearest navigator's: `goto(href, { reset?, replaceState?, presentation? })`, `back()`, `current`, `entries`. `goto` resolves over the whole tree and never stacks the same screen twice. A link the app was launched with becomes the stack's base; later links are plain `goto`s.
- `ref` callbacks follow React's contract: the handle when the element is built, `null` when it is destroyed, and the old callback gets `null` before a new one gets the handle. `ScrollView` and `TextInput` handles have `scrollTo`, `focus`, `blur`, `measure`, `dispatchCommand`.
- `export const presentation = "modal"` in the module script (a literal: `push`, `modal`, `transparentModal`, `sheet`, `formSheet`) sets how a page enters.
- Runes, stores, context, snippets, `{#await}`, `<svelte:boundary>` and `.svelte.ts` modules work. Components are compiled in runes mode (below). Keep shared validation and domain logic in portable modules; native screens call explicit network boundaries.

Long lists use `List`, which mounts only the rows near the viewport:

```svelte
<List items={rows} rowHeight={56} keyOf={(row) => row.id}>
  {#snippet row(item)}<Text>{item.title}</Text>{/snippet}
</List>
```

Fixed `rowHeight`, measured rows (`estimatedRowHeight`), `rowHeights`, `horizontal`, `initialScrollIndex`, `header`, `footer`, `empty`, `onEndReached` and `onViewableItemsChanged` are in [REFERENCE.md](REFERENCE.md). An unvirtualized list of hundreds of rows costs one long mount frame.

### Coming from Svelte on the web

- **Runes are the default.** The library compiles every component of the app in runes mode, also a component with no rune in it, where Svelte alone would infer legacy mode from the file. Legacy mode makes a variable the markup mutates reactive state, even a `const`, and a worklet that captures it crashes the screen on the device. A file opts out with `<svelte:options runes={false} />`. Svelte libraries below `node_modules` keep Svelte's own default (runes inferred per file), so a third-party component written in the legacy syntax still compiles; this library's own components are always runes. An app that is migrating legacy components turns the default off with `withSvelteNative(config, { runes: false })` in `metro.config.cjs` and `svelteNative({ runes: false })` in `vite.config.ts`, and Svelte infers the mode of each file again. The web target gets the default too, so a component both targets import means the same on each ([REFERENCE.md](REFERENCE.md#runes-mode)).
- **`Text` keeps whitespace as written**, as React Native's does; a browser collapses it with CSS and there is none here. A sentence split across source lines shows the line break and the next line's indent. Write a long sentence on one source line, or as a string, `<Text>{"one long string"}</Text>` ([REFERENCE.md](REFERENCE.md#text-and-whitespace)).

## Platform modules

`@alfayez/svelte-native/platform` exports React Native's JavaScript-only modules, typed, for an app without React: `Platform`, `Appearance`, `Dimensions`, `Linking`, `Keyboard`, `AppState`, `BackHandler`, `PixelRatio`, `Share`, `Vibration` and `Alert`. They are React Native's own objects (the instances `react-native` exports, reached by the path of each module because the `react-native` index would load React's components too), so state is shared with libraries that import them from the index. Importing the entry loads none of them: each loads when a property is first read, and a function read from one is bound to it.

```svelte
<script lang="ts">
  import { Appearance, Dimensions, Linking, Platform } from "@alfayez/svelte-native/platform";
  let scheme = $state(Appearance.getColorScheme());
  Appearance.addChangeListener((preferences) => { scheme = preferences.colorScheme; });
  const width = Dimensions.get("window").width;
  const label = Platform.select({ ios: "iPhone", android: "Android phone" });
</script>
```

The types are `react-native`'s own, except `Platform`, which is narrowed to the two systems the library runs on (`Platform.OS` is `"ios" | "android"`, and `Platform.Version` is a string on iOS and a number on Android once `OS` is checked). No declaration of the app's own is needed, and none for the modules the library itself imports by path: its public declaration files carry them ("Type checking an app" in [REFERENCE.md](REFERENCE.md#type-checking-an-app)).

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
  import { Tabs } from "@alfayez/svelte-native";
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

`@alfayez/svelte-native/gestures` puts react-native-gesture-handler on Svelte views: its recognisers and arbitration unchanged, its `Gesture.Pan()`, `Tap()`, `Pinch()`, `Rotation()`, `Fling()`, `LongPress()`, `Native()` and `Manual()` builders and `Race`/`Simultaneous`/`Exclusive` as they are. The app wraps nothing.

```svelte
<script lang="ts">
  import { AnimatedView, createSharedValue, withSpring } from "@alfayez/svelte-native/animation";
  import { Gesture } from "@alfayez/svelte-native/gestures";
  const x = createSharedValue(0); // first: it loads Reanimated
  const pan = Gesture.Pan()
    .onUpdate((e) => { x.value = e.translationX; })  // a worklet, on the UI thread
    .onEnd(() => { x.value = withSpring(0); });
</script>
<AnimatedView gesture={pan} style={{ width: 96, height: 96 }} animatedStyle={() => { "worklet"; return { transform: [{ translateX: x.value }] }; }} />
```

`gesture={g}` works on `View`, `Pressable`, `ScrollView`, `AnimatedView`, `Image`, `Text` and host tags; `<GestureDetector>` and `use:gesture` are the same. Callbacks that are all worklets run on the UI thread; any plain callback or `.runOnJS(true)` moves the whole gesture to the JavaScript thread. A UI callback can capture shared values, numbers, strings and plain objects, not `$state`, `$derived` or `$props`: development builds throw naming the variable. A swipeable row or a carousel needs an accessibility alternative of its own (a button or `accessibilityActions`); a view that only carries a gesture is not an accessibility action. Not supported: RNGH's component API (`Swipeable`, `DrawerLayout`, the buttons), `Gesture.ForceTouch`, the web. Contract and arbitration rules per platform: SPEC "Gestures (react-native-gesture-handler)"; usage detail: [REFERENCE.md](REFERENCE.md#gestures).

## Animation

`@alfayez/svelte-native/animation` adapts Reanimated: `AnimatedView` with `animatedStyle` or `animatedProps` worklets, `createSharedValue` (cancelled when the component is destroyed), `withTiming`, `withSpring`, `withRepeat`, `withSequence`, `withDelay`, `runOnUISync`/`runOnUIAsync`, entering/exiting/layout animations. Svelte's own `transition:`, `in:`, `out:` (`svelte/transition`: `fade`, `fly`, `scale`, `slide`, `blur` without its filter, and transitions of your own) and `animate:flip` work on native elements as on the web, and play on the UI thread through the same path (the patch to Svelte's compiler above; opacity, transforms, lengths and colours; see the CHANGELOG). `AnimatedView` also takes Reanimated's CSS animation and transition style keys without a worklet; those run in C++ on the UI thread and are the cheaper choice for repeating or decorative motion. Read Svelte state on the JavaScript side and write the target into a shared value; a worklet cannot read a signal. Reanimated and worklets load on first use. See [REFERENCE.md](REFERENCE.md#animation) and SPEC "Animated write path".

## Native views from other libraries

`@alfayez/svelte-native/foreign` mounts views other libraries own inside the tree, and `@alfayez/svelte-native/svg` is react-native-svg as Svelte components. None imports the library's React code, and none loads at boot unless the app imports it. Install the libraries you use (`npx expo install <name>`; they are optional peer dependencies) and rebuild the native host.

| Library | Components |
|---|---|
| expo-image, expo-blur, expo-linear-gradient, expo-conic-gradient | `ExpoImage`; `ExpoBlurView`, `BlurTargetView`; `LinearGradient`; `ConicGradient` |
| react-native-video, expo-video, lottie-react-native, rive-react-native | `Video`; `VideoView`; `LottieView`; `Rive` |
| @react-native-community/datetimepicker | `DateTimePicker` (iOS), `openDatePicker` (Android dialog) |
| react-native-pdf, react-native-view-shot | `Pdf`; `captureRef`, `ViewShot` |
| react-native-webview, react-native-maps | `WebView`; `MapView`, `Marker` |
| react-native-fast-shadow, react-native-animateable-text | `ShadowedView`, `shadowStyle`; `AnimateableText` |
| react-native-svg 15.15.4 | `Svg`, shapes, text, gradients, filters, `SvgXml`, `SvgUri` (36 components) |

The library has its own blur, `BlurView`, which needs no package (a native module of the library, `native/svelte-blur`): `intensity` and `tint`, children on top. `ExpoBlurView` is expo-blur's.
| any other Expo module's view | `ExpoView`, `defineExpoView` mount it by the module's name, with the module's own props |
| anything else | `ForeignView` mounts a Fabric component by name |

An Expo library that has no component above (`expo-camera`) needs no wrapper written for it. `defineExpoView` makes a component of a module's view once; the view's props and events are read from the native module at run time, and `ref` gives the host handle with the functions the module defines for the view, as Expo's React adapter does:

```svelte
<script lang="ts">
  import { Pressable, Text } from "@alfayez/svelte-native";
  import { defineExpoView, type ExpoViewHandle } from "@alfayez/svelte-native/foreign";
  import type { CameraNativeProps, CameraViewRef } from "expo-camera";

  const CameraView = defineExpoView<CameraNativeProps, CameraViewRef>("ExpoCamera");
  let camera: ExpoViewHandle<CameraViewRef> | null = null;
</script>

<CameraView facing="back" barcodeScannerEnabled={false} style={{ flex: 1 }} ref={(handle) => (camera = handle)}
  onMountError={(event) => console.warn(event.nativeEvent.message)} />
<Pressable onPress={async () => console.log((await camera?.takePicture({ quality: 1 }))?.uri)}><Text>Take a picture</Text></Pressable>
```

The component is the native view, not the library's React component: its props are the names the native module declares, an `on…` handler gets React Native's event object (`{ nativeEvent }`), and a shared object (an `expo-video` player) is given as its id. A library whose React component changes what it is given before the view sees it still needs that step done by the app: `expo-camera`'s `CameraView` maps `flash` to the native `flashMode`, `autofocus` to `autoFocus` and always sends `barcodeScannerEnabled` (from `onBarcodeScanned`; on Android that prop is what starts the camera, so the example gives it), and `expo-linear-gradient` converts its colours. That is why the dedicated components above stay, and why the example types the native props (`CameraNativeProps`), not `CameraViewProps`. A view function that only normalises its options in JavaScript (`takePictureAsync`) is not on the handle; call the native one (`takePicture`). `<ExpoView module="ExpoCamera" ... />` is the same without the typing, for one place. [REFERENCE.md](REFERENCE.md#foreign-views) has the props, the handle and the errors.

A touch inside a foreign view goes to the view and not to JavaScript (`pointerEvents="box-only"` keeps the frame's touches for JavaScript). Foreign views work inside list rows and sheets.

On Android, React Native's event queue replaces an unread event of one name with the next one from the same view while JavaScript is busy, unless the event class opts out. Four of the libraries sent events that must not be replaced (a PDF's `onLoadComplete` was overwritten by the `onPageChanged` that follows it, so 28 of 182 row mounts on the emulator raised no load event), and the repository's pnpm patches make those events non-coalescable: pdf, video, Lottie and maps (progress, bandwidth and the other streams still coalesce). An app that is not this repository must carry the same patches (`patches/react-native-pdf@7.0.3.patch`, `react-native-video@6.19.3.patch`, `react-native-maps@1.27.2.patch`, `lottie-react-native@7.3.8.patch`); a test reads each installed package and fails when a version no longer has the shape the patch was written for. Rive needs none (its events leave through React Native's interop emitter, which never coalesces), and iOS cannot lose them. SPEC "Foreign views", "Events on Android" has the mechanism and the lab checks that prove it both ways. Props, events, what is not ported and the verification of each library: SPEC "Foreign views" and [REFERENCE.md](REFERENCE.md#foreign-views).

## Native modules

Use a native module the way React Native's JavaScript does, without React:

```ts
import { turboModule, nativeModule } from "@alfayez/svelte-native/native-modules";
import { requireNativeModule } from "expo-modules-core";

const blobUtil = turboModule<{ getConstants(): object }>("ReactNativeBlobUtil"); // a TurboModule by name; throws if none
const legacy = nativeModule<{ ping(): void }>("MyLegacyModule");                   // a legacy NativeModule; undefined if none
const fileSystem = requireNativeModule("ExpoFileSystem");                          // Expo modules as usual
```

Libraries whose own JavaScript needs React cannot be imported; call their native module by name, as the wrappers do. The example app proves that the native libraries a production app uses load under this host: a smoke app (`APP_VARIANT=smoke`, `io.example.svelteqa.smoke`) loads 35 native libraries (the libraries of a real production app on Expo SDK 57; 34 on the Samsung phone, where the Huawei location module is skipped) and `pnpm native-qa smoke` fails when one stops loading. The example's production and QA variants link none of those libraries. SPEC "Native modules (smoke test)" lists each module and what it needed.

## Updates

`@alfayez/svelte-native/updates` is `expo-updates` reduced to what this host needs, compatible with `eas update` (manifest protocol 1, assets, rollback directives). The app config's `updates` and `runtimeVersion` keys are the ones Expo's plugin already writes.

```ts
import { checkForUpdateAsync, fetchUpdateAsync, reloadAsync, isEnabled } from "@alfayez/svelte-native/updates";
if (isEnabled && (await checkForUpdateAsync()).isAvailable) { await fetchUpdateAsync(); await reloadAsync(); }
```

A build made for a channel (`UPDATES_CHANNEL`, sent as `expo-channel-name`) checks once after the first commit and downloads the newest update; it launches on the next start. A launch is confirmed only after a healthy window (the first idle callback, 3 s after the first commit, no fatal error): an update that throws in its first seconds is marked failed at the next start, which runs the previous update or the embedded bundle, and a launch that was merely killed does not blacklist a good update the first time. Development builds and builds without a channel never check. On iOS a failing update needs two unconfirmed launches. SPEC "Updates" has the protocol coverage, the store, launch selection and the end-to-end procedure on a QA channel.

## Remote functions

SvelteKit's remote functions (`query`, `query.batch`, `query.live`, `command`, `form`, `prerender`) work in native Svelte code the way they do on the web: import the `*.remote.ts` module and call its functions. What comes back is SvelteKit's own client API (`.current`, `.loading`, `.error`, `.refresh()`, `.set()`, `.withOverride()`, `command(...).updates(...)` and single-flight mutations, `form.fields` with `.value()`, `.set()`, `.issues()`, `.pending`, `.result`, `.for(id)`, `.preflight()`, `.enhance()`, Standard Schema validation, live streams, `error()` and `redirect()`), and the server is the SvelteKit server of the web app, unchanged: it answers `/_app/remote/…` for the browser and for the phone alike.

```svelte
<script lang="ts">
  import { TextInput, Switch, Pressable, Text } from "@alfayez/svelte-native";
  import { native } from "@alfayez/svelte-native/remote";
  import { getPosts, addPost } from "#lib/posts.remote";   // the module the web page imports
  const posts = getPosts();                               // a query: await it, or read posts.current
  const form = native(addPost);                           // the same object, typed for native inputs
</script>

{#each posts.current ?? [] as post (post.id)}<Text>{post.title}</Text>{/each}
<TextInput {...form.fields.title.as("text")} accessibilityLabel="Title" />
<Switch {...form.fields.pinned.as("checkbox")} />
<Pressable onPress={() => form.submit()}><Text>Add</Text></Pressable>
```

**Set up.** The package peer-depends on `@sveltejs/kit` 3.1.1 exactly, optionally (it reaches into the package's `src/`; a new version is reviewed first, see below; install it to use remote functions, an app without them has none) and on `expo-constants`. On the server, `experimental: { remoteFunctions: true }` in the SvelteKit options, and every remote module in the server's graph: a module no web page imports is not known to the server (in `vite dev` it is registered when first loaded: list it in `server.warmup.ssrFiles`; in a build, import it from `hooks.server.ts`). In the app config, the host:

```ts
// app.config.ts
plugins: [["@alfayez/svelte-native/expo", { remote: { origin: "https://app.example.com" /*, base: "/prefix", appDir: "_app" */ } }]]
```

`base` and `appDir` are SvelteKit's `paths.base` and `appDir` when they are not the defaults. Metro needs no setting: `withSvelteNative` resolves the remote function runtime, and the transformer turns `*.remote.ts` into stubs. `configureRemote({ origin, base, appDir, transport, handleError, fetch, goto })` (from `@alfayez/svelte-native/remote`) overrides the config and sets what the web's `hooks.ts` sets: pass the same `transport` object as the browser's universal hooks for custom types, and the client `handleError`. `remoteHost()` is the host in effect and `refreshAll()` refetches every query and reconnects every live query a screen holds.

### What was decided, and why

- **The host is in the app config, read at run time.** `extra.svelteNative.remote` (written by the plugin's `remote` option, which validates it when the config is evaluated and, for an `http:` origin, lets the Android and iOS builds use plain HTTP to it) is embedded by `expo-constants` and read when the first remote function is called. Inlining it at bundle time would make the bundle differ per build and keep an `eas update` bundle from running against another build's host; the embedded config is per build, as the host should be, and `app.config.ts` can set it per variant (`SVELTE_NATIVE_REMOTE_ORIGIN`, the QA app; the product accepts `https:` only). A build with no host throws `RemoteConfigError` ("No SvelteKit host is configured … set `extra.svelteNative.remote.origin`") from the *call* of any remote function, not from the import and not as a failed request.
- **The ids are SvelteKit's.** The Vite plugin names a remote module by `hash(path from the project root)` and calls `<hash>/<export>`; Metro's transformer computes the same hash (`remote/transform.ts`, a copy of `utils/hash.js`, tested against SvelteKit's own function and against a running server) from the same path, with the Metro project root as the root (`vite.config.ts` and `metro.config.cjs` in one directory, as in `apps/qa`). SvelteKit learns a module's exports and kinds by running it; Metro cannot run server code, so they are read from the source: every export must be `export const name = query(…) | query.batch(…) | query.live(…) | command(…) | form(…) | prerender(…)` with those imported from `$app/server` (an `export { x as y }` of such a constant is fine; `export *`, re-exports and helpers that build remote functions are refused with the file and line).
- **SvelteKit's client runtime is reused, not copied.** `query`, `query.batch`, `query.live`, `command`, `prerender`, the query cache, the live stream and its reconnect rules, `remote_request`, the devalue payloads and `.updates` bookkeeping are SvelteKit's files (`@sveltejs/kit/src/runtime/client/remote-functions/*`, `runtime/shared.js`, `runtime/form-utils.js`, 3.1.1), compiled by Metro with the rest. What they import from a browser app is shimmed (`remote/shims/`): `#app/paths`, `#app/state/client` (`page.url` is the router's current URL), `$app/env`, and the router client (`client.js`: the query maps, `goto`, `refreshAll`, `handle_error`). **Nothing is installed on `globalThis`.** The globals those files use and a phone lacks or has with other behavior are module-scoped names: the transformer appends an import of them, from `remote/globals.ts`, to the SvelteKit files that use them (`fetch`, `location`, `navigator`, `window`, `FinalizationRegistry`, `WeakRef`, `__SVELTEKIT_DEV__` to the files of `client/remote-functions`; `Blob` to `form-utils.js`; `btoa` and `atob` to `runtime/utils.js`), so the rest of the app sees the same globals as before. `WeakRef`, `btoa` and `atob` are the engine's own (Hermes 0.17 has them); the package's stand-ins are used only where the engine has none. The only port is `form` (below). `remote/transform.ts` records, in `SHADOWS` and `remoteResolution`, every place the package reaches into SvelteKit. The on-device SvelteKit files are found as the closure of imports from what the runtime imports, and a test fails when an update makes any of them use a browser global that is neither given nor known to be there, or changes `form.svelte.js` (pinned by hash, so the port is compared with it first); the peer range of `@sveltejs/kit` is the one version that was reviewed.
- **Transport.** Requests go through Expo's `fetch` (it streams a response body on Android and on iOS, which React Native's does not), to the configured origin, with `credentials: "include"`: the cookie jar is the platform's (on Android the one React Native's networking and WebViews share, on iOS `HTTPCookieStorage`), so a session cookie a command sets (`cookies.set`) reaches the next call. Every request that is not a GET carries `Origin: <the configured origin>`. SvelteKit refuses a remote call whose `Origin` differs from its own origin (`is_remote_forbidden`; production only, `trusted_origins` does not apply to remote calls), so the origin in the app config must be the one the server sees (`paths.origin`, or the `Host` behind your proxy): nothing on the server is weakened. The screen's path and query go as `x-sveltekit-pathname`/`-search`, so `getRequestEvent().url` is the screen. Redirects are not followed (`redirect: "error"`): SvelteKit answers a remote call itself (its `redirect()` is a JSON answer), and a 3xx from a proxy or a hook would send the session cookie where it points, so it fails the call instead.
- **`query.live`** is SvelteKit's `create_live_iterator` on the streaming `fetch`: Server-Sent Events, values replace each other, a stream that ends is `done`, a dropped connection reconnects with SvelteKit's backoff, and `reconnect()` works. `navigator.onLine` is always true (a phone cannot tell, and a live query would stop retrying on `undefined`), and the page lifecycle is the app's: the stream is closed when the app goes to the background and reconnected when it returns.
- **The query cache is released by the screen that made the query, and a query object never breaks for it.** SvelteKit frees a cache entry, and a live query closes its stream, when the last query object that uses it is garbage collected (`FinalizationRegistry`). React Native 0.86's Hermes (0.17) has no `FinalizationRegistry`, so without help no entry would ever be freed: a screen entered again would show the data it showed last time and its stream would stay open. The package supplies one (the `FinalizationRegistry` above: the engine's own when it has one, else a registry that looks for collected objects every three seconds, not while the app is in the background) that can also release an object by hand, and the object a query call returns is a stand-in for SvelteKit's that does so when the effect that made it is torn down (a component that is destroyed, an expression that runs again for another argument): leaving a screen closes its live streams and drops its cached queries, and entering it again fetches. This is a guess about who else holds the object, so it is never allowed to break a reader: an object used after its entry was freed (made by a `$derived` and first read in a branch that went away, held by a command that finished later, read after an `await`) makes SvelteKit's object again, with the same call, and is owned by the effect that is running then; its data is fetched again (`current` is `undefined` and `loading` true until it is back), and a read after the screen is gone starts a live stream again for whoever reads it. It works the same with an engine registry of its own. An object made outside an effect (an event handler, a store) is released when the engine collects it, as on the web.
- **Errors** are the web's. `error()` is the `HttpError` (the query's `.error` is its `App.Error`, after your `handleError`), a validation failure is the form's issues, and a transport failure is an unknown error (500, through `handleError`). `redirect()` from a query, command or form goes to `goto` in `configureRemote`, else through the root router when it is a path of the app (the web `paths.base` is removed), or opens another site with the system when it is an `http:` or `https:` address; any other kind of address the server names (`javascript:`, `intent:`, `file:`, another app's scheme) is refused with an error. `getRequestEvent().url`, cookies and headers work as written for the web.

### Forms

There is no `<form>` or `<input>`, so `form` is a native port of SvelteKit's client form (`remote/form.svelte.ts`, from `form.svelte.js` 3.1.1; the state, validation, issue merging, request, `.updates` and `.for(key)` are the same code paths, the DOM is replaced). `fields.x.as(type)` returns the props of a native input; spread them onto it:

| `as(…)` | Spread onto | Props |
|---|---|---|
| `"text"`, `"email"`, `"password"`, `"tel"`, `"url"`, `"search"`, `"date"`, `"time"`, `"datetime-local"`, `"month"`, `"week"`, `"color"`, `"textarea"` | `TextInput` | `value`, `onChangeText`, `onBlur`, and the keyboard the type asks for (`keyboardType`, `secureTextEntry`, `autoCapitalize`, `textContentType`, …) |
| `"number"`, `"range"` | `TextInput` | the same with a decimal keypad; the field holds a number (below), empty is `undefined` |
| `"checkbox"` (one boolean, or `"checkbox", option` for a list), `"radio", option` | `Switch` | `value: boolean`, `onValueChange`, `onBlur`; a radio turned off keeps its choice |
| `"select"`, `"select multiple"` (`initial?`, `options?`) | your picker | `value`, `multiple`, `onValueChange(next)` |
| `"hidden", value` | – | `value`; sent with every submission |
| `"submit", value` | `Pressable` | `value`, `onPress`: sets the field and submits |
| `"file"`, `"image"` | – | throws: files are not supported |

**What is submitted is what is shown**, as a browser posts a form. A field that has an input on screen is submitted with the value its input shows: a text input as its text (`""` when empty), a number input as its number (`undefined` when empty), a checked box as `true` (an unchecked one is not posted at all, as on the web), a list of boxes as the checked ones, the chosen radio, the select's choice, the hidden values; and the defaults count: `as("text", "Dr")`, `as("number", 3)`, `as("checkbox", true)`, `as("radio", "s", true)` and a select's `initial` (or, without it, the first of `as("select", undefined, options)`, which is what a browser's select starts on) are posted until the user changes them, and a change, even to empty, wins. Fields set from code with `fields.x.set(...)` and never given an input are posted too. A field none of whose inputs is on screen any more (a row of a virtualized `List` that scrolled away, an input in a closed `Modal` or sheet, a step of a wizard that went) keeps what was typed or set, because on a phone that is not the user taking a value back; what its inputs would have shown (defaults, the empty `""`) is not added for it. The host tells each input's `ref`, which `as()` puts in the props (spread them; if you pass your own `ref`, call `props.ref(handle)` from it), so that a field is known to be gone. Of several submit buttons only the one pressed last is posted.

**Numbers** are read strictly and in full from the keyboards of the app's locales (`en`, `ar`): Western, Arabic-Indic and Extended Arabic-Indic digits, the decimal marks `.` and `٫` (U+066B), the minus signs `-` and `−`, and a `+`. `"12abc"`, `"-"`, `"."` and `"1e5"` are not numbers: the field holds `NaN` (never `12`) and the server's schema says what it makes of that; empty is `undefined`; the typed text stays on screen (`"17."` is 17). The comma: a comma (or `،`) that is the only mark of the number is a decimal mark (`"1,5"` is 1.5, `"12,3456"` is 12.3456; `en` decimal pads have a point and `ar` ones a `٫` or a comma, so a comma that is typed or pasted means the decimal mark), and commas that group are dropped (`"1,234,567"`, `"1,234.5"`), as are spaces and `٬` between groups of three digits. One shape is both a thousands mark and a decimal mark, and is **not a number** (`NaN`, so the schema reports it): one to three digits, a lone comma and exactly three digits (`"1,000"`, `"1,234"`), which is a thousand in English and 1.000 in French; a silent 1 would be a wrong amount. `٫` is always a decimal mark (`"١٫٠٠٠"` is 1).

`form.submit()` is the submit button: preflight, then `enhance` (default: send, and reset the form when the server accepted it), and `.updates(...)` works on it. It resolves to whether the data was accepted and **never rejects for a failed submission**: the network, the server or an `enhance` callback that throws go through `handle_error` (your `handleError`) as they do in SvelteKit's submit handler, `form.error` holds the resulting `App.Error` until the next submission, `form.result` is cleared, and `submit()` resolves `false`, so `onPress={() => form.submit()}` leaves nothing unhandled. (A build with no host still throws, at the call, like every remote function.) `form.reset()` is the web form's `reset`. `native(form)` is a cast for the types: SvelteKit's types describe DOM inputs.

### Not supported

File fields; `<select>`'s option list (a native picker is yours: pass the options for the starting choice); `prerender` results are not cached across launches (no Cache API; the server answers from its prerendered files when it has them); a server-rendered payload to hydrate from (a screen is not server-rendered); `load`-function invalidation (`refreshAll()` refetches remote queries only); remote modules inside `node_modules`; `export *` and re-exports in a remote module; a Metro project root that is not the Vite root.

### Checking on a device

The development lab has a page for it, `/__dev/remote` (QA and smoke builds), with a host field, the lab's own checks (one per kind: query, devalue types, `error()`, batch, live, command with single-flight, `.updates` with an override, request/Origin/cookie, prerender, `redirect()`, form issues then success), a form built from `TextInput` and `Switch`, and a live clock. The checks are the ones `tests/remote-lab.test.ts` runs against the lab's server module on the host; a device adds Hermes, the platform's networking and the screen.

```sh
cd apps/qa && pnpm dev                                  # the SvelteKit dev server, port 3000, serves src/lib/native/dev/remote-lab.remote.ts
# Android (the Samsung over USB, or the emulator): the build must allow plain HTTP to the host, so it is built with the origin
SVELTE_NATIVE_REMOTE_ORIGIN=http://localhost:3000 pnpm native-qa build --abi arm64-v8a --prebuild
adb reverse tcp:3000 tcp:3000
adb shell am start -a android.intent.action.VIEW -d "example-svelte:///__dev/remote?run=1" io.example.svelteqa
adb logcat -s ReactNativeJS | grep "remote lab results"      # {"origin":…,"results":{"query":"pass: …",…}}: eleven passes
```

On the iPhone the dev server must be reachable from it: run it on the Mac and use the Mac's LAN address (`SVELTE_NATIVE_REMOTE_ORIGIN=http://<mac address>:3000`, or `?origin=http://<mac address>:3000` on the link of a build that has no host; an IP literal is outside App Transport Security) and open `example-svelte:///__dev/remote?run=1`. A build with no origin still has the page: type the origin of a reachable dev server and press "Use this host" (`?origin=<origin>` does it from the link; use `https:`, or on the iPhone a plain `http:` address to an IP, which App Transport Security does not cover). Then, by hand: type in the form and watch the issues change; leave the page while the clock runs, come back and press "Server stats": `liveOpen` is 1 (this page's clock) and not 2, because the first stream was closed with its screen; send the app to the background and back and check the clock resumes; kill the dev server and check the failures are shown, not swallowed.

## Apply the patches

The library works only with ten third-party packages patched, and pnpm applies a patch only from the app's own workspace, so an app copies the patch files in and declares them. They are in `patches/` of this package, named `<package>@<version>.patch`, and each is for exactly that version of the package it names (the peers below are pinned to the same versions).

| Package | Needed | What the patch changes |
|---|---|---|
| `@sveltejs/kit` 3.1.1 | if installed (an optional peer: remote functions, the web target) | SvelteKit's route manifest and its `+page`/`+layout` warnings leave `+mobile.svelte` files in a route directory alone |
| `expo-modules-core` 57.0.23 | always (comes with `expo`; pin it with `overrides`, "Install in an app") | Android: Expo modules register lazily and the common ones are prewarmed on a thread of their own; the native view adapter loads React Native's component registry on its first view |
| `react-native-gesture-handler` 2.32.0 | always (a peer) | iOS: the manager can be asked for the root gesture recognizer of a screen the library presents (sheets, modals) and does not stop its walk above a view that holds a touch handler |
| `react-native-reanimated` 4.5.1 | always (a peer) | Android: `synchronouslyUpdateUIProps` hands the engine's views to a native sink, and opacity and translate/scale transforms skip React Native's prop path |
| `react-native-worklets` 0.10.1 | always (a peer) | the UI runtime asks for an animation frame only while a callback waits, not on every frame forever (about 12 % of an idle screen's main-thread samples on the Samsung A16) |
| `lottie-react-native` 7.3.8 | if installed | Android: the three events do not coalesce; iOS: a load or failure raised before the view has its event emitter is kept for it |
| `react-native-maps` 1.27.2 | if installed | Android: the 21 discrete events do not coalesce; the drag, pan, region and location streams still do |
| `react-native-pdf` 7.0.3 | if installed | Android: the one `topChange` event, which carries every message of the view, does not coalesce (a document's load event was overwritten by the page event that follows it) |
| `react-native-video` 6.19.3 | if installed | Android: only the progress and bandwidth events coalesce; load, seek, end, error and the rest are delivered one by one |

Coalescing is React Native's event queue replacing an unread event of one name with the next from the same view while JavaScript is busy ([Native views from other libraries](#native-views-from-other-libraries)). The example app's `react-native-live-direction` patch is not here: it fixes `I18nManager` for the libraries of the smoke app and nothing of this package uses it.

Copy them into the app, keep the entries of the libraries the app installs, and install again:

```sh
pnpm add <the library>                       # first: the patch files arrive with it
mkdir -p patches/svelte-native
cp node_modules/@alfayez/svelte-native/patches/*.patch patches/svelte-native/
```

```yaml
# pnpm-workspace.yaml, next to the allowBuilds and overrides of "Install in an app" (or "pnpm": { "patchedDependencies": { … } } in package.json)
patchedDependencies:
  "@sveltejs/kit@3.1.1": patches/svelte-native/@sveltejs__kit@3.1.1.patch
  expo-modules-core@57.0.23: patches/svelte-native/expo-modules-core@57.0.23.patch
  lottie-react-native@7.3.8: patches/svelte-native/lottie-react-native@7.3.8.patch
  react-native-gesture-handler@2.32.0: patches/svelte-native/react-native-gesture-handler@2.32.0.patch
  react-native-maps@1.27.2: patches/svelte-native/react-native-maps@1.27.2.patch
  react-native-pdf@7.0.3: patches/svelte-native/react-native-pdf@7.0.3.patch
  react-native-reanimated@4.5.1: patches/svelte-native/react-native-reanimated@4.5.1.patch
  react-native-video@6.19.3: patches/svelte-native/react-native-video@6.19.3.patch
  react-native-worklets@0.10.1: patches/svelte-native/react-native-worklets@0.10.1.patch
```

```sh
pnpm install --no-frozen-lockfile    # the declaration changes the lockfile; commit it, and CI's frozen install then passes
```

- **Copy the files; do not point `patchedDependencies` at `node_modules/@alfayez/svelte-native/patches/…`.** pnpm reads the patch files before it fetches anything, so on a clean install (CI, a fresh clone) that path does not exist yet and the install stops with "Failed to read patch file".
- **Declare only the libraries the app installs.** pnpm refuses a patch whose package is not in the install (`ERR_PNPM_UNUSED_PATCH`), unless `allowUnusedPatches: true` is set. A library that is installed needs its patch: the events are lost without it.
- **Versions are exact.** A patch is for one version; `pnpm add react-native-pdf@7.0.3`, not `^7`. The peer ranges in this package's `package.json` say which. `expo-modules-core` is not the app's own dependency: pin it with the `overrides` entry of "Install in an app", or pnpm resolves `expo`'s `~57.0.23` to a newer one and stops with `ERR_PNPM_UNUSED_PATCH`.
- **Copy again after every upgrade of this package**, then `pnpm install`: a patch changes with the library's code that depends on it, and an older copy applies cleanly but leaves the old behaviour. The doctor compares the installed files with the patch files of the installed library, so it tells the two apart.
- Most of the patches change native code (Kotlin, Java, Objective-C++, C++): rebuild the native app after installing or changing them.

## Check an app with `svelte-native doctor`

```sh
pnpm exec svelte-native doctor            # from the app's directory
pnpm exec svelte-native doctor --json     # the same checks as JSON
```

It reads the app and prints one line per check, `pass`, `FAIL`, `skip` or `????` (it could not tell), and under a failure the fix. It exits 1 if a check failed and 0 otherwise; it changes nothing in the app (unlike the other commands it does not write `.svelte-native/`).

```
svelte-native doctor: /home/me/app

environment
  pass  node 24.18.1 (needs ^22.17.0 || ^24.3.0 || >=26.0.0)
  pass  pnpm 12.3.4 (needs >=12.3.4)

svelte
  FAIL  svelte 5.56.7 is the stock Svelte: it has no ./renderer export (/home/me/app/node_modules/svelte)
        fix: install the custom-renderer build of Svelte (sveltejs/svelte#18042, commit 216f258, 5.56.7): `pnpm exec svelte-native init` does it (docs/10-getting-started/20-creating-a-project.md), or by hand, README "Install in an app"

peer dependencies
  pass  react-native 0.86.3 satisfies 0.86.3
  FAIL  react 19.2.6 does not satisfy 19.2.7
        fix: pnpm add react@19.2.7
  skip  optional view libraries not installed, nothing to check: lottie-react-native, react-native-maps

patches
  pass  react-native-reanimated@4.5.1 applied: the engine's views are written natively and opacity/translate/scale skip React Native's prop path (Android)
  FAIL  react-native-pdf@7.0.3 is not applied: the pdf view's one event, which carries every message, no longer coalesces (Android)
        android/src/main/java/org/wonday/pdf/events/TopChangeEvent.java: canCoalesce() is not overridden to return false
        fix: copy node_modules/@alfayez/svelte-native/patches/react-native-pdf@7.0.3.patch into your repository (patches/svelte-native/), declare "react-native-pdf@7.0.3: patches/svelte-native/react-native-pdf@7.0.3.patch" under patchedDependencies in pnpm-workspace.yaml, then pnpm install (README: "Apply the patches")

build integration
  pass  @alfayez/svelte-native 0.4.0-rc.5 is a dependency of the app
  ????  could not tell: metro.config.cjs does not mention withSvelteNative (a config that applies it from a file it imports is fine)
        fix: module.exports = withSvelteNative(getDefaultConfig(__dirname)), with withSvelteNative from require("@alfayez/svelte-native/metro")
  pass  app.json lists the @alfayez/svelte-native/expo plugin

…
```

What it checks, and how: [REFERENCE.md](REFERENCE.md#doctor). Among the peers: `hermes-intl` is a dependency of the app itself (autolinking), `@sveltejs/kit` and `vite` are skipped when absent, and a version of `expo-modules-core` other than the patch's gets the `overrides` fix. A patch counts as applied when the installed package has the code the patch adds (the Android events that must not coalesce, the gesture handler's manager, Reanimated's sink, the worklets frame loop, Expo's lazy registry, SvelteKit's route filter), not when `patchedDependencies` merely names it.

## Development loop

```sh
cd apps/qa && node ../../packages/svelte-native/src/cli.ts dev --port 8181
adb reverse tcp:8181 tcp:8181      # Android device; the debug host asks Metro on that port
```

A debug build loads the bundle from Metro. A save re-runs the changed module and the entry, which remounts every surface on the same root; navigation state and native state are kept, component state is not. An uncaught error in development replaces the surface with a red error screen with a Reload button. Do not start Metro with `CI=1` (the file watcher is disabled and bundles go stale). A release build cannot be pointed at Metro. Recipe and limits: [REFERENCE.md](REFERENCE.md#fabric-entry-dev-loop).

## Testing and quality

```sh
cd packages/svelte-native
bun run test             # bun test --timeout 30000: renderer, host against a fake Fabric binding, router, lowering, gestures, foreign libraries, updates, remote functions (a real SvelteKit server); a plain `bun test` keeps Bun's 5 s default, which the server and bundling tests can exceed on a busy machine
pnpm build               # the JavaScript of the Node-side entries into dist/node/ (committed): run it after changing the code they are built from
pnpm typecheck           # svelte-check
pnpm lint                # eslint
npx biome check .        # from the repository root: lint for the TypeScript packages
```

`dist/node/` is what `pnpm build` (`scripts/build-node.ts`, esbuild) writes for the sources of the entries in the table of "Set up an app": the command line, the route generator, `metro.ts`, `transformer.ts`, `expo.ts`, `vite.ts`, `lower.ts` and what they import (`build.ts`, `doctor/`, `remote/{transform,plugin,host}.ts`, `svelte-build.ts`, `route-tree.ts`, `variant.ts`, `package-root.ts`). The repository's own tools use the built files too (the QA app's Metro, Vite and Expo config load them through the package's `exports`), so a change to that code reaches the QA app only after `pnpm build`. `tests/dist.test.ts` fails when `dist/node/` differs from a fresh build, and `tests/node-modules.test.ts` packs the package with `pnpm pack`, unpacks it into the `node_modules` of a scratch app and loads each entry with plain `node`. Node-side code names the TypeScript Metro compiles by path (`sourceFile()` in `src/package-root.ts`), never by a relative import: a built file is not next to its sources.

Devices are driven by the `native-qa` harness in `apps/qa/qa` (see its [README](../../apps/qa/qa/README.md)): `pnpm native-qa build|lab|boot|parity|a11y|resilience|soak|crashes|gestures|foreign|smoke|updates|product|report|gates` builds the QA app, runs the lab on an emulator, the Samsung or the iPhone, and judges `gates.json`. The lab (28 functional checks plus the stress scenarios) is in the example app's `/__dev` routes, present in development and QA builds and absent from the production variant. Pixel references, accessibility-tree checks and the resilience loop are automated; what a person must check with TalkBack and VoiceOver is in [apps/qa/qa/A11Y-MANUAL.md](../../apps/qa/qa/A11Y-MANUAL.md). The state of the production bar, the exceptions and the final gate table (every device's result on the final build, with its decision where a bar is missed) are in [PLAN.md](PLAN.md).

## Known limits

- Hot reload remounts the root; there is no Fast Refresh and no state-preserving HMR.
- The Android engine is verified on one phone model and an emulator; iOS on one iPhone. The frame bar on the phones is at most one late interval per run and no frame over 33 ms, in nine runs of ten. Documented misses, each with its measurement and decision in [PLAN.md](PLAN.md): animated churn on the Samsung (Reanimated's worklet runtime), the iOS header (UIKit's navigation bar), the Samsung's `churn-static` (short late intervals at 90 Hz, capped) and the first touch of a process. The Samsung's boot p90 reads 295–371 ms across the last three proofs against a bar of 350 (the last two met it; a miss is an accepted exception, D9) and the windowed list's cold mount there 25–33 ms against 10 (an accepted exception too); the iPhone meets its boot and list-mount bars. On Android, parity (216 signed-out cases at 0 px, twice, the Arabic variants included) and the accessibility oracle (108 screens, 0 findings) run on the emulator only, where the boot and frame rows are informational (software GL).
- On the iPhone the gesture checks (12 scenarios) and the resilience steps (126) pass through XCUITest (measured on `1919e8f03` and carried to the final build, D14: the iOS app's code since then differs only in the foreign lab page), whose synthetic touches get no touch boost: the gesture frames measured that way (a `box` drag reads 6.7–7.1 % and 52 ms, a finger on the same `box` 0.3 % and 33 ms) are a documented exception (D13). The thirteen view libraries are verified on the iPhone (390 checks, measured on `c8faf5e97`, whose iOS code is the final build's apart from the foreign lab's race helper). [PLAN.md](PLAN.md) lists what is open.
- Screen-reader behavior (TalkBack order and announcements, VoiceOver focus) is covered by the automated oracle and by a manual checklist, not by a recorded person-run yet.
- The Android engine now publishes `accessibilityState`, `accessibilityValue`, `accessibilityHint`, `accessibilityActions`, `accessibilityLiveRegion` and `role` (checked by the automated oracle); what TalkBack says for them has not been confirmed by a person yet, see the checklist.
- The Svelte compiler is an unmerged pull request: review the pin when updating Svelte or SvelteKit. Boundary `failed` snippets must be declared outside `<svelte:boundary>` and passed with `{failed}`.
