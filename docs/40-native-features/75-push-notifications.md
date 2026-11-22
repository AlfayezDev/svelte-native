---
title: Push notifications
---

An Expo Svelte app can get push notifications three ways. They differ in who delivers a message, where the keys that can send to every user are kept, and how much you build around a send.

| | [Standalone](#standalone) | [Firebase](#with-react-native-firebase) | [Expo](#with-expo-notifications) |
| --- | --- | --- | --- |
| Library in the app | `expo-svelte/push`, part of this library | `@react-native-firebase/messaging` | `expo-notifications` |
| Your server sends with | `createPush` from this library | `firebase-admin` | `expo-server-sdk` |
| The path of a message | your server → FCM (Android) or APNs (iOS) | your server → FCM, which hands iOS messages to APNs | your server → Expo's push service → FCM or APNs |
| The sending keys are kept | on your server | on your server (FCM), and in Firebase (the APNs key) | at Expo, in your EAS project |
| A tap opens a screen | built in: the message's `url` goes through the router | your code calls `goto` | your code calls `goto` |
| A silent push on iOS | runs your hook with no screen mounted | mounts the first screen | mounts the first screen |
| You build | a job queue, retries, token storage, fan-out | a job queue, token storage | a job queue, a receipts check, token storage |

An app has one push library. The three exclude each other: Android delivers to one messaging service and iOS has one notification center delegate. The config plugin stops the prebuild when `capabilities.push` is on and `expo-notifications` or `@react-native-firebase/messaging` is installed too.

**Which one?**

- **Standalone** when nothing should sit between your server and Apple and Google, and you can run a job queue. It is the one Expo Svelte is built around: a tap is a link, and a background message never mounts a screen.
- **Firebase** when the app uses Firebase already (Analytics, Crashlytics), or you want Firebase's topics and its console's campaigns.
- **Expo** when you'd rather not handle the providers at all: Expo keeps the keys and talks to Apple and Google, and you send one kind of token from your server. It needs an EAS project.

## Standalone

`expo-svelte/push`. Push is part of `expo-svelte`: there is nothing to install. You turn it on in the config, and your server sends straight to Firebase Cloud Messaging (FCM) on Android and the Apple Push Notification service (APNs) on iOS, with your own credentials. There is no relay in between. The library does the device's side: the permission, the token, receiving a message, showing it, a tap on it, and a message that arrives while the app is closed. For your server it has a sender that sends one message to one device and tells you what happened.

> **important** **You need a job queue.** The sender doesn't queue, retry or fan out, so these are yours to run: a queue that sends from a job and not from the user's request, retries with backoff for the answers that ask for one, a table of tokens that you clean up from the answers, and sending to many devices with a concurrency limit. Postgres (with a job table or pg-boss), Redis (BullMQ) or a cloud queue all work. [What your app owns](#what-your-app-owns) has the list and a worked recipe. If you don't want to run this, use [Expo's push service](#with-expo-notifications), which does most of it for you.

Three rules shape it:

1. **A tapped notification is a link.** Its `url` opens a screen the way any [link to your app](routing#deep-links) does, from a closed app or a running one. The router does not change, and a path such as `/orders/42` works.
2. **A push that wakes the app mounts no screen.** The background hook and `init` run, and the first screen waits until the user opens the app.
3. **Secrets never go in the app.** The app's config holds identifiers only. The keys that can send to every user, the FCM service account and the APNs key, live in your server's environment, and the config plugin refuses a build that contains one.

### Setting up

#### The accounts

On Android, create a Firebase project, add your app to it with its Android package, and download `google-services.json`. It goes in your app's repository: it holds identifiers, not secrets. For your server, create a service account key with the Firebase Cloud Messaging API Admin role and keep it in the server's secrets.

On iOS, you need a paid Apple Developer team: a Personal Team can't sign the push entitlement. Create an APNs authentication key (a `.p8` file) and keep it, with its key id and your team id, on the server. iOS goes to APNs directly, so there is no Firebase on iOS.

#### The config

Turn the capability on in the plugin's options, with the identifiers of the platforms you serve:

```ts
/// file: app.config.ts
export default {
	expo: {
		android: { package: 'dev.example.myapp' },
		plugins: [
			[
				'expo-svelte',
				{
					capabilities: {
						push: {
							android: {
								googleServicesFile: './google-services.json',
								icon: './assets/notify.png',
								color: '#0a7f5a',
								channel: { name: 'Updates' }
							},
							ios: { mode: 'production' }
						}
					}
				}
			]
		]
	}
};
```

`android` needs `googleServicesFile`; `icon`, `color` and `channel` are optional. `ios` needs `mode`, the `aps-environment` entitlement: `'development'` for a build signed for development, `'production'` for TestFlight and the App Store. Name only the platform you serve. Each option, with its type and default, is in [Configuration](configuration#capabilitiespush).

Then prebuild and build the native app again ([Development builds](development-builds#when-to-run-expo-prebuild)). Push is native code, so an over-the-air update can't add it to a build that doesn't have it.

The plugin does what the plugin of any push library does, from those identifiers: on Android it sets up Firebase's Gradle step, the notification icon, color and channel; on iOS it writes the `aps-environment` entitlement and the `remote-notification` background mode, and changes `AppDelegate.swift` so that a push that wakes the app doesn't mount a screen. Firebase Messaging joins the Android build only then: an app with push off has none of Firebase in it, and doesn't bundle push's JavaScript either. The plugin stops the prebuild for a half-made setup (a second push library, a Google services file that has no client for your `android.package`) and for anything that is a server secret: a service account, a PEM private key, a `.p8` path. [Troubleshooting](troubleshooting#push-notifications) lists the messages.

With push off, `push` still works and does nothing: `push.permission` reads `'denied'`, `push.subscribe` resolves with `null`, and the console has one warning that says how to turn it on.

### On the device

`push` is in `expo-svelte/push`. What the app does with a message depends on where the app is and what the message is:

| The message | App in the foreground | App in the background or closed |
| --- | --- | --- |
| A notification (it has a `title` or a `body`) | The `foreground` hook says how to show it, then `push.on('message')` listeners hear it. | The system shows it, and no hook runs. A tap runs `opened` and opens the `url`. |
| A silent message (`silent: true`) | The `foreground` hook and the `push.on('message')` listeners hear it. Nothing is shown. | The `background` hook runs, with no screen. |

#### Permission and token

```svelte
<!--- file: src/routes/settings/+mobile.svelte --->
<script lang="ts">
	import { Pressable, Screen, Text } from 'expo-svelte';
	import { Linking } from 'expo-svelte/platform';
	import { push } from 'expo-svelte/push';
	import { savePushToken } from '#lib/push.remote.ts';
</script>

<Screen title="Settings">
	{#if push.permission === 'prompt'}
		<Pressable onPress={() => push.subscribe({ save: savePushToken })} accessibilityRole="button">
			<Text>Turn on notifications</Text>
		</Pressable>
	{:else if push.permission === 'denied'}
		<Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
			<Text>Notifications are off. Open the settings</Text>
		</Pressable>
	{/if}
</Screen>
```

`savePushToken` is a [remote function](loading-data#remote-functions) of yours that stores the token for the signed-in user:

```ts
/// file: src/lib/push.remote.ts
import { command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import * as db from '$lib/server/db';

export const savePushToken = command(
	v.object({
		provider: v.picklist(['fcm', 'apns']),
		token: v.string(),
		environment: v.optional(v.picklist(['development', 'production'])),
		app: v.string()
	}),
	async (token) => {
		const { locals } = getRequestEvent();
		await db.savePushToken(locals.user.id, token);
	}
);
```

- `push.permission` is `'granted'`, `'denied'` or `'prompt'`, and it is reactive. It is read again whenever the app returns to the foreground, because the user may have changed it in the settings. It starts from the last value the system reported, kept in `localStorage`, so a user who has answered never sees `'prompt'` for a moment. `'denied'` means only the user's settings can change it, so offer `Linking.openSettings()`.
- `push.subscribe({ save })` asks for the permission when it is `'prompt'`, registers the device with FCM or APNs and calls `save(token)` with a `PushToken`. It resolves with the token, or with `null` when the permission is denied. Call it at every start where the user is signed in: it asks only once, and it calls `save` only when the token is new, has changed since the last `save` that succeeded, or was rotated by the system while the app runs. If `save` throws, `subscribe` rejects with its error and the token isn't remembered, so the next `subscribe` saves it again.
- `push.unsubscribe()` deletes the device's token with the provider and forgets the saved one. Call it when the user signs out, and remove the token from your server too.
- `push.token` is the current `PushToken`, or `null` until `subscribe` has registered in this run.

```ts
type PushToken = {
	provider: 'fcm' | 'apns';
	token: string;
	/** APNs only: which APNs the token belongs to. The sender picks the endpoint with it. */
	environment?: 'development' | 'production';
	/** The Android package or the iOS bundle id: the APNs topic. */
	app: string;
};
```

Keep the whole object: the sender needs `provider` to pick the service, `environment` to pick APNs's sandbox or production host, and `app` as the topic.

Asking at the moment the user turns notifications on, with a button, is kinder than asking at launch. At each later start the permission is already `'granted'`, and `subscribe` only refreshes the token:

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import { push } from 'expo-svelte/push';
	import { savePushToken } from '#lib/push.remote.ts';
	import { session } from '#lib/session.svelte.ts';

	let { children } = $props();

	$effect(() => {
		if (session.signedIn && push.permission === 'granted') {
			push.subscribe({ save: savePushToken }).catch(console.error);
		}
	});
</script>

{@render children()}
```

#### Hooks

The app answers the three things a push can do to it with the `push` export of [`src/hooks.mobile.ts`](hooks):

```ts
/// file: src/hooks.mobile.ts
import { page } from '$app/state';
import type { PushHooks } from 'expo-svelte/push';
import { syncInbox } from '#lib/inbox.ts';
import { session } from '#lib/session.svelte.ts';

export const push: PushHooks = {
	// A message arrived while the app is open: how to show it.
	foreground: (message) => ({ banner: message.url !== page.url.pathname }),

	// A silent message woke the app. No screen is mounted.
	background: async (message) => {
		await syncInbox(message.data.inbox);
	},

	// A notification was tapped. Return false to stop its url from opening.
	opened: (message) => {
		if (message.url?.startsWith('/account') && !session.signedIn) return false;
	}
};
```

Every hook is optional. They run where `init` runs, so also in a launch without a screen, and they wait for `init` to settle. A hook that throws is logged with `console.error` and its default applies.

A hook gets a `PushMessage`:

```ts
type PushMessage = {
	id: string;
	title?: string;
	body?: string;
	/** The link a tap opens: a path of the app ('/orders/42') or a full link. */
	url?: string;
	/** The sender's `data`: strings only, as both providers carry them. */
	data: Record<string, string>;
	provider: 'fcm' | 'apns';
};
```

**`foreground(message)`** decides how a message that arrives while the app is open is shown. Return `{ banner, sound, badge }`, each `true` or `false`; a member you leave out is `true`, and so is the whole answer when you return nothing. The default is to show the message as the system would with the app in the background: a banner, with its sound and badge. `banner: false` shows nothing, for a message your own screen handles. On iOS, `sound` and `badge` choose what the banner does. On Android there is no badge, and the sound is the channel's, so `sound: false` shows the notification without it. The hook has 900 milliseconds to answer. One that takes longer gets the default, so don't wait for the network in it.

To react to a message in a screen, for example to refresh a list, listen with `push.on('message', listener)`. It hears each message that arrives in the foreground, after the `foreground` hook has decided how it shows, and returns the function that stops listening, so an effect can return it:

```svelte
<script lang="ts">
	import { push } from 'expo-svelte/push';

	$effect(() => push.on('message', () => orders.refresh()));
</script>
```

**`background(message)`** runs for a silent message when the app is in the background or closed. No screen is mounted: the app's JavaScript starts, runs `init` and the hook, and the native side holds the process until the hook's promise settles or its limit passes. The time is short and the system's to give: Android lets the hook run for 18 seconds, iOS for 25, and iOS decides for itself how often it wakes an app for a silent push, delaying or dropping them as it sees fit. Use it to keep data fresh. Nothing that must happen belongs in it. On Android, Firebase hands messages to the app one at a time, so a slow hook holds up the next message too; keep it to a few seconds.

**`opened(message)`** runs when a notification is tapped, whether the app was closed, in the background or open, and for the tap that launched the app too. Return `false` to stop its `url` from opening. Keep it quick: the router waits only three seconds for the link a launch carries. On Android, a notification that the system showed while the app was away comes back here with its `id`, `url` and `data` and without its `title` and `body`. Treat what `opened` gets as untrusted input, as you would a link: on Android another app can start yours with the same extras a tap carries, so a message here is not proof that your server sent it. Its `url` can only open a screen of your app, but don't act on its `data` (a payment, a deletion) without checking with your server.

#### A tap opens a link

When `opened` doesn't return `false` and the message has a `url`, the tap opens it through the router, the way any link to your app opens. A path of the app, `/orders/42`, is read by its path. A full link, `myapp://orders/42` or an https link your app handles, is used as it is. A tap that launches the app makes the link the first screen, with no back button; a tap while the app runs opens it like any link that arrives then. A link that matches no route is ignored, and a message without a `url` just opens the app.

An app that reads `Linking` itself sees a path as `https://app.invalid/orders/42`. The router ignores the host, and `.invalid` can never be a real site.

### On the server

The sender is in `expo-svelte/push/server`. It is built for Node, has no dependencies, and runs nothing on the device, so import it from server code only. Make one `createPush` for the process:

```ts
/// file: src/lib/server/push.ts
import { createPush } from 'expo-svelte/push/server';
import { env } from '$env/dynamic/private';

export const push = createPush({
	fcm: { serviceAccount: env.FCM_SERVICE_ACCOUNT }, // the key's JSON
	apns: { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID } // the .p8's contents
});
```

A provider with none of its options set is not configured: the module loads without secrets, and the first send to it throws. One that is set but wrong (JSON that doesn't parse, a key of the wrong kind, only two of the three APNs values) throws in `createPush`, without quoting the secret. A `.p8` whose line breaks were written as `\n` in an environment variable is accepted.

| Option | Description |
| --- | --- |
| `fcm.serviceAccount` | The service account key's JSON, as text or as an object. |
| `apns.key`, `apns.keyId`, `apns.teamId` | The `.p8`'s contents, its key id and your team id. All three, or none. |
| `timeout` | Milliseconds a send waits for a provider before it answers `unavailable` and drops the connection. Default `30000`. |

`fcm.baseUrl`, `fcm.tokenUrl`, `apns.productionUrl` and `apns.sandboxUrl` replace the providers' addresses, for tests and proxies.

#### Sending

```ts
import { push } from '$lib/server/push';

const result = await push.send(token, {
	title: 'Order ready',
	body: 'Pickup at gate 3',
	url: '/orders/42'
});

if (!result.ok && result.reason === 'gone') await deleteToken(token);
```

`send(token, message)` sends one message to one device and resolves with what happened. It never queues or retries, each request to a provider waits at most `timeout` (the first FCM send of a process makes two: the access token, then the message), and it never throws for a provider's answer. It throws a `TypeError` for a bug in your code: a token or message that is not of the type, a notification with neither `title` nor `body`, a `silent` message with a `title`, `body`, `badge`, `sound` or `channel`, a `url` also given in `data`, a `data.aps` on APNs, a `collapseKey` that isn't printable ASCII without spaces on APNs, or a send to a provider that isn't configured.

The one retry it makes is its own: when APNs answers `ExpiredProviderToken`, it signs a new provider token and sends once more.

`close()` waits for the sends in flight and ends the connections to APNs. The sender keeps one HTTP/2 connection per APNs host open and reuses it, as Apple wants, so call `close()` when the server shuts down or a script is done; otherwise the process doesn't exit. A send after `close()` answers `unavailable`.

#### What a send returns

```ts
type SendResult =
	| { ok: true; id: string }
	| {
			ok: false;
			reason: 'gone' | 'invalid-token' | 'invalid-message' | 'rate-limited' | 'unavailable' | 'auth' | 'error';
			retryAfter?: number; // milliseconds, when the provider gave one
			status?: number; // the provider's HTTP status, when it answered
			detail: string; // the provider's own reason, or what went wrong on the way
	  };
```

| `reason` | What it means | What to do |
| --- | --- | --- |
| `gone` | The token will never work again: the app was uninstalled, or the provider unregistered it. | Delete the token. |
| `invalid-token` | The provider doesn't accept the token: it isn't a token, or it is for another bundle id than its `app` says. | Don't retry. Delete the token. If many tokens answer this at once, look at where the tokens' `app` and `environment` come from first. |
| `invalid-message` | The provider refused the message, for example a payload that is too large. | Don't retry as it is. Fix the message. |
| `rate-limited` | The provider asks you to slow down. | Retry later with a backoff, after `retryAfter` when it is given. |
| `unavailable` | The provider didn't answer in time, or is down. | Retry later, as for `rate-limited`. |
| `auth` | The server's credentials are wrong or revoked: the service account, or the APNs key or its right to your app. FCM's `SENDER_ID_MISMATCH` is one: the token belongs to another Firebase project than the service account's. | Don't retry, and don't delete the token. Fix the credentials, and treat a rise in these as an incident. |
| `error` | Anything else. `status` and `detail` say what. | Don't retry. Log it. |

`gone` and `invalid-token` tell you to delete a token, so only the provider's own word decides them: FCM's `UNREGISTERED`, APNs's `Unregistered` and `ExpiredToken`, `BadDeviceToken` and `DeviceTokenNotForTopic`. A bare 404 or 410 is `error`, because a wrong `project_id` answers 404 too, and a misconfigured server must not delete every token it has; for the same reason FCM's `SENDER_ID_MISMATCH`, which every token answers when the server has another project's credentials, is `auth`. A device doesn't save a token it saved before, so a token deleted by mistake stays deleted until it changes.

#### The message

| Field | Description |
| --- | --- |
| `title`, `body` | The notification's text. A notification needs at least one. |
| `url` | The link a tap opens: a path of the app or a full link. Sent as the data key `url`. |
| `data` | Strings only. Sent as FCM's `data` and as custom keys beside `aps`. |
| `silent` | `true` for a data message: nothing is shown, and the app's `background` hook runs. It has no `title`, `body`, `badge`, `sound` or `channel`. On iOS it goes as a background push at priority 5, whatever `priority` says. |
| `badge` | iOS: the app icon's badge, a whole number of 0 or more. Not sent to Android, which has no reliable count. |
| `sound` | `'default'`, the default for a notification, or `null` to send none. On Android the channel decides the sound, so `null` doesn't make a notification silent there. |
| `channel` | Android: the id of the notification channel. Default: the channel in the config. Not sent to iOS. |
| `collapseKey` | A newer message with the same key replaces an older one the provider still holds. FCM's `collapse_key`, APNs's `apns-collapse-id`. On APNs it must be printable ASCII without spaces, else `send` throws. |
| `priority` | `'high'` or `'normal'`. FCM's `HIGH` and `NORMAL`, APNs's 10 and 5. |
| `ttl` | Seconds the provider keeps the message for a device that is offline. `0` delivers at once or not at all. |

### What your app owns

The sender sends and says what happened. These are yours:

- **A queue.** Send from a job, not from the request that caused it. A send can take seconds or fail, and the user's request shouldn't wait for it or lose it.
- **Retries.** On `rate-limited` and `unavailable`, retry with backoff, after `retryAfter` when it is given, a bounded number of times. Never retry `invalid-token`, `invalid-message`, `auth`, `error` or `gone`.
- **Tokens.** Store the whole `PushToken` per user and device, upsert it in `save`, and delete it on `gone` and on sign-out. A token that hasn't changed isn't saved again, so `save` is not a sign that the device is alive: don't prune by the date it last ran.
- **Fan-out.** Sending to many devices is many `send`s. Run them concurrently with a limit; one HTTP/2 connection to APNs carries many. FCM topics and APNs broadcast are not in version 1.
- **Rate limits.** FCM and APNs throttle a sender that sends too much too fast, and a device that gets too many messages.
- **Idempotency.** A retried job can send twice. `collapseKey` only helps in part: a provider keeps one of the messages that share a key while the device is offline, and iOS shows messages with the same key as one notification, but Android doesn't replace a notification it has already shown. Record that a job's message went to a device, and skip it the second time.
- **Watching it.** Log every result's `reason`. A rise in `auth` or `invalid-message` is a bug, not noise.

A sketch of the recipe, with a job queue of your choice (Postgres, Redis, a cloud queue). One job is one message to one device, so a retry never repeats a send that worked:

```ts
/// file: src/lib/server/push-jobs.ts
import type { PushSend, PushToken } from 'expo-svelte/push/server';
import * as db from './db';
import { push } from './push';
import { queue } from './queue'; // your queue: add(job, { delay })

type Job = { token: PushToken; message: PushSend; sendId: string; attempt: number };

const MAX_ATTEMPTS = 5;

/** Queue one message for every device of a user. */
export async function notify(userId: string, message: PushSend) {
	const sendId = crypto.randomUUID();
	for (const token of await db.pushTokens(userId)) {
		await queue.add({ token, message, sendId, attempt: 0 });
	}
}

/** The queue's worker: one message to one device. */
export async function work(job: Job) {
	if (await db.wasSent(job.sendId, job.token.token)) return; // a job that ran twice
	const result = await push.send(job.token, job.message);
	if (result.ok) return db.markSent(job.sendId, job.token.token);

	switch (result.reason) {
		case 'gone':
		case 'invalid-token':
			return db.deletePushToken(job.token);
		case 'rate-limited':
		case 'unavailable':
			if (job.attempt + 1 < MAX_ATTEMPTS) {
				const backoff = Math.min(1000 * 2 ** job.attempt, 60_000);
				return queue.add({ ...job, attempt: job.attempt + 1 }, { delay: result.retryAfter ?? backoff });
			}
	}
	console.warn('push not delivered', result.reason, result.status, result.detail);
}
```

### Testing

On the iOS simulator, `xcrun simctl push` delivers an alert to an app that is running. That is enough to try the `foreground` hook, the message you get, a tap and the link it opens. Put the payload in a file, with your `url` as a key beside `aps`:

```json
/// file: payload.json
{
	"aps": { "alert": { "title": "Order ready", "body": "Pickup at gate 3" } },
	"url": "/orders/42"
}
```

```sh
xcrun simctl push booted dev.example.myapp payload.json
```

The simulator doesn't deliver a silent push, neither to an app in the background nor by launching one that isn't running, so the `background` hook, and a launch without a screen, can only be tried on a device.

A device needs a paid Apple Developer team for the entitlement. On Android, FCM needs Google Play services, so an emulator needs a system image with Google Play. A phone with Google Play services works as it is; a phone without them (Huawei's) does not.

`expo-svelte doctor` has a push section when the app has push. It checks the package and its version, a second push library, `capabilities.push` in `app.json`, the Google services file (it parses, it holds no secret, and it has a client for your package) and, after a prebuild, the iOS entitlement and background mode. It does not check the signing team: Xcode refuses to sign the entitlement with a Personal Team. `expo-svelte doctor --server` checks your server's credentials instead: it reads the variables below, loads the keys, and asks each provider once whether it accepts them. [Command line](cli#the-push-section) has the details.

`expo-svelte push send` sends one message to one token from the command line, with your server's credentials in `FCM_SERVICE_ACCOUNT`, or `APNS_KEY`, `APNS_KEY_ID` and `APNS_TEAM_ID`. It is for trying a device without writing a server first. The command line also takes the path of the key's file in `FCM_SERVICE_ACCOUNT` and `APNS_KEY`; `createPush` takes the contents only. Its options are in [Command line](cli#push).

### Limits

#### On iOS

A silent push can start the app in the background. The plugin makes that launch run your JavaScript, `init` and the hooks, and start the first screen when the user opens the app. Two things follow:

- **The splash screen.** An app that calls `SplashScreen.preventAutoHideAsync()` and then `SplashScreen.hideAsync()` from `init` can leave the splash up after a background launch: `init` ran with no screen, so the hide was spent before the screen existed. Hide the splash from the first screen, `+layout.mobile.svelte`, and not from `init`. This is not fixed in version 1.
- **Expo's scene-based template.** The iOS 27 template of Expo moves `startReactNative` into `ExpoAppSceneDelegate`. The plugin finds no call to wrap in `AppDelegate.swift` there, so it stops the prebuild with an error:

  ```
  Svelte native could not find the imports and `factory.startReactNative(withModuleName: …, in: window, launchOptions: launchOptions)` in application(_:didFinishLaunchingWithOptions:) of AppDelegate.swift. Push needs the call to keep a launch in the background (a silent push) from mounting the first screen.
  ```

  Push doesn't support that template yet.

#### Not in version 1

- Scheduled local notifications. Push shows a notification now, which it needs for the foreground, and schedules nothing.
- Action buttons and categories.
- Images in a notification (on iOS, a notification service extension).
- FCM topics and APNs broadcast.
- Web push (the same `push.subscribe` on a `+page.svelte`, over the browser's Push API).
- Phones without Google services (Huawei's HMS).
- iOS provisional and critical alerts.
- Live Activities.

## With React Native Firebase

`@react-native-firebase/messaging`. React Native Firebase uses Firebase Cloud Messaging on both platforms. On iOS, FCM hands each message to APNs with the APNs key you upload to Firebase, so the device's token is an FCM token on both. Your server sends with Google's `firebase-admin`. Its functions are plain JavaScript, so they work in an Expo Svelte app; the parts this library does for the standalone package (opening a tap's link, a background launch with no screen) are yours to write, and the code below does them.

> **info** **Still send from a job.** `firebase-admin` doesn't queue either, so send from a job, not from the user's request, and keep the tokens in a table. Firebase lightens the rest: `sendEachForMulticast` sends one message to up to 500 tokens, and topics let Firebase do the fan-out. Delete a token when a send fails with `messaging/registration-token-not-registered`.

### Setting up Firebase

Create a Firebase project and add both apps to it: download `google-services.json` (Android) and `GoogleService-Info.plist` (iOS). In the project's settings, under Cloud Messaging, upload your APNs key (the `.p8`, its key id and your team id). For the server, create a service account key, as for the standalone package.

```sh
npx expo install @react-native-firebase/app @react-native-firebase/messaging expo-build-properties
```

```ts
/// file: app.config.ts
export default {
	expo: {
		android: { package: 'dev.example.myapp', googleServicesFile: './google-services.json' },
		ios: {
			bundleIdentifier: 'dev.example.myapp',
			googleServicesFile: './GoogleService-Info.plist',
			entitlements: { 'aps-environment': 'production' },
			infoPlist: { UIBackgroundModes: ['remote-notification'] }
		},
		plugins: [
			'expo-svelte',
			'@react-native-firebase/app',
			'@react-native-firebase/messaging',
			// Firebase's iOS pods build as static frameworks.
			['expo-build-properties', { ios: { useFrameworks: 'static' } }]
		]
	}
};
```

Leave `capabilities.push` out of the `expo-svelte` plugin's options. Firebase's plugins don't write the iOS push entitlement or the background mode, so the config sets them: `'aps-environment'` is `'development'` for a build signed for development. Then prebuild and build again.

### Receiving with Firebase

A message that arrives while the app is in the background or closed goes to Firebase's background handler. On Android, Firebase runs it as a headless task, which starts your JavaScript with no screen, so register it where it runs before anything else: the top level of [`src/hooks.mobile.ts`](hooks).

```ts
/// file: src/hooks.mobile.ts
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import { syncInbox } from '#lib/inbox.ts';

setBackgroundMessageHandler(getMessaging(), async (message) => {
	if (message.data?.inbox) await syncInbox(String(message.data.inbox));
});
```

The rest belongs to the app's first screen: the permission, the token, messages in the foreground, and taps. A tap is not a link here, so the code opens the message's `url` with `goto`, from a tap that launched the app (`getInitialNotification`) and from one while it runs (`onNotificationOpenedApp`):

```ts
/// file: src/lib/push.ts
import { goto } from '$app/navigation';
import { Platform } from 'expo-svelte/platform';
import {
	AuthorizationStatus,
	getInitialNotification,
	getMessaging,
	getToken,
	onMessage,
	onNotificationOpenedApp,
	onTokenRefresh,
	requestPermission,
	type RemoteMessage
} from '@react-native-firebase/messaging';
import PermissionsAndroid from 'react-native/Libraries/PermissionsAndroid/PermissionsAndroid';
import { savePushToken } from '#lib/push.remote.ts';

const messaging = getMessaging();

function open(message: RemoteMessage | null) {
	const url = message?.data?.url;
	if (typeof url === 'string') goto(url);
}

/** Asks for the permission and saves the token. Call it when the user turns notifications on. */
export async function subscribe() {
	if (Platform.OS === 'android') {
		// Android 13 and later ask for POST_NOTIFICATIONS; Firebase's requestPermission only asks on iOS.
		const answer = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
		if (answer !== 'granted') return;
	} else {
		const status = await requestPermission(messaging);
		if (status !== AuthorizationStatus.AUTHORIZED && status !== AuthorizationStatus.PROVISIONAL) return;
	}
	await savePushToken({ provider: 'fcm', token: await getToken(messaging) });
}

/** Listens for tokens, messages and taps while the app runs. Returns what stops it. */
export function listen(onForeground: (message: RemoteMessage) => void) {
	getInitialNotification(messaging).then(open);
	const stops = [
		onNotificationOpenedApp(messaging, open),
		onMessage(messaging, async (message) => onForeground(message)),
		onTokenRefresh(messaging, (token) => savePushToken({ provider: 'fcm', token }))
	];
	return () => stops.forEach((stop) => stop());
}
```

```svelte
<!--- file: src/routes/+layout.mobile.svelte --->
<script lang="ts">
	import { listen } from '#lib/push.ts';

	let { children } = $props();

	// FCM shows nothing while the app is open: a message in the foreground is the app's to show.
	$effect(() => listen((message) => console.log('message', message.notification?.title)));
</script>

{@render children()}
```

The effect runs once the router has mounted, so `goto` has a router to drive, and the launch tap opens its screen over the first one. `savePushToken` is your remote function, as in [Permission and token](#permission-and-token), with a schema for this token's shape.

### Sending with firebase-admin

```ts
/// file: src/lib/server/push.ts
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '$env/dynamic/private';

const messaging = getMessaging(initializeApp({ credential: cert(JSON.parse(env.FCM_SERVICE_ACCOUNT)) }));

export async function send(token: string, title: string, body: string, url: string) {
	try {
		await messaging.send({
			token,
			notification: { title, body },
			data: { url },
			apns: { payload: { aps: { sound: 'default' } } }
		});
	} catch (error) {
		if ((error as { code?: string }).code === 'messaging/registration-token-not-registered') await deleteToken(token);
		else throw error; // let the job retry
	}
}
```

A data-only message (no `notification`) reaches `setBackgroundMessageHandler`; on iOS it also needs `apns: { headers: { 'apns-priority': '5', 'apns-push-type': 'background' }, payload: { aps: { 'content-available': 1 } } }`.

### Limits with Firebase

- **A silent push on iOS mounts the first screen.** iOS starts the app in the background, and the screen mounts nobody can see. Only the standalone package keeps it from mounting.
- **Taps are your code.** A tap's `url` opens because `listen` calls `goto`; a layout that doesn't run it opens nothing.
- **React hooks don't run.** React Native Firebase's API is functions, so it works; anything a guide shows as a React hook or component doesn't. See [Native libraries](native-libraries#functions-work-hooks-dont).

## With Expo notifications

`expo-notifications`. Your server sends to Expo's push service with an Expo push token, and Expo delivers the message through FCM and APNs with the credentials you give it in your EAS project. You keep no Apple or Google key on your server: it holds an Expo access token. Expo batches requests and retries the providers for you.

> **info** **Still send from a job, and check the receipts.** Expo answers a send with a ticket, and about 15 minutes later it has a receipt that says whether Apple or Google took the message. A receipt of `DeviceNotRegistered` means delete the token. So you run two jobs: one that sends, and a delayed one that reads the receipts.

### Setting up Expo notifications

You need an EAS project (`eas init` writes its id into the config as `extra.eas.projectId`). Upload the credentials there with `eas credentials`: a Firebase service account key for Android (FCM V1), and an APNs key for iOS, which EAS can create for you. Android also needs a Firebase project's `google-services.json` in the app, because Expo delivers to Android through FCM.

```sh
npx expo install expo-notifications expo-constants expo-task-manager
```

```ts
/// file: app.config.ts
export default {
	expo: {
		android: { package: 'dev.example.myapp', googleServicesFile: './google-services.json' },
		ios: { bundleIdentifier: 'dev.example.myapp' },
		extra: { eas: { projectId: 'your-eas-project-id' } },
		plugins: [
			'expo-svelte',
			['expo-notifications', { icon: './assets/notify.png', color: '#0a7f5a', enableBackgroundRemoteNotifications: true }]
		]
	}
};
```

Leave `capabilities.push` off. Expo's plugin writes the push entitlement and the background mode itself. Then prebuild and build again.

### Receiving with Expo notifications

How a message shows while the app is open, and the background task, are set where they run first, the top level of [`src/hooks.mobile.ts`](hooks):

```ts
/// file: src/hooks.mobile.ts
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { syncInbox } from '#lib/inbox.ts';

Notifications.setNotificationHandler({
	handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
});

const BACKGROUND = 'push-background';
TaskManager.defineTask<Notifications.NotificationTaskPayload>(BACKGROUND, async ({ data }) => {
	if (!('actionIdentifier' in data)) await syncInbox();
});
Notifications.registerTaskAsync(BACKGROUND);
```

The permission, the token and taps go in the app, as with Firebase. `useLastNotificationResponse` is a React hook and doesn't run in Expo Svelte; `getLastNotificationResponse()` gives the same tap:

```ts
/// file: src/lib/push.ts
import { goto } from '$app/navigation';
import { Platform } from 'expo-svelte/platform';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { savePushToken } from '#lib/push.remote.ts';

function open(response: Notifications.NotificationResponse | null) {
	const url = response?.notification.request.content.data?.url;
	if (typeof url === 'string') goto(url);
}

/** Asks for the permission and saves the Expo push token. Call it when the user turns notifications on. */
export async function subscribe() {
	if (Platform.OS === 'android') {
		// Android 13 asks only an app that has a channel.
		await Notifications.setNotificationChannelAsync('default', { name: 'Updates', importance: Notifications.AndroidImportance.HIGH });
	}
	const { granted } = await Notifications.requestPermissionsAsync();
	if (!granted) return;
	const { data } = await Notifications.getExpoPushTokenAsync({ projectId: Constants.expoConfig?.extra?.eas?.projectId });
	await savePushToken({ provider: 'expo', token: data });
}

/** Listens for messages and taps while the app runs. Returns what stops it. */
export function listen(onForeground: (notification: Notifications.Notification) => void) {
	open(Notifications.getLastNotificationResponse());
	const received = Notifications.addNotificationReceivedListener(onForeground);
	const tapped = Notifications.addNotificationResponseReceivedListener(open);
	return () => {
		received.remove();
		tapped.remove();
	};
}
```

Call `listen` from the root `+layout.mobile.svelte` in an `$effect`, as in the Firebase example.

### Sending with expo-server-sdk

```ts
/// file: src/lib/server/push.ts
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { env } from '$env/dynamic/private';

const expo = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN });

/** The send job: returns the ticket ids for the receipts job. */
export async function send(messages: ExpoPushMessage[]) {
	const ids: string[] = [];
	for (const chunk of expo.chunkPushNotifications(messages)) {
		for (const ticket of await expo.sendPushNotificationsAsync(chunk)) {
			if (ticket.status === 'ok') ids.push(ticket.id);
			else if (ticket.details?.error === 'DeviceNotRegistered') await deleteToken(ticket.details.expoPushToken);
		}
	}
	return ids; // queue the receipts job for about 15 minutes from now
}

/** The receipts job. */
export async function checkReceipts(ids: string[]) {
	for (const chunk of expo.chunkPushNotificationReceiptIds(ids)) {
		const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
		for (const receipt of Object.values(receipts)) {
			if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') await deleteToken(receipt.details.expoPushToken);
		}
	}
}
```

A message is `{ to: token, title, body, data: { url: '/orders/42' } }`; `_contentAvailable: true` with no `title` makes it a background message on iOS.

### Limits with Expo

- **A silent push on iOS mounts the first screen**, as with Firebase.
- **Taps are your code**: `listen` calls `goto`.
- **Expo is in the path.** Every message goes through Expo's service, and your EAS project holds the keys that can send to all your users.
- **React hooks don't run**: use `getLastNotificationResponse()`, not `useLastNotificationResponse()`.
