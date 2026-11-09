# Svelte Native showcase

A tour of [`@example/svelte-native`](../../packages/svelte-native/README.md): a small app where every feature of the library is its own screen with one short example. It is written the way an app that installs the library would be written, and it imports nothing but the library's public entries (`@example/svelte-native`, `/animation`, `/gestures`, `/foreign`, `/svg`, ...). Read it with the library's [README](../../packages/svelte-native/README.md) and [REFERENCE](../../packages/svelte-native/REFERENCE.md) beside it.

The app id is `io.example.sveltenative.example`, the name is "Svelte Native" and the link scheme is `svelte-native://`.

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
| Text and fonts | `/text` | Size, weight, style, spans and links, `numberOfLines`, system fonts per platform, a font bundled with the `expo-font` plugin |
| State and reactivity | `/state` | `$state`, `$derived`, `$effect` with a cleanup, a `$state` array whose fields are bound to `Switch`es, `{#await}` |
| Layout | `/layout` | Flexbox through Yoga: column and row, `justifyContent` (live), `alignItems`, `flexWrap` and `gap`, `flex`, absolute position |
| Styling | `/styling` | Style objects, arrays and `$derived` styles, the theme and dark mode, shadow and elevation, transforms |
| Lists | `/lists` | A `ScrollView` with `{#each}` beside the windowed `List` of 5,000 rows |
| Inputs and forms | `/inputs` | `TextInput` and `Switch` with `bind:value`, a form with validation, `returnKeyType`, input refs, `KeyboardAvoidingView` |
| Stack | `/navigation/stack`, `/navigation/stack/[id]` | `router.goto` and `back`, a route parameter, a large title, `headerRight`, the stack growing |
| Tabs | `/navigation/tabs`, `/navigation/tabs/feed`, `/navigation/tabs/feed/[id]`, `/navigation/tabs/profile` | A layout with `navigator = "tabs"`, `Tabs` with icons from snippets and a badge, a stack inside a tab, closing the bar from its first screen |
| Sheet | `/navigation/sheet` | `presentation = "sheet"`, `sheet={{ detents, grabber }}`, `onDetentChange` |
| Modal | `/navigation/modal` | `presentation = "modal"` with its own Close button in `headerLeft` |
| Links | `/navigation/links` | The launch URL, `Linking`, `router.openURL`, and the `adb` and `xcrun` commands that open the app on a screen |
| Platform | `/platform` | `Platform`, `Dimensions`, the `insets` store (safe area and keyboard), the status bar option of `Screen`, the system's appearance |
| Internationalization | `/i18n` | English and Arabic, `Intl` plurals, numbers and dates, `direction: "rtl"` and `marginStart` |
| Accessibility | `/accessibility` | Labels, roles, state, hints, grouping, hidden decoration, live regions, `accessibilityActions` |

## Notes for a reader

- **React Native's JavaScript modules are imported by path** (`react-native/Libraries/Utilities/Platform`, `Appearance`, `Dimensions`, `Linking`): the library has none of its own, and the `react-native` index would load React's components. React Native ships no types for these paths, so `src/lib/modules.d.ts` declares the few members the app uses. It also declares two modules the library's own source imports, because a workspace link is type-checked with the app.
- **`hermes-intl` is a dependency of the app** although it is not a peer of the library: the library's polyfills require it, and Metro cannot bundle without it.
- **`@sveltejs/kit` and `vite` are dependencies too**, because the library lists them as peers (the web target and remote functions use them). A native-only app like this one does not run either.
- **`expo-system-ui`** makes `userInterfaceStyle: "automatic"` in `app.config.ts` apply on Android, so the app follows the system's dark mode there (Expo warns at prebuild without it).
- **Dark mode** is the theme's: `src/lib/theme.svelte.ts` keeps the system's colour scheme in `$state` (React Native's `Appearance`), and a screen reads `theme.colors`. There is no in-app switch; change the phone's appearance.
- **Fonts**: the system fonts need no setup. `JetBrainsMono-Regular.ttf` (SIL Open Font License, `assets/fonts/OFL.txt`) is embedded by the `expo-font` plugin in `app.config.ts`.

## Tests

```sh
cd apps/example
pnpm typecheck    # svelte-check on the app, tsc on the tests
pnpm lint         # eslint
pnpm test         # bun test: the registries, the screens and the Metro bundles
```

- `test/routes.test.ts`: every route of `src/routes` is listed in a registry and every listed route is a folder; screens stay short; the app imports only the library's public entries.
- `test/screens.test.ts`: every screen of the core registry mounts on the library's fake Fabric binding (Android and iOS) without an error.
- `test/bundle.test.ts`: the Metro bundle of the app is made for Android and iOS (`expo export:embed`, release, not minified), which is what a build runs before Hermes. None of these needs a device.
