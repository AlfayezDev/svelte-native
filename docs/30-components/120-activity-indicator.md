---
title: ActivityIndicator
---

`ActivityIndicator` is the platform's spinner: a Material progress circle on Android, a `UIActivityIndicatorView` on iOS. Show it while something loads.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { ActivityIndicator, Screen, Text, View } from '@rasheed/svelte-native';

	const posts = fetch('https://api.example.com/posts').then((response) => response.json());
</script>

<Screen title="Posts">
	{#await posts}
		<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
			<ActivityIndicator size="large" color="#ff3e00" accessibilityLabel="Loading posts" />
		</View>
	{:then list}
		<Text>{list.length} posts</Text>
	{/await}
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `size` | `'small' \| 'large' \| number` | `'small'` | The spinner's size. A number, in points, works on Android only. |
| `color` | `string` | the system's | The spinner's colour. |
| `animating` | `boolean` | `true` | Whether it spins. |
| `hidesWhenStopped` | `boolean` | `true` | iOS: hides the spinner while it doesn't spin. |
| `accessibilityLabel` | `string` | | What a screen reader says, such as "Loading posts". |
| `style` | `ViewStyle` | | Layout. |

It also takes the other props of React Native's [`ActivityIndicator`](https://reactnative.dev/docs/activityindicator).
