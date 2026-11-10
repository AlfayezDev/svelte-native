---
title: Animation
---

Animations in Svelte Native run on the UI thread, with [Reanimated](https://docs.swmansion.com/react-native-reanimated/), so they stay smooth while JavaScript is busy. `@rasheed/svelte-native/animation` gives you an `AnimatedView`, shared values to animate, and Reanimated's helpers that move them.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text } from '@rasheed/svelte-native';
	import { AnimatedView, createSharedValue, withSpring } from '@rasheed/svelte-native/animation';

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

Reanimated and its worklets are part of every Svelte Native app. They load the first time you call `createSharedValue` or another function from this module.

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
	import { Switch } from '@rasheed/svelte-native';
	import { AnimatedView, createSharedValue, withTiming } from '@rasheed/svelte-native/animation';

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

The same rule makes runes mode matter. Svelte Native compiles your components in runes mode, where state is only what `$state` and `$derived` declare. A component in legacy mode (one with `<svelte:options runes={false} />`) treats a variable the markup changes as state, even a `const` shared value, and its worklets can't capture it. Give such a component `<svelte:options runes />`.

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
