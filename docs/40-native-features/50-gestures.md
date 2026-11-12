---
title: Gestures
video: gestures
---

Drags, pinches, swipes and long presses are recognised by the platform, with [react-native-gesture-handler](https://docs.swmansion.com/react-native-gesture-handler/). `@example/svelte-native/gestures` puts its gestures on Svelte views. You build a gesture with the library's own builders, and attach it to a view with `gesture={...}`.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen } from '@example/svelte-native';
	import { AnimatedView, createSharedValue, withSpring } from '@example/svelte-native/animation';
	import { Gesture } from '@example/svelte-native/gestures';

	const x = createSharedValue(0);
	const y = createSharedValue(0);

	const drag = Gesture.Pan()
		.onUpdate((event) => {
			x.value = event.translationX;
			y.value = event.translationY;
		})
		.onEnd(() => {
			x.value = withSpring(0);
			y.value = withSpring(0);
		});
</script>

<Screen title="Drag">
	<AnimatedView
		gesture={drag}
		style={{ width: 96, height: 96, borderRadius: 16, backgroundColor: '#0091ff' }}
		animatedStyle={() => {
			'worklet';
			return { transform: [{ translateX: x.value }, { translateY: y.value }] };
		}}
	/>
</Screen>
```

The box follows the finger and springs back when you let go. The gesture's callbacks run on the UI thread, so the drag stays smooth while JavaScript is busy. For a plain tap, use [`Pressable`](pressable) instead: it's simpler and accessible by default.

## Building a gesture

`Gesture` has the library's builders, with their configuration and callbacks unchanged:

| Builder | Recognises |
| --- | --- |
| `Gesture.Tap()` | One or more taps. `.numberOfTaps(2)` for a double tap. |
| `Gesture.LongPress()` | A press held for `.minDuration(ms)`. |
| `Gesture.Pan()` | A drag. `.activeOffsetX([-10, 10])` and friends decide when it starts. |
| `Gesture.Fling()` | A quick swipe in a `.direction(...)`. |
| `Gesture.Pinch()` | Two fingers moving apart or together: `event.scale`. |
| `Gesture.Rotation()` | Two fingers turning: `event.rotation`, in radians. |
| `Gesture.Native()` | Lets a native scrolling view take part in the arbitration. |
| `Gesture.Manual()` | A gesture whose state you drive yourself. |

Each has the callbacks `onBegin`, `onStart`, `onUpdate`, `onChange`, `onEnd` and `onFinalize`, and the touch callbacks `onTouchesDown`, `onTouchesMove`, `onTouchesUp` and `onTouchesCancelled`. The module also exports the library's constants: `State`, `Directions`, `PointerType`.

To recognise several gestures on one view, compose them:

- `Gesture.Simultaneous(a, b)` recognises both at once, such as a pinch and a rotation.
- `Gesture.Race(a, b)` lets the first one to start win.
- `Gesture.Exclusive(a, b)` tries `a` first and `b` only if `a` fails, such as a double tap before a single tap.

```ts
const pinchAndRotate = Gesture.Simultaneous(
	Gesture.Pinch().onUpdate((event) => { scale.value = event.scale; }),
	Gesture.Rotation().onUpdate((event) => { angle.value = event.rotation; })
);
```

Relations across views work too: `simultaneousWithExternalGesture`, `requireExternalGestureToFail` and `blocksExternalGesture` take gestures attached to other views, in other components.

## Attaching a gesture

`gesture={...}` works on `View`, `Pressable`, `ScrollView`, `Image`, `Text` and `AnimatedView`. Set it to `undefined` to detach the gesture. One gesture object drives one view: build another for a second view.

Two other forms do the same:

- `<GestureDetector gesture={g}>...</GestureDetector>` is a `View` that carries the gesture, for wrapping content you don't control.
- `use:gesture={g}` is an action, for a native element.

```svelte
<script lang="ts">
	import { Text } from '@example/svelte-native';
	import { Gesture, GestureDetector } from '@example/svelte-native/gestures';

	let liked = $state(false);
	const doubleTap = Gesture.Tap().numberOfTaps(2).runOnJS(true).onEnd(() => (liked = !liked));
</script>

<GestureDetector gesture={doubleTap}>
	<Text>{liked ? 'Liked' : 'Double-tap to like'}</Text>
</GestureDetector>
```

## UI thread or JavaScript thread

A gesture whose callbacks are all worklets runs on the UI thread. An inline callback in a `Gesture.X().onY(...)` chain is a worklet automatically. On the UI thread a callback can capture:

- shared values, numbers, strings and plain objects;
- other worklets, and plain functions through `runOnJS`.

It can't capture `$state`, `$derived` or props. To change Svelte state from a UI callback, call a JavaScript function with `runOnJS`:

```ts
import { runOnJS } from '@example/svelte-native/gestures';

let held = $state(0);
const markHeld = () => (held += 1);

const hold = Gesture.LongPress()
	.minDuration(600)
	.onStart(() => {
		runOnJS(markHeld)();
	});
```

In a development build, a UI callback that captures Svelte state throws when the gesture attaches, naming the callback and the variable.

A gesture with `.runOnJS(true)`, or with any callback that isn't a worklet, runs entirely on the JavaScript thread instead. There, callbacks can read and change Svelte state directly, as in the double tap above. Don't mix the two kinds of callback in one gesture.

## Load order

The first `Gesture` or `createSharedValue` call loads Reanimated. A worklet defined before that captures placeholders instead of `withSpring`, `runOnJS` and the other helpers. Create your shared values or gestures first, and write helper worklets below them, as the examples on this page do.

## Accessibility

A screen reader can't perform a drag or a swipe. Give everything a gesture can do a second way that it can: a button, or `accessibilityActions` on the view:

```svelte
<AnimatedView
	gesture={hold}
	accessible
	accessibilityRole="button"
	accessibilityLabel="Hold me"
	accessibilityActions={[{ name: 'activate', label: 'Count a hold' }]}
	onAccessibilityAction={markHeld}
/>
```

A swipeable row needs a delete button or an action; a carousel needs next and previous.

## Not supported

The library's React components aren't available: `PanGestureHandler` and the other handler components, `Swipeable`, `ReanimatedSwipeable`, `DrawerLayout`, its buttons and touchables, and `GestureHandlerRootView` (which an app doesn't need). Build those from the gestures above. `Gesture.ForceTouch` isn't supported either.
