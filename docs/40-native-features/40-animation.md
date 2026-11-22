---
title: Animation
video: animation
---

Animations in Expo Svelte run on the UI thread, with [Reanimated](https://docs.swmansion.com/react-native-reanimated/), so they stay smooth while JavaScript is busy. `expo-svelte` gives you an `AnimatedView`, shared values to animate, and Reanimated's helpers that move them.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { AnimatedView, Pressable, Screen, Text, createSharedValue, withSpring } from 'expo-svelte';

	const x = createSharedValue(0);
	let right = $state(false);

	function move() {
		right = !right;
		x.value = withSpring(right ? 160 : 0);
	}
</script>

<Screen title="Spring">
	<AnimatedView
		style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: '#0091ff' }}
		animatedStyle={() => {
			'worklet';
			return { transform: [{ translateX: x.value }] };
		}}
	/>
	<Pressable onPress={move} accessibilityRole="button">
		<Text>Move</Text>
	</Pressable>
</Screen>
```

There are three parts:

- A **shared value** holds a number (or any value) that both threads can read. `createSharedValue(0)` makes one; set `.value` to change it.
- An **animation helper** such as `withSpring` or `withTiming` moves a shared value to a target over time, on the UI thread.
- A **worklet** turns shared values into style. `animatedStyle` is a function marked `'worklet'`, which runs on the UI thread every frame the values change.

Reanimated and its worklets are part of every Expo Svelte app: the library carries them (they are not dependencies of your app) and compiles your worklets with its copy of the Worklets plugin. They load the first time you call `createSharedValue` or another animation function.

## AnimatedView

`AnimatedView` is a [`View`](view) that can be animated. It takes every prop of `View`, and:

| Prop | Description |
| --- | --- |
| `animatedStyle` | A worklet returning the style to animate, or an array of them, which are merged. |
| `animatedProps` | A worklet returning props that aren't style, or an array of them. |
| `entering`, `exiting`, `layout` | Reanimated's layout animations: how the view appears, leaves, and moves when the layout changes. |
| `gesture` | A gesture from [Gestures](gestures). |

The `style` keys of Reanimated's CSS animations and transitions work too: see [CSS animations](#css-animations).

## Shared values

```ts
const opacity = createSharedValue(1);
opacity.value = withTiming(0, { duration: 500 });
```

Call `createSharedValue` while the component initialises, at the top of its script. When the component is destroyed, the animation running on its shared value is cancelled.

The helpers are Reanimated's own, with the same options:

| Function | What it does |
| --- | --- |
| `withTiming(to, { duration, easing }?)` | Moves to `to` over a duration (300 ms by default), along an `Easing` curve. |
| `withSpring(to, { damping, stiffness, mass, ... }?)` | Moves to `to` with spring physics. |
| `withRepeat(animation, count, reverse?)` | Repeats an animation. `-1` repeats forever; `reverse` goes back and forth. |
| `withSequence(...animations)` | Runs animations one after another. |
| `withDelay(ms, animation)` | Starts an animation after a delay. |
| `cancelAnimation(sharedValue)` | Stops the animation of a shared value where it is. |

`Easing` has Reanimated's curves (`Easing.inOut(Easing.cubic)`, `Easing.bezier(...)`). Every helper respects the system's reduce motion setting by default; pass `reduceMotion: ReduceMotion.Never` in its options for an animation that must always run.

## Driving an animation from state

A worklet runs on the UI thread, where Svelte's state doesn't exist, so a worklet can't read `$state`, `$derived` or a prop. Read the state in JavaScript and write the target into a shared value; the worklet reads the shared value:

```svelte
<script lang="ts">
	import { AnimatedView, Switch, createSharedValue, withTiming } from 'expo-svelte';

	let big = $state(false);
	const grow = createSharedValue(0);

	$effect(() => {
		grow.value = withTiming(big ? 1 : 0, { duration: 250 });
	});
</script>

<Switch bind:value={big} accessibilityLabel="Big" />
<AnimatedView
	style={{ width: 56, height: 56, backgroundColor: '#0091ff' }}
	animatedStyle={() => {
		'worklet';
		return { transform: [{ scale: 1 + 0.6 * grow.value }] };
	}}
/>
```

A worklet that reads Svelte state fails the build, with the name of the variable, rather than crashing on the device.

The same rule makes runes mode matter. Expo Svelte compiles your components in runes mode, where state is only what `$state` and `$derived` declare. A component in legacy mode (one with `<svelte:options runes={false} />`) treats a variable the markup changes as state, even a `const` shared value, and its worklets can't capture it. Give such a component `<svelte:options runes />`.

## CSS animations

For motion that repeats or decorates, such as a pulse, a spinner or a shimmer, use Reanimated's CSS animation keys in the `style` of an `AnimatedView`. They run in native code with no worklet, and cost less than a worklet that does the same:

```svelte
<AnimatedView
	style={{
		width: 56,
		height: 56,
		backgroundColor: '#0091ff',
		animationName: { from: { transform: [{ scale: 0.7 }] }, to: { transform: [{ scale: 1.2 }] } },
		animationDuration: '700ms',
		animationIterationCount: 'infinite',
		animationDirection: 'alternate',
		animationTimingFunction: 'ease-in-out'
	}}
/>
```

`transitionProperty`, `transitionDuration` and the other transition keys animate a style key whenever its value changes, without a shared value. Here `visible` is ordinary `$state`:

```svelte
<AnimatedView style={{ opacity: visible ? 1 : 0, transitionProperty: 'opacity', transitionDuration: '200ms' }} />
```

Use worklets when the motion follows state, a gesture or a value that changes every frame; use CSS keys for the rest.

## Svelte transitions

Svelte's `transition:`, `in:`, `out:` and `animate:` work on the HTML elements you write, with the functions from `svelte/transition` and `svelte/animate`:

```svelte
<script>
  import { fade, fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';

  let open = $state(false);
  let items = $state([1, 2, 3]);
</script>

{#if open}
  <div in:fly={{ y: 24 }} out:fade>
    <p>Hello</p>
  </div>
{/if}

<ul>
  {#each items as item (item)}
    <li animate:flip={{ duration: 250 }}>{item}</li>
  {/each}
</ul>
```

Svelte decides when a transition runs and works out its frames, as on the web. The library then plays those frames on the UI thread, so a busy script doesn't make them stutter. An `in:` that turns into an `out:` carries on from where it was. `animate:flip` moves each item of a keyed `{#each}` from where it was.

What plays:

- `opacity` and transforms: `translate`, `scale`, `rotate`, `skew` and `perspective`. These are the cheapest to animate.
- Lengths and percentages, such as `height`, `width`, `padding`, `margin` and border widths. These cost a layout pass per frame, so `slide` costs more than `fade`.
- Colours.

What doesn't:

- `filter`, so `blur` fades without blurring.
- SVG stroke properties, so `draw` does nothing.
- `matrix()` and the 3D transform functions.

A transition skips what doesn't play and still plays the rest; in development you get one warning. A transition that only has `tick` runs on the JavaScript thread. While an element plays its outro, it takes no touches.

An item can show a single frame in the wrong place when it is reordered while its `animate:flip` is still running, or in the few frames after an animation ends. Reanimated keeps the last values it drew a view with and applies them over the next layout until it has been told to forget them; the library does that as soon as it can, but not before the new animation's first frame is committed. The item is never left in the wrong place: the next frame draws it correctly. The first reorder after the app starts can show the new order for a frame or two before the items start from where they were, while the animation layer runs for the first time.

Write the directives on HTML elements (`div`, `p`, `li`, `button`, `img`, ...). Svelte takes a directive only on an element, so `svelte-check` reports one on a component such as `<View in:fly>`, even though Metro compiles it; `<div in:fly>` is checked, and builds the same native view. The elements that are components in their own right, `input`, `textarea` and `dialog`, take none: the build leaves it out and warns. On a `span` or other text inside a paragraph a transition runs its length and draws nothing, because React Native draws it as part of the paragraph.

## Running code on either thread

| Function | What it does |
| --- | --- |
| `runOnUISync(worklet, ...args)` | Runs a worklet on the UI thread and returns its result. |
| `runOnUIAsync(worklet, ...args)` | Runs a worklet on the UI thread and resolves with its result. |
| `runOnJS(fn)(...args)` | From a worklet, calls a plain JavaScript function on the JavaScript thread, where it can change Svelte state. |
| `scheduleOnRN(fn, ...args)` | The same as `runOnJS`, in Reanimated 4's newer form. |

`runOnJS` is how a [gesture](gestures) or an animation's end callback reaches your state:

```ts
const done = () => (finished = true);
x.value = withTiming(100, undefined, (completed) => {
	'worklet';
	if (completed) runOnJS(done)();
});
```

## Animating other views

`animatedProps` works on more than `AnimatedView`: on any element, next to `animatedStyle`. [SVG](svg#animation) elements animate their geometry with it, and [`AnimateableText`](native-views#animateabletext) its string.
