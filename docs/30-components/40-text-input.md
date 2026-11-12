---
title: TextInput
group: Basics
video: text-input
---

`TextInput` is a native text field, single-line or multi-line. Bind its `value` to a variable, as you would an `input` on the web. The platform draws it, so it has the system keyboard, selection, autocorrect and autofill.

```svelte
<!--- file: src/routes/+mobile.svelte --->
<script lang="ts">
	import { Screen, Text, TextInput, View } from '@example/svelte-native';

	let name = $state('');
</script>

<Screen title="Your name">
	<View style={{ padding: 20, gap: 12 }}>
		<TextInput
			bind:value={name}
			placeholder="Name"
			placeholderTextColor="#9ca3af"
			autoCapitalize="words"
			accessibilityLabel="Name"
			style={{ minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#d1d5db', fontSize: 16 }}
		/>
		<Text>{name === '' ? 'Nothing typed yet.' : `Hello, ${name}`}</Text>
	</View>
</Screen>
```

A `TextInput` has no border or padding of its own. Give it a style, and a `minHeight` of 48 so it's easy to tap.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | `''` | The text. Use `bind:value` to keep a variable and the field in step. |
| `onChangeText` | `(text: string) => void` | | Called on every edit, after the bound `value` is updated. |
| `placeholder` | `string` | | Shown while the field is empty. |
| `placeholderTextColor` | `string` | | The placeholder's colour. |
| `multiline` | `boolean` | `false` | Allows several lines. Return inserts a line break instead of submitting. |
| `maxLength` | `number` | | The most characters the field accepts. |
| `editable` | `boolean` | `true` | `false` makes the field read-only. |
| `keyboardType` | `'default' \| 'email-address' \| 'numeric' \| 'phone-pad' \| 'number-pad' \| 'decimal-pad' \| 'url'` | `'default'` | Which keyboard opens. |
| `secureTextEntry` | `boolean` | `false` | Hides the text, for passwords. |
| `autoCapitalize` | `'none' \| 'sentences' \| 'words' \| 'characters'` | `'sentences'` | Which letters the keyboard capitalises. |
| `autoCorrect` | `boolean` | `true` | Autocorrect. Turn it off for email addresses and user names. |
| `autoComplete`, `textContentType` | `string` | | What the field holds (`'email'`, `'password'`, `'one-time-code'`, ...), for autofill and password managers. |
| `returnKeyType` | `'done' \| 'go' \| 'next' \| 'search' \| 'send'` | | The label of the return key. |
| `onSubmitEditing` | `(event) => void` | | The return key was pressed, in a single-line field. |
| `onFocus`, `onBlur` | `(event) => void` | | The field gained or lost focus. |
| `autoFocus` | `boolean` | `false` | Focuses the field, and opens the keyboard, when it mounts. |
| `ref` | `(handle \| null) => void` | | Receives the field's handle. See [ref](#ref). |
| `style` | `TextStyle` | | Text style and layout. |
| `class` | `ClassValue` | | A list of classes: a string, an array or an object, as on a DOM element in Svelte. Their style goes under `style`, which wins. Needs the `css` option ([Classes](styling#classes)). |
| `accessibilityLabel` | `string` | | What a screen reader calls the field. A placeholder isn't a label. |

It also takes the other props of React Native's [`TextInput`](https://reactnative.dev/docs/textinput).

## ref

The handle has the methods of React Native's `TextInput`:

| Method | Description |
| --- | --- |
| `focus()` | Focuses the field and opens the keyboard. |
| `blur()` | Takes the focus away and closes the keyboard. |
| `measure(callback)` | As on a [`View`](view#ref). |

`clear()` isn't there: set the bound value to `''` instead.

A form that moves from field to field when the user presses return:

```svelte
<script lang="ts">
	import { TextInput, View } from '@example/svelte-native';

	let email = $state('');
	let password = $state('');
	let passwordField: { focus(): void } | null = null;

	function submit() {
		console.log(email, password);
	}
</script>

<View style={{ gap: 12 }}>
	<TextInput
		bind:value={email}
		keyboardType="email-address"
		autoCapitalize="none"
		autoCorrect={false}
		autoComplete="email"
		returnKeyType="next"
		onSubmitEditing={() => passwordField?.focus()}
		placeholder="Email"
		accessibilityLabel="Email"
	/>
	<TextInput
		bind:value={password}
		ref={(handle) => (passwordField = handle)}
		secureTextEntry
		autoComplete="password"
		returnKeyType="done"
		onSubmitEditing={submit}
		placeholder="Password"
		accessibilityLabel="Password"
	/>
</View>
```

## Forms and the keyboard

- Put a form in a [`KeyboardAvoidingView`](keyboard-avoiding-view) so the keyboard doesn't cover the field being edited.
- In a [`ScrollView`](scroll-view), set `keyboardShouldPersistTaps="handled"`: otherwise the first tap on a button while the keyboard is open only closes the keyboard.
- `Keyboard.dismiss()` from `@example/svelte-native/platform` closes the keyboard from code.
- A remote function's `form` gives the props of a field to spread onto a `TextInput`: see [loading data](loading-data).
