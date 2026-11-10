---
title: Stack
---

`Stack` sets the defaults of every screen in a stack navigator: the header style, the transition, the background, the system bars. You write it in the layout of the stack, around `children`. It draws nothing itself: the stack is the navigator the routes make, and `Stack` only configures it.

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack, colorScheme } from '@example/svelte-native';

	let { children }: { children: Snippet } = $props();
</script>

<Stack
	header={{ tint: '#ff3e00' }}
	animation="slide_from_right"
	statusBar={{ style: 'auto' }}
	style={{ backgroundColor: colorScheme.current === 'dark' ? '#000000' : '#ffffff' }}
>
	{@render children()}
</Stack>
```

The root layout, `src/routes/+layout.mobile.svelte`, holds the app's root stack, and a layout that exports `navigator = 'stack'` holds a nested one. See [navigators](routing#navigators).

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `header` | `HeaderOptions` | The header options of every screen: `large`, `tint`, `background`, `hideShadow`, ... See [Screen's header](screen#header). |
| `animation` | `'default' \| 'none' \| 'fade' \| 'slide_from_right' \| 'slide_from_bottom'` | How screens are pushed and popped. Modals and sheets keep the platform's animation. |
| `gestureEnabled` | `boolean` | Whether screens can be swiped away. |
| `statusBar` | `{ style?: 'auto' \| 'light' \| 'dark'; hidden?: boolean }` | The status bar. `{ style: 'auto' }` follows light and dark mode. |
| `navigationBar` | `{ color?: string; style?: 'auto' \| 'light' \| 'dark' }` | Android's system navigation bar. |
| `style` | `ViewStyle` | The style of each screen's content area. |
| `loading` | `Snippet<[location]>` | Shown in a screen while its page's code loads. It receives the screen's location: `url`, `params` and `route`. |
| `children` | `Snippet` | The navigator: render `children` here. |

Each screen's own [`Screen`](screen) options win over these, option by option, and object options merge key by key. A stack without `Stack` gives its screens no defaults.

## Give every screen a background

React Native screens are transparent. Without a background, a pushed screen draws over the one below it while it slides in, and both show at once. `style={{ backgroundColor }}` on the `Stack` gives every screen one; [light and dark mode](styling#light-and-dark-mode) shows how to follow the system's colours.

## Loading

Pages load when they're first shown. The `loading` snippet fills the screen meanwhile, usually for a split second:

```svelte
<Stack>
	{#snippet loading()}
		<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
			<ActivityIndicator />
		</View>
	{/snippet}
	{@render children()}
</Stack>
```
