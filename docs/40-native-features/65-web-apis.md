---
title: Web APIs
video: web-apis
---

On the device, `fetch`, `Blob`, `crypto`, `localStorage` and `navigator`'s clipboard and share are the web's own, with nothing to import. Code you share with a SvelteKit app runs unchanged, and underneath each one is native code: the bytes of a download, the hashing and the storage happen outside JavaScript.

## fetch

`fetch`, `Request`, `Response` and `Headers` follow the Fetch standard. Svelte Native has a native module of its own for them, on URLSession on iOS and on React Native's OkHttp client on Android, and they share cookies with the rest of the app.

```ts
const response = await fetch('https://api.example.com/items', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ name: 'Groceries' })
});
const items = await response.json();
```

A response's bytes stay in native code until you read them. `arrayBuffer()` and `bytes()` give you one buffer straight from native memory, with no base64 and no copy through a JavaScript array, and `blob()` keeps the bytes native. `body` is a `ReadableStream` that hands you the bytes as they arrive, which is how you show progress:

```ts
const response = await fetch(url);
const total = Number(response.headers.get('content-length'));
const reader = response.body.getReader();
let received = 0;
for (let next = await reader.read(); !next.done; next = await reader.read()) {
	received += next.value.length; // progress: received / total
}
```

An `AbortSignal` stops the request, or the download of its body: `fetch(url, { signal: AbortSignal.timeout(5000) })` gives up after five seconds with a `TimeoutError`.

- **URLs:** `http:` and `https:`, `data:`, and `file://` for a local file, read natively (on Android `content://` too).
- **Redirects:** `redirect: 'follow'` follows up to 20; `'error'` rejects on a redirect; `'manual'` gives you the redirect response itself, with its `Location`, as Node's `fetch` does.
- **Cookies:** sent and kept by default; `credentials: 'omit'` sends none and keeps none.
- **Errors:** a network failure rejects with a `TypeError`, an abort with the signal's reason. A response with an error status (404, 500) is not a failure: check `response.ok`.

## Blob, File and FormData

A `Blob` is native bytes too. Slicing one, joining several and uploading them copy nothing through JavaScript, and neither does a multipart body built from them.

```ts
const photo = await (await fetch(photoUri)).blob();

const form = new FormData();
form.append('title', 'Sunset');
form.append('photo', photo, 'sunset.jpg');
await fetch('https://api.example.com/upload', { method: 'POST', body: form });
```

A `FormData` value can also be React Native's way of naming a local file, `{ uri, name, type }`: the file is read natively as it is sent.

`URL.createObjectURL(blob)` gives you a `file://` URL that an image, a video or a WebView can load, and `URL.revokeObjectURL(url)` deletes the file when you are done with it:

```svelte
<Image source={{ uri: URL.createObjectURL(photo) }} style={{ width: 120, height: 120 }} />
```

`File` is a `Blob` with a `name` and a `lastModified`, and `FileReader` reads a `Blob` as text, an `ArrayBuffer` or a data URL.

`XMLHttpRequest`, and libraries built on it such as axios, still go through React Native's own networking. They accept the library's `FormData` and `Blob` as bodies.

A few things differ from a browser:

- A request body is sent whole: a `ReadableStream` body is read to its end before the request starts.
- `mode`, `cache`, `referrer` and `integrity` are accepted and ignored.
- On iOS, a response header that arrives more than once is one value joined with `, `, and `statusText` is the standard phrase for the status code, not the server's own.
- On iOS, a POST body that has no type of its own (bytes, or a `Blob` without one) is sent as `application/octet-stream`: iOS would otherwise label it a form.

## Crypto

`crypto` is the web's: `crypto.getRandomValues(array)`, `crypto.randomUUID()` and `crypto.subtle`, the Web Crypto API (digests, HMAC, AES, RSA, ECDSA, key derivation). It is backed by [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto), so the work is native.

```ts
const bytes = crypto.getRandomValues(new Uint8Array(16));
const id = crypto.randomUUID();
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello'));
```

Nothing loads until `crypto` is first read, so an app that never uses it pays nothing at start. A library that reads it while it starts loads it then: Sentry's SDK does, from `src/hooks.mobile.ts`. Only `crypto` is defined: not `Buffer`, and not `process`. The library behind it adds a few things of its own when it loads, on the first read of `crypto`: `process.nextTick`, and the functions `base64FromArrayBuffer` and `base64ToArrayBuffer`.

A library written for Node that imports `crypto` or `node:crypto` gets react-native-quick-crypto itself, which has Node's API (`createHash`, `createHmac`, `randomBytes`, ciphers, key pairs) as well as `subtle`. Metro does the substitution, so nothing needs configuring. The package is a required dependency of the app: `svelte-native init` installs it and `svelte-native doctor` checks it.

## Storage

`localStorage` and `sessionStorage` are the web's `Storage`: `getItem`, `setItem`, `removeItem`, `clear`, `key` and `length`, with keys and values turned into strings. A key is also a property, as it is in a browser.

```ts
localStorage.setItem('theme', 'dark');
localStorage.getItem('theme'); // 'dark'
localStorage.visits = 3;
localStorage.visits; // '3'
Object.keys(localStorage); // ['theme', 'visits']
```

`localStorage` keeps its data in the app's files, so it survives a restart. It is an [MMKV](https://github.com/mrousavy/react-native-mmkv) instance, which makes reads and writes synchronous and fast. `sessionStorage` lives in memory for as long as the app's process does.

Nothing is created until `localStorage` is first read, and an app that never uses storage never loads MMKV. There are no `storage` events, and no quota.

For more than strings (numbers, booleans, bytes, encryption, change listeners, other instances), `@alfayez/svelte-native/mmkv` has react-native-mmkv's `createMMKV` and its types, and `localStorageMMKV()`, the instance behind `localStorage`:

```ts
import { createMMKV, localStorageMMKV } from '@alfayez/svelte-native/mmkv';

const secrets = createMMKV({ id: 'secrets', encryptionKey: 'a key' });
localStorageMMKV().set('onboarded', true);
localStorage.getItem('onboarded'); // null: localStorage reads strings
```

react-native-mmkv is a required dependency of the app, with react-native-nitro-modules.

## navigator

`navigator` has the members of the web's that a phone has, each on the system's own feature.

### Clipboard

`navigator.clipboard` is the system clipboard, through a native module of Svelte Native's:

```ts
await navigator.clipboard.writeText('Copied from Svelte Native');
const text = await navigator.clipboard.readText();

await navigator.clipboard.write([
	new ClipboardItem({ 'text/plain': 'Bold', 'text/html': '<b>Bold</b>' })
]);
const [item] = await navigator.clipboard.read();
const html = await (await item.getType('text/html')).text();
```

It holds text: `text/plain` and `text/html`. Writing another type, such as an image, is refused with a `NotAllowedError`, as Chrome refuses a type it doesn't support. The system clipboard holds one item, so `write()` takes one. On iOS, reading shows the system's paste prompt, as it does in Safari. On Android, the clipboard reads as empty while none of the app's windows has the focus.

### Share

`navigator.share()` opens the system share sheet with a title, a text and a link:

```ts
await navigator.share({ title: 'Svelte Native', text: 'Have a look', url: 'https://svelte-native.alfayez.dev' });
```

`navigator.canShare(data)` says whether `share` takes it: a title, a text or an absolute URL. Files can't be shared. When the user dismisses the sheet, the promise rejects with an `AbortError` on iOS. Android doesn't report a dismissal, so there it resolves once the sheet is shown.

### Vibration, language

- `navigator.vibrate(200)` vibrates for a duration, and `navigator.vibrate([100, 50, 100])` plays a pattern of vibrations and pauses; `0` or `[]` stops it, and a new call replaces the pattern that plays. iOS has one fixed vibration, so each vibration of a pattern starts one at its time, whatever its length.
- `navigator.language` is the device's language as a tag such as `en-US` or `zh-Hans-CN`, and `navigator.languages` lists it. On Android it is the device's language when the app started; on iOS, the language and region the app runs in.

## An update to an older build

An over-the-air update can reach a build made before these APIs existed. There, `fetch` and `Blob` are Expo's and React Native's as before, and `crypto`, `localStorage` and `navigator.clipboard` read as `undefined` (with one warning in the console), so a check like `typeof crypto !== 'undefined'` takes its fallback instead of throwing.
