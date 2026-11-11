---
title: Styling
---

There is no CSS engine on the device. Each component takes a `style` prop: a plain object with React Native's style keys, in camelCase, with numbers for sizes. If you'd rather write classes, Tailwind's included, `class` works through Uniwind ([Classes](#classes)).

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Text, View } from '@example/svelte-native';
</script>

<View style={{ padding: 20, gap: 8, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e5ea' }}>
	<Text style={{ fontSize: 20, fontWeight: '600' }}>A card</Text>
	<Text style={{ color: '#6c6c70' }}>Styled with a plain object.</Text>
</View>
```

## Style values

A style is a value like any other. Keep one in a constant, compute it with `$derived`, or combine several in an array: later entries win, and `false`, `null` and `undefined` are skipped.

```svelte
<script lang="ts">
	import { Pressable, Text } from '@example/svelte-native';

	const card = { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e5e5ea' };
	let selected = $state(false);
</script>

<Pressable
	onPress={() => (selected = !selected)}
	accessibilityRole="button"
	accessibilityState={{ selected }}
	style={[card, selected && { borderColor: '#007aff', borderWidth: 3 }]}
>
	<Text>{selected ? 'Selected' : 'Not selected'}</Text>
</Pressable>
```

To share styles across screens, export the objects from a module in `src/lib`.

## Classes

`class` takes Tailwind's utilities and classes of your own through [Uniwind](https://uniwind.dev), which compiles your CSS file to React Native styles when Metro builds the app. Without it, `class` does nothing, and a warning in development says so.

> [!NOTE] Classes come after 0.4.0-rc.3: in that release, `class` does nothing. Until the next release, install from `main` with `#main&path:packages/svelte-native` in place of the tag.

```svelte
<View class="flex-row items-center gap-3 rounded-2xl bg-white p-4 dark:bg-zinc-900">
	<Text class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">A card</Text>
</View>
```

### Set up Uniwind

Install Uniwind and Tailwind, at the versions Svelte Native is made for:

```sh
pnpm add uniwind@1.13.2 tailwindcss@4.3.3
```

Create the CSS file:

```css
/// file: src/global.css
@import 'tailwindcss';
@import 'uniwind';
```

Give its path to Metro, with the `uniwind` option of `withSvelteNative`:

```js
/// file: metro.config.cjs
const { getDefaultConfig } = require('expo/metro-config');
const { withSvelteNative } = require('@example/svelte-native/metro');

module.exports = withSvelteNative(getDefaultConfig(__dirname), {
	uniwind: { cssEntryFile: './src/global.css' }
});
```

Import Svelte Native's Uniwind module and the CSS file in the app shell, then restart Metro:

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import '@example/svelte-native/uniwind';
	import '../global.css';
	// ...
</script>
```

Don't combine the configs with Uniwind's own `withUniwindConfig`: its resolver swaps React Native's components for React ones, which a Svelte Native app can't use. The `uniwind` option uses Uniwind's CSS compiler and leaves the resolver out.

### Writing classes

- `class` takes what it takes on a DOM element in Svelte: a string, an array or an object (`class={['card', selected && 'border-4']}`). On `View`, `Text`, `ScrollView`, `Image`, `ActivityIndicator` and `Pressable`, which a page compiles to native elements, `class:name={condition}` works too; Svelte allows no directive on other components, so write `class={{ name: condition }}` there.
- `dark:` follows the system's light or dark mode, and the views that use it change when the user switches. Breakpoints such as `md:` follow the window's width, so they change when the device turns.
- The safe-area utilities (`pt-safe`, `pb-safe`, `h-screen-safe`, ...) use the device's insets, the ones `<SafeAreaView>` adds.
- `style` wins over the classes, as an inline style wins over a stylesheet on the web: `<View class="bg-zinc-400" style={{ backgroundColor: '#f97316' }} />` is orange.
- Tailwind finds the classes you use by reading your source files, `.svelte` files included. A name built at run time (`` `bg-${color}-500` ``) isn't found: write each class in full.

Classes of your own go in the CSS file. Put them in Tailwind's `components` layer, so a utility next to one wins (`class="card border-4"`), as on the web. A class outside any layer wins over every utility.

```css
/// file: src/global.css
@layer components {
	.card {
		padding: 16px;
		border-radius: 12px;
		background-color: var(--color-white);

		@variant dark {
			background-color: var(--color-zinc-900);
		}
	}
}
```

### Not supported yet

- The state variants `active:`, `focus:` and `disabled:`.
- Uniwind's props that take classes for another prop, such as `contentContainerClassName` and `placeholderTextColorClassName`, and its React components and hooks (`withUniwind`, `useResolveClassNames`, `ScopedTheme`).
- `class` on `<Stack>`, `<Tabs>` and `<List>`, which take `style`, and on SVG elements.

## Layout

Layout is flexbox, with a few differences from the web:

- `flexDirection` is `'column'` by default. Use `'row'` to lay children out side by side.
- Sizes are numbers in density-independent pixels: `width: 48`, not `'48px'`. Percentages are strings: `width: '50%'`.
- `flex: 1` makes a view take the space left in its parent. A screen's top view usually has it.
- `gap`, `rowGap` and `columnGap` space the children.
- `position: 'absolute'` with `top`, `right`, `bottom`, `left` places a view relative to its parent.

```svelte
<View style={{ flex: 1, padding: 16, gap: 12 }}>
	<View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
		<View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#007aff' }} />
		<Text style={{ flex: 1 }}>The text takes the rest of the row.</Text>
	</View>
</View>
```

React Native's [layout props](https://reactnative.dev/docs/layout-props) page lists every layout key.

## Text styles

Font, colour and alignment go on a [`Text`](text): `fontSize`, `fontWeight`, `fontFamily`, `color`, `lineHeight`, `textAlign`, `letterSpacing`. A `View` can't style the text inside it. A `Text` inside another `Text` inherits its style and can override parts of it:

```svelte
<Text style={{ fontSize: 16, color: '#3c3c43' }}>
	Plain words and <Text style={{ fontWeight: '700' }}>bold words</Text>.
</Text>
```

## Shadows, borders and transforms

- **Borders:** `borderWidth`, `borderColor`, `borderRadius`, and per side (`borderTopWidth`, `borderTopLeftRadius`, ...).
- **Shadows:** iOS draws a shadow from `shadowColor`, `shadowOffset`, `shadowOpacity` and `shadowRadius`. Android draws one from `elevation`. Set both. For soft shadows on Android that match iOS, use [`ShadowedView`](native-views).
- **Transforms:** `transform: [{ rotate: '15deg' }, { scale: 1.2 }, { translateX: 8 }]` changes how a view is drawn without changing its layout. `opacity` fades it.

React Native's [View style props](https://reactnative.dev/docs/view-style-props) and [Text style props](https://reactnative.dev/docs/text-style-props) list every key.

## Light and dark mode

Native screens don't follow the system's appearance on their own: a `Text` without a colour is black, and a screen without a background shows the window behind it. `colorScheme.current` is `'light'` or `'dark'`, and anything that reads it (a template, a `$derived`, an `$effect`) updates when the user switches:

```svelte
<script lang="ts">
	import { colorScheme, Text, View } from '@example/svelte-native';

	const dark = $derived(colorScheme.current === 'dark');
</script>

<View style={{ flex: 1, backgroundColor: dark ? '#000000' : '#f2f2f7' }}>
	<Text style={{ color: dark ? '#ffffff' : '#000000' }}>Follows the system.</Text>
</View>
```

`svelte-native init` writes a small theme, `src/lib/theme.ts`, built on the same idea. Its `theme.colors` is the light or the dark palette:

```ts
/// file: src/lib/theme.ts
import { colorScheme } from '@example/svelte-native';

const light = { background: '#f2f2f7', surface: '#ffffff', text: '#000000', secondaryText: '#6c6c70', accent: '#007aff', onAccent: '#ffffff' };
const dark: typeof light = { background: '#000000', surface: '#1c1c1e', text: '#ffffff', secondaryText: '#98989f', accent: '#0a84ff', onAccent: '#ffffff' };

export const theme = {
	get colors() {
		return colorScheme.current === 'dark' ? dark : light;
	}
};
```

Give the root stack the background, so that every screen is opaque and a pushed screen covers the one below it as it slides in, and let the status bar pick light or dark icons:

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack } from '@example/svelte-native';
	import { theme } from '#lib/theme.ts';

	let { children }: { children: Snippet } = $props();
</script>

<Stack statusBar={{ style: 'auto' }} style={{ backgroundColor: theme.colors.background }}>
	{@render children()}
</Stack>
```

Then use `theme.colors` in your screens: `<Text style={{ color: theme.colors.text }}>`. Headers, tab bars, sheets and system controls ([`Switch`](switch), [`ActivityIndicator`](activity-indicator)) are the platform's and follow the system without help.

## Safe areas

The status bar, the camera cut-out and the home indicator cover the edges of the screen. A screen with a header is padded below it already. For content that reaches an edge, use [`SafeAreaView`](safe-area-view), or read the `insets` store ([Platform APIs](platform-apis)).
