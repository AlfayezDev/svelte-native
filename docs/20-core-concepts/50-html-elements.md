---
title: HTML elements
---

You can write a native screen with HTML elements. `<div>`, `<p>`, `<button>`, `<a href>`, `<img>`, `<input>` and the rest of the list below become native components when the app is built for a phone, so one `.svelte` file can be a SvelteKit page in the browser and a screen on the device. You import a component from the library only for what HTML can't say: [`ScrollView`](scroll-view), [`List`](list), [`Screen`](screen), gestures, [`BlurView`](blur-view).

```svelte
<!--- file: src/lib/ContactCard.svelte --->
<script lang="ts">
	let { name, email, onremove }: { name: string; email: string; onremove: () => void } = $props();
	let note = $state('');
</script>

<div class="rounded-xl bg-white p-4">
	<h2 class="text-lg font-semibold">{name}</h2>
	<p class="text-gray-500">{email}</p>
	<input bind:value={note} placeholder="A note" class="mt-2 rounded border p-2" />
	<button onclick={onremove} class="mt-3 rounded bg-blue-500 px-4 py-2 text-white">Remove</button>
</div>
```

Nothing is imported, and the file means the same in both places. In the browser it is HTML. On the device it is a `View`, two `Text`s, a `TextInput` and a `Pressable`.

## Where it applies

The change happens in the build for the device. The web build never sees it, so a file is HTML there, exactly as you wrote it.

It applies to the files of your app: routes (`+page.svelte`, `+mobile.svelte`), components in `src/lib`, and packages of your own workspace. It doesn't apply to Svelte libraries in `node_modules`, which keep their markup as written. A native-only file can mix both ways: `import { ScrollView } from '@rasheed/svelte-native'` beside `<div>` works.

## The elements

| HTML | On the device | What changes |
| --- | --- | --- |
| `div` `section` `header` `footer` `main` `nav` `article` `aside` `ul` `ol` `li` `form` `label` `figure` `fieldset` `dl` `dd` | [`View`](view) | A `View` with `onclick` is pressable. |
| `p` `span` `h1`–`h6` `strong` `b` `em` `i` `small` `code` `blockquote` `figcaption` `dt` `mark` `kbd` `time` `abbr` `s` `u` `del` `ins` `q` `cite` `sub` `sup` `var` `samp` `dfn` `data` | [`Text`](text) | `h1`–`h6` get the `header` role. A text inside a text is a span of it. |
| `pre` | `Text` | Spaces and newlines are kept as written. |
| `br` | a newline | Only inside text; elsewhere it's an error. |
| `hr` | `View` | A hairline (grey, 8 points of margin above and below). Its class or style changes it. |
| `button` | [`Pressable`](pressable) | The `button` role. `type` is dropped. A submit button submits its form. |
| `a` | `Pressable` (`Text` inside text) | The `link` role. A press follows `href`. |
| `img` | [`Image`](image) | `src` is the source. `alt` is its label. |
| `input` (`text`, `email`, `password`, `number`, `search`, `url`, `tel`) and `textarea` | [`TextInput`](text-input) | `type` picks the keyboard. `bind:value` works. |
| `input type="checkbox"` | [`Switch`](switch) | `bind:checked` works. |
| `dialog` | [`Modal`](modal) | `open` is `visible`. |

Everything on an element carries over: `class`, `class:name`, `style`, `{...spread}`, `bind:this`, `use:`, and the `in:`, `out:`, `transition:` and `animate:` directives. You can use `{#if}`, `{#each}` and snippets inside any of them, as usual.

## Text

A string, or an `{expression}`, directly inside a `div` (or any element that becomes a `View`) is wrapped in a `Text` for you. A browser would show it as a line, and so does the device:

```svelte
<div class="p-4">
	Hello {name}, you have <b>{count}</b> messages.
</div>
```

Here the string, the expression and the `<b>` are one `Text`, with the `<b>` as a span of it. A `div` with only elements in it gets no `Text`.

Whitespace is as in a `Text`: the edges are trimmed and the rest is kept as written ([Text](text)). The one exception is `pre`, which keeps all of it.

## Text style is inherited

In a browser, `class="text-lg text-white"` on a `div` or a `button` styles the text inside it. On the device it does too:

```svelte
<button class="rounded bg-blue-500 px-4 py-2 text-white">Save</button>
<div class="text-lg leading-snug">
	<p>This text is 18 points, with a line height of 1.375 of that.</p>
</div>
```

The keys that inherit are the ones CSS inherits for text: `color`, `fontSize`, `fontWeight`, `fontFamily`, `fontStyle`, `lineHeight`, `letterSpacing`, `textAlign`, `textTransform`, the `textDecoration` keys and `fontVariant`. They go from the classes and the `style` of an HTML element to the text and the inputs below it, through the elements between them. A text's own style wins, and when a parent's class changes, the text below it follows.

Only elements that came from HTML take part. A `View` or a `Text` you import has React Native's rules: a `View` gives no text style and doesn't stop one, and a `Text` takes none from the elements above it.

A `line-height` without a unit, and a `letter-spacing` in `em`, are a factor of the font size, and they stay a factor while they inherit: `leading-snug` on a paragraph is 1.25 of the font size the paragraph ends up with, whether it's its own or the one it inherits.

## Events

`onclick` is `onPress`. It works on every element above, and a `div` or `li` with one becomes pressable. The event has `preventDefault`, `currentTarget` and `nativeEvent`.

```svelte
<li onclick={() => select(item)}>{item.name}</li>
```

The other events of the web don't exist on a phone. A handler that can't run, such as `onmouseover` on a `div`, gives a warning when the file is built, with the file and line. It's a warning and not an error because the file still works on the web. The ones the elements below do get are listed with them.

### Links

`<a href>` follows the link when pressed:

- A path of your app (`href="/settings"`) goes to that screen, as the router's [`goto`](routing#navigating) does. It needs a router above it: use it in a screen, not in the code that runs before the app has one.
- A link to another place (`https:`, `mailto:`, `tel:`, or your app's own scheme) is opened by the phone.
- A link that is only a hash (`#top`) does nothing.

An `onclick` on the link runs first, and `event.preventDefault()` in it stops the navigation.

### Forms

A `<form onsubmit>` hears `submit` when a submit button inside it is pressed, or when someone presses Enter in a single-line `input` inside it. A button is a submit button unless it says `type="button"`. The form finds its buttons and fields by where they are, not by which file they're written in, so a field in a component of its own submits the form it sits in.

```svelte
<form onsubmit={(event) => { event.preventDefault(); save(); }}>
	<input bind:value={name} placeholder="Name" />
	<label><input type="checkbox" bind:checked={agree} /> I agree</label>
	<button type="submit">Save</button>
</form>
```

`event.currentTarget` and `event.target` are the form. Nothing is sent anywhere by itself: there is no page to navigate to, so `action` and `method` do nothing and `preventDefault` has nothing to prevent. `event.preventDefault()` in a button's `onclick` stops its submission, as on the web.

## Images

`src` is the image: a string is its `uri`, and what an `import` gives (an image in your project) is used as it is. `alt` is the label a screen reader says. `width` and `height` set the size, and `class` or `style` can change it.

```svelte
<img src="https://example.com/photo.jpg" alt="A photo" width="120" height="80" />
```

A native image has no size of its own until it loads, so give it a `width` and a `height`, or a class.

## Inputs

`input` is a [`TextInput`](text-input). `type` chooses the keyboard and what the phone may fill in: `email`, `password` (hides what is typed), `number`, `search`, `url`, `tel`. `type={expression}` works too, and is looked at when it changes, so a password field with a "show" button works.

`disabled` is `editable={false}`, and `readonly`, `maxlength`, `autofocus`, `autocomplete`, `autocapitalize`, `inputmode` and `enterkeyhint` are the native props of those names. `rows` on a `textarea` is `numberOfLines`.

`oninput` runs on every edit, and `onchange` when the edit is finished. Their event has what web code reads: `event.currentTarget.value` (and `event.target.value`). `onkeydown` and `onkeyup` are the key press of the keyboard, with `event.key` (`"Enter"`, `"a"`, `"Backspace"`); a key press comes once, so both run for it. `bind:this` gives the input's handle, which has `focus()` and `blur()`.

A checkbox is a switch: `bind:checked`, `checked`, `disabled` and `onchange` (with `event.currentTarget.checked`) work.

`bind:value` on `type="number"` is a string here, where the browser gives a number.

## Dialog

`<dialog open={shown}>` is a [`Modal`](modal) that is visible while `shown` is true. `bind:open` works too, and also closes the dialog when the phone does (the Back key, a swipe down), and `onclose` hears it. A dialog without `open` is closed.

```svelte
<dialog bind:open={shown} class="rounded-xl bg-white p-6">
	<p>Delete this contact?</p>
	<button onclick={remove}>Delete</button>
</dialog>
```

## Style

`class` works as on the web, with the classes of your CSS file ([Classes](styling#classes)). So does `style`, in two forms:

- `style="padding: 4px 8px; color: red"` is turned into a style object when the file is built, by the converter that makes the classes, so a unit or a colour means the same as in a class. A declaration that has no native equivalent is a build error that names it. So is a `vw`, `vh` or `env()` value (a class can have those; a string written at build time can't know the device), and a string with `{expressions}` in it. For those, use `style={{ ... }}`, a class or `style:`.
- `style:property={value}` follows its value. The name is camel-cased, `px` and plain numbers are points, and percentages, colours and keywords pass through. A value it can't use (`3rem`, `calc()`, `var()`) is left out, with a warning in development.

```svelte
<div style:width="{percent}%" style:background-color={color} class="h-2 rounded"></div>
```

`style={{ ... }}` with a React Native style object also works, as in any native component.

## What doesn't exist

An element with no native equivalent is a build error, naming the element, the file and the line, with what to use:

| Element | Use |
| --- | --- |
| `table`, `tr`, `td`, ... | `div`s with flex classes |
| `svg` | [`@rasheed/svelte-native/svg`](svg) |
| `canvas` | the SVG components |
| `video` | [`Video` or `VideoView`](native-views#video) from `@rasheed/svelte-native/foreign` |
| `iframe` | [`WebView`](native-views#webview) from `@rasheed/svelte-native/foreign` |
| `select`, `option` | a list of buttons, or a `Modal` |
| `input type="radio"`, `range`, `date`, `file`, ... | a `button` per choice, a gesture, [`DateTimePicker`](native-views#datetimepicker-and-opendatepicker) |
| `bind:clientWidth` and the other size bindings | `onLayout` |
| `class:name` on an `input`, `textarea`, `dialog` | `class={[...]}` |

Any other HTML element not in the first table is also an error. All the errors of a file are reported together.

## Limits

- **No CSS cascade.** Apart from the inherited text style above, a style applies to its element only. There are no selectors or `<style>` blocks (`<style>` is refused in a native file).
- **No browser behaviour.** Hover, focus rings, `:active`, tab order, text selection, drag and drop, and scroll events don't exist. `overflow: auto` is a [`ScrollView`](scroll-view).
- **A list is not a `ul`.** `ul` and `li` are `View`s. For a long list, use [`List`](list).
- **A spread can't be adapted.** The names inside `{...props}` are the native ones, except `onclick`, which is `onPress` there too. A web name such as `maxlength` in a spread does nothing.
- **Elements from libraries aren't changed.** A Svelte component library in `node_modules` that is written with HTML keeps its HTML, and so doesn't draw on a device.
- **`{@html}` has no equivalent.** Use a [`WebView`](native-views#webview).
