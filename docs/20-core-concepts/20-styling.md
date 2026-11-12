---
title: Styling
video: styling
---

There is no CSS engine on the device. Each component takes a `style` prop: a plain object with React Native's style keys, in camelCase, with numbers for sizes. If you'd rather write classes, Tailwind's included, `class` works too ([Classes](#classes)).

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Text, View } from '@rasheed/svelte-native';
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
	import { Pressable, Text } from '@rasheed/svelte-native';

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

`class` takes Tailwind's utilities and classes of your own. Svelte Native compiles your CSS file to React Native styles when Metro starts: no CSS runs on the device, and a class becomes the same style object you'd write by hand. Without the setup below, `class` does nothing, and a warning in development says so.

```svelte
<View class="flex-row items-center gap-3 rounded-2xl bg-white p-4 dark:bg-zinc-900">
	<Text class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">A card</Text>
</View>
```

> **warning** Classes come after 0.4.0-rc.3: in that release, `class` does nothing. Until the next release, install from `main` with `#main&path:packages/svelte-native` in place of the tag.

### Set up classes

Install Tailwind, at the version Svelte Native is made for:

```sh
pnpm add -D tailwindcss@4.3.3
```

Create the CSS file. A SvelteKit app can use the same file for its web pages, with Tailwind's Vite plugin:

```css
/// file: src/global.css
@import 'tailwindcss';
```

Give its path to Metro, and restart Metro:

```js
/// file: metro.config.cjs
const { getDefaultConfig } = require('expo/metro-config');
const { withSvelteNative } = require('@rasheed/svelte-native/metro');

module.exports = withSvelteNative(getDefaultConfig(__dirname), { css: 'src/global.css' });
```

There is nothing to import. Metro writes the compiled classes to `.svelte-native/` when it starts, and again when you save a file under `src/` or the CSS file, and the screens that use them change in place. `svelte-native css src/global.css` runs the same compile by hand.

### Writing classes

- `class` takes what it takes on a DOM element in Svelte: a string, an array or an object (`class={['card', selected && 'border-4']}`). On `View`, `Text`, `ScrollView`, `Image`, `ActivityIndicator` and `Pressable`, which a page compiles to native elements, `class:name={condition}` works too; Svelte allows no directive on other components, so write `class={{ name: condition }}` there.
- `dark:` follows the system's light or dark mode, and the views that use it change when the user switches. Breakpoints (`sm:`, `md:`, `max-md:`, ...) follow the window's width, so they change when the device turns.
- `style` wins over the classes, as an inline style wins over a stylesheet on the web: `<View class="bg-zinc-400" style={{ backgroundColor: '#f97316' }} />` is orange.
- Layout is React Native's: `flex` doesn't make a row, because a view is already a flex column. Add `flex-row` for a row.
- Safe areas: `pt-[env(safe-area-inset-top)]` and the other `env(safe-area-inset-*)` values use the device's insets, the ones `<SafeAreaView>` adds.
- Line height and letter spacing in Tailwind's units (`leading-tight`, `tracking-wide`) are relative to the font size set on the same element, by a class (`text-lg`) or its `style`; with neither, to 14. A parent `Text`'s size isn't seen, so give the element its size.
- Tailwind finds the classes you use by reading your files under `src/`. A name built at run time (`` `bg-${color}-500` ``) isn't found: write each class in full.

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

Your theme works as on the web: `@theme { --color-brand: oklch(55% 0.2 260); }` gives `bg-brand`, `text-brand` and the rest.

### What isn't supported

A class that has no native equivalent is left out, and using one prints why in development. So does a class that is only partly supported, such as `truncate`, whose ellipsis has no style key (use `<Text numberOfLines={1}>`):

- States and structure: `hover:`, `active:`, `focus:`, `disabled:`, `placeholder:`, `group-*`, `peer-*`, `first:`, `space-*`, `divide-*` (pseudo-classes and child selectors).
- Layout and effects React Native doesn't have: `grid`, `fixed` and `sticky` positions, transitions and animations, `filter` and `backdrop-blur` (use [`<BlurView>`](blur-view)), gradients (`bg-linear-*`, `from-*`), `ring-*`, percentage translations (`-translate-x-1/2`).
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
	import { colorScheme, Text, View } from '@rasheed/svelte-native';

	const dark = $derived(colorScheme.current === 'dark');
</script>

<View style={{ flex: 1, backgroundColor: dark ? '#000000' : '#f2f2f7' }}>
	<Text style={{ color: dark ? '#ffffff' : '#000000' }}>Follows the system.</Text>
</View>
```

`svelte-native init` writes a small theme, `src/lib/theme.ts`, built on the same idea. Its `theme.colors` is the light or the dark palette:

```ts
/// file: src/lib/theme.ts
import { colorScheme } from '@rasheed/svelte-native';

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
	import { Stack } from '@rasheed/svelte-native';
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
