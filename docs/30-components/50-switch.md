---
title: Switch
---

`Switch` is the platform's on/off toggle: a Material switch on Android, a `UISwitch` on iOS. Bind its `value` to a boolean.

```svelte
<!--- file: src/routes/settings/+mobile.svelte --->
<script lang="ts">
	import { Screen, Switch, Text, View } from '@rasheed/svelte-native';

	let notifications = $state(true);
</script>

<Screen title="Settings">
	<View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 }}>
		<Text style={{ fontSize: 16 }}>Notifications are {notifications ? 'on' : 'off'}</Text>
		<Switch bind:value={notifications} accessibilityLabel="Notifications" />
	</View>
</Screen>
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `boolean` | `false` | Whether the switch is on. Use `bind:value`. |
| `onValueChange` | `(value: boolean) => void` | | Called when the user flips it, after the bound `value` is updated. |
| `disabled` | `boolean` | `false` | The user can't flip it. |
| `trackColor` | `{ false?: string; true?: string }` | | The track's colour when off and when on. |
| `thumbColor` | `string` | | The colour of the knob. |
| `ios_backgroundColor` | `string` | | iOS: the colour behind the track when it's off. |
| `accessibilityLabel` | `string` | | What a screen reader calls the switch. A switch has no text of its own, so give it one. |

It also takes the other props of React Native's [`Switch`](https://reactnative.dev/docs/switch).

The label next to a switch is a separate `Text`. To let the user flip the switch by tapping its label too, wrap both in a [`Pressable`](pressable) whose `onPress` flips the value.
