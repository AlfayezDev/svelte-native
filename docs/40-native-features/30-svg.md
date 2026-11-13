---
title: SVG
video: svg
---

`@alfayez/svelte-native/svg` draws vector graphics with [react-native-svg](https://github.com/software-mansion/react-native-svg), as Svelte components. The elements and their props are the ones you know from SVG on the web, written in camelCase (`strokeWidth`, `stopColor`).

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen } from '@alfayez/svelte-native';
	import { Circle, Defs, LinearGradient, Rect, Stop, Svg, Text as SvgText } from '@alfayez/svelte-native/svg';
</script>

<Screen title="SVG">
	<Svg width={96} height={64} viewBox="0 0 96 64">
		<Defs>
			<LinearGradient id="card" x1="0" y1="0" x2="1" y2="1">
				<Stop offset="0" stopColor="#ff7a18" />
				<Stop offset="1" stopColor="#319197" />
			</LinearGradient>
		</Defs>
		<Rect width="96" height="64" rx="12" fill="url(#card)" />
		<Circle cx="24" cy="32" r="6" fill="#fff" />
		<SvgText x="48" y="38" fill="#fff" fontSize="14" fontWeight="bold">SVG</SvgText>
	</Svg>
</Screen>
```

Install the library and build again, as for any [native view](native-views):

```sh
npx expo install react-native-svg
pnpm exec expo prebuild --platform android
pnpm android
```

## Elements

| Kind | Components |
| --- | --- |
| Root | `Svg` (also the default export) |
| Shapes | `Rect`, `Circle`, `Ellipse`, `Line`, `Polygon`, `Polyline`, `Path` |
| Text | `Text`, `TSpan`, `TextPath` |
| Structure | `G`, `Defs`, `Use`, `Symbol`, `Image`, `ForeignObject` |
| Paint | `LinearGradient`, `RadialGradient`, `Stop`, `Pattern`, `Mask`, `ClipPath`, `Marker` |
| Filters | `Filter`, `FeBlend`, `FeColorMatrix`, `FeComposite`, `FeDropShadow`, `FeFlood`, `FeGaussianBlur`, `FeMerge`, `FeMergeNode`, `FeOffset` |
| Documents | `SvgXml`, `SvgUri` |

`Text` and `Image` here are the SVG elements, and their names clash with the primitives of `@alfayez/svelte-native`. Import them under another name when you use both: `import { Text as SvgText } from '@alfayez/svelte-native/svg'`.

Inside a `Text` or `TextPath`, a string is a text span of its own. Whitespace between elements counts as text, as in HTML.

## Drawing a document

`SvgXml` draws an SVG document from a string, and `SvgUri` from a URL, a file or a data URI. This is the way to use icons exported from a design tool:

```svelte
<script lang="ts">
	import { SvgXml } from '@alfayez/svelte-native/svg';

	const check = `<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="#191b1e" stroke-width="2"/></svg>`;
</script>

<SvgXml xml={check} width={24} height={24} />
```

Both take `onError` and a `fallback` snippet, shown when the document can't be drawn; `SvgUri` also calls `onLoad` once the document has loaded. Style sheets inside the document (`SvgCss`) aren't supported.

## The ref handle

An element's `ref` gets a handle with the library's geometry functions: `getBBox(options)`, `getTotalLength()`, `getPointAtLength(length)`, `isPointInFill({ x, y })`, `isPointInStroke({ x, y })`, `getCTM()` and `getScreenCTM()`. The results are plain objects. The `Svg`'s handle also has `toDataURL(callback, options)`, which renders the drawing to a base64 PNG.

```svelte
<script lang="ts">
	import { Path, Svg, type SvgHandle } from '@alfayez/svelte-native/svg';

	let length = $state(0);
</script>

<Svg width={100} height={40}>
	<Path d="M0 20 Q50 0 100 20" stroke="#000" fill="none" ref={(handle: SvgHandle | null) => { if (handle) length = handle.getTotalLength() ?? 0; }} />
</Svg>
```

## Animation

`animatedProps` on any element is a worklet that returns the props to animate. It runs on the UI thread and reads shared values, as `animatedStyle` does on an [`AnimatedView`](animation):

```svelte
<script lang="ts">
	import { createSharedValue, withRepeat, withTiming } from '@alfayez/svelte-native/animation';
	import { Circle, Svg } from '@alfayez/svelte-native/svg';

	const radius = createSharedValue(6);
	radius.value = withRepeat(withTiming(12, { duration: 800 }), -1, true);
</script>

<Svg width={48} height={48}>
	<Circle cx="24" cy="24" r="6" fill="#0091ff" animatedProps={() => { 'worklet'; return { r: radius.value }; }} />
</Svg>
```

Animate numbers (`r`, `cx`, `strokeDashoffset`, `opacity`), a path's `d`, or a colour (`fill`, `stroke`) given as a CSS string such as `'#ff8000'` or `'rgba(0, 128, 255, 0.5)'`.

## Touches

Elements take `onPress`, `onLongPress`, `onPressIn` and `onPressOut`. On Android, a touch inside an `Svg` goes to the native view and never reaches JavaScript, so a shape's `onPress` doesn't run there. To make a drawing tappable on both platforms, give the `Svg` `pointerEvents="box-only"` and put `onPress` on the `Svg` itself, or wrap it in a [`Pressable`](pressable).
