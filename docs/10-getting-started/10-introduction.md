---
title: Introduction
---

## Before we begin

> [!NOTE] If you're new to Svelte or SvelteKit, start with the [Svelte tutorial](https://svelte.dev/tutorial) and the [SvelteKit docs](https://svelte.dev/docs/kit). This guide assumes you know them, and covers what is different on a phone.
>
> Svelte Native is an early preview. [What works today](#what-works-today) is listed below. If you get stuck, see [Troubleshooting](troubleshooting).

## What is Svelte Native?

Svelte Native lets you write Android and iOS apps as Svelte 5 components. Your components don't run in a web view: they become real native views, laid out and drawn by the platform.

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

If you know Svelte, most of this is familiar: runes, snippets, `{#each}`, `{#await}`, stores and context all work. What changes are the building blocks. You use [`View`](view), [`Text`](text) and [`Pressable`](pressable) instead of `div`, `p` and `button`, and style objects instead of CSS. [Coming from the web](coming-from-the-web) lists the differences.

Under the hood, Svelte Native runs on [React Native](https://reactnative.dev)'s renderer, without React. Your components are compiled by Svelte, run in Hermes (React Native's JavaScript engine) and drive the native views directly.

## Svelte Native and SvelteKit

A Svelte Native app is a SvelteKit project. You create it with `npx sv create`, and the web app stays where it was:

- `src/routes/+page.svelte` is a page of the web app.
- `src/routes/+mobile.svelte` is a screen of the native app, in the same directory.
- `src/lib` is shared. A module that doesn't touch the DOM can be imported by both.

The native app uses SvelteKit's ideas where they fit: [routing](routing) is filesystem-based, layouts wrap screens, and [remote functions](loading-data#remote-functions) call your SvelteKit server from the phone.

## Svelte Native and Expo

[Expo](https://expo.dev) is the toolchain underneath. It generates the Android and iOS projects, links native modules, and builds and installs your app. You don't need to know Expo to start, and [Development builds](development-builds) explains the parts you will meet.

Because the library has native code of its own, your app is a build of your own, not something you open in the Expo Go app.

## What works today

Svelte Native targets Expo SDK 57 and React Native 0.86, on Android and iOS phones. The same project still builds for the web through SvelteKit.

Not there yet:

- No Fast Refresh. Saving a file reloads the app's root, and component state is lost.
- Phones only: tablet and foldable layouts, and tvOS, are not supported yet.
- Screen reader support is checked by automated tests, not yet by people using TalkBack and VoiceOver.
- No Svelte transitions, no DOM libraries, no React components, and no Expo dev client.
- Building on Expo's servers (EAS Build) is untested.
- Svelte Native needs a build of Svelte from an [open pull request](https://github.com/sveltejs/svelte/pull/18042), and SvelteKit 3.1.1 exactly. `init` installs both.
- `@rasheed/svelte-native` is a working name. The repository is private for now, and you install from it over SSH.

## Next steps

[Creating a project](creating-a-project) takes you from `npx sv create` to your app running on a phone.
