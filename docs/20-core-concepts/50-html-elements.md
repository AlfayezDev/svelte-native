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

It applies to the files of your app: routes (`+page.svelte`, `+mobile.svelte`), components in `src/lib`, and packages of your own workspace. It doesn't apply to Svelte libraries in `node_modules`, which keep their markup as written. A native-only file can mix both ways: `import { ScrollView } from '@example/svelte-native'` beside `<div>` works.

## The elements

| HTML | On the device | What changes |
| --- | --- | --- |
| `div` `section` `header` `footer` `main` `nav` `article` `aside` `ul` `ol` `li` `form` `label` `figure` `fieldset` `dl` `dd` | [`View`](view) | A `View` with `onclick` is pressable. |
| `p` `span` `h1`–`h6` `strong` `b` `em` `i` `small` `code` `blockquote` `figcaption` `dt` `mark` `kbd` `time` `abbr` `s` `u` `del` `ins` `q` `cite` `sub` `sup` `var` `samp` `dfn` `data` | [`Text`](text) | `h1`–`h6` get the `header` role. A text inside a text is a span of it. |
| `pre` | `Text` | Spaces and newlines are kept as written. |
| `br` | a newline | Only inside text; elsewhere it's an error. |
| `hr` | `View` | A hairline (grey, 8 points of margin above and below). Its class or style changes it. |
| `button` | [`Pressable`](pressable) | The `button` role. A button submits its form unless its `type` says it doesn't. |
| `a` | `Pressable` (`Text` inside text) | The `link` role. A press follows `href`. |
| `img` | [`Image`](image) | `src` is the source. `alt` is its label. |
| `input` (`text`, `email`, `password`, `number`, `search`, `url`, `tel`) and `textarea` | [`TextInput`](text-input) | `type` picks the keyboard. `bind:value` works. |
| `input type="checkbox"` | [`Switch`](switch) | `bind:checked` works. |
| `dialog` | [`Modal`](modal) | `open` is shown, `bind:open` works. |

`class`, `class:name`, `style`, `{...spread}` and `bind:this` carry over, and you can use `{#if}`, `{#each}` and snippets inside any of them, as usual. `use:` actions don't run on a native element (the build warns, naming the file and line). `in:`, `out:`, `transition:` and `animate:` are passed through as you wrote them, and play on the UI thread once the library's transitions land. On an `input`, a `textarea` and a `dialog`, which are components, Svelte takes no such directive, so the build leaves it out and warns.

The file keeps its lines: every construct is on the line it was written on, so an error from the Svelte compiler points where you wrote it. (A comment that runs to the end of a line, or a template literal with a line break in it, inside an expression that has to be written twice, such as a `bind:this` target, is the one place where that can't hold. A `//` inside a string is not a comment.)

An element that isn't in the table (`<center>`, `<font>`, a custom element) is a build error, like the ones under [What doesn't exist](#what-doesnt-exist).

## Spreads and wrappers

A component of your own that passes its props down keeps the meaning of the HTML it holds:

```svelte
<!--- file: src/lib/Button.svelte --->
<script lang="ts">
	let { children, ...rest } = $props();
</script>

<button {...rest}>{@render children?.()}</button>
```

`<Button type="button" onclick={cancel}>Cancel</Button>` in a form doesn't submit it, and `onclick` runs before a submit button submits, as it does in a browser. An input that passes `{...rest}` gets its `type`, `disabled`, `maxlength` and `oninput` the same way, and a link gets its `href`.

## Text

A string, or an `{expression}`, directly inside a `div` (or any element that becomes a `View`) is drawn for you. The device finds out what is in the element when the screen runs, so it doesn't matter where the text comes from: written in the element, passed in `children`, or rendered from a snippet or a block.

```svelte
<div class="p-4">
	Hello {name}, you have <b>{count}</b> messages.
</div>

<button>{@render children?.()}</button>
```

The string, the expression and the `<b>` are one line, with the `<b>` as a span of it, as in a browser. So is the text of `Hello {#if n}{n}{/if}!`, and so are `<span>a</span><span>b</span>` in a `div`. An element that isn't inline (a `p`, a `div`, a `button`) ends the line and starts another. The whitespace at the edge of a line is not drawn, and the rest is kept as written ([Text](text)). The one exception is `pre`, which keeps all of it.

That is what a block container does. A **flex container** lays out items instead, as it does in a browser: each element is an item, and each run of text between them is an item of its own (the whitespace between items is not drawn).

```svelte
<div class="flex flex-row justify-between"><span>Name</span><span>{price}</span></div>
<button class="flex flex-row items-center gap-2"><span>★</span><span>Label</span></button>
<div class="flex flex-row gap-2">Total: <span>5</span></div>
<div>Total: <span>5</span></div>
```

The first three have two items each, a `Name` and a price at the two ends of a row, an icon and a label side by side, `Total:` and `5` next to each other. The last is one line. A view is a flex container when its style has `display: flex` (`flex`, `inline-flex`, `style="display: flex"`) or any of `flex-direction`, `flex-wrap`, `gap`, `justify-content`, `align-items` and `align-content` (`flexDirection` and the others in a style object). A text element (`p`, `h1`–`h6`, `span`, an `<a>` among text) is not a container at all: it draws its own text, so `flex`, `gap` or `items-center` on it does nothing, and in development the library says so once for each element. Use a `div` when you need items. A `class="block"` is not a flex container, even though React Native has only flex and the class compiler writes `flex` for it (it keeps the word you used beside it), so `<label class="block">Name <span>*</span></label>` is a line.

An inline element that sets its own `display` is in the line or not by what it sets: `inline`, `inline-block` and `inline-flex` flow with the text, `none` has no box and doesn't break the line (`<span class="hidden sm:inline">` is out of it while it's hidden, and a span of it when it shows), and `block` or `flex` is an item of its own, as `<span class="block">` is. And an `<a>` in a component of its own (`<Link>See the terms</Link>` in the middle of a paragraph) is a pressable, not a span of the text around it, so it ends the line, as a `button` does; written as `<a>` in the paragraph, it is part of the line and a press on that part of the text.

A `View` or a `Text` you import has React Native's rule: a string directly in a `View` is not drawn, and in development the library warns about it once.

## Default styles

A browser gives some elements a look, and so does the device, under the element's class and style: `b` and `strong` are bold; `em`, `i`, `cite`, `dfn` and `var` italic; `u` and `ins` underlined; `s` and `del` struck through; `code`, `kbd`, `samp` and `pre` monospace; `small` is 0.8 of the font size, `sub` and `sup` 0.75; `mark` is black on yellow; and `h1` to `h6` are bold at 2, 1.5, 1.17, 1, 0.83 and 0.67 times the font size they inherit. Decorations add up, as in CSS: a `<s>` in a `<u>` is underlined and struck through, and a `text-decoration: none` doesn't take away the line of an element above. A link has no default colour: that is the app's to choose.

On the web, Tailwind's preflight takes the default style of headings away. If a file is shared with the web, give the headings classes of their own (`text-2xl font-bold`), which win on both.

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

Svelte's own `on:` directive isn't accepted by the library's renderer, so `on:click={f}` is `onclick={f}`, and one with a modifier (`on:click|preventDefault={f}`) or no function (`on:click`) is a build error that says what to write: the attribute, and `event.preventDefault()` inside it.

### Links

`<a href>` follows the link when pressed:

- A path of your app (`href="/settings"`) goes to that screen, as the router's [`goto`](routing#navigating) does. It needs a router above it: use it in a screen, not in the code that runs before the app has one.
- A link to another place (`https:`, `mailto:`, `tel:`, or your app's own scheme) is opened by the phone.
- A link that is only a hash (`#top`) does nothing.

A link follows the `href` the element has when it is pressed, so one that comes from a `{...spread}` counts, and an `<a>` with no `href` (or `href={undefined}`) does nothing. An `onclick` on the link runs first, and `event.preventDefault()` in it stops the navigation.

### Forms

A `<form onsubmit>` hears `submit` when a submit button inside it is pressed, or when someone presses Enter in a single-line `input` inside it. A button is a submit button unless it says `type="button"` (or `reset`), even when its `type` comes from a spread. The form finds its buttons and fields by where they are, not by which file they're written in, so a field in a component of its own submits the form it sits in.

```svelte
<form onsubmit={(event) => { event.preventDefault(); save(); }}>
	<input bind:value={name} placeholder="Name" />
	<label><input type="checkbox" bind:checked={agree} /> I agree</label>
	<button type="submit">Save</button>
</form>
```

`event.currentTarget` and `event.target` are the form. Nothing is sent anywhere by itself: there is no page to navigate to, so `action` and `method` do nothing and `preventDefault` has nothing to prevent. `event.preventDefault()` in a button's `onclick` stops its submission, and in `onkeydown` on the key press of Enter it stops that submission, as on the web.

## Images

`src` is the image: a string is its `uri`, and what an `import` gives (an image in your project) is used as it is. `alt` is the label a screen reader says. `width` and `height` set the size, and `class` or `style` can change it.

```svelte
<img src="https://example.com/photo.jpg" alt="A photo" width="120" height="80" />
```

A native image has no size of its own until it loads, so give it a `width` and a `height`, or a class.

## Inputs

`input` is a [`TextInput`](text-input), and it works the HTML attributes out when the screen runs, so they mean the same on the element and in a `{...rest}` a component passes down. `type` chooses the keyboard and what the phone may fill in: `email`, `password` (hides what is typed), `number`, `search`, `url`, `tel`. `type={expression}` is looked at when it changes, so a password field with a "show" button works.

`disabled` is `editable={false}`, and `readonly`, `maxlength`, `autofocus`, `autocomplete`, `autocapitalize`, `inputmode` and `enterkeyhint` are the native props of those names. `rows` on a `textarea` is `numberOfLines`, and the text between its tags is its initial value (unless it has `bind:value`).

`oninput` runs on every edit, and `onchange` when the edit is finished. Their event has what web code reads: `event.currentTarget.value` (and `event.target.value`), and the `name`, `id` and `type` of the input. `onkeydown` and `onkeyup` are the key press of the keyboard, with `event.key` (`"Enter"`, `"a"`, `"Backspace"`); a key press comes once, so both run for it.

`bind:this` gives the element's handle, which has `focus()`, `blur()` and `measure()`. When the content around an element changes what it is drawn as (a text that is alone and then a span of a line), the platform view is made again and the handle's `tag` is the new view's: the one you held reaches it. It is there as soon as the element is, so `onMount(() => el.focus())` in an `{#if}` works, and a handle asked to focus before the view is on the screen does it when it is. In a keyed `{#each}`, `bind:this={els[i]}` follows its row, as it does on the web.

A checkbox is a switch: `bind:checked`, `checked`, `disabled` and `onchange` (with `event.currentTarget.checked`) work.

`bind:value` on `type="number"` is a string when the user types, where the browser gives a number. A number in state is shown as its text.

## Dialog

`<dialog open={shown}>` is a [`Modal`](modal) that is shown while `shown` is true (the `Modal` takes `open` as it takes `visible`). `bind:open` works too, and the `Modal` sets it to `false` when the phone closes the dialog (the Back key, a swipe down), and `onclose` hears it. A dialog without `open` is closed.

```svelte
<dialog bind:open={shown} class="rounded-xl bg-white p-6">
	<p>Delete this contact?</p>
	<button onclick={remove}>Delete</button>
</dialog>
```

## Style

`class` works as on the web, with the classes of your CSS file ([Classes](styling#classes)). So does `style`, in two forms:

- `style="padding: 4px 8px; color: red"` is turned into a style object when the file is built, by the converter that makes the classes, so a unit or a colour means the same as in a class. A declaration that has no native equivalent is a build error that names it. So is a `vw`, `vh` or `env()` value (a class can have those; a string written at build time can't know the device), and a string with `{expressions}` in it. For those, use `style={{ ... }}`, a class or `style:`.
- `style:property={value}` follows its value. The name is camel-cased, `px` and plain numbers are points, `rem` is 16 points, and percentages, colours and keywords pass through; `!important` is dropped. A value it can't use (`calc()`, `var()`), a custom property (`--gap`), a `display` a device has no layout for (`grid`, `table`: a view is flex, `none` or `contents`) and a name React Native doesn't know are left out or reported, with a warning in development.

```svelte
<div style:width="{percent}%" style:background-color={color} class="h-2 rounded"></div>
```

`style={{ ... }}` with a React Native style object also works, as in any native component, and `style={text}` with a string that is only known when the screen runs is read then, by the same rules as `style:`.

## What doesn't exist

An element with no native equivalent is a build error, naming the element, the file and the line, with what to use:

| Element | Use |
| --- | --- |
| `table`, `tr`, `td`, ... | `div`s with flex classes |
| `svg` | [`@example/svelte-native/svg`](svg) |
| `canvas` | the SVG components |
| `video` | [`Video` or `VideoView`](native-views#video) from `@example/svelte-native/foreign` |
| `iframe` | [`WebView`](native-views#webview) from `@example/svelte-native/foreign` |
| `select`, `option` | a list of buttons, or a `Modal` |
| `input type="radio"`, `range`, `date`, `file`, ... | a `button` per choice, a gesture, [`DateTimePicker`](native-views#datetimepicker-and-opendatepicker) |
| `bind:clientWidth` and the other size bindings | `onLayout` |
| `class:name` on an `input`, `textarea`, `dialog` | `class={[...]}` |

Any other HTML element not in the first table is also an error. All the errors of a file are reported together.

Some elements of Svelte are for the document: `<svelte:head>` is taken out when the file is built, so a page shared with the web compiles, and `<svelte:window>`, `<svelte:document>` and `<svelte:body>` are errors that say so (`windowSize` and `svelte/reactivity/window` give the window's size). `<svelte:element this={tag}>` draws the host tag of `tag` (`h2` is a text, `div` a view, and a `span` or a `b` is a span of the line it is in), and fails with the tag's name when it has none. `bind:this` is its handle, and a tap presses it: `onclick={f}` and `on:click={f}` are `onPress`, as on a `div` (any other `on:event={f}` is `onevent={f}`); its `class`, `style` and other events are not adapted (the build warns), so write the element when you need them.

## Limits

- **No CSS cascade.** Apart from the inherited text style above, a style applies to its element only. There are no selectors or `<style>` blocks (`<style>` is refused in a native file).
- **No browser behaviour.** Hover, focus rings, `:active`, tab order, text selection, drag and drop, and scroll events don't exist. `overflow: auto` is a [`ScrollView`](scroll-view).
- **A list is not a `ul`.** `ul` and `li` are `View`s. For a long list, use [`List`](list).
- **A spread on a view, text or image keeps the native names.** `{...props}` on a `div` or an `img` has `onclick` (it is `onPress` there too), and the rest is as the host reads it. The ones above that decide what an element does by itself (a button's `type` and `onclick`, a link's `href`, an input's attributes) are read as HTML when they come through a spread.
- **Elements from libraries aren't changed.** A Svelte component library in `node_modules` that is written with HTML keeps its HTML, and so doesn't draw on a device.
- **`{@html}` has no equivalent.** Use a [`WebView`](native-views#webview).
