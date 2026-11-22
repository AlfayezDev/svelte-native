---
title: Web APIs
video: web-apis
---

On the device, `fetch`, `Blob`, `crypto`, `localStorage` and `navigator`'s clipboard, share and geolocation are the web's own, with nothing to import. Code you share with a SvelteKit app runs unchanged, and underneath each one is native code: the bytes of a download, the hashing and the storage happen outside JavaScript.

## fetch

`fetch`, `Request`, `Response` and `Headers` follow the Fetch standard. Expo Svelte has a native module of its own for them, on URLSession on iOS and on React Native's OkHttp client on Android, and they share cookies with the rest of the app.

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

- A request body is sent whole: a `ReadableStream` body is read to its end before the request starts. An abort while it is read cancels the stream with the signal's reason, and the request never starts.
- `mode`, `cache`, `referrer` and `integrity` are accepted and ignored.
- On iOS, a response header that arrives more than once is one value joined with `, `, and `statusText` is the standard phrase for the status code, not the server's own.
- On iOS, a POST body that has no type of its own (bytes, or a `Blob` without one) is sent as `application/octet-stream`: iOS would otherwise label it a form.

## Crypto

`crypto` is the web's: `crypto.getRandomValues(array)`, `crypto.randomUUID()` and `crypto.subtle`, the Web Crypto API (digests, HMAC, AES, RSA, ECDSA, key derivation). It is backed by [react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto), which is part of Expo Svelte (the library carries it, with the base64 module it asks for, and links it), so the work is native and there is nothing to install.

```ts
const bytes = crypto.getRandomValues(new Uint8Array(16));
const id = crypto.randomUUID();
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello'));
```

Nothing loads until `crypto` is first read, so an app that never uses it pays nothing at start. A library that reads it while it starts loads it then: Sentry's SDK does, from `src/hooks.mobile.ts`. Only `crypto` is defined: not `Buffer`, and not `process`. The library behind it adds a few things of its own when it loads, on the first read of `crypto`: `process.nextTick`, and the functions `base64FromArrayBuffer` and `base64ToArrayBuffer`.

A library written for Node that imports `crypto` or `node:crypto` gets react-native-quick-crypto itself, which has Node's API (`createHash`, `createHmac`, `randomBytes`, ciphers, key pairs) as well as `subtle`. Metro does the substitution, so nothing needs configuring. The package is not a dependency of the app: an app that lists `react-native-quick-crypto` or `react-native-quick-base64` is refused, because a second copy would be linked beside the library's. libsodium's algorithms (XSalsa20 and the other ciphers OpenSSL lacks) are off; the `sodiumEnabled` plugin option turns them on ([Configuration](configuration)).

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

For more than strings (numbers, booleans, bytes, encryption, change listeners, other instances), `expo-svelte/mmkv` has react-native-mmkv's `createMMKV` and its types, and `localStorageMMKV()`, the instance behind `localStorage`:

```ts
import { createMMKV, localStorageMMKV } from 'expo-svelte/mmkv';

const secrets = createMMKV({ id: 'secrets', encryptionKey: 'a key' });
localStorageMMKV().set('onboarded', true);
localStorage.getItem('onboarded'); // null: localStorage reads strings
```

react-native-mmkv comes with the library, together with react-native-nitro-modules: do not add either to the app's dependencies (the prebuild stops if you do).

## navigator

`navigator` has the members of the web's that a phone has, each on the system's own feature.

### Clipboard

`navigator.clipboard` is the system clipboard, through a native module of Expo Svelte's:

```ts
await navigator.clipboard.writeText('Copied from Expo Svelte');
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
await navigator.share({ title: 'Expo Svelte', text: 'Have a look', url: 'https://expo-svelte.alfayez.dev' });
```

`navigator.canShare(data)` says whether `share` takes it: a title, a text or an absolute URL. Files can't be shared. When the user dismisses the sheet, the promise rejects with an `AbortError` on iOS. Android doesn't report a dismissal, so there it resolves once the sheet is shown.

### Vibration, language

- `navigator.vibrate(200)` vibrates for a duration, and `navigator.vibrate([100, 50, 100])` plays a pattern of vibrations and pauses; `0` or `[]` stops it, and a new call replaces the pattern that plays. iOS has one fixed vibration, so each vibration of a pattern starts one at its time, whatever its length.
- `navigator.language` is the device's language as a tag such as `en-US` or `zh-Hans-CN`, and `navigator.languages` lists it. On Android it is the device's language when the app started; on iOS, the language and region the app runs in.

### Geolocation

`navigator.geolocation` is the web's Geolocation API. It needs a permission of the system, so it is a capability: off until the app says why it uses it. Its native code is part of Expo Svelte, so there is nothing to install: give the reason in the plugin's options.

```ts
/// file: app.config.ts
export default {
	plugins: [['expo-svelte', { capabilities: { location: 'Shows the stores near you.' } }]]
};
```

The text is what iOS shows when the app asks (`location: { whenInUse: '…' }` says the same). Then prebuild and rebuild the native app. The prebuild adds the location permissions on Android (`ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`) and the text on iOS, and on iOS it compiles the location code into the app only then: an app without the capability has no location API in its binary, so App Store Connect never asks it for a location text. On Android the position comes from the system's own location service, with no Google library: on Android 12 and later its fused provider, and the GPS or the network otherwise, so it works on phones without Google services too. Turn the capability off and prebuild again, and the permissions and the compiled code go away (the iOS text stays, as nothing says it was the capability's).

The capability is for `navigator.geolocation`, in the foreground. Background location (tracking with the app closed, geofencing) is not part of it: the prebuild stops on a `background` or `motion` option and says so. An app that needs it can install expo-location and configure its own plugin; the two don't share anything, so they can be in the same app.

```ts
navigator.geolocation.getCurrentPosition(
	(position) => console.log(position.coords.latitude, position.coords.longitude),
	(error) => {
		if (error.code === GeolocationPositionError.PERMISSION_DENIED) showWhyWeAsk();
	},
	{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
);

const id = navigator.geolocation.watchPosition((position) => follow(position.coords));
navigator.geolocation.clearWatch(id);

const status = await navigator.permissions.query({ name: 'geolocation' }); // 'granted', 'prompt' or 'denied'
```

It behaves as in a browser: the first call asks for the permission, the callbacks come later, never during the call, and an error is a `GeolocationPositionError` with `PERMISSION_DENIED`, `POSITION_UNAVAILABLE` (location services off, no fix) or `TIMEOUT`. `timeout` counts from when the permission is granted; for a watch, from when it runs, with one `TIMEOUT` each time that long passes without a position, and the watch going on. `maximumAge` answers from the last position the app or the system has, when it is young enough and was taken as the request asks: a position taken without `enableHighAccuracy` does not answer a request with it, nor the other way round, and the system's, taken no one knows how, answers only a request without it. The system's is a lookup that may not answer. `getCurrentPosition` waits for it at most 100 ms, so with `timeout: 0` it answers from it only when it comes that fast. A watch looks it up alongside its own and uses it only when it comes before the watch's first position. A lookup that never answers holds nothing up. `enableHighAccuracy` turns on the GPS, and without it the position comes from the network and Wi-Fi, to about a city block. A watch reports every position, however small the move. A `PermissionStatus`'s `state` changes, with a `change` event, when the user answers and when the app comes back from the settings. What a callback throws is reported as an uncaught error, after the call, and the watch goes on.

A few things differ from a browser:

- What the platform doesn't know reads as `null`: altitude, heading and speed.
- A watch that fails once it runs reports it, as `POSITION_UNAVAILABLE` (the watch goes on: on Android when its location provider is switched off, on iOS when the fix is lost) or, on iOS when the permission was taken away, `PERMISSION_DENIED` (the watch ends). A watch that only goes quiet is heard of through its `timeout`.
- The permission is the system's. After a refusal the app can ask again where the system still allows it: Android asks twice, then answers for the user.
- `navigator.permissions.query` knows `geolocation`, and refuses other names with a `TypeError`, as a browser refuses one it doesn't know.

## An update to an older build

An over-the-air update can reach a build made before these APIs existed. There, `fetch` and `Blob` are Expo's and React Native's as before, and `crypto`, `localStorage`, `navigator.clipboard` and `navigator.geolocation` read as `undefined` (with one warning in the console), so a check like `typeof crypto !== 'undefined'` takes its fallback instead of throwing. The same goes for `navigator.geolocation` in a build without the location capability: the warning says how to turn it on, and `navigator.permissions.query({ name: 'geolocation' })` answers `denied`.
