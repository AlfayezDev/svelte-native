# Introduction

## Before we begin

> [!NOTE] If you're new to Svelte or SvelteKit, start with the [Svelte tutorial](https://svelte.dev/tutorial) and the [SvelteKit docs](https://svelte.dev/docs/kit). These pages pick up where SvelteKit's leave off.
>
> Svelte Native is an early preview. It works, it has rough edges, and [what doesn't work yet](#what-is-in-the-early-preview) is listed below. If you get stuck, see [Troubleshooting](08-troubleshooting.md) or open an issue.

## What is Svelte Native?

Svelte Native lets you write Android and iOS apps as Svelte 5 components. The components are not rendered into a web view: they become real native views (an Android `View`, a UIKit `UIView`) that are laid out and drawn by the platform.

It does this on top of [React Native](https://reactnative.dev)'s new architecture, but without React. A pinned build of the Svelte compiler turns your components into code that runs in [Hermes](https://hermesengine.dev) (React Native's JavaScript engine) and talks to React Native's renderer, Fabric, directly. There is no React reconciler, no React Native component layer and no WebView between your component and the screen.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text, View } from '@rasheed/svelte-native';

	let taps = $state(0);
</script>

<Screen title="Hello">
	<View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center' }}>
		<Text>Tapped {taps} times.</Text>
		<Pressable onPress={() => taps++} accessibilityRole="button">
			<Text>Tap</Text>
		</Pressable>
	</View>
</Screen>
```

If you know Svelte, most of this is familiar: runes, snippets, `{#each}`, stores and context all work. What changes is the building blocks. You use `View`, `Text` and `Pressable` instead of `div`, `p` and `button`, and style objects instead of CSS.

## How it relates to SvelteKit

A Svelte Native app is a SvelteKit project. You create it with `npx sv create`, and the web app stays exactly where it was:

- `src/routes/+page.svelte` is a page of the web app.
- `src/routes/+mobile.svelte` is a screen of the native app, in the same directory.
- `src/lib` is shared. A function, a store or a `.svelte.ts` module that doesn't touch the DOM can be imported by both.

`vite dev` still runs the web app. A second tool, [Metro](https://metrobundler.dev), bundles the native app. SvelteKit's file-based routing carries over to the native side: [Native routes](04-native-routes.md) shows how.

> [!NOTE] Native screens are not server-rendered and have no `load` functions. A screen fetches its data with `fetch`, or with [remote functions](../packages/svelte-native/README.md#remote-functions), which the library supports on native.

## How it relates to Expo

[Expo](https://expo.dev) is the toolchain underneath. It provides Metro, the project generator that creates the `android/` and `ios/` folders (`expo prebuild`), autolinking of native modules, and the build commands. You don't need to know Expo to use Svelte Native, but you will meet its words, and [Development builds](05-development-builds.md) explains the ones that matter.

Because the library ships its own native code, your app is a native build of your own, not something you open in the Expo Go app. Expo Go can't load native modules it wasn't built with.

## What is in the early preview?

Svelte Native targets Expo SDK 57 and React Native 0.86. What has been exercised:

- **Android:** a Samsung Galaxy A16 (Android 16) and an API 36 emulator.
- **iOS:** an iPhone SE (3rd generation) on iOS 26.
- **Web:** the same project builds for browsers through SvelteKit.

What doesn't work yet, or hasn't been tried:

- There is no Fast Refresh. A save remounts the root, and component state is lost.
- Phones only. Tablet and foldable layouts, and tvOS, are not exercised.
- Screen readers (TalkBack, VoiceOver) are covered by automated checks, not yet by a person using them.
- Svelte's DOM transitions, DOM-based libraries, React widgets and the Expo dev client are not supported.
- Building on Expo's servers (EAS Build) is untried, and push notification delivery is not tested end to end.
- The Svelte compiler it needs is an [unmerged pull request](https://github.com/sveltejs/svelte/pull/18042), pinned to one commit. SvelteKit is pinned to `3.1.1`, the version the library's patch is for.
- `@rasheed/svelte-native` is a placeholder name and will change before a public release. The repository is private for now, and you install from it over SSH.

## Where to go next

- [Creating a project](02-creating-a-project.md) takes you from `npx sv create` to an app on your device.
- [Project structure](03-project-structure.md) explains the files that appear.
- The [package README](../packages/svelte-native/README.md) is the reference for everything the library exports.
