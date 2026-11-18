---
title: State management
video: state-management
---

State works as in any Svelte app: `$state` in a component, shared state in `.svelte.ts` modules, and context for state that belongs to part of the tree. A few things are different on a phone: how long a screen lives, and where data survives a restart.

## State in a screen

A screen is a component, so `$state` and `$derived` in it live as long as the screen does:

- A screen you push stays mounted while other screens cover it. Going back to it shows it as you left it.
- A screen you go back from is destroyed, with its state.
- Each tab keeps its own stack, mounted from the first time the tab is selected.

## Shared state

State that several screens read goes in a `.svelte.ts` module:

```ts
/// file: src/lib/cart.svelte.ts
export const cart = $state({ items: [] as { id: string; name: string }[] });

export function add(item: { id: string; name: string }) {
	cart.items.push(item);
}
```

```svelte
<!--- file: src/routes/cart/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text } from '@alfayez/svelte-native';
	import { cart } from '#lib/cart.svelte.ts';
</script>

<Screen title="Cart ({cart.items.length})">
	{#each cart.items as item (item.id)}
		<Text>{item.name}</Text>
	{/each}
</Screen>
```

On the web, SvelteKit warns against state in modules, because the server shares it between users. The native app runs on one person's phone, so module state is safe there. A module imported by both the web app and the native app is still a module on the server too: keep per-user state out of the modules your web pages import.

## Context

State that belongs to one part of the app, a signed-in user or one workspace, can go in context. Set it in a layout and read it in the screens below:

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import { Stack } from '@alfayez/svelte-native';

	let { children }: { children: Snippet } = $props();

	const session = $state({ user: null as string | null });
	setContext('session', session);
</script>

<Stack>
	{@render children()}
</Stack>
```

A screen reads it with `getContext('session')`. A screen presented as a modal or a sheet is still below the app shell, and sees its context.

## Keeping data across launches

There is no `localStorage` on a phone. To keep data when the app closes, use a native storage library and load it when the app starts:

- [`expo-secure-store`](https://docs.expo.dev/versions/latest/sdk/securestore/) for secrets, such as a session token
- `localStorage` for everything else, or `@alfayez/svelte-native/mmkv` for more than strings: both are MMKV, which comes with the library ([Web APIs](web-apis#storage)), so there is nothing to install

[Native libraries](native-libraries) explains how to install them.

Saving a file during development reloads the app's root, and component state is lost. The navigation state is kept, so you stay on the same screen.
