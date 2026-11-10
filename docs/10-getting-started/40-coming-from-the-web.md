---
title: Coming from the web
---

Svelte on a phone is the Svelte you know: the same compiler, the same runes, the same template syntax. What is different is everything the browser used to give you. There is no DOM, no HTML and no CSS. This page lists what changes.

## What stays the same

Runes (`$state`, `$derived`, `$effect`, `$props`, `$bindable`), snippets, `{#if}`, `{#each}`, `{#await}`, `{#key}`, `<svelte:boundary>`, stores, context, lifecycle functions and `.svelte.ts` modules all work as they do on the web. So does `fetch`.

## Components instead of elements

A native screen is built from components, not HTML elements:

| On the web | In Svelte Native |
| --- | --- |
| `<div>` | [`View`](view) |
| `<p>`, `<span>`, `<h1>` | [`Text`](text) |
| `<button>`, `<a>` | [`Pressable`](pressable) |
| `<input>`, `<textarea>` | [`TextInput`](text-input) |
| `<input type="checkbox">` | [`Switch`](switch) |
| `<img>` | [`Image`](image) |
| `overflow: auto` | [`ScrollView`](scroll-view) |
| a long list | [`List`](list) |
| `<dialog>` | [`Modal`](modal) |

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Text, TextInput, View } from '@rasheed/svelte-native';

	let name = $state('');
	let greeting = $state('');
</script>

<View style={{ padding: 24, gap: 12 }}>
	<TextInput bind:value={name} placeholder="Your name" accessibilityLabel="Name" />
	<Pressable onPress={() => (greeting = `Hello ${name}`)} accessibilityRole="button">
		<Text>Say hello</Text>
	</Pressable>
	<Text>{greeting}</Text>
</View>
```

Events are props: `onPress` instead of `onclick`, `onChangeText` instead of `oninput`. `bind:value` works on `TextInput` and `Switch`.

## Text goes in Text

Every string must be inside a [`Text`](text). A string directly inside a `View` is not drawn.

`Text` keeps whitespace as you write it. A browser collapses spaces and line breaks; a phone doesn't. A sentence split across two lines of your source shows the line break and the indent. Keep a long sentence on one line, or write it as a string:

```svelte
<Text>{'A long sentence, written as one string.'}</Text>
```

## Styles are objects

There is no CSS. Each component takes a `style` object, with React Native's names and values:

```svelte
<View style={{ flexDirection: 'row', gap: 8, padding: 16, backgroundColor: '#f2f2f7', borderRadius: 12 }} />
```

Layout is flexbox, but the default direction is a column, sizes are numbers (density-independent pixels), and styles don't cascade, except from a `Text` to the `Text`s inside it. [Styling](styling) covers it.

## Navigation is native

There are no links and no URLs in the address bar. A screen asks the router to move: `useRouter().goto('/settings')`. The screens slide, the header is the platform's, and the back button and back gesture work. [Routing](routing) explains it.

## Data is fetched by the screen

A native screen is not rendered on a server and has no `load` function. It fetches its own data, with `fetch` or with SvelteKit's [remote functions](loading-data#remote-functions), which call your SvelteKit server from the phone.

## Runes mode is the default

Every component of your app compiles in runes mode, even one with no rune in it. A file that needs legacy mode opts out with `<svelte:options runes={false} />`. Svelte libraries in `node_modules` keep Svelte's own default.

## What doesn't carry over

- **Transitions.** `transition:`, `in:`, `out:` and `animate:` need the DOM. Use [`AnimatedView`](animation).
- **The DOM.** `document`, `window`, actions that touch DOM nodes, and libraries built on them.
- **React.** React Native components and hooks can't be used. Many native libraries still can: see [Native libraries](native-libraries).
- **SvelteKit's page APIs.** `$app/navigation`, `$app/state`, `load`, form actions and `+error.svelte` are the web app's.

A `failed` snippet for `<svelte:boundary>` must be declared outside the boundary and passed as `{failed}`.
